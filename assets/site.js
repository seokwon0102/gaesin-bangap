const DATA = window.SITE_DATA;
const COORDS = window.BUILDING_COORDS ?? {};
const DONG_CENTER = [36.6284, 127.4562]; // 충북대학교 정문 부근
const PAGES = [
  ['home', 'index.html', '계약 지도'],
  ['review', 'review.html', '거주 후기'],
  ['guide', 'guide.html', '주거 정보'],
];
const CATEGORY = {
  oneroom: { name: '원룸', rule: `${DATA.limits.oneRoom}㎡ 이하` },
  tworoom: { name: '투룸', rule: `${DATA.limits.oneRoom}㎡ 초과 ${DATA.limits.twoRoom}㎡ 이하` },
  officetel: { name: '오피스텔', rule: '면적 무관' },
};
const ROOM_TABS = [['', '전체'], ['oneroom', '원룸'], ['tworoom', '투룸'], ['officetel', '오피스텔']];
const DEAL_TABS = [['', '전체'], ['monthly', '월세'], ['jeonse', '전세']];
const SORT = [['date', '최근 계약순'], ['rent', '월세 낮은순'], ['deposit', '보증금 낮은순'], ['area', '넓은순']];

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (n) => n.toLocaleString('ko-KR');
const $ = (selector) => document.querySelector(selector);

function won(amount) {
  if (amount < 10000) return num(amount);
  const eok = Math.floor(amount / 10000);
  const rest = amount % 10000;
  return rest ? `${eok}억 ${num(rest)}` : `${eok}억`;
}
const priceText = (r) => (r.rent > 0 ? `월세 ${r.rent}만원 · 보증금 ${won(r.deposit)}만원` : `전세 ${won(r.deposit)}만원`);
const pyeong = (area) => (area / 3.3058).toFixed(1);
const titleOf = (r) => r.name || `${r.kind} ${r.cat === 'officetel' ? '' : CATEGORY[r.cat].name}`.trim();
const placeOf = (r) => (r.jibun ? `개신동 ${r.jibun}` : '개신동 · 지번 비공개');
const coordOf = (r) => (r.jibun ? COORDS[r.jibun] : null);
const shortPrice = (r) => (r.rent > 0 ? `${won(r.deposit)}/${r.rent}` : `전세 ${won(r.deposit)}`);

// 좌표가 들어 있는 위성 타일 한 장의 주소.
function satelliteTile([lat, lon], zoom = 18) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;
}

const lngLat = ([lat, lon]) => [lon, lat];

// 벡터 지도의 색과 글자를 사이트에 맞게 다시 칠한다.
function restyleMap(style) {
  const line = '#d3cec3';
  const colors = [
    [/^background$/, { 'background-color': '#f1efe8' }],
    [/^landuse-(residential|suburb|commercial|industrial|railway|cemetery)/, { 'fill-opacity': 0 }],
    [/^landuse-(school|hospital)/, { 'fill-color': '#f4eee2', 'fill-opacity': 1 }],
    [/^(park|landcover-wood|landcover-grass)/, { 'fill-color': '#d4ecc9', 'fill-opacity': 1 }],
    [/^water(-intermittent)?$/, { 'fill-color': '#a9dcf5' }],
    [/^waterway/, { 'line-color': '#a9dcf5' }],
    [/^building$/, { 'fill-color': '#eceae4', 'fill-outline-color': line }],
    [/motorway.*casing|trunk.*casing/, { 'line-color': '#e2b56b' }],
    [/casing/, { 'line-color': line }],
    [/-(motorway|motorway-link)$/, { 'line-color': '#fbc87c' }],
    [/-(trunk|trunk-primary|primary)$/, { 'line-color': '#ffe29f' }],
    [/-secondary-tertiary$/, { 'line-color': '#fff1bd' }],
    [/-(minor|link|service-track)$/, { 'line-color': '#ffffff' }],
    [/-path/, { 'line-color': '#e6e2da' }],
  ];
  style.layers = style.layers.filter((layer) => !/^(building-top|road_shield|highway-shield|road_oneway|boundary)/.test(layer.id) && layer.type !== 'hillshade');
  for (const layer of style.layers) {
    const match = colors.find(([pattern, paint]) => pattern.test(layer.id) && Object.keys(paint)[0].startsWith(layer.type));
    if (match) {
      layer.paint = { ...layer.paint, ...match[1] };
      delete layer.paint['fill-pattern'];
    }
    if (layer.type === 'symbol' && layer.layout?.['text-field']) {
      layer.layout['text-field'] = ['coalesce', ['get', 'name:ko'], ['get', 'name'], ['get', 'name_en']];
      layer.paint = { ...layer.paint, 'text-color': '#4b4744', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 };
    }
  }
  return style;
}

function createMap(box, { center, zoom, mode, scroll }) {
  const fail = () => { box.innerHTML = '<p class="mapfail">지도를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.</p>'; };
  if (!window.maplibregl) {
    fail();
    return null;
  }
  box.innerHTML = `<div class="mapcanvas"></div>
    <div class="seg mapseg" role="group" aria-label="지도 종류">
      <button type="button" data-layer="road">지도</button>
      <button type="button" data-layer="satellite">위성</button>
    </div>`;
  let map;
  try {
    map = new maplibregl.Map({
      container: box.querySelector('.mapcanvas'),
      style: { version: 8, sources: {}, layers: [] },
      center: lngLat(center), zoom, minZoom: 10, maxZoom: 18.5,
      dragRotate: false, pitchWithRotate: false, touchPitch: false, scrollZoom: Boolean(scroll),
      localIdeographFontFamily: "'IBM Plex Sans KR', 'Malgun Gothic', sans-serif",
    });
  } catch {
    fail();
    return null;
  }
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  map.setStyle('https://tiles.openfreemap.org/styles/bright', { transformStyle: (_, next) => restyleMap(next) });
  let current = mode;
  function apply() {
    if (map.getLayer('satellite')) map.setLayoutProperty('satellite', 'visibility', current === 'satellite' ? 'visible' : 'none');
    box.querySelectorAll('[data-layer]').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.layer === current)));
  }
  map.once('style.load', () => {
    map.addSource('satellite', {
      type: 'raster', tileSize: 256, maxzoom: 19,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    });
    const firstLabel = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
    map.addLayer({ id: 'satellite', type: 'raster', source: 'satellite' }, firstLabel);
    apply();
  });
  box.querySelector('.mapseg').addEventListener('click', (e) => {
    const button = e.target.closest('[data-layer]');
    if (!button) return;
    current = button.dataset.layer;
    apply();
  });
  apply();
  return map;
}

function renderShell() {
  const current = document.body.dataset.page;
  const links = PAGES.map(([id, href, label]) => `<a href="${href}"${id === current ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  $('#head').innerHTML = `<header class="nav"><div class="wrap">
    <a class="skip" href="#main">본문으로 건너뛰기</a>
    <a class="logo" href="index.html">개신방값</a>
    <nav class="menu" aria-label="주요 메뉴">${links}</nav>
    <a class="btn btn--primary navaction" href="review.html#write">후기 남기기</a>
  </div></header>
  <nav class="tabs" aria-label="하단 메뉴">${links}</nav>`;
  $('#foot').innerHTML = `<footer class="foot"><div class="wrap">
    <p>출처: 국토교통부 실거래가 공개 자료(공공데이터포털). ${DATA.range[0]}~${DATA.range[1]} 계약, ${DATA.fetchedAt} 수집.</p>
    <p>개신동 계약 ${DATA.totalRaw}건 중 66㎡를 넘는 ${DATA.excluded}건은 원룸·투룸이 아니라서 뺐습니다. 원룸과 투룸은 면적으로 나눈 추정 분류이며, 최근 자료는 신고 시점에 따라 늘어날 수 있습니다.</p>
  </div></footer>`;
}

function peakShare() {
  const peak = DATA.byMonth.filter(([month]) => ['2025.12', '2026.01', '2026.02'].includes(month));
  const count = peak.reduce((sum, [, n]) => sum + n, 0);
  return { count, percent: Math.round((count / DATA.summary.all.count) * 100) };
}

function monthChart() {
  const max = Math.max(...DATA.byMonth.map(([, n]) => n));
  const bars = DATA.byMonth.map(([month, n]) => {
    const label = `${month.replace('.', '년 ')}월`;
    return `<div class="bar" tabindex="0" aria-label="${label} ${n}건">
      <span class="tip">${label} ${n}건</span>
      ${n >= max * 0.9 ? `<b>${n}</b>` : ''}
      <i style="height:${(n / max) * 86}%"></i>
    </div>`;
  }).join('');
  const axis = DATA.byMonth.map(([month]) => `<span>${Number(month.slice(5))}월</span>`).join('');
  const rows = DATA.byMonth.map(([month, n]) => `<tr><td>${month}</td><td>${n}건</td></tr>`).join('');
  return `<div class="chart" style="--n:${DATA.byMonth.length}">
    <div class="bars">${bars}</div><div class="axis" aria-hidden="true">${axis}</div>
    <details><summary>월별 건수 표로 보기</summary><table><thead><tr><th>계약월</th><th>건수</th></tr></thead><tbody>${rows}</tbody></table></details>
  </div>`;
}

function listCard(r) {
  const coord = coordOf(r);
  const thumb = coord
    ? `<img src="${satelliteTile(coord)}" alt="" loading="lazy">`
    : `<span>${CATEGORY[r.cat].name}</span>`;
  return `<a class="lcard" href="detail.html?id=${r.id}"${r.jibun ? ` data-jibun="${esc(r.jibun)}"` : ''}>
    <div class="thumb">${thumb}</div>
    <div class="lbody">
      <div class="ltitle"><h3>${esc(titleOf(r))}</h3><span class="chip">${CATEGORY[r.cat].name}</span></div>
      <p class="meta">${esc(placeOf(r))} · ${r.areaType} ${r.area}㎡ (${pyeong(r.area)}평)</p>
      <p class="lprice">${esc(priceText(r))}</p>
      <p class="meta">${r.date} 계약</p>
    </div>
  </a>`;
}

const tabButtons = (key, tabs, active) => tabs.map(([value, label]) => (
  `<button type="button" data-${key}="${value}" aria-pressed="${value === active}">${label}</button>`)).join('');

function renderExplorer() {
  const params = new URLSearchParams(location.search);
  const state = { room: CATEGORY[params.get('room')] ? params.get('room') : '', deal: '', sort: 'date', query: '', building: '' };
  const { all, oneroom } = DATA.summary;
  $('#intro').innerHTML = `개신동 <strong>원룸·투룸·오피스텔</strong> 전월세 계약 ${num(all.count)}건을 계약 전에 확인하세요. 원룸 월세 중앙값은 보증금 ${oneroom.medianDeposit}만원에 월세 ${oneroom.medianRent}만원입니다.`;
  $('#roomTabs').innerHTML = tabButtons('room', ROOM_TABS, state.room);
  $('#dealTabs').innerHTML = tabButtons('deal', DEAL_TABS, state.deal);
  $('#sort').innerHTML = SORT.map(([v, label]) => `<option value="${v}">${label}</option>`).join('');

  const map = createMap($('#map'), { center: DONG_CENTER, zoom: 14, mode: 'road', scroll: true });
  $('#map').insertAdjacentHTML('beforeend', '<p class="maphidden" id="mapHidden" aria-live="polite"></p>');
  const points = Object.values(COORDS);
  if (map && points.length) {
    const wide = map.getContainer().clientWidth >= 720;
    const bounds = new maplibregl.LngLatBounds();
    (wide ? [...points, DONG_CENTER] : points).forEach((point) => bounds.extend(lngLat(point)));
    map.fitBounds(bounds, { duration: 0, maxZoom: 15, padding: wide ? 96 : { top: 96, bottom: 64, left: 72, right: 72 } });
  }

  const pins = {};

  // 붙어 있는 건물의 핀은 좌우로 벌려 금액이 겹치지 않게 한다.
  function sideOf(jibun, shown) {
    const [lat, lon] = COORDS[jibun];
    const near = shown.filter((other) => other !== jibun
      && Math.abs(COORDS[other][0] - lat) < 0.001 && Math.abs(COORDS[other][1] - lon) < 0.001);
    if (!near.length) return '';
    return near.every((other) => jibun < other) ? ' is-left' : ' is-right';
  }

  function pinHtml(rows) {
    const extra = rows.length > 1 ? `<em>외 ${rows.length - 1}건</em>` : '';
    return `<span>${esc(shortPrice(rows[0]))}${extra}</span>`;
  }

  function drawMap(list) {
    if (!map) return;
    Object.keys(pins).forEach((key) => {
      pins[key].remove();
      delete pins[key];
    });
    const buildings = {};
    let hidden = 0;
    for (const r of list) {
      if (coordOf(r)) (buildings[r.jibun] ??= []).push(r);
      else hidden += 1;
    }
    $('#mapHidden').textContent = hidden ? `지도에 없는 계약 ${num(hidden)}건, 지번 비공개` : '';
    for (const [jibun, rows] of Object.entries(buildings)) {
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.title = `개신동 ${jibun}`;
      pin.className = `pricepin${jibun === state.building ? ' is-active' : ''}${sideOf(jibun, Object.keys(buildings))}`;
      pin.innerHTML = pinHtml(rows);
      pin.addEventListener('click', () => selectBuilding(jibun));
      pins[jibun] = new maplibregl.Marker({ element: pin, anchor: 'bottom' }).setLngLat(lngLat(COORDS[jibun])).addTo(map);
    }
  }

  function selectBuilding(jibun) {
    state.building = jibun;
    draw();
    if (jibun) map.flyTo({ center: lngLat(COORDS[jibun]), zoom: 16, duration: 500 });
    $('.listpane').scrollTo({ top: $('#result').offsetTop - 16 });
  }

  function draw() {
    const words = state.query.trim().toLowerCase();
    const filtered = DATA.listings.filter((r) => {
      if (state.room && r.cat !== state.room) return false;
      if (state.deal === 'monthly' && r.rent === 0) return false;
      if (state.deal === 'jeonse' && r.rent > 0) return false;
      return !words || `${titleOf(r)} ${placeOf(r)} ${r.kind}`.toLowerCase().includes(words);
    });
    const order = {
      date: (a, b) => b.date.localeCompare(a.date),
      rent: (a, b) => (a.rent || Infinity) - (b.rent || Infinity) || a.deposit - b.deposit,
      deposit: (a, b) => a.deposit - b.deposit,
      area: (a, b) => b.area - a.area,
    }[state.sort];
    filtered.sort(order);
    if (state.building && !filtered.some((r) => r.jibun === state.building)) state.building = '';
    const list = state.building ? filtered.filter((r) => r.jibun === state.building) : filtered;
    $('#result').innerHTML = state.building
      ? `개신동 ${esc(state.building)} 계약 <strong>${num(list.length)}건</strong> <button type="button" class="clearpick" id="clearPick">전체 보기</button>`
      : `계약 <strong>${num(list.length)}건</strong>`;
    $('#list').innerHTML = list.length ? list.map(listCard).join('')
      : '<div class="empty"><p>조건에 맞는 계약이 없습니다.</p></div>';
    drawMap(filtered);
  }

  $('#result').addEventListener('click', (e) => {
    if (e.target.id === 'clearPick') selectBuilding('');
  });
  const lightPin = (e, on) => {
    const card = e.target.closest('.lcard');
    if (card?.dataset.jibun) pins[card.dataset.jibun]?.getElement()?.classList.toggle('is-hover', on);
  };
  $('#list').addEventListener('mouseover', (e) => lightPin(e, true));
  $('#list').addEventListener('mouseout', (e) => lightPin(e, false));

  function bindTabs(box, key) {
    box.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button) return;
      state[key] = button.dataset[key];
      box.querySelectorAll('button').forEach((el) => el.setAttribute('aria-pressed', String(el === button)));
      draw();
    });
  }
  bindTabs($('#roomTabs'), 'room');
  bindTabs($('#dealTabs'), 'deal');
  $('#search').addEventListener('input', (e) => { state.query = e.target.value; draw(); });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; draw(); });
  draw();
}

function compareText(r) {
  const median = DATA.summary[r.cat].medianRent;
  if (!r.rent || DATA.summary[r.cat].count <= 2) return '';
  const gap = r.rent - median;
  if (gap === 0) return `같은 종류의 월세 중앙값 ${median}만원과 같습니다.`;
  return `같은 종류의 월세 중앙값 ${median}만원보다 ${Math.abs(gap)}만원 ${gap > 0 ? '높습니다' : '낮습니다'}.`;
}

function renderDetail() {
  const r = DATA.listings.find((item) => item.id === Number(new URLSearchParams(location.search).get('id')));
  if (!r) {
    $('#detail').innerHTML = '<div class="empty"><p>계약 정보를 찾지 못했습니다.</p><a class="btn btn--secondary" href="index.html">목록으로 돌아가기</a></div>';
    return;
  }
  document.title = `${titleOf(r)} | 개신방값`;
  const coord = coordOf(r);
  const tiles = [
    r.rent > 0 ? ['보증금 / 월세', `${won(r.deposit)} / ${r.rent}만원`] : ['전세금', `${won(r.deposit)}만원`],
    [`${r.areaType} 면적`, `${r.area}㎡ (${pyeong(r.area)}평)`],
    ['준공', r.year ? `${r.year}년` : '자료 없음'],
    ['계약일', r.date],
  ];
  const chips = [r.kind, r.floor ? `${r.floor}층` : '', r.contract, r.term ? `기간 ${r.term}` : ''].filter(Boolean);
  const siblings = r.jibun ? DATA.listings.filter((item) => item.jibun === r.jibun && item.id !== r.id) : [];
  $('#detail').innerHTML = `
    <a class="back link" href="index.html">← 목록으로</a>
    <div class="mapbox mapbox--detail" id="detailMap"></div>
    ${coord ? '' : `<p class="mapnote">${r.jibun ? '이 건물은 아직 좌표가 없어' : '이 계약은 지번이 공개되지 않아'} 개신동 일대를 보여 줍니다. 위성사진 속 건물이 이 계약의 집은 아닙니다.</p>`}
    <span class="chip">${CATEGORY[r.cat].name}</span>
    <h1>${esc(titleOf(r))}</h1>
    <p class="sub">${esc(placeOf(r))}</p>
    <dl class="stats">${tiles.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <p class="chips">${chips.map((c) => `<span class="chip chip--plain">${esc(c)}</span>`).join('')}</p>
    ${compareText(r) ? `<p class="compare">${compareText(r)}</p>` : ''}
    <p class="notice">지금 나와 있는 매물이 아니라 이미 맺어진 계약 기록입니다. 관리비와 집 상태는 자료에 없습니다.</p>
    ${siblings.length ? `<h2>같은 건물의 다른 계약</h2><div class="lcards">${siblings.map(listCard).join('')}</div>` : ''}
    <div class="btn-row detailaction"><a class="btn btn--primary" href="review.html#write">후기 남기기</a><a class="btn btn--secondary" href="review.html">거주 후기 읽기</a></div>`;
  const map = createMap($('#detailMap'), { center: coord ?? DONG_CENTER, zoom: coord ? 17 : 15, mode: 'satellite' });
  if (map && coord) {
    const pin = document.createElement('div');
    pin.className = 'pricepin is-active';
    pin.innerHTML = `<span>${esc(shortPrice(r))}</span>`;
    new maplibregl.Marker({ element: pin, anchor: 'bottom' }).setLngLat(lngLat(coord)).addTo(map);
  }
}

function renderGuide() {
  const peak = peakShare();
  const { newer, middle, older } = DATA.ageCompare;
  $('#tiles').innerHTML = Object.entries(CATEGORY).map(([id, c]) => {
    const s = DATA.summary[id];
    const typical = s.count > 2
      ? `<p class="big">${s.medianDeposit}/${s.medianRent}</p><p class="note">월세 계약 중앙값, 단위 만원</p>`
      : `<p class="big">${s.count}건</p><p class="note">계약이 적어 시세로 보기 어렵습니다</p>`;
    return `<a class="tile" href="index.html?room=${id}"><h3>${c.name}</h3>
      <p class="count">${num(s.count)}건 · ${c.rule}</p>${typical}
      <span class="link">${c.name} 계약 보기</span></a>`;
  }).join('');
  $('#peakGuide').textContent = `개신동 계약의 ${peak.percent}%가 12~2월에 맺어졌습니다. 겨울에 계약이 크게 몰리므로, 이 시기에 방을 구한다면 일찍 둘러보는 편이 좋습니다.`;
  $('#monthChart').innerHTML = monthChart();
  const max = Math.max(...DATA.rentBands.map((b) => b.count));
  $('#bands').innerHTML = DATA.rentBands.map((b) => `<li><span>${b.label}</span>
    <i style="width:${(b.count / max) * 100}%"></i><span>${b.count}건</span></li>`).join('');
  const row = (label, s) => `<tr><td>${label}</td><td>${s.count}건</td><td>${s.medianDeposit}/${s.medianRent}</td><td>${s.medianArea}㎡</td></tr>`;
  $('#age').innerHTML = row('10년 이내', newer) + row('11~20년', middle) + row('21년 이상', older);
}

renderShell();
const page = document.body.dataset.page;
if (page === 'home') renderExplorer();
else if (page === 'detail') renderDetail();
else if (page === 'guide') renderGuide();
