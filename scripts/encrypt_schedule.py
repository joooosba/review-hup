#!/usr/bin/env python3
"""체험단 일정 암호화 — Web Crypto API와 호환되는 PBKDF2(SHA-256, 100,000) + AES-256-GCM.

사용 예
    python3 scripts/encrypt_schedule.py --password '****' \
        --in data/my_schedule_plain.json --out data/my_schedule.enc.json
    # 비밀번호를 인자에 남기기 싫으면 환경변수를 쓴다.
    REVIEW_HUB_PW='****' python3 scripts/encrypt_schedule.py

    # 복호화 확인(라운드트립 검증)
    python3 scripts/encrypt_schedule.py --decrypt data/my_schedule.enc.json --password '****'

출력 형식은 브라우저의 crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ciphertext)와
그대로 맞물린다: salt 16바이트, iv 12바이트, ciphertext는 GCM 태그를 포함한 값의 base64.
비밀번호는 코드에 저장하지 않는다(인자 또는 환경변수만).
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from datetime import datetime, timedelta, timezone

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITERATIONS = 100_000
KEY_LEN = 32          # AES-256
SALT_LEN = 16
IV_LEN = 12
KDF = "PBKDF2-SHA256"
CIPHER = "AES-256-GCM"
KST = timezone(timedelta(hours=9))


def derive_key(password: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=KEY_LEN, salt=salt, iterations=ITERATIONS)
    return kdf.derive(password.encode("utf-8"))


def b64e(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def b64d(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"))


def encrypt(plain: dict, password: str) -> dict:
    data = json.dumps(plain, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    salt = os.urandom(SALT_LEN)
    iv = os.urandom(IV_LEN)
    ciphertext = AESGCM(derive_key(password, salt)).encrypt(iv, data, None)
    items = plain.get("items") or []
    return {
        "v": 1,
        "kdf": {"name": KDF, "iterations": ITERATIONS, "hash": "SHA-256"},
        "cipher": CIPHER,
        "salt": b64e(salt),
        "iv": b64e(iv),
        "ciphertext": b64e(ciphertext),
        "count": len(items),
        "generatedAt": datetime.now(KST).isoformat(timespec="seconds"),
    }


def decrypt(payload: dict, password: str) -> dict:
    if payload.get("kdf", {}).get("iterations") != ITERATIONS:
        print("경고: 예상과 다른 iteration 값입니다.", file=sys.stderr)
    key = derive_key(password, b64d(payload["salt"]))
    raw = AESGCM(key).decrypt(b64d(payload["iv"]), b64d(payload["ciphertext"]), None)
    return json.loads(raw.decode("utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser(description="체험단 일정 암호화 도구")
    ap.add_argument("--password", help="잠금 비밀번호 (없으면 REVIEW_HUB_PW 환경변수)")
    ap.add_argument("--in", dest="src", default="data/my_schedule_plain.json")
    ap.add_argument("--out", dest="dst", default="data/my_schedule.enc.json")
    ap.add_argument("--decrypt", metavar="ENC", help="복호화 검증만 수행하고 결과를 출력")
    args = ap.parse_args()

    password = args.password or os.environ.get("REVIEW_HUB_PW")
    if not password:
        ap.error("비밀번호가 필요합니다. --password 또는 REVIEW_HUB_PW 환경변수를 사용하세요.")

    if args.decrypt:
        with open(args.decrypt, encoding="utf-8") as fh:
            payload = json.load(fh)
        plain = decrypt(payload, password)
        items = plain.get("items") or []
        print(f"복호화 성공 · {len(items)}건 · generatedAt={plain.get('generatedAt')}")
        print(json.dumps(items[:2], ensure_ascii=False, indent=2))
        return 0

    with open(args.src, encoding="utf-8") as fh:
        plain = json.load(fh)
    if not isinstance(plain, dict) or not isinstance(plain.get("items"), list):
        print("입력 파일에 items 배열이 없습니다.", file=sys.stderr)
        return 2

    payload = encrypt(plain, password)
    # 저장 전에 같은 비밀번호로 풀리는지 확인한다.
    check = decrypt(payload, password)
    assert len(check.get("items", [])) == len(plain["items"])

    with open(args.dst, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    size = os.path.getsize(args.dst)
    print(f"암호화 완료 → {args.dst} ({size:,} bytes, {payload['count']}건, {ITERATIONS:,}회 PBKDF2)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
