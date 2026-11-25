/* 내 일정 & 최적 동선 — localStorage 저장 · Leaflet 지도 · 최단 노선(NN + 2-opt)
   개인 일정·출발지는 이 브라우저에만 저장되고 서버로 전송하지 않는다. */
(() => {
  'use strict';

  const view = document.getElementById('view-schedule');
  if (!view) return;

  const LS_KEY = 'rh-sched-v1';
  const GEO_KEY = 'rh-sched-geo-v1';
  const GEO_DELAY = 1150;                 // Nominatim 이용 정책: 초당 1회 이하
  const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

  /* ---------------------------------------------------------- 출발지 프리셋 */
  const PRESETS = [
    { id: 'guro', label: '구로구', lat: 37.4952, lng: 126.8877 },
    { id: 'hwagok', label: '화곡동', lat: 37.5416, lng: 126.8405 },
    { id: 'yeongdeungpo', label: '영등포', lat: 37.5259, lng: 126.8963 },
    { id: 'gwanak', label: '관악', lat: 37.4652, lng: 126.9437 }
  ];

  /* ------------------------------------- Nominatim 실패 시 쓰는 서울 기본 좌표 */
  const FALLBACK = [
    { name: '구로디지털단지역', lat: 37.4852, lng: 126.9016, keys: ['구로디지털단지', '구디', '구로디지털'] },
    { name: '신도림역', lat: 37.5088, lng: 126.8912, keys: ['신도림'] },
    { name: '구로역', lat: 37.5031, lng: 126.8820, keys: ['구로역'] },
    { name: '대림역', lat: 37.4926, lng: 126.8957, keys: ['대림'] },
    { name: '개봉역', lat: 37.4860, lng: 126.8588, keys: ['개봉'] },
    { name: '오류동역', lat: 37.4945, lng: 126.8450, keys: ['오류동'] },
    { name: '구로구', lat: 37.4952, lng: 126.8877, keys: ['구로'] },
    { name: '영등포역', lat: 37.5157, lng: 126.9075, keys: ['영등포역'] },
    { name: '영등포구청역', lat: 37.5259, lng: 126.8963, keys: ['영등포구청'] },
    { name: '문래역', lat: 37.5179, lng: 126.8950, keys: ['문래'] },
    { name: '여의도역', lat: 37.5216, lng: 126.9244, keys: ['여의도'] },
    { name: '당산역', lat: 37.5344, lng: 126.9027, keys: ['당산'] },
    { name: '선유도역', lat: 37.5379, lng: 126.8939, keys: ['선유도'] },
    { name: '영등포구', lat: 37.5259, lng: 126.8963, keys: ['영등포'] },
    { name: '신림역', lat: 37.4842, lng: 126.9296, keys: ['신림'] },
    { name: '서울대입구역', lat: 37.4812, lng: 126.9527, keys: ['서울대입구', '샤로수길'] },
    { name: '봉천역', lat: 37.4823, lng: 126.9418, keys: ['봉천'] },
    { name: '낙성대역', lat: 37.4769, lng: 126.9636, keys: ['낙성대'] },
    { name: '사당역', lat: 37.4766, lng: 126.9816, keys: ['사당'] },
    { name: '관악구', lat: 37.4652, lng: 126.9437, keys: ['관악'] },
    { name: '화곡역', lat: 37.5416, lng: 126.8405, keys: ['화곡'] },
    { name: '마곡나루역', lat: 37.5673, lng: 126.8273, keys: ['마곡'] },
    { name: '발산역', lat: 37.5586, lng: 126.8378, keys: ['발산'] },
    { name: '강서구', lat: 37.5509, lng: 126.8495, keys: ['강서'] },
    { name: '목동역', lat: 37.5262, lng: 126.8644, keys: ['목동', '양천'] },
    { name: '금천구청역', lat: 37.4559, lng: 126.8953, keys: ['금천', '시흥', '독산'] },
    { name: '가산디지털단지역', lat: 37.4815, lng: 126.8826, keys: ['가산'] },
    { name: '용산역', lat: 37.5298, lng: 126.9648, keys: ['용산'] },
    { name: '노량진역', lat: 37.5142, lng: 126.9422, keys: ['노량진'] },
    { name: '합정역', lat: 37.5495, lng: 126.9137, keys: ['합정'] },
    { name: '홍대입구역', lat: 37.5572, lng: 126.9246, keys: ['홍대'] },
    { name: '시청역', lat: 37.5657, lng: 126.9770, keys: ['시청', '종로', '을지로'] },
    { name: '강남역', lat: 37.4979, lng: 127.0276, keys: ['강남'] },
    { name: '잠실역', lat: 37.5133, lng: 127.1001, keys: ['잠실'] }
  ];

  const FALLBACK_KEYS = (() => {
    const rows = [];
    FALLBACK.forEach((f) => f.keys.forEach((k) => rows.push({ key: k, at: f })));
    rows.sort((a, b) => b.key.length - a.key.length);
    return rows;
  })();

  /* ---------------------------------------------------------------- 상태 */
  const state = {
    items: [],
    origin: { label: '구로구', lat: 37.4952, lng: 126.8877, kind: 'preset' },
    geo: {},
    mode: 'upcoming',
    pickDate: '',
    route: null,
    pickId: null
  };

  const mapEl = document.getElementById('map');
  const mapNoteEl = document.getElementById('mapNote');
  const listEl = document.getElementById('schedList');
  const emptyEl = document.getElementById('schedEmpty');
  const noteEl = document.getElementById('schedNote');
  const routeBox = document.getElementById('routeSummary');
  const routeClear = document.getElementById('routeClear');
  const badgeEl = document.getElementById('schedBadge');
  const originSelect = document.getElementById('originPreset');
  const originInput = document.getElementById('originInput');
  const originNow = document.getElementById('originNow');
  const addForm = document.getElementById('addForm');
  const modal = document.getElementById('schedModal');
  const modalForm = document.getElementById('modalForm');

  /* ---------------------------------------------------------------- 유틸 */
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const pad2 = (n) => String(n).padStart(2, '0');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function uid() {
    return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseYmd(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso == null ? '' : iso));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function fmtDate(iso) {
    const d = parseYmd(iso);
    if (!d) return String(iso || '');
    const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + wd + ')';
  }

  function relLabel(iso) {
    const d = parseYmd(iso);
    if (!d) return '';
    const t = parseYmd(todayISO());
    const diff = Math.round((d - t) / 86400000);
    if (diff === 0) return '오늘';
    if (diff === 1) return '내일';
    if (diff === 2) return '모레';
    if (diff < 0) return Math.abs(diff) + '일 지남';
    return diff + '일 뒤';
  }

  function daysLeft(iso) {
    const d = parseYmd(iso);
    if (!d) return null;
    const t = parseYmd(todayISO());
    return Math.round((d - t) / 86400000);
  }

  function ddayText(iso) {
    const n = daysLeft(iso);
    if (n === null) return '';
    if (n < 0) return '마감 지남';
    if (n === 0) return '오늘 마감';
    if (n === 1) return '내일 마감';
    return 'D-' + n;
  }

  function weekRange() {
    const t = parseYmd(todayISO());
    const dow = t.getDay();                        // 0=일요일
    const monday = new Date(t.getTime() - ((dow + 6) % 7) * 86400000);
    const sunday = new Date(monday.getTime() + 6 * 86400000);
    const f = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    return [f(monday), f(sunday)];
  }

  function delay(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  function kmText(km) {
    if (km < 1) return Math.round(km * 1000) + 'm';
    return (Math.round(km * 10) / 10).toFixed(1) + 'km';
  }

  function haversine(a, b) {
    const R = 6371;
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLng = (b.lng - a.lng) * rad;
    const s = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function byId(id) {
    for (let i = 0; i < state.items.length; i += 1) {
      if (state.items[i].id === id) return state.items[i];
    }
    return null;
  }

  /* ---------------------------------------------------------------- 저장 */
  function normalizeItem(raw) {
    const it = raw || {};
    return {
      id: it.id || uid(),
      cid: it.cid || '',
      site: it.site || '',
      title: it.title || '(이름 없음)',
      address: it.address || '',
      date: it.date || todayISO(),
      time: it.time || '',
      deadline: it.deadline || '',
      memo: it.memo || '',
      url: it.url || '',
      lat: isNum(it.lat) ? it.lat : (isNum(Number(it.lat)) && it.lat !== null && it.lat !== '' ? Number(it.lat) : null),
      lng: isNum(it.lng) ? it.lng : (isNum(Number(it.lng)) && it.lng !== null && it.lng !== '' ? Number(it.lng) : null),
      geoLabel: it.geoLabel || '',
      geoStatus: it.geoStatus || '',
      approx: !!it.approx,
      visited: !!it.visited,
      reviewed: !!it.reviewed,
      sel: it.sel === false ? false : true,
      createdAt: it.createdAt || Date.now()
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.items)) {
          state.items = d.items.filter((x) => x && x.title).map(normalizeItem);
        }
        if (d && d.origin && isNum(Number(d.origin.lat)) && isNum(Number(d.origin.lng))) {
          state.origin = {
            label: d.origin.label || '출발지',
            lat: Number(d.origin.lat),
            lng: Number(d.origin.lng),
            kind: d.origin.kind || 'address'
          };
        }
      }
    } catch (e) {
      console.warn('[일정] 저장된 일정을 읽지 못했습니다', e);
    }
    try {
      const g = localStorage.getItem(GEO_KEY);
      if (g) {
        const parsed = JSON.parse(g);
        if (parsed && typeof parsed === 'object') state.geo = parsed;
      }
    } catch (e) { /* 캐시는 없어도 된다 */ }
  }

  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        version: 1, items: state.items, origin: state.origin, savedAt: new Date().toISOString()
      }));
    } catch (e) {
      note('브라우저 저장 공간이 부족해 저장하지 못했습니다.');
    }
  }

  function saveGeo() {
    try {
      const keys = Object.keys(state.geo);
      if (keys.length > 120) {
        keys.slice(0, keys.length - 120).forEach((k) => { delete state.geo[k]; });
      }
      localStorage.setItem(GEO_KEY, JSON.stringify(state.geo));
    } catch (e) { /* 캐시 실패는 무시 */ }
  }

  /* -------------------------------------------------------------- 지오코딩 */
  const normQ = (q) => String(q || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function withSeoul(addr) {
    const t = String(addr || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (/^(서울|경기|인천|부산|대구|대전|광주|울산|세종|제주|강원|충북|충남|전북|전남|경북|경남)/.test(t)) return t;
    return '서울 ' + t;
  }

  let geoChain = Promise.resolve();

  function geocodeQuery(q) {
    const key = normQ(q);
    if (!key) return Promise.resolve(null);
    if (state.geo[key]) return Promise.resolve(state.geo[key]);
    const run = () => fetch(
      'https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=kr&limit=1&accept-language=ko&q='
      + encodeURIComponent(key),
      { headers: { Accept: 'application/json' } }
    ).then((r) => (r.ok ? r.json() : [])).then((rows) => {
      const first = Array.isArray(rows) && rows.length ? rows[0] : null;
      if (!first) return null;
      const hit = {
        lat: Number(first.lat),
        lng: Number(first.lon),
        label: String(first.display_name || key).split(',')[0].trim() || key
      };
      if (!isNum(hit.lat) || !isNum(hit.lng)) return null;
      state.geo[key] = hit;
      saveGeo();
      return hit;
    }).catch(() => null);

    const p = geoChain.then(() => delay(GEO_DELAY)).then(run);
    geoChain = p.then(() => null, () => null);
    return p;
  }

  function fallbackCoords(text) {
    const t = String(text || '');
    if (!t) return null;
    for (let i = 0; i < FALLBACK_KEYS.length; i += 1) {
      const row = FALLBACK_KEYS[i];
      if (t.indexOf(row.key) !== -1) {
        return { lat: row.at.lat, lng: row.at.lng, label: row.at.name + ' 기준', approx: true };
      }
    }
    return null;
  }

  function applyHit(item, hit) {
    item.lat = hit.lat;
    item.lng = hit.lng;
    item.geoLabel = hit.label || '';
    item.approx = !!hit.approx;
    item.geoStatus = 'ok';
  }

  async function resolveItem(item) {
    if (isNum(item.lat) && isNum(item.lng)) {
      if (!item.geoStatus) item.geoStatus = 'ok';
      return true;
    }
    const queries = [];
    if (item.address) {
      queries.push(withSeoul(item.address));
      const stripped = item.address.replace(/[0-9\-~]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (stripped && stripped !== item.address.trim()) queries.push(withSeoul(stripped));
    }
    if (item.title && String(item.title).length <= 26 && item.title.indexOf('&') === -1) {
      queries.push(withSeoul(item.title));
    }
    const tried = {};
    for (let i = 0; i < queries.length; i += 1) {
      const q = normQ(queries[i]);
      if (!q || tried[q]) continue;
      tried[q] = true;
      const hit = await geocodeQuery(queries[i]);
      if (hit) { applyHit(item, hit); return true; }
    }
    const fb = fallbackCoords((item.address || '') + ' ' + (item.title || ''));
    if (fb) { applyHit(item, fb); return true; }
    item.geoStatus = 'none';
    return false;
  }

  let resolving = false;

  function resolvePending() {
    if (resolving) return;
    const todo = state.items.filter((it) => !(isNum(it.lat) && isNum(it.lng)) && it.geoStatus !== 'none');
    if (!todo.length) return;
    resolving = true;
    let left = todo.length;
    note('주소로 위치를 찾는 중… (' + left + '곳)');
    const step = () => {
      const it = todo.shift();
      if (!it) {
        resolving = false;
        saveState();
        if (state.route) computeRoute();
        else renderAll();
        note('');
        return;
      }
      resolveItem(it).then(() => {
        left -= 1;
        saveState();
        renderAll();
        if (left > 0 && it.geoStatus === 'none') note('주소로 위치를 찾는 중… (' + left + '곳 남음)');
        setTimeout(step, 130);
      });
    };
    step();
  }

  /* ------------------------------------------------------------------ 지도 */
  let map = null;
  let markerLayer = null;
  let mapMsgShown = false;

  function ensureMap() {
    if (map) return true;
    if (view.hidden) return false;          // 숨겨진 탭에서는 지도를 만들지 않는다 (크기 0 오류 방지)
    if (!window.L) {
      if (!mapMsgShown) {
        mapEl.innerHTML = '<div class="map-empty">지도(Leaflet)를 불러오지 못했습니다.<br>'
          + '네트워크나 CDN 차단을 확인해 주세요. 일정 목록은 그대로 사용할 수 있습니다.</div>';
        mapMsgShown = true;
      }
      return false;
    }
    mapEl.innerHTML = '';
    mapMsgShown = false;
    map = L.map(mapEl, { scrollWheelZoom: true });
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    map.setView([state.origin.lat, state.origin.lng], 12);
    map.on('click', onMapClick);
    return true;
  }

  function numIcon(n, cls) {
    return L.divIcon({
      className: 'map-pin' + (cls ? ' ' + cls : ''),
      html: '<span><i>' + n + '</i></span>',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -16]
    });
  }

  function originIcon() {
    return L.divIcon({
      className: 'map-pin origin',
      html: '<span><i>출발</i></span>',
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      popupAnchor: [0, -22]
    });
  }

  function naverDir(f, t, mode) {
    const fname = encodeURIComponent(f.name || '출발');
    const tname = encodeURIComponent(t.name || '도착');
    return 'https://map.naver.com/p/directions/' + f.lng + ',' + f.lat + ',' + fname
      + '/' + t.lng + ',' + t.lat + ',' + tname + '/-/' + (mode || 'transit');
  }

  const naverSearch = (name) => 'https://map.naver.com/p/search/' + encodeURIComponent(name || '');

  function itemAsPoint(it) {
    return { lat: it.lat, lng: it.lng, name: it.title };
  }

  function originAsPoint() {
    return { lat: state.origin.lat, lng: state.origin.lng, name: state.origin.label };
  }

  function popupHtml(it) {
    const out = ['<h4>' + esc(it.title) + '</h4>'];
    const meta = [];
    meta.push(fmtDate(it.date) + (it.time ? ' ' + it.time : ''));
    if (it.address) meta.push(esc(it.address));
    out.push('<div class="pop-meta">' + meta.join(' · ') + '</div>');
    if (it.memo) out.push('<div>' + esc(it.memo) + '</div>');
    if (it.deadline) out.push('<div class="pop-meta">마감 ' + fmtDate(it.deadline) + ' · ' + ddayText(it.deadline) + '</div>');
    if (it.approx) out.push('<div class="pop-meta">동네 기준 대략 위치</div>');
    const links = ['<a href="' + esc(naverDir(originAsPoint(), itemAsPoint(it))) + '" target="_blank" rel="noopener">🧭 출발지→여기</a>'];
    links.push('<a href="' + esc(naverSearch(it.title)) + '" target="_blank" rel="noopener">🔎 매장 찾기</a>');
    if (it.url) links.push('<a href="' + esc(it.url) + '" target="_blank" rel="noopener">🔗 체험단</a>');
    out.push('<div class="pop-links">' + links.join('') + '</div>');
    return out.join('');
  }

  function renderMap() {
    if (!ensureMap()) return;
    map.invalidateSize({ animate: false });
    markerLayer.clearLayers();

    const list = visibleItems();
    const order = state.route && state.route.ids ? state.route.ids : [];
    const points = [[state.origin.lat, state.origin.lng]];

    const om = L.marker([state.origin.lat, state.origin.lng], {
      icon: originIcon(), title: '출발지: ' + state.origin.label, zIndexOffset: 400
    }).addTo(markerLayer);
    om.bindPopup('<h4>출발지 · ' + esc(state.origin.label) + '</h4>'
      + '<div class="pop-meta">' + state.origin.lat.toFixed(4) + ', ' + state.origin.lng.toFixed(4) + '</div>');

    list.forEach((it, i) => {
      if (!isNum(it.lat) || !isNum(it.lng)) return;
      const pos = order.indexOf(it.id);
      const n = pos >= 0 ? pos + 1 : (i + 1);
      let cls = '';
      if (pos >= 0) cls += ' route';
      if (it.visited) cls += ' done';
      if (it.approx) cls += ' nofix';
      const m = L.marker([it.lat, it.lng], { icon: numIcon(n, cls.trim()), title: it.title }).addTo(markerLayer);
      m.bindPopup(popupHtml(it));
      points.push([it.lat, it.lng]);
    });

    if (state.route && state.route.ids.length > 1) {
      const latlngs = [[state.origin.lat, state.origin.lng]];
      state.route.ids.forEach((id) => {
        const it = byId(id);
        if (it && isNum(it.lat) && isNum(it.lng)) latlngs.push([it.lat, it.lng]);
      });
      if (latlngs.length > 1) {
        L.polyline(latlngs, { color: '#059669', weight: 4, opacity: 0.85, lineJoin: 'round' }).addTo(markerLayer);
      }
    }

    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [42, 42], maxZoom: 15 });
      if (map.getZoom() > 15) map.setZoom(15);
    } else {
      map.setView([state.origin.lat, state.origin.lng], 13);
    }
    if (state.pickId) mapEl.classList.add('picking');
    else mapEl.classList.remove('picking');
    renderMapNote(list);
  }

  function renderMapNote(list) {
    const noFix = list.filter((it) => !(isNum(it.lat) && isNum(it.lng)));
    const approx = list.filter((it) => it.approx && it.geoStatus === 'ok');
    const parts = [];
    if (!list.length) {
      parts.push('담은 일정이 생기면 이 지도에 번호 핀으로 표시됩니다.');
    } else {
      parts.push('핀을 누르면 매장 정보와 <b>네이버 길찾기</b> 링크가 열립니다.');
    }
    if (approx.length) parts.push('동네 기준 대략 위치 <b>' + approx.length + '곳</b>');
    if (noFix.length) parts.push('위치 미확인 <b>' + noFix.length + '곳</b> — 카드의 <b>📍 위치</b>로 직접 찍어 주세요');
    if (state.pickId) parts.push('<b>지도를 클릭</b>하면 위치를 지정합니다 (Esc 취소)');
    mapNoteEl.innerHTML = parts.join(' · ');
  }

  function onMapClick(e) {
    if (!state.pickId) return;
    const it = byId(state.pickId);
    if (!it) { state.pickId = null; return; }
    it.lat = e.latlng.lat;
    it.lng = e.latlng.lng;
    it.geoLabel = '지도에서 직접 지정';
    it.geoStatus = 'ok';
    it.approx = false;
    state.pickId = null;
    saveState();
    if (state.route) computeRoute();
    else renderAll();
    note('「' + esc(it.title) + '」 위치를 지도에서 지정했습니다.');
  }

  /* -------------------------------------------------------------- 목록·필터 */
  function compareItems(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const at = a.time || '99:99';
    const bt = b.time || '99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  }

  function visibleItems() {
    const t = todayISO();
    let arr = state.items.slice();
    if (state.mode === 'today') {
      arr = arr.filter((it) => it.date === t);
    } else if (state.mode === 'week') {
      const r = weekRange();
      arr = arr.filter((it) => it.date >= r[0] && it.date <= r[1]);
    } else if (state.mode === 'date') {
      arr = arr.filter((it) => it.date === state.pickDate);
    } else if (state.mode === 'upcoming') {
      arr = arr.filter((it) => it.date >= t);
    }
    arr.sort(compareItems);
    if (state.route && state.route.ids && state.route.ids.length) {
      const rank = (it) => {
        const k = state.route.ids.indexOf(it.id);
        return k < 0 ? 9999 : k;
      };
      arr.sort((a, b) => (rank(a) - rank(b)) || compareItems(a, b));
    }
    return arr;
  }

  function dateHead(iso, count) {
    const div = document.createElement('div');
    div.className = 'sched-date-head';
    div.innerHTML = '<b>' + fmtDate(iso) + '</b><span>' + relLabel(iso) + ' · ' + count + '곳</span>';
    return div;
  }

  function itemCard(it, index) {
    const el = document.createElement('article');
    el.className = 'sched-card';
    el.dataset.id = it.id;
    if (it.visited) el.classList.add('is-visited');
    const order = state.route && state.route.ids ? state.route.ids.indexOf(it.id) : -1;
    if (order >= 0) el.classList.add('in-route');

    const badges = [];
    badges.push('<span>' + fmtDate(it.date) + (it.time ? ' ' + it.time : ' 시간 미정') + '</span>');
    badges.push(it.address
      ? '<span class="where">📍 ' + esc(it.address) + '</span>'
      : '<span class="where none">📍 위치 미지정</span>');
    if (it.deadline) {
      const n = daysLeft(it.deadline);
      badges.push('<span class="due' + (n !== null && n <= 2 ? ' warn' : '') + '">마감 ' + fmtDate(it.deadline) + ' ' + ddayText(it.deadline) + '</span>');
    }

    const links = [];
    if (isNum(it.lat) && isNum(it.lng)) {
      links.push('<a href="' + esc(naverDir(originAsPoint(), itemAsPoint(it))) + '" target="_blank" rel="noopener" title="출발지에서 이 매장까지 네이버 길찾기">🧭 길찾기</a>');
    }
    links.push('<a href="' + esc(naverSearch(it.title)) + '" target="_blank" rel="noopener">🔎 매장</a>');
    if (it.url) links.push('<a href="' + esc(it.url) + '" target="_blank" rel="noopener">🔗 체험단</a>');

    el.innerHTML = ''
      + '<div class="sched-order">' + (order >= 0 ? order + 1 : index + 1) + '</div>'
      + '<div class="sched-main">'
      + '  <div class="sched-head">'
      + '    <h3>' + esc(it.title) + '</h3>'
      + '    <label class="sched-sel"><input type="checkbox" data-sact="sel"' + (it.sel ? ' checked' : '') + '> 노선</label>'
      + '  </div>'
      + '  <div class="sched-meta">' + badges.join('') + '</div>'
      + (it.memo ? '<p class="sched-memo">' + esc(it.memo) + '</p>' : '')
      + '  <div class="sched-actions">'
      + '    <button type="button" class="tgl' + (it.visited ? ' on' : '') + '" data-sact="visited">' + (it.visited ? '✅ 방문 완료' : '방문 완료') + '</button>'
      + '    <button type="button" class="tgl' + (it.reviewed ? ' on' : '') + '" data-sact="reviewed">' + (it.reviewed ? '✅ 리뷰 완료' : '리뷰 완료') + '</button>'
      + links.join('')
      + '    <button type="button" data-sact="pin" title="지도에서 위치 직접 지정">📍 위치</button>'
      + '    <button type="button" class="del" data-sact="del">🗑 삭제</button>'
      + '  </div>'
      + '</div>';
    return el;
  }

  function renderList() {
    const list = visibleItems();
    listEl.innerHTML = '';
    const showHeads = !(state.route && state.route.ids && state.route.ids.length);
    if (!list.length) {
      emptyEl.hidden = false;
      const total = state.items.length;
      if (total) {
        const chip = document.querySelector('#dateChips .chip');
        emptyEl.innerHTML = '<p class="empty-emoji">🔍</p><p><b>이 조건에 맞는 일정이 없습니다.</b></p>'
          + '<p class="muted">다른 날짜를 고르거나 <b>전체 예정</b>·<b>지난 일정 포함</b>을 눌러 보세요. (저장된 일정 ' + total + '건)</p>'
          + '<div class="empty-actions"><button type="button" class="ghost-btn" data-sact="mode-all">지난 일정 포함</button></div>';
        void chip;
      } else {
        emptyEl.innerHTML = '<p class="empty-emoji">🗓️</p><p><b>아직 담은 일정이 없습니다.</b></p>'
          + '<p class="muted">‘체험단 찾기’에서 <b>📅 일정 담기</b>를 누르거나 위의 <b>➕ 일정 직접 추가</b>로 매장을 등록해 보세요.</p>';
      }
      return;
    }
    emptyEl.hidden = true;

    const frag = document.createDocumentFragment();
    let lastDate = '';
    let count = 0;
    list.forEach((it, i) => {
      if (showHeads && it.date !== lastDate) {
        if (lastDate) void 0;
        lastDate = it.date;
        count = list.filter((x) => x.date === it.date).length;
        frag.appendChild(dateHead(it.date, count));
      }
      frag.appendChild(itemCard(it, i));
    });
    listEl.appendChild(frag);
  }

  /* -------------------------------------------------------------- 노선 계산 */
  function nearestNeighbor(start, pts) {
    const rest = pts.slice();
    const out = [];
    let cur = start;
    while (rest.length) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < rest.length; i += 1) {
        const d = haversine(cur, rest[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
      const pick = rest.splice(best, 1)[0];
      out.push(pick);
      cur = pick;
    }
    return out;
  }

  function pathLength(seq) {
    let d = 0;
    for (let i = 1; i < seq.length; i += 1) d += haversine(seq[i - 1], seq[i]);
    return d;
  }

  function twoOpt(seq) {
    let best = seq.slice();
    let improved = true;
    let guard = 0;
    while (improved && guard < 40) {
      improved = false;
      guard += 1;
      for (let i = 1; i < best.length - 1; i += 1) {
        for (let j = i + 1; j < best.length; j += 1) {
          const cand = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
          if (pathLength(cand) < pathLength(best) - 1e-9) {
            best = cand;
            improved = true;
          }
        }
      }
    }
    return best;
  }

  function computeRoute() {
    const base = visibleItems();
    const usable = base.filter((it) => it.sel && isNum(it.lat) && isNum(it.lng));
    const skipped = base.filter((it) => it.sel && !(isNum(it.lat) && isNum(it.lng)));
    if (!usable.length) {
      state.route = null;
      renderAll();
      note(base.length
        ? '노선을 계산할 위치가 없습니다. 주소를 넣거나 카드의 <b>📍 위치</b>로 좌표를 지정해 주세요.'
        : '먼저 일정을 담아 주세요.');
      return;
    }
    const pts = usable.map((it) => ({ id: it.id, lat: it.lat, lng: it.lng }));
    const start = { id: '__origin__', lat: state.origin.lat, lng: state.origin.lng };
    const ordered = twoOpt([start].concat(nearestNeighbor(start, pts)));
    const seq = ordered.slice(1);

    let prev = { lat: state.origin.lat, lng: state.origin.lng };
    let total = 0;
    const legs = seq.map((p) => {
      const km = haversine(prev, p);
      total += km;
      const leg = { id: p.id, km: km };
      prev = p;
      return leg;
    });

    state.route = {
      ids: seq.map((p) => p.id),
      total: total,
      legs: legs,
      skipped: skipped.map((it) => it.id),
      at: Date.now()
    };
    renderAll();
    note(skipped.length
      ? '위치를 못 찾은 <b>' + skipped.length + '곳</b>은 노선에서 빠졌습니다. 카드의 <b>📍 위치</b>로 지정한 뒤 다시 계산하세요.'
      : '');
  }

  function renderRoute() {
    if (!state.route) {
      routeBox.hidden = true;
      routeClear.hidden = true;
      return;
    }
    const ids = state.route.ids;
    const rows = [];
    rows.push('<li class="origin-row"><span class="idx">출</span><span><b>' + esc(state.origin.label) + '</b></span>'
      + '<span class="km">출발</span></li>');
    ids.forEach((id, i) => {
      const it = byId(id);
      if (!it) return;
      const leg = state.route.legs[i];
      rows.push('<li><span class="idx">' + (i + 1) + '</span>'
        + '<a href="' + esc(naverDir(originAsPoint(), itemAsPoint(it))) + '" target="_blank" rel="noopener" title="네이버 길찾기 열기">'
        + esc(it.title) + '</a>'
        + '<span class="km">' + (leg ? kmText(leg.km) : '') + '</span></li>');
    });
    routeBox.innerHTML = '<div class="route-head">🧭 최적 노선 · ' + ids.length + '곳 '
      + '<small>직선 총 ' + kmText(state.route.total) + '</small></div>'
      + '<ol class="route-steps">' + rows.join('') + '</ol>'
      + '<div class="route-total">직선거리 기준 최단 순서입니다. 실제 이동 경로·시간은 각 지점의 '
      + '<b>🧭 길찾기</b>로 네이버지도에서 확인하세요.</div>';
    routeBox.hidden = false;
    routeClear.hidden = false;
  }

  /* ---------------------------------------------------------------- 렌더 */
  function renderBadge() {
    const n = state.items.length;
    badgeEl.textContent = String(n);
    badgeEl.hidden = n === 0;
  }

  function renderAll() {
    renderBadge();
    renderList();
    renderMap();
    renderRoute();
    updateOriginUI();
    syncCardButtons();
  }

  function note(html) {
    if (!html) {
      noteEl.hidden = true;
      noteEl.innerHTML = '';
      return;
    }
    noteEl.hidden = false;
    noteEl.innerHTML = html;
  }

  /* ------------------------------------------------------------- 출발지 UI */
  function buildOriginSelect() {
    const opts = PRESETS.map((p) => '<option value="p:' + p.id + '">' + p.label + '</option>');
    opts.push('<option value="geo">📍 현재 위치</option>');
    opts.push('<option value="manual">✏️ 직접 입력</option>');
    originSelect.innerHTML = opts.join('');
  }

  function updateOriginUI() {
    let matched = '';
    PRESETS.forEach((p) => {
      if (!matched && Math.abs(p.lat - state.origin.lat) < 1e-5 && Math.abs(p.lng - state.origin.lng) < 1e-5) {
        matched = 'p:' + p.id;
      }
    });
    if (state.origin.kind === 'geo') matched = 'geo';
    if (!matched && state.origin.kind === 'address') matched = 'manual';
    originSelect.value = matched || 'manual';
    originNow.innerHTML = '출발 <b>' + esc(state.origin.label) + '</b> · '
      + state.origin.lat.toFixed(4) + ', ' + state.origin.lng.toFixed(4);
  }

  function setOrigin(label, lat, lng, kind) {
    state.origin = { label: label, lat: lat, lng: lng, kind: kind || 'address' };
    saveState();
    updateOriginUI();
    renderMap();
    if (state.route) computeRoute();
    else renderRoute();
    renderList();
    syncCardButtons();
  }

  async function applyOriginInput() {
    const raw = originInput.value.trim();
    if (!raw) {
      note('출발지로 쓸 주소나 역 이름을 입력해 주세요.');
      return;
    }
    note('출발지 「' + esc(raw) + '」 위치를 찾는 중…');
    const hit = await geocodeQuery(withSeoul(raw));
    if (hit) {
      setOrigin(raw, hit.lat, hit.lng, 'address');
      note('출발지를 「' + esc(raw) + '」(' + esc(hit.label) + ')로 설정했습니다.');
      return;
    }
    const fb = fallbackCoords(raw);
    if (fb) {
      setOrigin(raw + ' (' + fb.label + ')', fb.lat, fb.lng, 'address');
      note('정확한 주소를 찾지 못해 동네 기준 좌표로 설정했습니다.');
      return;
    }
    note('출발지 주소를 찾지 못했습니다. 역 이름이나 ‘구로구’처럼 동네 이름으로 다시 시도해 주세요.');
  }

  function useGeoLocation() {
    if (!navigator.geolocation) {
      note('이 브라우저에서는 현재 위치를 쓸 수 없습니다.');
      return;
    }
    note('현재 위치를 확인하는 중…');
    navigator.geolocation.getCurrentPosition((pos) => {
      setOrigin('현재 위치', pos.coords.latitude, pos.coords.longitude, 'geo');
      note('출발지를 현재 위치로 설정했습니다.');
    }, () => {
      note('현재 위치를 가져오지 못했습니다. 위치 권한을 확인하거나 출발지를 직접 골라 주세요.');
    }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
  }

  /* ------------------------------------------------------------- 일정 담기 */
  let modalCtx = null;

  function toast(msg) {
    let el = document.getElementById('rhToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rhToast';
      el.className = 'rh-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function guessAddress(region) {
    const r = String(region || '').trim();
    if (!r) return '';
    if (r.indexOf('배송') !== -1) return '';
    return r;
  }

  function openSchedModal(d) {
    modalCtx = d;
    document.getElementById('modalSub').textContent = '「' + (d.title || '') + '」'
      + (d.site ? ' · ' + d.site : '') + (d.region ? ' · ' + d.region : '');
    modalForm.reset();
    const already = d.cid ? state.items.find((it) => it.cid === d.cid) : null;
    modalForm.elements.date.value = already && already.date ? already.date : todayISO();
    modalForm.elements.time.value = already ? already.time : '';
    modalForm.elements.address.value = already && already.address
      ? already.address
      : guessAddress(d.region);
    modalForm.elements.memo.value = already ? already.memo : '';
    document.querySelector('#modalForm button[type="submit"]').textContent = already
      ? '일정 수정' : '일정에 담기';
    modal.hidden = false;
    document.body.classList.add('modal-open');
    setTimeout(() => { modalForm.elements.date.focus(); }, 30);
  }

  function closeSchedModal() {
    modal.hidden = true;
    modalCtx = null;
    document.body.classList.remove('modal-open');
  }

  function upsertItem(data) {
    let hit = null;
    if (data.cid) {
      hit = state.items.find((it) => it.cid === data.cid) || null;
    }
    if (hit) {
      hit.date = data.date || hit.date;
      hit.time = data.time || '';
      hit.address = data.address || hit.address;
      hit.memo = data.memo || hit.memo;
      if (data.deadline) hit.deadline = data.deadline;
      if (data.url) hit.url = data.url;
      hit.geoStatus = '';
      delete hit.lat;
      delete hit.lng;
      hit.lat = null;
      hit.lng = null;
      hit.geoLabel = '';
      hit.approx = false;
      return { item: hit, updated: true };
    }
    const item = normalizeItem({
      cid: data.cid || '',
      site: data.site || '',
      title: data.title || '(이름 없음)',
      address: data.address || '',
      date: data.date || todayISO(),
      time: data.time || '',
      deadline: data.deadline || '',
      memo: data.memo || '',
      url: data.url || ''
    });
    state.items.push(item);
    return { item: item, updated: false };
  }

  function afterChange(res) {
    saveState();
    if (state.route) computeRoute();
    else renderAll();
    resolvePending();
    if (res && res.item) {
      toast(res.updated ? '📅 일정을 수정했습니다' : '📅 일정에 담았습니다 — 🗺️ 내 일정 탭에서 확인');
    }
  }

  /* ---------------------------------------------------------------- 이벤트 */
  function bind() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.view));
    });

    document.getElementById('dateChips').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      state.mode = btn.dataset.date;
      document.querySelectorAll('#dateChips .chip').forEach((b) => b.classList.toggle('on', b === btn));
      document.getElementById('datePick').classList.remove('on');
      state.route = null;
      renderAll();
    });

    document.getElementById('datePick').addEventListener('change', (e) => {
      const v = e.target.value;
      if (!v) return;
      state.mode = 'date';
      state.pickDate = v;
      document.querySelectorAll('#dateChips .chip').forEach((b) => b.classList.remove('on'));
      e.target.classList.add('on');
      state.route = null;
      renderAll();
    });

    document.getElementById('routeBtn').addEventListener('click', () => {
      computeRoute();
      const list = visibleItems();
      if (list.length && state.route) note('노선을 계산했습니다. 지도의 초록 선과 번호 순서를 확인하세요.');
    });

    routeClear.addEventListener('click', () => {
      state.route = null;
      renderAll();
      note('경로 표시를 지웠습니다.');
    });

    document.getElementById('addToggle').addEventListener('click', () => {
      addForm.hidden = !addForm.hidden;
      if (!addForm.hidden) {
        if (!addForm.elements.date.value) addForm.elements.date.value = todayISO();
        addForm.elements.title.focus();
      }
    });

    document.getElementById('addCancel').addEventListener('click', () => {
      addForm.hidden = true;
    });

    addForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = addForm.elements;
      const title = f.title.value.trim();
      if (!title) return;
      const res = upsertItem({
        title: title,
        address: f.address.value.trim(),
        date: f.date.value || todayISO(),
        time: f.time.value,
        deadline: f.deadline.value,
        memo: f.memo.value.trim()
      });
      addForm.reset();
      addForm.hidden = true;
      state.mode = 'upcoming';
      document.querySelectorAll('#dateChips .chip').forEach((b) => b.classList.toggle('on', b.dataset.date === 'upcoming'));
      afterChange(res);
    });

    document.getElementById('exportBtn').addEventListener('click', exportJson);
    document.getElementById('importBtn').addEventListener('click', () => {
      document.getElementById('importFile').click();
    });
    document.getElementById('importFile').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importJson(file);
      e.target.value = '';
    });

    originSelect.addEventListener('change', () => {
      const v = originSelect.value;
      if (v.indexOf('p:') === 0) {
        const id = v.slice(2);
        const p = PRESETS.find((x) => x.id === id);
        if (p) setOrigin(p.label, p.lat, p.lng, 'preset');
      } else if (v === 'geo') {
        useGeoLocation();
      } else {
        originInput.focus();
      }
    });

    document.getElementById('originApply').addEventListener('click', applyOriginInput);
    originInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyOriginInput();
      }
    });
    document.getElementById('originGeo').addEventListener('click', useGeoLocation);

    listEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sact]');
      if (!btn) return;
      const act = btn.dataset.sact;
      if (act === 'mode-all') {
        state.mode = 'all';
        document.querySelectorAll('#dateChips .chip').forEach((b) => b.classList.toggle('on', b.dataset.date === 'all'));
        renderAll();
        return;
      }
      const card = btn.closest('.sched-card');
      if (!card) return;
      const it = byId(card.dataset.id);
      if (!it) return;
      if (act === 'visited') {
        it.visited = !it.visited;
        afterChange();
      } else if (act === 'reviewed') {
        it.reviewed = !it.reviewed;
        afterChange();
      } else if (act === 'pin') {
        state.pickId = it.id;
        note('지도를 클릭하면 「' + esc(it.title) + '」 위치를 지정합니다. (Esc 취소)');
        renderMapNote(visibleItems());
        if (map) mapEl.classList.add('picking');
      } else if (act === 'del') {
        state.items = state.items.filter((x) => x.id !== it.id);
        if (state.pickId === it.id) state.pickId = null;
        afterChange();
        toast('일정을 삭제했습니다');
      }
    });

    listEl.addEventListener('change', (e) => {
      const box = e.target.closest('[data-sact="sel"]');
      if (!box) return;
      const card = box.closest('.sched-card');
      const it = card ? byId(card.dataset.id) : null;
      if (!it) return;
      it.sel = box.checked;
      saveState();
      if (state.route) computeRoute();
    });

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sched-add]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      openSchedModal({
        cid: btn.dataset.cid,
        site: btn.dataset.site,
        title: btn.dataset.title,
        region: btn.dataset.region,
        url: btn.dataset.url,
        deadline: btn.dataset.deadline
      });
    }, true);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeSchedModal();
    });
    document.getElementById('modalCancel').addEventListener('click', closeSchedModal);

    modalForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!modalCtx) return;
      const f = modalForm.elements;
      const res = upsertItem({
        cid: modalCtx.cid,
        site: modalCtx.site,
        title: modalCtx.title,
        url: modalCtx.url,
        deadline: modalCtx.deadline,
        address: f.address.value.trim(),
        date: f.date.value || todayISO(),
        time: f.time.value,
        memo: f.memo.value.trim()
      });
      closeSchedModal();
      afterChange(res);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!modal.hidden) { closeSchedModal(); return; }
      if (state.pickId) {
        state.pickId = null;
        mapEl.classList.remove('picking');
        renderMapNote(visibleItems());
        note('');
      }
    });

    const grid = document.getElementById('grid');
    if (grid && window.MutationObserver) {
      let t = null;
      new MutationObserver(() => {
        clearTimeout(t);
        t = setTimeout(syncCardButtons, 60);
      }).observe(grid, { childList: true });
    }
  }

  function syncCardButtons() {
    const nodes = document.querySelectorAll('[data-sched-add]');
    for (let i = 0; i < nodes.length; i += 1) {
      const btn = nodes[i];
      const cid = btn.dataset.cid;
      const hit = cid ? state.items.find((it) => it.cid === cid) : null;
      btn.classList.toggle('added', !!hit);
      btn.textContent = hit ? '✅ ' + fmtDate(hit.date) + ' 담김' : '📅 일정 담기';
      btn.title = hit ? '내 일정에 담겨 있습니다 — 눌러서 날짜·메모 수정' : '방문 날짜·시간을 정해 내 일정에 담기';
    }
  }

  function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach((b) => {
      const on = b.dataset.view === name;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.getElementById('view-finder').hidden = name !== 'finder';
    view.hidden = name !== 'schedule';
    if (name === 'schedule') {
      renderAll();
      resolvePending();
      if (map) {
        setTimeout(() => { map.invalidateSize({ animate: false }); renderMap(); }, 120);
      }
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  /* --------------------------------------------------------------- 내보내기 */
  function exportJson() {
    const payload = {
      app: 'review-hub',
      version: 1,
      exportedAt: new Date().toISOString(),
      origin: state.origin,
      items: state.items
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'review-hub-일정-' + todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    note('일정 ' + state.items.length + '건을 JSON 파일로 내려받았습니다.');
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(String(reader.result));
        const incoming = Array.isArray(d) ? d : (d && Array.isArray(d.items) ? d.items : null);
        if (!incoming) throw new Error('items 배열을 찾지 못했습니다');
        let added = 0;
        let updated = 0;
        incoming.forEach((raw) => {
          if (!raw || !raw.title) return;
          const it = normalizeItem(raw);
          let hit = state.items.find((x) => x.id === it.id) || null;
          if (!hit && it.cid) hit = state.items.find((x) => x.cid === it.cid) || null;
          if (hit) {
            const keepId = hit.id;
            Object.assign(hit, it);
            hit.id = keepId;
            updated += 1;
          } else {
            state.items.push(it);
            added += 1;
          }
        });
        if (d && d.origin && isNum(Number(d.origin.lat))) {
          state.origin = {
            label: d.origin.label || '출발지',
            lat: Number(d.origin.lat),
            lng: Number(d.origin.lng),
            kind: d.origin.kind || 'address'
          };
        }
        saveState();
        renderAll();
        resolvePending();
        note('일정 <b>' + added + '건</b> 추가, <b>' + updated + '건</b> 갱신했습니다.');
      } catch (err) {
        note('JSON을 읽지 못했습니다: ' + esc(err.message));
      }
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------ 시작 */
  loadState();
  buildOriginSelect();
  updateOriginUI();
  bind();
  renderAll();
  resolvePending();
})();
