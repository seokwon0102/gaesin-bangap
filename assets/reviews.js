const ROOMS = ['원룸(빌라)', '투룸', '오피스텔'];
const INCLUDED = ['수도', '전기', '가스', '인터넷', '난방'];
const CHOICES = {
  heatType: ['난방 방식', ['개별난방', '중앙난방', '지역난방', '모르겠음']],
  heatCost: ['겨울 난방비', ['낮음', '보통', '높음', '모르겠음']],
  hotWater: ['온수', ['문제없음', '저녁에 약함', '자주 끊김', '모르겠음']],
  position: ['방 위치', ['끝방', '중간방', '모르겠음']],
  light: ['채광', ['밝음', '보통', '어두움', '모르겠음']],
  mold: ['결로·곰팡이', ['없음', '약간 있음', '심함', '모르겠음']],
  noise: ['소음', ['조용함', '보통', '시끄러움', '모르겠음']],
  parking: ['주차', ['가능', '불가능', '모르겠음']],
};
const LOCAL_KEY = 'gaesin-reviews';
const MAX_COMMENT = 300;

// 웹 앱 주소가 있으면 구글 시트, 없으면 이 브라우저에만 저장한다.
const localStore = {
  shared: false,
  async list() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) ?? []; } catch { return []; }
  },
  async add(review) {
    const list = await this.list();
    list.unshift({ ...review, createdAt: new Date().toISOString() });
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  },
};

function sheetStore(url) {
  return {
    shared: true,
    async list() {
      const res = await fetch(url);
      if (!res.ok) throw new Error('list');
      return (await res.json()).reviews;
    },
    // text/plain 으로 보내야 브라우저가 Apps Script 가 받지 못하는 사전 요청을 보내지 않는다.
    async add(review) {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(review) });
      const result = await res.json();
      if (!result.ok) throw new Error(result.error);
    },
  };
}

const selectHtml = (key, label, values) => `<label class="field">${label}
  <select name="${key}"><option value="">선택 안 함</option>${values.map((v) => `<option>${v}</option>`).join('')}</select></label>`;

function reviewHtml(r) {
  const price = r.deal === '월세' ? `${won(r.deposit)}/${r.rent}` : won(r.deposit);
  const fee = r.fee == null ? '' : `관리비 ${r.fee}만원${r.included?.length ? ` (${r.included.join(', ')} 포함)` : ''}`;
  const tags = Object.entries(CHOICES)
    .filter(([key]) => r[key] && r[key] !== '모르겠음')
    .map(([key, [label]]) => `${label} ${r[key]}`);
  const day = r.createdAt ? r.createdAt.slice(0, 10).replaceAll('-', '.') : '';
  return `<article class="card">
    <p class="price"><span class="chip${r.deal === '전세' ? ' chip--jeonse' : ''}">${esc(r.deal)}</span>${esc(price)}</p>
    <p class="spec">${esc([r.room, r.place, r.building].filter(Boolean).join(' · '))}</p>
    ${fee ? `<p class="meta">${esc(fee)}</p>` : ''}
    ${tags.length ? `<p class="meta">${esc(tags.join(' · '))}</p>` : ''}
    ${r.comment ? `<p class="comment">${esc(r.comment)}</p>` : ''}
    <p class="meta">${esc([r.stay, r.period, day && `${day} 등록`].filter(Boolean).join(' · '))}</p>
  </article>`;
}

function tally(list, key) {
  const known = list.filter((r) => r[key] && r[key] !== '모르겠음');
  if (!known.length) return '응답 없음';
  const counts = {};
  for (const r of known) counts[r[key]] = (counts[r[key]] ?? 0) + 1;
  const [top, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return `${top} ${count}/${known.length}명`;
}

function readForm(form) {
  const f = new FormData(form);
  const text = (key) => String(f.get(key) ?? '').trim();
  const amount = (key) => (text(key) === '' ? null : Number(text(key)));
  const review = {
    room: text('room'), deal: text('deal'), stay: text('stay'),
    place: text('place'), building: text('building'), period: text('period'),
    deposit: amount('deposit'), rent: text('deal') === '월세' ? amount('rent') : 0,
    fee: amount('fee'), included: f.getAll('included'), comment: text('comment'), website: text('website'),
  };
  for (const key of Object.keys(CHOICES)) review[key] = text(key);

  const inRange = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
  if (!review.place) return { error: '대략적인 위치를 적어 주세요.', field: 'place' };
  if (!inRange(review.deposit, 100000)) return { error: '보증금을 0 이상의 만원 단위 숫자로 적어 주세요.', field: 'deposit' };
  if (review.deal === '월세' && !inRange(review.rent, 1000)) return { error: '월세를 0 이상의 만원 단위 숫자로 적어 주세요.', field: 'rent' };
  if (review.fee !== null && !inRange(review.fee, 100)) return { error: '관리비는 만원 단위 숫자로 적어 주세요.', field: 'fee' };
  if (!f.get('agree')) return { error: '안내 내용을 확인하고 체크해 주세요.', field: 'agree' };
  return { review };
}

async function renderReviews() {
  const form = $('#reviewForm');
  $('#roomSelect').innerHTML = ROOMS.map((v) => `<option>${v}</option>`).join('');
  $('#choiceFields').innerHTML = Object.entries(CHOICES).map(([key, [label, values]]) => selectHtml(key, label, values)).join('');
  $('#includedFields').innerHTML = INCLUDED.map((v) => `<label class="check"><input type="checkbox" name="included" value="${v}">${v}</label>`).join('');

  const store = window.REVIEWS_API_URL ? sheetStore(window.REVIEWS_API_URL) : localStore;
  $('#mode').textContent = store.shared
    ? '등록한 후기는 운영자가 확인한 뒤 공개됩니다.'
    : '시험 운영 중입니다. 후기는 지금 쓰는 브라우저에만 저장되고 다른 사람에게는 보이지 않습니다.';

  let reviews = [];
  let room = '';

  function draw() {
    const list = room ? reviews.filter((r) => r.room === room) : reviews;
    $('#reviewCount').innerHTML = `거주 후기 <strong>${num(list.length)}건</strong>`;
    $('#tally').innerHTML = list.length ? [['결로·곰팡이', 'mold'], ['소음', 'noise'], ['겨울 난방비', 'heatCost']]
      .map(([label, key]) => `<div><dt>${label}</dt><dd>${esc(tally(list, key))}</dd></div>`).join('') : '';
    $('#reviews').innerHTML = list.length ? list.map(reviewHtml).join('')
      : '<div class="empty"><p>아직 후기가 없습니다. 살아 본 집의 첫 후기를 남겨 주세요.</p><a class="btn btn--primary" href="#write">후기 남기기</a></div>';
  }

  async function load() {
    try {
      reviews = await store.list();
    } catch {
      $('#formError').textContent = '후기를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.';
    }
    draw();
  }

  $('#roomFilter').innerHTML = `<button type="button" data-room="" aria-pressed="true">전체</button>${
    ROOMS.map((v) => `<button type="button" data-room="${v}" aria-pressed="false">${v}</button>`).join('')}`;
  $('#roomFilter').addEventListener('click', (e) => {
    const button = e.target.closest('[data-room]');
    if (!button) return;
    room = button.dataset.room;
    document.querySelectorAll('[data-room]').forEach((el) => el.setAttribute('aria-pressed', String(el === button)));
    draw();
  });

  const syncDeal = () => { $('#rentField').hidden = form.elements.deal.value !== '월세'; };
  form.elements.deal.addEventListener('change', syncDeal);
  syncDeal();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { review, error, field } = readForm(form);
    const message = $('#formError');
    message.textContent = error ?? '';
    $('#formDone').textContent = '';
    if (error) {
      form.elements[field].focus();
      return;
    }
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    try {
      await store.add(review);
      form.reset();
      syncDeal();
      if (store.shared) {
        $('#formDone').textContent = '후기가 접수됐습니다. 운영자가 확인한 뒤 공개됩니다.';
      } else {
        await load();
        $('#reviewsTop').scrollIntoView();
      }
    } catch (err) {
      message.textContent = err.message && store.shared ? err.message : '저장하지 못했습니다. 내용을 확인하고 다시 시도해 주세요.';
    }
    submit.disabled = false;
  });

  await load();
}

renderReviews();
