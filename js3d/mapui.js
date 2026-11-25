/* =========================================================
 * js3d/mapui.js — 캠퍼스 지도 UI (2번 기능: 캠퍼스 지도 및 범위)
 *  - 미니맵: 화면 구석에 항상 떠 있는 "내 주변" 지도 (북쪽이 위)
 *            누르면 전체 지도가 열리고, 접기 버튼으로 숨길 수 있어요.
 *  - 전체 지도: M 키 또는 미니맵을 눌러 열어요.
 *            건물(이름)이나 원하는 곳을 누르면 바로 그리로 이동해요. (세로 화면에선 옆으로 끌어서 봐요)
 *  - 경계 안내: 캠퍼스 끝(생울타리)에 막히면 빨간 글씨로 알려 줘요.
 *
 *  좌표는 게임 좌표(px)를 그대로 써요. 캠퍼스 3000 × 2100px = 300m × 210m
 *  campus3d.js가 init(hooks)로 필요한 함수들을 넘겨주고, 매 프레임 frame()을 불러요.
 * ========================================================= */
import * as L from './logic.js?v=2026112501';

const DATA = window.DATA;
const Store = window.Store;

const MINI_SPAN = 1400;                 // 미니맵 가로로 보이는 범위(px) ≈ 140m (4:3이라 세로는 ≈ 105m)
const MINI_IDLE = 500;                  // 가만히 있을 땐 0.5초에 한 번만 다시 그려요 (가볍게)
const FOLD_KEY = 'cbnu-minimap-folded'; // 미니맵 접힘 상태 기억

const C = {
  outside: '#c3ccb8', campus: '#cfe8b4', road: '#f1e8d4',
  field: '#e39f7d', fieldIn: '#a5d48a', pond: '#8fcde8', pondEdge: '#69a8c6',
  plaza: '#ece3cf', plazaEdge: '#a79f92', hedge: '#4f7f3c', bollard: '#5b6266', gate: '#5a4636',
  tower: '#7d7368', mine: '#ff6a00', line: '#4a3d33'
};

let hooks = null;
let elMini, miniCv, elShow, elFull, fullCv, elMeDot, elNotice;
let fullOpen = false, folded = false, lastMini = 0, lastMiniKey = '', noticeTimer = 0;
let fv = { s: 1, ox: 0, oy: 0 };         // 전체 지도: 게임 px → 화면 px 변환

/* ---------------- 그리기 도우미 ---------------- */

// 캔버스 실제 해상도를 화면 크기 × 기기 배율에 맞춰요
function fit(cv) {
  const w = cv.clientWidth, h = cv.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
  return cv.getContext('2d');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function outlinedText(ctx, text, x, y, color) {
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255, 253, 246, .95)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color || C.line;
  ctx.fillText(text, x, y);
}

/* ---------------- 캠퍼스 그리기 (게임 좌표로 변환된 상태에서) ----------------
 *  k = 화면 1px이 게임 몇 px인지 → 선 굵기를 화면 기준으로 맞출 때 써요 */
function drawCampus(ctx, k) {
  const W = L.W, H = L.H;
  const gate = DATA.PLACES.find(function (p) { return p.type === 'gate'; });

  // 캠퍼스 밖(회색빛) / 캠퍼스 안(잔디)
  ctx.fillStyle = C.outside;
  ctx.fillRect(-3000, -3000, W + 6000, H + 6000);
  ctx.fillStyle = C.campus;
  ctx.fillRect(0, 0, W, H);

  // 운동장·연못
  DATA.PLACES.forEach(function (p) {
    if (p.type === 'field') {
      roundRect(ctx, p.x, p.y, p.w, p.h, p.h / 2);
      ctx.fillStyle = C.field; ctx.fill();
      roundRect(ctx, p.x + 26, p.y + 26, p.w - 52, p.h - 52, (p.h - 52) / 2);
      ctx.fillStyle = C.fieldIn; ctx.fill();
    } else if (p.type === 'pond') {
      ctx.beginPath();
      ctx.ellipse(p.x + p.w / 2, p.y + p.h / 2, p.w / 2, p.h / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = C.pond; ctx.fill();
      ctx.lineWidth = 2.5 * k; ctx.strokeStyle = C.pondEdge; ctx.stroke();
    }
  });

  // 길
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.road;
  DATA.ROADS.forEach(function (r) { ctx.lineWidth = r.w; line(ctx, r.x1, r.y1, r.x2, r.y2); });

  // 소원 돌탑 마당
  ctx.beginPath();
  ctx.arc(L.PLAZA.x, L.PLAZA.y, L.PLAZA.r, 0, Math.PI * 2);
  ctx.fillStyle = C.plaza; ctx.fill();
  ctx.lineWidth = 2.5 * k; ctx.strokeStyle = C.plazaEdge; ctx.stroke();

  // 건물 (지붕 색)
  DATA.PLACES.forEach(function (p) {
    if (p.type !== 'building') return;
    roundRect(ctx, p.x, p.y, p.w, p.h, 8);
    ctx.fillStyle = p.roof; ctx.fill();
    ctx.lineWidth = 1.5 * k; ctx.strokeStyle = C.line; ctx.stroke();
  });

  // 생울타리 = 캠퍼스 경계 (3D와 같은 logic.js hedgeRects, 작은 지도에선 최소 3px 굵기)
  ctx.lineCap = 'butt';
  ctx.fillStyle = C.hedge;
  L.hedgeRects(Math.max(12, 3 * k)).forEach(function (r) { ctx.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]); });

  // 정문 아래 볼라드 줄 (여기서 캠퍼스 끝)
  ctx.strokeStyle = C.bollard;
  ctx.lineWidth = Math.max(5, 2.5 * k);
  ctx.setLineDash([3 * k, 3 * k]);
  line(ctx, gate.x - 10, H - 10, gate.x + gate.w + 10, H - 10);
  ctx.setLineDash([]);

  // 정문 기둥
  ctx.fillStyle = C.gate;
  [gate.x, gate.x + gate.w].forEach(function (x) { ctx.fillRect(x - 9, gate.y + gate.h - 19, 18, 18); });
}

// 화면 좌표를 기기 픽셀 칸에 맞춰요 → 작은 점·글자가 움직일 때 번지거나 꿀렁이지 않게
function snap(v, dpr) { return Math.round(v * dpr) / dpr; }

// 돌탑 점: 모두 같은 크기, 내 돌탑은 색만 다르게(맨 위에). 화면 좌표로 그려요.
//  v = { s, ox, oy, dpr, w, h } (게임 px → 화면 px 변환과 캔버스 크기), r = 점 반지름(화면 px)
function drawTowers(ctx, towers, v, r) {
  let mine = null;
  const dot = function (t, color) {
    const x = snap(v.ox + t.x * v.s, v.dpr), y = snap(v.oy + t.y * v.s, v.dpr);
    if (x < -r || y < -r || x > v.w + r || y > v.h + r) return;   // 안 보이는 건 건너뛰기
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill(); ctx.stroke();
  };
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.3;
  towers.forEach(function (t) {
    if (Store.isMine(t.id)) mine = t;
    else dot(t, C.tower);
  });
  if (mine) dot(mine, C.mine);
}

// 건물·장소 이름표 (화면 좌표, 글자 크기 일정). 화면 밖으로 나가면 잘려 보여요.
//  opt = { size, icon(건물 아이콘 붙이기), short(정문·돌탑 마당을 짧게) }
//  돌려주는 값: 이름표 자리들 [{ place, x, y, w, h }] (화면 px, 누르기 판정용)
function drawLabels(ctx, v, opt) {
  ctx.font = opt.size + "px 'Jua', sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const rects = [];
  const put = function (place, text, gx, gy, dy, color) {
    const x = snap(v.ox + gx * v.s, v.dpr), y = snap(v.oy + gy * v.s + dy, v.dpr);
    if (x < -120 || y < -20 || x > v.w + 120 || y > v.h + 20) return;
    outlinedText(ctx, text, x, y, color);
    const w = ctx.measureText(text).width;
    rects.push({ place: place, x: x - w / 2, y: y - opt.size / 2, w: w, h: opt.size });
  };
  DATA.PLACES.forEach(function (p) {
    let text = p.name;
    if (p.type === 'building' && opt.icon) text = p.icon + ' ' + p.name;
    if (p.type === 'gate' && opt.short) text = '정문';      // 좁을 땐 짧게 (이름표 겹침 방지)
    if (p.type === 'gate') put(p, text, p.x + p.w / 2, p.y, -6);
    else put(p, text, p.x + p.w / 2, p.y + p.h / 2, 0);
  });
  put(PLAZA_PLACE, opt.short ? '돌탑 마당' : L.PLAZA.name, L.PLAZA.x, L.PLAZA.y + L.PLAZA.r, 10, '#8a5a3c');
  return rects;
}

// 나: 시야각 부채꼴(카메라 방향) + 화살표(캐릭터가 보는 방향). 화면 좌표.
function drawPlayer(ctx, x, y, st, size) {
  // 시야각: 카메라가 보는 방향을 부채꼴로 (가운데는 진하고 끝으로 갈수록 옅게)
  //  카메라는 캐릭터의 (sin yaw, cos yaw) 쪽에 있으니까 보는 방향은 그 반대예요
  const a = Math.atan2(-Math.cos(st.yaw), -Math.sin(st.yaw));
  const r = size * 5.5;
  const g = ctx.createRadialGradient(x, y, size * 0.6, x, y, r);
  g.addColorStop(0, 'rgba(51, 120, 240, .55)');   // 지도 앱처럼 파란 빛줄기 (잔디 위에서도 잘 보이게)
  g.addColorStop(1, 'rgba(51, 120, 240, 0)');
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, r, a - 0.6, a + 0.6);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();

  // 화살표: 캐릭터가 보는 방향
  // heading: 0이면 남쪽(+y), atan2(dx, dy) 규칙 (campus3d.js face()와 같음)
  const fx = Math.sin(st.heading), fy = Math.cos(st.heading);
  const bx = x - fx * size * 0.75, by = y - fy * size * 0.75;
  ctx.beginPath();
  ctx.moveTo(x + fx * size * 1.3, y + fy * size * 1.3);
  ctx.lineTo(bx + fy * size * 0.9, by - fx * size * 0.9);
  ctx.lineTo(x - fx * size * 0.3, y - fy * size * 0.3);
  ctx.lineTo(bx - fy * size * 0.9, by + fx * size * 0.9);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.lineWidth = 1.6; ctx.strokeStyle = C.line; ctx.stroke();
  ctx.fillStyle = st.color; ctx.fill();
}

/* ---------------- 미니맵 ---------------- */

function drawMini(st) {
  const w = miniCv.clientWidth, h = miniCv.clientHeight;
  if (!w || !h) return;
  const ctx = fit(miniCv), dpr = miniCv.width / w;
  const s = w / MINI_SPAN;
  const cx = w / 2, cy = h / 2;
  // 내가 가운데 오도록 옮겨서 그려요 (북쪽이 위). 옮기는 양은 기기 픽셀 단위로 맞춰요.
  const ox = snap(cx - st.x * s, dpr), oy = snap(cy - st.y * s, dpr);
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
  drawCampus(ctx, 1 / s);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const v = { s: s, ox: ox, oy: oy, dpr: dpr, w: w, h: h };
  drawTowers(ctx, st.towers, v, w >= 240 ? 3.6 : 3);
  // 이름표는 PC처럼 미니맵이 넉넉할 때만 (모바일 작은 미니맵에선 글자가 서로 겹쳐서 빼요)
  if (w >= 240) drawLabels(ctx, v, { size: 12, icon: false, short: true });
  drawPlayer(ctx, cx, cy, st, 7);
}

function setFolded(v) {
  folded = v;
  elMini.hidden = v;
  elShow.hidden = !v;
  try { window.localStorage.setItem(FOLD_KEY, v ? '1' : '0'); } catch (e) { /* 저장 못 해도 괜찮아요 */ }
}

/* ---------------- 전체 지도 ---------------- */

let fullPan = null;   // 세로 화면에서 지도를 옆으로 끌어 볼 때, 지도 왼쪽 끝의 화면 x
let drag = null;      // 누르고(끌고) 있는 손가락·마우스 정보
let labelRects = [];  // 전체 지도 이름표 자리 (누르기 판정용)
const PLAZA_PLACE = { type: 'plaza', name: L.PLAZA.name };
const TAP_PX = 10;    // 이보다 많이 움직이면 누르기가 아니라 끌기

// 지도 모달에 캠퍼스 바깥을 이만큼(게임 px)만 남겨요 → 모달 비율 = (3000+60) : (2100+60)
//  (CSS .fm-card의 aspect-ratio와 같은 숫자여야 지도에 딱 맞아요)
const FULL_MARGIN = 30;

// 게임 px → 화면 px 변환 정하기
//  - 가로(PC 모달): 모달이 지도 비율이라 캠퍼스가 모달에 딱 맞게 들어가요
//  - 세로 화면(폰): 높이를 꽉 채우고, 넘치는 좌우는 끌어서 봐요 (처음엔 내 위치가 가운데)
function fullLayout(w, h, st) {
  if (h > w) {
    const s = h / L.H;
    if (fullPan == null) fullPan = w / 2 - st.x * s;
    fullPan = Math.max(w - L.W * s, Math.min(0, fullPan));
    return { s: s, ox: fullPan, oy: 0, pan: true };
  }
  const s = Math.min(w / (L.W + FULL_MARGIN * 2), h / (L.H + FULL_MARGIN * 2));
  return { s: s, ox: (w - L.W * s) / 2, oy: (h - L.H * s) / 2, pan: false };
}

function drawFull(st) {
  const w = fullCv.clientWidth, h = fullCv.clientHeight;
  if (!w || !h) return;
  const ctx = fit(fullCv), dpr = fullCv.width / w;
  fv = fullLayout(w, h, st);
  const s = fv.s, ox = fv.ox, oy = fv.oy;

  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
  drawCampus(ctx, 1 / s);

  // 돌탑·이름표는 화면 좌표로 (크기가 일정하게)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const big = s > 0.3;
  const v = { s: s, ox: ox, oy: oy, dpr: dpr, w: w, h: h };
  drawTowers(ctx, st.towers, v, big ? 4.5 : 3.8);
  labelRects = drawLabels(ctx, v, { size: big ? 14 : 10, icon: big, short: !big });
  drawPlayer(ctx, ox + st.x * s, oy + st.y * s, st, big ? 10 : 8);
}

// 누르면 그곳으로 이동, 세로 화면(폰)에서 끌면 지도를 옆으로 보기
function onFullDown(e) {
  if (e.button > 0) return;
  if (drag) { drag.moved = true; return; }   // 두 번째 손가락 → 누르기로 치지 않아요
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: fullPan, moved: false };
  try { fullCv.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
}
function onFullMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > TAP_PX) drag.moved = true;
  if (fv.pan && drag.moved) fullPan = drag.pan + (e.clientX - drag.x);  // 범위는 다음 그리기에서 맞춰요
}
function onFullUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const tap = !drag.moved;
  drag = null;
  if (!tap) return;
  const r = fullCv.getBoundingClientRect();
  goFromMap(e.clientX - r.left, e.clientY - r.top);
}

// 지도의 (mx, my)에 있는 장소: 이름표 → 건물·연못·운동장·정문·돌탑 마당 순서로 찾아요
function placeAt(mx, my, x, y) {
  const hit = labelRects.filter(function (q) { return mx > q.x - 6 && mx < q.x + q.w + 6 && my > q.y - 6 && my < q.y + q.h + 6; });
  if (hit.length) {
    // 이름표가 겹쳐 있으면 누른 자리와 가운데가 제일 가까운 것
    hit.sort(function (a, b) {
      return Math.hypot(a.x + a.w / 2 - mx, a.y + a.h / 2 - my) - Math.hypot(b.x + b.w / 2 - mx, b.y + b.h / 2 - my);
    });
    return hit[0].place;
  }
  const p = DATA.PLACES.find(function (q) { return q.type !== 'field' && x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h; });
  return p || null;
}

// 그 장소 앞에 설 자리: 건물·연못은 남쪽 앞, 정문은 안쪽, 마당·운동장은 가운데
function frontOf(p) {
  if (p.type === 'plaza') return { x: L.PLAZA.x, y: L.PLAZA.y };
  const cx = p.x + p.w / 2;
  if (p.type === 'gate') return { x: cx, y: p.y - 60 };
  if (p.type === 'field') return { x: cx, y: p.y + p.h / 2 };
  return { x: cx, y: p.y + p.h + (p.type === 'pond' ? 22 : 40) };
}

function goFromMap(mx, my) {
  const x = (mx - fv.ox) / fv.s, y = (my - fv.oy) / fv.s;
  const p = placeAt(mx, my, x, y);
  closeFull();
  if (p) { const f = frontOf(p); hooks.goTo(f.x, f.y, p.name, p.type === 'building' || p.type === 'pond'); }
  else hooks.goTo(x, y, '', false);
}

function openFull() {
  if (fullOpen) return;
  fullOpen = true;
  fullPan = null;   // 열 때마다 내 위치를 가운데로
  drag = null;
  elFull.hidden = false;
  const st = hooks.state();
  elMeDot.setAttribute('fill', st.color);
  drawFull(st);
  elFull.focus({ preventScroll: true }); // 닫기 버튼에 초점 테두리가 생기지 않게 지도 자체에 초점
}

export function closeFull() {
  if (!fullOpen) return;
  fullOpen = false;
  elFull.hidden = true;
  if (elFull.contains(document.activeElement)) document.activeElement.blur();
}

/* ---------------- 경계 안내 ---------------- */

// 캠퍼스 끝에 막히는 동안 계속 불려요. 멈추면 1.4초 뒤 사라져요.
export function edgeWarn() {
  if (!elNotice) return;
  elNotice.classList.add('show');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(function () { elNotice.classList.remove('show'); }, 1400);
}

/* ---------------- 준비 / 매 프레임 ---------------- */

function isTyping(e) {
  const tg = e.target;
  return tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable);
}

/**
 * hooks = {
 *   state()        → { x, y, heading, yaw, color, towers }
 *   canOpen()      → 지금 전체 지도를 열어도 되나? (모달·돌 쌓기 중이면 false)
 *   goTo(x, y, name, north) → 그 자리(막혔으면 가까운 빈자리)로 이동. north면 북쪽(건물)을 바라봐요
 * }
 */
export function init(h) {
  // 전체 지도 모달 비율을 맵 크기에 맞춰요 (css .fm-card)
  document.documentElement.style.setProperty('--map-ar', ((L.W + FULL_MARGIN * 2) / (L.H + FULL_MARGIN * 2)).toFixed(4));
  hooks = h;

  // 미니맵
  elMini = document.createElement('div');
  elMini.className = 'minimap';
  elMini.innerHTML =
    '<canvas aria-hidden="true"></canvas>' +
    '<button class="mm-open" type="button" aria-label="전체 지도 열기 (M)" title="전체 지도 열기 (M)"></button>' +
    '<button class="mm-fold" type="button" aria-label="미니맵 접기" title="미니맵 접기">－</button>' +
    '<span class="mm-n" aria-hidden="true">N</span>' +
    '<span class="mm-key" aria-hidden="true">M</span>';
  miniCv = elMini.querySelector('canvas');
  elMini.querySelector('.mm-open').addEventListener('click', openFull);
  elMini.querySelector('.mm-fold').addEventListener('click', function () { setFolded(true); });

  // 접었을 때 보이는 작은 버튼
  elShow = document.createElement('button');
  elShow.className = 'minimap-show';
  elShow.type = 'button';
  elShow.textContent = '🗺️ 지도';
  elShow.title = '미니맵 펴기';
  elShow.addEventListener('click', function () { setFolded(false); });

  // 전체 지도: PC는 큰 모달, 모바일은 화면 가득. 지도만 + 떠 있는 닫기 버튼 + 왼쪽 아래 범례 카드
  elFull = document.createElement('div');
  elFull.className = 'fullmap';
  elFull.hidden = true;
  elFull.setAttribute('role', 'dialog');
  elFull.setAttribute('aria-modal', 'true');
  elFull.setAttribute('aria-label', '충북대학교 캠퍼스 지도');
  elFull.tabIndex = -1;
  elFull.innerHTML =
    '<div class="fm-card">' +
      '<canvas aria-label="캠퍼스 전체 지도. 건물이나 가고 싶은 곳을 누르면 그곳으로 이동해요."></canvas>' +
      '<div class="fm-hint">건물이나 원하는 곳을 누르면 바로 이동해요</div>' +
      '<button class="fm-close" type="button" aria-label="지도 닫기" title="닫기 (M)">✕</button>' +
      '<div class="fm-legend">' +
        '<span><svg class="fm-me" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 .8 11 11 6 8.2 1 11z"/></svg>나</span>' +
        '<span><i class="fm-dot tower"></i>돌탑</span>' +
        '<span><i class="fm-dot mine"></i>내 돌탑</span>' +
      '</div>' +
    '</div>';
  fullCv = elFull.querySelector('canvas');
  elMeDot = elFull.querySelector('.fm-me');
  fullCv.addEventListener('pointerdown', onFullDown);
  fullCv.addEventListener('pointermove', onFullMove);
  fullCv.addEventListener('pointerup', onFullUp);
  fullCv.addEventListener('pointercancel', function () { drag = null; });
  elFull.querySelector('.fm-close').addEventListener('click', closeFull);
  elFull.addEventListener('click', function (e) { if (e.target === elFull) closeFull(); }); // 모달 바깥 누르면 닫기

  // 경계 안내 문구
  elNotice = document.createElement('div');
  elNotice.className = 'edge-notice';
  elNotice.setAttribute('role', 'status');
  elNotice.setAttribute('aria-live', 'polite');
  elNotice.textContent = '캠퍼스 밖으로는 나갈 수 없어요';

  // 미니맵은 왼쪽 위 칸(#mapDock)의 도움말 버튼 앞에 넣어요
  const dock = document.getElementById('mapDock');
  (dock || document.body).prepend(elMini, elShow);
  document.body.append(elFull, elNotice);

  let saved = false;
  try { saved = window.localStorage.getItem(FOLD_KEY) === '1'; } catch (e) { /* 무시 */ }
  setFolded(saved);

  window.addEventListener('keydown', function (e) {
    if (isTyping(e)) return;
    if (e.code === 'KeyM' && !e.repeat) {
      if (fullOpen) closeFull();
      else if (hooks.canOpen()) openFull();
    } else if (e.key === 'Escape' && fullOpen) {
      closeFull();
    }
  });
}

export function frame() {
  if (!hooks) return;
  const st = hooks.state();
  if (fullOpen) drawFull(st);
  // 미니맵: 움직이는 동안엔 매 프레임 그려서 부드럽게, 가만히 있으면 0.5초에 한 번만
  if (folded) return;
  const now = performance.now();
  const key = [st.x, st.y, st.yaw, st.heading, st.towers.length, miniCv.clientWidth].join('|');
  if (key !== lastMiniKey || now - lastMini >= MINI_IDLE) {
    lastMiniKey = key;
    lastMini = now;
    drawMini(st);
  }
}
