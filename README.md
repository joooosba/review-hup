# 리뷰 허브 (review-hub)

리뷰노트 · 디너의여왕 · 강남맛집의 **공개 체험단 목록**을 한 화면에서 골라 보는 개인용 대시보드입니다.
GitHub Pages 정적 사이트 + GitHub Actions 수집기로 돌아갑니다.

- 사이트: <https://joooosba.github.io/review-hub/>
- 기본 필터: **구로구 · 영등포구 · 관악구** / **경쟁률 5:1 이상** / **제공 금액 4만 원 이상**
- 추가 필터: 강서구, 서울 전체, 배송형, 경쟁률·금액 슬라이더, 금액 미표기 포함, 얼굴 노출 숨기기, 키워드 검색, 마감임박·경쟁률·금액 정렬

## 구조

```
index.html  style.css  app.js      화면 (정적, 빌드 없음)
data/public_campaigns.json         리뷰노트 · 디너의여왕 (Actions가 자동 갱신)
data/gangnam.json                  강남맛집 (한국 IP 수집 스냅샷, 수동 갱신)
scripts/collect_public.py          수집기 (리뷰노트 API + 디너의여왕 HTML)
scripts/build_gangnam.py           강남맛집 raw → JSON 변환
raw/gangnam_*.txt                  강남맛집 원본 (브라우저에서 받아 둔 목록)
.github/workflows/update.yml       매일 KST 09·15·21시 수집 + 커밋
```

## 데이터 갱신

- **자동**: `.github/workflows/update.yml` 이 `cron: "0 0,6,12 * * *"`(KST 09:00/15:00/21:00)과 수동 실행(`workflow_dispatch`)으로
  `scripts/collect_public.py` 를 돌려 `data/public_campaigns.json` **만** 커밋합니다. `data/gangnam.json` 은 건드리지 않습니다.
- **강남맛집**: `xn--939au0g4vj8sq.net` 은 해외 IP를 막아 GitHub Actions(미국 러너)에서 접속되지 않습니다.
  한국 IP 브라우저에서 `/cp/?ca=20&loca_prt=서울&local_1=구로/금천&local_2=구로구|금천구` 같은 지역 목록과
  `/cp/?ca=30`(제품=배송형) 목록을 읽어 `raw/gangnam_*.txt` 로 저장한 뒤 `python scripts/build_gangnam.py` 로 `data/gangnam.json` 을 만듭니다.
  (raw 형식: `id|제목|유형 또는 채널|남은기간|제공내역|신청 n / 모집 m|썸네일 경로`)

## 수집 범위와 예의

- 로그인·신청 없이 **공개 목록만** 읽습니다. 개인정보·계정 정보는 저장하지 않습니다.
- 리뷰노트: 공개 API `/api/v2/campaigns` (구별 조회, 배송형, 서울 전체 보강). 상세 페이지는 robots.txt 가 `Disallow` 라 수집하지 않고 링크만 겁니다.
- 디너의여왕: `/taste` 서버렌더 HTML (여의도/영등포/구로, 관악/신림, 강서/목동/마곡, 배송).
- 강남맛집: `/cp/` 목록 HTML. robots.txt 는 `/cp/` 목록을 허용합니다.
- 쿼리당 최대 20페이지, 요청 사이 0.2초 간격(`MAX_PAGES` 환경변수로 조정).

## 데이터 형식

```json
{
  "generated_at": "2026-11-25T15:28:36+09:00",
  "sources": { "reviewnote": { "label": "리뷰노트", "updated_at": "...", "count": 1598 } },
  "campaigns": [
    {
      "site": "리뷰노트", "id": "1517928",
      "title": "...", "offer": "...",
      "kind": "방문형", "channel": "블로그",
      "regions": ["구로구"], "regionText": "서울 구로구",
      "applicants": 3, "capacity": 10, "ratio": 0.3,
      "amount": 45000, "deadline": "2026-12-01", "dday": 6,
      "image": "https://...", "url": "https://..."
    }
  ]
}
```

`amount` 는 제공 내역 텍스트에서 뽑은 금액(최댓값)이며, 숫자가 없으면 `null`(화면에서 ‘금액 미표기’)입니다.
`dday`/`deadline` 은 수집 시점 기준으로 계산합니다.

## 참고

- 개인용 대시보드입니다. 각 사이트의 이용약관·로봇 정책을 존중하며 저빈도로만 읽습니다.
- 신청·로그인은 각 사이트에서 직접 합니다. 이 사이트는 링크만 연결합니다.
