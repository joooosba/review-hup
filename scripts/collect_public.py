#!/usr/bin/env python3
"""체험단 공개 목록 수집기 (리뷰노트 · 디너의여왕).

GitHub Actions(해외 IP)에서도 접근되는 두 사이트만 수집해 data/public_campaigns.json 으로 저장한다.
- 로그인/신청 없이 공개 목록(API·HTML)만 읽는다.
- 강남맛집은 해외 IP 차단이라 여기서 다루지 않는다(data/gangnam.json 은 별도 파일로 유지).
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

KST = timezone(timedelta(hours=9))
NOW = datetime.now(KST)
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
HEADERS = {
    "User-Agent": UA,
    "Accept-Language": "ko-KR,ko;q=0.9",
    "From": "review-hub (personal dashboard)",
}
DELAY = 0.2          # 요청 사이 간격(초)
MAX_PAGES = int(os.environ.get("MAX_PAGES", "20"))   # 쿼리당 최대 페이지

DISTRICTS = {        # 동네 기준 구 (기본 필터 + 강서구 여유분)
    "구로구": "135",
    "영등포구": "149",
    "관악구": "128",
    "강서구": "139",
}


# ---------------------------------------------------------------- 공통 파서
_AMOUNT_PATTERNS = [
    # 4만 5,000원 / 8만 9,000원
    (re.compile(r"(\d+)\s*만\s*(\d[\d,]*)\s*원"), "man_won"),
    # 16만 8천원
    (re.compile(r"(\d+)\s*만\s*(\d+)\s*천"), "man_cheon"),
    # 12만 / 3만5천 / 5만원
    (re.compile(r"(\d[\d,]*)\s*만(?:\s*(\d+)\s*천)?\s*원?"), "man"),
    # 45,000원 / 45000원
    (re.compile(r"(\d[\d,]{2,})\s*원"), "won"),
    # 8천원 / 3천 원
    (re.compile(r"(\d+)\s*천\s*원"), "cheon"),
    # '50,000' / '30, 000' 처럼 원 표기 없이 콤마만 찍은 금액 (1만 원 이상만)
    (re.compile(r"(\d{2,3}(?:,\s?\d{3})+)"), "comma"),
]


def parse_amount(text: str) -> int | None:
    """제공 내역 문자열에서 금액(원)을 뽑아 최댓값을 돌려준다. 못 찾으면 None."""
    if not text:
        return None
    text = re.sub(r"(?<=\d),\s+(?=\d{3}(?!\d))", ",", text or "")
    values: list[int] = []
    for rx, kind in _AMOUNT_PATTERNS:
        for m in rx.finditer(text):
            try:
                if kind == "man_won":
                    values.append(int(m.group(1)) * 10000 + int(m.group(2).replace(",", "")))
                elif kind == "man_cheon":
                    values.append(int(m.group(1)) * 10000 + int(m.group(2)) * 1000)
                elif kind == "man":
                    n = int(m.group(1).replace(",", "")) * 10000
                    if m.group(2):
                        n += int(m.group(2)) * 1000
                    values.append(n)
                elif kind in ("won", "comma"):
                    n = int(m.group(1).replace(",", "").replace(" ", ""))
                    if kind == "comma" and n < 10000:
                        continue
                    values.append(n)
                else:
                    values.append(int(m.group(1)) * 1000)
            except (ValueError, TypeError):
                continue
    values = [v for v in values if 1000 <= v <= 20_000_000]
    return max(values) if values else None


def parse_dday(text: str) -> tuple[int | None, str | None]:
    """'6일 남음' / '마감임박(하루전)' / '오늘마감' / 'D-3' → (남은일수, 마감일 ISO)"""
    if not text:
        return None, None
    t = text.replace(" ", "")
    days = None
    if "오늘" in t and "마감" in t:
        days = 0
    else:
        m = re.search(r"(\d+)일남음", t) or re.search(r"D-(\d+)", t, re.I)
        if m:
            days = int(m.group(1))
        elif "하루전" in t or "1일전" in t:
            days = 1
        elif "마감" in t and "임박" in t:
            days = 1
    if days is None:
        return None, None
    return days, (NOW.date() + timedelta(days=days)).isoformat()


def iso_to_kst_date(value: str) -> str | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.astimezone(KST).date().isoformat()


def region_label_from_text(text: str) -> list[str]:
    """제목/지역 문자열에서 서울 구 이름을 찾아 표준 표기로 돌려준다."""
    if not text:
        return []
    table = [
        ("구로", "구로구"), ("금천", "금천구"), ("영등포", "영등포구"), ("여의도", "영등포구"),
        ("관악", "관악구"), ("신림", "관악구"), ("서울대", "관악구"),
        ("강서", "강서구"), ("마곡", "강서구"), ("화곡", "강서구"), ("양천", "양천구"),
        ("목동", "양천구"),
    ]
    found = []
    for key, std in table:
        if key in text and std not in found:
            found.append(std)
    return found


def make_record(**kw) -> dict:
    amount = kw.get("amount")
    cap = kw.get("capacity") or 0
    app = kw.get("applicants") or 0
    ratio = round(app / cap, 2) if cap > 0 else None
    return {
        "site": kw["site"],
        "id": str(kw["id"]),
        "title": (kw.get("title") or "").strip(),
        "offer": (kw.get("offer") or "").strip(),
        "kind": kw.get("kind") or "방문형",
        "channel": kw.get("channel") or "",
        "regions": kw.get("regions") or [],
        "regionText": kw.get("regionText") or "",
        "applicants": app,
        "capacity": cap,
        "ratio": ratio,
        "amount": amount,
        "deadline": kw.get("deadline"),
        "dday": kw.get("dday"),
        "image": kw.get("image") or "",
        "url": kw.get("url") or "",
    }


# ------------------------------------------------------------ 리뷰노트
RN_API = "https://www.reviewnote.co.kr/api/v2/campaigns"
RN_IMG = "https://firebasestorage.googleapis.com/v0/b/reviewnote-e92d9.appspot.com/o/{}?alt=media"
RN_CHANNEL = {"BLOG": "블로그", "INSTA": "인스타", "INSTAGRAM": "인스타", "REELS": "릴스",
              "YOUTUBE": "유튜브", "CLIP": "클립", "TIKTOK": "틱톡", "SHORTS": "쇼츠", "PIN": "핀터레스트"}


def rn_channel_label(value: str) -> str:
    """'BLOG_CLIP' 처럼 여러 채널이 붙은 값을 '블로그·클립' 으로 읽기 좋게 바꾼다."""
    if not value:
        return ""
    parts = [RN_CHANNEL.get(t, t.capitalize()) for t in re.split(r"[_+/,]", value) if t]
    seen, out = set(), []
    for p in parts:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return "·".join(out)


def rn_fetch(params: dict, max_pages: int = MAX_PAGES) -> list[dict]:
    rows, page = [], 0
    while page < max_pages:
        q = {"limit": 16, "page": page, "s": "default", **params}
        r = requests.get(RN_API, params=q, headers={**HEADERS, "Accept": "application/json"}, timeout=25)
        r.raise_for_status()
        data = r.json()
        objs = data.get("objects") or []
        rows.extend(objs)
        if not objs or not data.get("has_more"):
            break
        page += 1
        time.sleep(DELAY)
    return rows


def rn_record(o: dict, regions: list[str], region_text: str = "") -> dict:
    offer = o.get("offer") or ""
    dday, deadline = parse_dday("")  # 리뷰노트는 ISO 마감일을 준다
    iso = iso_to_kst_date(o.get("applyEndAt") or "")
    if iso:
        deadline = iso
        try:
            dday = (datetime.fromisoformat(iso).date() - NOW.date()).days
        except ValueError:
            dday = None
    kind = "배송형" if (o.get("sort") == "DELIVERY" or o.get("city") == "재택") else "방문형"
    image = RN_IMG.format(quote(o.get("imageKey") or "", safe="")) if o.get("imageKey") else ""
    return make_record(
        site="리뷰노트",
        id=o.get("id"),
        title=o.get("title"),
        offer=offer,
        kind=kind,
        channel=rn_channel_label(o.get("channel") or ""),
        regions=regions,
        regionText=region_text or ("배송형" if kind == "배송형" else (o.get("city") or "")),
        applicants=o.get("applicantCount") or 0,
        capacity=o.get("infNum") or 0,
        amount=parse_amount(offer) or parse_amount(o.get("title") or ""),
        deadline=deadline,
        dday=dday,
        image=image,
        url="https://www.reviewnote.co.kr/campaigns/%s" % o.get("id"),
    )


def collect_reviewnote() -> list[dict]:
    out: dict[str, dict] = {}

    # 1) 동네(구)별 방문형
    for name, gid in DISTRICTS.items():
        try:
            rows = rn_fetch({"city": "서울", "sort": "VISIT", "gugunSelected": gid})
        except Exception as e:  # noqa: BLE001
            print(f"[reviewnote] {name} 수집 실패: {e!r}", file=sys.stderr)
            continue
        for o in rows:
            rec = rn_record(o, [name], f"서울 {name}")
            key = rec["id"]
            if key in out:
                for rg in rec["regions"]:
                    if rg not in out[key]["regions"]:
                        out[key]["regions"].append(rg)
            else:
                out[key] = rec
        print(f"[reviewnote] {name}: {len(rows)}건", file=sys.stderr)
        time.sleep(DELAY)

    # 2) 배송형(재택)
    try:
        for o in rn_fetch({"sort": "DELIVERY"}):
            rec = rn_record(o, [], "배송형")
            out.setdefault(rec["id"], rec)
    except Exception as e:  # noqa: BLE001
        print(f"[reviewnote] 배송형 수집 실패: {e!r}", file=sys.stderr)
    time.sleep(DELAY)

    # 3) 서울 전체(구 미지정 캠페인 보강)
    try:
        for o in rn_fetch({"city": "서울", "sort": "VISIT"}, max_pages=8):
            rec = rn_record(o, region_label_from_text(o.get("title") or ""), "서울")
            out.setdefault(rec["id"], rec)
    except Exception as e:  # noqa: BLE001
        print(f"[reviewnote] 서울 전체 보강 실패: {e!r}", file=sys.stderr)

    return list(out.values())


# ------------------------------------------------------------ 디너의여왕
DQ_URL = "https://dinnerqueen.net/taste"
DQ_AREAS = [
    ({"ct": "지역", "area1": "서울", "area2": "여의도/영등포/구로", "sns[]": "blog"}, ["영등포구", "구로구"]),
    ({"ct": "지역", "area1": "서울", "area2": "관악/신림", "sns[]": "blog"}, ["관악구"]),
    ({"ct": "지역", "area1": "서울", "area2": "강서/목동/마곡", "sns[]": "blog"}, ["강서구", "양천구"]),
]


def dq_cards(params: dict, max_pages: int = 8) -> list[dict]:
    cards, page = [], 1
    while page <= max_pages:
        q = {**params, "page": page}
        r = requests.get(DQ_URL, params=q, headers=HEADERS, timeout=25)
        if r.status_code != 200:
            break
        soup = BeautifulSoup(r.text, "html.parser")
        found = soup.select(".qz-dq-card.campaign")
        if not found:
            break
        for c in found:
            a = c.select_one("a.qz-dq-card__link")
            if not a:
                continue
            cards.append({"a": a, "c": c})
        page += 1
        time.sleep(DELAY)
    return cards


def dq_record(item: dict, fallback_regions: list[str]) -> dict | None:
    a, c = item["a"], item["c"]
    href = a.get("href") or ""
    m = re.search(r"/taste/(\d+)", href)
    if not m:
        return None
    title = c.select_one(".qz-dq-card__text p")
    sub = c.select_one(".qz-dq-card__text p + p")
    stat = c.select_one(".apply_badge")
    cnt = re.findall(r"\d[\d,]*", stat.get_text(" ", strip=True)) if stat else []
    applicants = int(cnt[0].replace(",", "")) if cnt else 0
    capacity = int(cnt[1].replace(",", "")) if len(cnt) > 1 else 0
    badges = [e.get_text(" ", strip=True) for e in c.select(".qz-dq-card__badge-row p")]
    title_text = title.get_text(" ", strip=True) if title else ""
    offer = sub.get_text(" ", strip=True) if sub else ""
    dday_text = c.select_one(".dday").get_text(" ", strip=True) if c.select_one(".dday") else ""
    dday, deadline = parse_dday(dday_text)
    img = c.select_one("img")
    kind = "배송형" if "배송" in badges else "방문형"
    regions = region_label_from_text(title_text) or list(fallback_regions)
    channel = ""
    for b in badges:
        if b in ("릴스", "클립", "기자단"):
            channel = b
    return make_record(
        site="디너의여왕",
        id=m.group(1),
        title=title_text,
        offer=offer,
        kind=kind,
        channel=channel or "블로그",
        regions=regions if kind != "배송형" else [],
        regionText=" ".join(regions) if kind != "배송형" else "배송형",
        applicants=applicants,
        capacity=capacity,
        amount=parse_amount(offer) or parse_amount(title_text),
        deadline=deadline,
        dday=dday,
        image=(img.get("src") if img else ""),
        url="https://dinnerqueen.net" + href,
    )


def collect_dinnerqueen() -> list[dict]:
    out: dict[str, dict] = {}
    for params, fallback in DQ_AREAS:
        try:
            items = dq_cards(params)
        except Exception as e:  # noqa: BLE001
            print(f"[dinnerqueen] {params.get('area2')} 수집 실패: {e!r}", file=sys.stderr)
            continue
        for it in items:
            rec = dq_record(it, fallback)
            if rec:
                out.setdefault(rec["id"], rec)
        print(f"[dinnerqueen] {params.get('area2')}: {len(items)}건", file=sys.stderr)
        time.sleep(DELAY)

    try:
        items = dq_cards({"ct": "배송"}, max_pages=8)
        for it in items:
            rec = dq_record(it, [])
            if rec:
                out.setdefault(rec["id"], rec)
        print(f"[dinnerqueen] 배송형: {len(items)}건", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"[dinnerqueen] 배송형 수집 실패: {e!r}", file=sys.stderr)

    return list(out.values())


# ---------------------------------------------------------------- main
def main() -> int:
    rn = collect_reviewnote()
    dq = collect_dinnerqueen()
    payload = {
        "generated_at": NOW.isoformat(timespec="seconds"),
        "sources": {
            "reviewnote": {"label": "리뷰노트", "updated_at": NOW.isoformat(timespec="seconds"), "count": len(rn)},
            "dinnerqueen": {"label": "디너의여왕", "updated_at": NOW.isoformat(timespec="seconds"), "count": len(dq)},
        },
        "campaigns": rn + dq,
    }
    os.makedirs("data", exist_ok=True)
    path = "data/public_campaigns.json"
    old = None
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                old = json.load(f)
        except json.JSONDecodeError:
            old = None
    # 캠페인 내용이 그대로면 generated_at 만 바뀌는 커밋을 만들지 않는다.
    if old and old.get("campaigns") == payload["campaigns"]:
        print("변경 없음 — 파일을 그대로 둡니다.", file=sys.stderr)
        return 0
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"저장 완료: {path} (리뷰노트 {len(rn)} · 디너의여왕 {len(dq)})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
