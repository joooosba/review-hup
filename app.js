/* 체험단 대시보드 — 데이터 로드 · 필터 · 렌더링 */
(() => {
  'use strict';

  const DATA_FILES = ['data/public_campaigns.json', 'data/gangnam.json'];
  const FACE_WORDS = ['얼굴노출', '얼굴 노출', '얼굴포함', '얼굴 포함', '얼굴 필수', '얼굴필수', '얼굴 공개'];
  const PAGE_STEP = 120;

  const state = {
    regions: new Set(['구로구', '영등포구', '관악구']),
    seoulAll: false,
    kinds: new Set(['방문형']),
    ratioMin: 5,
    amountMin: 40000,
    includeNoAmount: true,
    hideFace: false,
    q: '',
    sort: 'deadline',
    limit: PAGE_STEP,
  };

  let all = [];
  let meta = { updated: [], failed: [] };

  const $ = (sel) => document.querySelector(sel);
  const grid = $('#grid');
  const countEl = $('#count');
  const bannerEl = $('#banner');
  const emptyEl = $('#empty');
  const moreBtn = $('#moreBtn');

  /* ------------------------------------------------------------ 유틸 */
  const won = (n) => n.toLocaleString('ko-KR') + '원';

  function amountText(n) {
    if (n === null || n === undefined) return '금액 미표기';
    if (n >= 100000) {
      const man = Math.floor(n / 10000);
      const rest = n % 10000;
      return rest ? `${man}만 ${rest.toLocaleString('ko-KR')}원` : `${man}만 원`;
    }
    return won(n);
  }

  function ratioText(r) {
    if (r === null || r === undefined) return '경쟁률 ?';
    if (r >= 100) return `경쟁률 ${Math.round(r)}:1`;
    return `경쟁률 ${r.toFixed(1)}:1`;
  }

  function ratioClass(r) {
    if (!r) return 'cool';
    if (r >= 10) return 'hot';
    if (r >= 5) return 'warm';
    return 'cool';
  }

  function ddayInfo(item) {
    if (item.dday === null || item.dday === undefined) return { text: '마감일 미표기', cls: 'unknown' };
    if (item.dday <= 0) return { text: '오늘 마감', cls: 'soon' };
    if (item.dday === 1) return { text: '내일 마감', cls: 'soon' };
    if (item.dday <= 3) return { text: `D-${item.dday}`, cls: 'soon' };
    return { text: `D-${item.dday}`, cls: '' };
  }

  const todayStr = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  function isExpired(item) {
    if (item.deadline && item.deadline < todayStr()) return true;
    if (item.dday !== null && item.dday !== undefined && item.dday < 0) return true;
    return false;
  }

  function fmtUpdated(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /* ------------------------------------------------------------ 데이터 */
  // Pages CDN 캐시가 오래된 JSON을 물고 있지 않도록 시간 단위로만 URL을 구분한다.
  function busted(path) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${path}?v=${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}`;
  }

  async function load() {
    const results = await Promise.allSettled(
      DATA_FILES.map((f) => fetch(busted(f), { cache: 'no-store' }).then((r) => {
        if (!r.ok) throw new Error(`${f} ${r.status}`);
        return r.json();
      }))
    );

    all = [];
    results.forEach((res, i) => {
      if (res.status !== 'fulfilled') {
        meta.failed.push(DATA_FILES[i]);
        return;
      }
      const payload = res.value || {};
      (payload.campaigns || []).forEach((c) => all.push(normalize(c)));
      Object.values(payload.sources || {}).forEach((s) => {
        meta.updated.push({ label: s.label, at: s.updated_at, count: s.count });
      });
    });

    // 같은 캠페인이 두 파일에 있어도 한 번만
    const seen = new Set();
    all = all.filter((c) => {
      const key = `${c.site}|${c.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    renderUpdated();
    render();
  }

  function normalize(c) {
    const hay = `${c.title || ''} ${c.offer || ''}`.toLowerCase();
    const face = FACE_WORDS.some((w) => hay.includes(w.toLowerCase()));
    return {
      ...c,
      ratio: typeof c.ratio === 'number' ? c.ratio : (c.capacity > 0 ? c.applicants / c.capacity : null),
      regions: c.regions || [],
      hay,
      face,
      expired: isExpired(c),
    };
  }

  function renderUpdated() {
    const el = $('#updated');
    if (!meta.updated.length) {
      el.innerHTML = meta.failed.length ? '데이터를 불러오지 못했습니다' : '업데이트 정보 없음';
      return;
    }
    const order = { 리뷰노트: 1, 디너의여왕: 2, 강남맛집: 3 };
    const list = meta.updated
      .slice()
      .sort((a, b) => (order[a.label] || 9) - (order[b.label] || 9))
      .map((s) => `${s.label} <b>${fmtUpdated(s.at)}</b>`);
    el.innerHTML = '업데이트 · ' + list.join(' / ');
  }

  /* ------------------------------------------------------------ 필터 */
  function passesRegion(c) {
    if (c.kind === '배송형') return true;          // 배송형은 지역과 무관
    if (state.seoulAll) return true;
    if (!c.regions.length) return false;
    return c.regions.some((r) => state.regions.has(r));
  }

  function passes(c) {
    if (c.expired) return false;
    if (!state.kinds.has(c.kind)) return false;
    if (!passesRegion(c)) return false;

    const ratio = c.ratio === null || c.ratio === undefined ? 0 : c.ratio;
    if (ratio < state.ratioMin) return false;

    if (c.amount === null || c.amount === undefined) {
      if (!state.includeNoAmount) return false;
    } else if (c.amount < state.amountMin) {
      return false;
    }

    if (state.hideFace && c.face) return false;
    if (state.q && !c.hay.includes(state.q)) return false;
    return true;
  }

  function sortItems(items) {
    const arr = items.slice();
    const byDeadline = (a, b) => {
      const av = a.dday === null || a.dday === undefined ? 9999 : a.dday;
      const bv = b.dday === null || b.dday === undefined ? 9999 : b.dday;
      return av - bv;
    };
    if (state.sort === 'ratio') {
      arr.sort((a, b) => (b.ratio || 0) - (a.ratio || 0) || byDeadline(a, b));
    } else if (state.sort === 'amount') {
      arr.sort((a, b) => (b.amount || -1) - (a.amount || -1) || byDeadline(a, b));
    } else {
      arr.sort((a, b) => byDeadline(a, b) || (b.ratio || 0) - (a.ratio || 0));
    }
    return arr;
  }

  /* ------------------------------------------------------------ 렌더 */
  function render() {
    const items = sortItems(all.filter(passes));
    const total = all.filter((c) => !c.expired).length;

    const bySite = {};
    items.forEach((c) => { bySite[c.site] = (bySite[c.site] || 0) + 1; });
    const breakdown = Object.entries(bySite)
      .map(([site, n]) => `${esc(site)} ${n}`)
      .join(' · ');

    countEl.innerHTML = `<b>${items.length}</b>개 캠페인 · 전체 ${total}개 중`
      + (breakdown ? ` <span class="muted">(${breakdown})</span>` : '');

    const needBanner = items.length < 3;
    bannerEl.hidden = !needBanner;
    if (needBanner) {
      const tips = [];
      if (!state.kinds.has('배송형')) tips.push('<button class="ghost-btn" data-act="delivery">배송형도 보기</button>');
      if (!state.seoulAll) tips.push('<button class="ghost-btn" data-act="seoul">서울 전체 보기</button>');
      tips.push('<button class="ghost-btn" data-act="loosen">기준 낮추기</button>');
      bannerEl.innerHTML = `<span>조건에 맞는 캠페인이 <b>${items.length}개</b>뿐입니다. 범위를 넓혀 볼까요?</span>${tips.join('')}`;
    }

    grid.innerHTML = '';
    const show = items.slice(0, state.limit);
    const frag = document.createDocumentFragment();
    show.forEach((c) => frag.appendChild(card(c)));
    grid.appendChild(frag);

    emptyEl.hidden = items.length > 0;
    moreBtn.hidden = items.length <= state.limit;
    if (!moreBtn.hidden) moreBtn.textContent = `더 보기 (${items.length - state.limit}개 남음)`;
  }

  function card(c) {
    const article = document.createElement('article');
    article.className = 'card';

    const d = ddayInfo(c);
    const faceBadge = c.face ? '<span class="badge warn">얼굴 노출</span>' : '';
    const kindBadge = c.kind === '배송형' ? '<span class="badge delivery">배송형</span>' : '';
    const channelBadge = c.channel ? `<span class="badge">${esc(c.channel)}</span>` : '';

    const regionTags = (c.regions && c.regions.length
      ? c.regions
      : [c.kind === '배송형' ? '전국 배송' : '서울']
    ).map((r) => `<span>${esc(r)}</span>`).join('');

    article.innerHTML = `
      <a class="card-hit" href="${esc(c.url || '#')}" target="_blank" rel="noopener noreferrer"
         aria-label="${esc(c.title || '제목 없음')} — ${esc(c.site)} 신청 페이지 새 창으로 열기"></a>
      <div class="thumb">
        <div class="fallback" aria-hidden="true">${c.kind === '배송형' ? '📦' : '🍽️'}</div>
        ${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ''}
        <div class="badges">
          <span class="badge site-${esc(c.site)}">${esc(c.site)}</span>
          ${kindBadge}${channelBadge}${faceBadge}
        </div>
        <div class="dday ${d.cls}">${d.text}</div>
      </div>
      <div class="card-body">
        <h3 class="card-title">${esc(c.title || '제목 없음')}</h3>
        <p class="card-offer">${esc(c.offer || '제공 내역 미표기')}</p>
        <div class="region-line">${regionTags}</div>
        <div class="stats">
          <span class="ratio ${ratioClass(c.ratio)}">${ratioText(c.ratio)}</span>
          <span class="amount ${c.amount === null || c.amount === undefined ? 'none' : ''}">${amountText(c.amount)}</span>
          <span class="people">신청 ${c.applicants || 0} / 모집 ${c.capacity || 0}</span>
        </div>
        <div class="card-foot">
          <button type="button" class="sched-add" data-sched-add
                  data-cid="${esc(c.id)}" data-site="${esc(c.site)}"
                  data-title="${esc(c.title || '')}" data-region="${esc(c.regionText || (c.regions && c.regions.join(' ')) || '')}"
                  data-url="${esc(c.url || '')}" data-deadline="${esc(c.deadline || '')}"
                  title="방문 날짜·시간을 정해 내 일정에 담기">📅 일정 담기</button>
        </div>
      </div>`;
    return article;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ------------------------------------------------------------ 이벤트 */
  function bind() {
    $('#regionChips').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      const region = btn.dataset.region;
      if (region === '__all__') {
        state.seoulAll = !state.seoulAll;
        btn.classList.toggle('on', state.seoulAll);
      } else {
        if (state.regions.has(region)) state.regions.delete(region);
        else state.regions.add(region);
        btn.classList.toggle('on', state.regions.has(region));
      }
      state.limit = PAGE_STEP;
      render();
    });

    $('#kindChips').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      const kind = btn.dataset.kind;
      if (state.kinds.has(kind)) state.kinds.delete(kind);
      else state.kinds.add(kind);
      btn.classList.toggle('on', state.kinds.has(kind));
      state.limit = PAGE_STEP;
      render();
    });

    const ratioRange = $('#ratioRange');
    ratioRange.addEventListener('input', () => {
      state.ratioMin = Number(ratioRange.value);
      $('#ratioVal').textContent = state.ratioMin.toFixed(1);
      state.limit = PAGE_STEP;
      render();
    });

    const amountRange = $('#amountRange');
    amountRange.addEventListener('input', () => {
      state.amountMin = Number(amountRange.value);
      $('#amountVal').textContent = amountRange.value === '0' ? '0원' : amountText(state.amountMin);
      state.limit = PAGE_STEP;
      render();
    });

    $('#noAmountToggle').addEventListener('change', (e) => {
      state.includeNoAmount = e.target.checked;
      state.limit = PAGE_STEP;
      render();
    });

    $('#hideFaceToggle').addEventListener('change', (e) => {
      state.hideFace = e.target.checked;
      state.limit = PAGE_STEP;
      render();
    });

    let timer = null;
    $('#search').addEventListener('input', (e) => {
      clearTimeout(timer);
      const v = e.target.value.trim().toLowerCase();
      timer = setTimeout(() => {
        state.q = v;
        state.limit = PAGE_STEP;
        render();
      }, 140);
    });

    $('#sort').addEventListener('change', (e) => {
      state.sort = e.target.value;
      state.limit = PAGE_STEP;
      render();
    });

    $('#resetBtn').addEventListener('click', resetFilters);

    moreBtn.addEventListener('click', () => {
      state.limit += PAGE_STEP;
      render();
    });

    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'delivery') {
        state.kinds.add('배송형');
        document.querySelector('[data-kind="배송형"]').classList.add('on');
        state.limit = PAGE_STEP;
        render();
      } else if (act === 'seoul') {
        state.seoulAll = true;
        document.querySelector('[data-region="__all__"]').classList.add('on');
        state.limit = PAGE_STEP;
        render();
      } else if (act === 'loosen') {
        state.ratioMin = 2;
        state.amountMin = 20000;
        $('#ratioRange').value = '2';
        $('#ratioVal').textContent = '2.0';
        $('#amountRange').value = '20000';
        $('#amountVal').textContent = amountText(20000);
        state.limit = PAGE_STEP;
        render();
      } else if (act === 'reset') {
        resetFilters();
      }
    });

    $('#themeBtn').addEventListener('click', toggleTheme);
  }

  function resetFilters() {
    state.regions = new Set(['구로구', '영등포구', '관악구']);
    state.seoulAll = false;
    state.kinds = new Set(['방문형']);
    state.ratioMin = 5;
    state.amountMin = 40000;
    state.includeNoAmount = true;
    state.hideFace = false;
    state.q = '';
    state.sort = 'deadline';
    state.limit = PAGE_STEP;

    document.querySelectorAll('#regionChips .chip').forEach((b) => {
      b.classList.toggle('on', b.dataset.region !== '__all__' && state.regions.has(b.dataset.region));
    });
    document.querySelectorAll('#kindChips .chip').forEach((b) => {
      b.classList.toggle('on', b.dataset.kind === '방문형');
    });
    $('#ratioRange').value = '5';
    $('#ratioVal').textContent = '5.0';
    $('#amountRange').value = '40000';
    $('#amountVal').textContent = '4만 원';
    $('#noAmountToggle').checked = true;
    $('#hideFaceToggle').checked = false;
    $('#search').value = '';
    $('#sort').value = 'deadline';
    render();
  }

  function toggleTheme() {
    const root = document.documentElement;
    const current = root.getAttribute('data-theme')
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('rh-theme', next); } catch (e) { /* 저장 실패는 무시 */ }
    $('#themeBtn').textContent = next === 'dark' ? '☀️' : '🌙';
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('rh-theme'); } catch (e) { /* 무시 */ }
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    const isDark = (document.documentElement.getAttribute('data-theme') || '')
      === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
    $('#themeBtn').textContent = isDark ? '☀️' : '🌙';
  }

  initTheme();
  bind();
  load().catch((err) => {
    countEl.textContent = '데이터를 불러오지 못했습니다.';
    console.error(err);
  });
})();
