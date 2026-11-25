#!/usr/bin/env python3
"""강남맛집 초기 데이터 빌드 (한국 IP 브라우저에서 받아 둔 원본 → data/gangnam.json).

강남맛집(xn--939au0g4vj8sq.net)은 해외 IP를 막아 GitHub Actions에서 수집할 수 없다.
그래서 한국 IP 브라우저로 목록을 읽어 raw/*.txt 로 남기고, 이 스크립트로 JSON을 만든다.
원본 형식(탭 아님, '|' 구분):
    id|제목|유형(방문형/배송형)|남은기간|제공내역|신청 n / 모집 m|썸네일 경로
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "raw")
OUT = os.path.join(ROOT, "data", "gangnam.json")
KST = timezone(timedelta(hours=9))

spec = importlib.util.spec_from_file_location("cp", os.path.join(HERE, "collect_public.py"))
cp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cp)

RAW_FILES = {
    "gangnam_guro.txt": "구로/금천",
    "gangnam_yeongdeungpo.txt": "여의도/영등포",
    "gangnam_gwanak.txt": "관악/신림",
    "gangnam_gangseo.txt": "강서/목동",
    "gangnam_delivery.txt": "배송형",
}
IMG_BASE = "https://gangnam-review.net/data/file/cmp/"
PAGE_BASE = "https://xn--939au0g4vj8sq.net/cp/?id="


def build() -> dict:
    now = datetime.now(KST)
    rows: dict[str, dict] = {}
    for fname, area in RAW_FILES.items():
        path = os.path.join(RAW, fname)
        if not os.path.exists(path):
            print(f"건너뜀(원본 없음): {fname}", file=sys.stderr)
            continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                parts = line.split("|")
                if len(parts) < 7:
                    print(f"형식 오류 건너뜀: {line[:60]}", file=sys.stderr)
                    continue
                pid, title, third, dday_text, offer, numb, img = (p.strip() for p in parts[:7])
                # 3번째 칸: 지역 목록은 유형(방문형/배송형), 배송형 목록은 채널(Blog/Clip)
                if third in ("방문형", "배송형"):
                    kind, channel = third, ""
                else:
                    kind, channel = "배송형", third
                channel = {"Blog": "블로그", "Clip": "클립"}.get(channel, channel)
                cnt = re.findall(r"\d[\d,]*", numb)
                applicants = int(cnt[0].replace(",", "")) if cnt else 0
                capacity = int(cnt[1].replace(",", "")) if len(cnt) > 1 else 0
                dday, deadline = cp.parse_dday(dday_text)
                regions = cp.region_label_from_text(title)
                if kind == "배송형":
                    regions = []
                rec = cp.make_record(
                    site="강남맛집",
                    id=pid,
                    title=title,
                    offer=offer,
                    kind=kind or "방문형",
                    channel=channel,
                    regions=regions,
                    regionText="배송형" if kind == "배송형" else " ".join(regions) or area,
                    applicants=applicants,
                    capacity=capacity,
                    amount=cp.parse_amount(offer) or cp.parse_amount(title),
                    deadline=deadline,
                    dday=dday,
                    image=(IMG_BASE + img) if img else "",
                    url=PAGE_BASE + pid,
                )
                rows.setdefault(pid, rec)
    campaigns = list(rows.values())
    return {
        "generated_at": now.isoformat(timespec="seconds"),
        "note": "강남맛집은 한국 IP에서만 열려, 앱의 한국 IP 브라우저로 수집한 스냅샷입니다. "
                "GitHub Actions 자동 갱신 대상이 아니며, 필요할 때 다시 수집해 갱신합니다.",
        "sources": {
            "gangnammatjip": {
                "label": "강남맛집",
                "updated_at": now.isoformat(timespec="seconds"),
                "count": len(campaigns),
            }
        },
        "campaigns": campaigns,
    }


def main() -> int:
    payload = build()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"저장 완료: {OUT} ({len(payload['campaigns'])}건)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
