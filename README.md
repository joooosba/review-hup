# 리뷰 허브 (review-hub)

리뷰노트 · 디너의여왕 · 강남맛집의 **공개 체험단 목록**을 한 화면에서 골라 보는 개인용 대시보드입니다.
GitHub Pages 정적 사이트 + GitHub Actions 수집기로 돌아갑니다.

- 사이트: <https://joooosba.github.io/review-hub/>
- 기본 필터: **구로구 · 영등포구 · 관악구** / **경쟁률 5:1 이상** / **제공 금액 4만 원 이상**
- 추가 필터: 강서구, 서울 전체, 배송형, 경쟁률·금액 슬라이더, 금액 미표기 포함, 얼굴 노출 숨기기, 키워드 검색, 마감임박·경쟁률·금액 정렬
- 탭: **🔍 체험단 찾기** / **🗺️ 내 일정 & 최적 동선**

## 🗺️ 내 일정 & 최적 동선

체험단에 당첨돼 실제로 방문할 매장을 모아 **날짜별 일정 · 지도 · 최단 동선**으로 관리하는 탭입니다.

- **일정 담기**: 카드 우측 하단 `📅 일정 담기` → 방문 날짜·시간·주소·메모를 넣어 저장. 탭 안의 `➕ 일정 직접 추가` 폼으로도 등록.
- **지도**: Leaflet + OpenStreetMap (API 키 불필요). 번호 핀을 누르면 매장명·시간·메모·네이버지도 길찾기 링크가 뜹니다.
- **좌표 변환**: OpenStreetMap Nominatim(한국 한정, 초당 1회 이하, 결과는 `localStorage`에 캐시) → 실패하면 구·역 기본 좌표(구로/신도림/대림/영등포/문래/여의도/당산/관악/신림/서울대입구/강서/화곡 등) 폴백 → 그래도 없으면 카드의 `📍 위치`로 지도를 클릭해 직접 지정.
- **최적 노선**: 출발지(구로구·화곡동·영등포·관악 프리셋, 직접 입력, 현재 위치)에서 그날 방문지들을 **Nearest Neighbor + 2-opt**로 정렬하고, 지도에 경로선과 순서별 직선거리를 표시. 각 지점은 `https://map.naver.com/p/directions/...` 링크로 바로 길찾기.
- **날짜 필터**: 전체 예정 / 오늘 / 이번 주 / 지난 일정 포함 / 특정 날짜. 방문·리뷰 완료 체크, 노선 포함 여부, 삭제 지원.
- **백업**: `⬇️ JSON 백업` / `⬆️ 불러오기`로 일정을 파일로 보관·복원.

> **개인정보**: 이 저장소는 공개 저장소입니다. 방문 일정·출발지·메모는 **오직 사용자 브라우저의 `localStorage`(`rh-sched-v1`, 좌표 캐시 `rh-sched-geo-v1`)에만** 저장되며 서버·저장소로 전송되지 않습니다. 저장소에는 코드만 있습니다.

## 구조

```
index.html  style.css  app.js      화면 (정적, 빌드 없음)
schedule.js                       내 일정 & 최적 동선 (localStorage · Leaflet · 최단 노선)
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
- 리뷰노트: 공개 API `/api/v2/campaigns` (구별 조회, 배송형, 서울 전체 보강). 상세 페이지는 robots.txt 가 `Disallow` 라 수집하지 않고 링크만 겁니다. 목록 API에는 매장 주소·좌표 필드가 없어(`sido`, `city`, `category`만 제공), 방문 일정의 좌표는 브라우저에서 Nominatim으로 변환합니다.
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
