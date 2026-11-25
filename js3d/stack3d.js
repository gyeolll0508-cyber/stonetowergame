/* =========================================================
 * js3d/stack3d.js — 3D 돌 쌓기 미니게임 (Three.js)
 *  기존 2D 버전(js/stack.js)과 "같은 규칙·같은 공개 API(window.Stack)"를 써요.
 *   - 판정·난이도·기록 로직은 2D 코드를 그대로 옮겼어요(px 단위 그대로).
 *   - 그리기만 3D로: 1px = 1cm 로 바꿔 입체 돌·그림자·조명으로 보여 줘요.
 *  균형 판정: 각 돌 위에 올라간 돌들의 "무게중심"이 두 돌이 맞닿은 면
 *  (접촉면) 안에 있어야 버텨요. 벗어나면 그 위가 와르르 무너져요.
 *  난이도: 높을수록 빨라지고, 4층부터 바람, 12층부터 손떨림.
 * ========================================================= */
import * as THREE from 'three';
import { makeStone, noise } from './actors.js?v=2026112502';
import { TONES, validTone, paintStone } from './tones.js';
import Bgm from './bgm.js';
import * as TX from './textures.js?v=2026112206';
const DATA = window.DATA, STONES = window.STONES, Store = window.Store;

/* ---------------- 규칙 상수 (2D와 동일) ---------------- */
const G = 2000;            // 중력 가속도(px/초²)
const HOVER_GAP = 160;     // 탑 꼭대기와 움직이는 돌 사이 간격
const WIND_FROM = 4;
const TREMOR_FROM = 12;
const BASE = { id: 'base', name: '받침돌', w: 230, h: 40, mass: 4, top: 0.96, bottom: 1, color: '#9c9488', shape: 'block' };

/* ---------------- 3D 표시 상수 ---------------- */
const K = 0.01;                            // 1px → 1cm
const CAM_YAW = -0.38, CAM_PITCH = 0.36;   // 오른쪽 앞, 약간 위에서 비스듬히
const FOV = 38;
const DEPTH = { slab: 0.72, block: 0.8, oval: 0.78, round: 0.95, pointy: 0.88 }; // 돌 두께(앞뒤) = 너비 × 비율

const $ = function (id) { return document.getElementById(id); };
let el = null;
let renderer = null, scene, camera, stackGroup, sun, guide, marker, face, popLayer;
let running = false, rafId = 0, lastT = 0, time = 0;
let vw = 0, vh = 0, bottomPad = 160, topPad = 80;
const view = { y: 1, dist: 10 };

let tower = null, onClose = null;
/* 친구와 번갈아 쌓기 (coop.js) — 혼자 쌓을 땐 null
 *  { host 돌탑 주인인지, name 상대 이름, send, leave, round 몇 번째 판,
 *    remote 지금 돌이 상대 돌인지, A 상대 화면의 좌우 폭, pend 상대 돌의 착지 정보,
 *    doneN 마지막으로 착지한 층 번호, ld 상대가 확인할 때까지 다시 보낼 착지 신호 }
 *  - n층째 돌은 n이 짝수면 주인, 홀수면 친구 차례예요(0부터).
 *  - 차례인 사람 화면이 기준: 떨어진 위치(x)를 보내면 상대도 같은 판정으로 쌓아요. */
let coop = null;
function myTurn() { return !coop || (height() % 2 === 0) === coop.host; }
let stack = [];            // {type, x, yb(아랫면 y, 위쪽이 음수), seed, mesh}
let selected = 'flat';
let state = 'hover';       // hover → falling → (hover | collapse | miss) → result
let mover = null;
let phase = 0;
let wind = 0;
let debris = [], dust = [], popups = [], leaves = [];
let minMargin = 1;
let endTimer = 0, endReason = '', endHeight = 0;
let recorded = false, reached15 = false, seedNo = 1;
const TIP_MS = 5000;   // '화면을 탭하면…' 안내가 보이는 시간
let tipTimer = 0;
let starTag = null;

/* ---------------- 균형 계산 (2D와 동일) ---------------- */

function height() { return stack.length - 1; }

function topY() {
  const t = stack[stack.length - 1];
  return t.yb - t.type.h;
}

// 아래 돌 a의 윗면과 위 돌 b의 아랫면이 겹치는 구간
function contact(a, b) {
  const l = Math.max(a.x - a.type.w * a.type.top / 2, b.x - b.type.w * b.type.bottom / 2);
  const r = Math.min(a.x + a.type.w * a.type.top / 2, b.x + b.type.w * b.type.bottom / 2);
  return { l: l, r: r };
}

// 모든 접촉면에서 위쪽 무게중심이 버티는지 검사
function analyze() {
  let min = 1, failK = -1, failDir = 1;
  for (let k = 0; k < stack.length - 1; k++) {
    const c = contact(stack[k], stack[k + 1]);
    let m = 0, mx = 0;
    for (let j = k + 1; j < stack.length; j++) {
      m += stack[j].type.mass;
      mx += stack[j].type.mass * stack[j].x;
    }
    const com = mx / m;
    const half = (c.r - c.l) / 2;
    const center = (c.l + c.r) / 2;
    const margin = half <= 0.5 ? -1 : (half - Math.abs(com - center)) / half;
    if (margin < min) {
      min = margin;
      if (margin < 0) { failK = k; failDir = com >= center ? 1 : -1; }
    }
  }
  return { min: min, failK: failK, dir: failDir };
}

/* ---------------- 3D 돌 ---------------- */

function depthPx(type) {
  return Math.min(165, type.w * (DEPTH[type.shape] || 0.8));
}

function stoneMesh(type, seed) {
  const m = makeStone(type.id === 'base' ? 'base' : type.id, seed);
  m.scale.set(type.w * K, type.h * K, depthPx(type) * K);
  m.rotation.y = ((seed * 0.37) % 0.3) - 0.15; // 돌마다 살짝 다른 방향
  m.userData.baseMat = m.material;             // 자연석톤(원래 색)으로 되돌릴 때 사용
  return m;
}

/* ---------------- 돌탑 꾸미기: 색상 테마 ----------------
 *  색표는 js3d/tones.js (캠퍼스 돌탑과 같은 색).
 *  "꾸미기 완료"를 누르면 내 돌탑에 테마를 저장해요(Store.setTone → Supabase).
 * ------------------------------------------------------- */
let tone = 'natural';
let decorating = false;

// 지금 화면에 있는 돌(쌓인 돌 + 떨어진 돌) 전체에 테마 적용 (받침돌 = 0층은 원래 색)
function applyTone(id) {
  tone = validTone(id);
  stack.forEach(function (s, i) { paintStone(s.mesh, tone, i); });
  debris.forEach(function (d, i) { paintStone(d.mesh, tone, stack.length + i); });
  if (el && el.tones) {
    Array.prototype.forEach.call(el.tones.children, function (b) {
      b.classList.toggle('on', b.dataset.tone === tone);
    });
  }
}

function openDecor() {
  if (state !== 'result' || height() + debris.length < 1) return;
  decorating = true;
  el.result.hidden = true;
  el.decor.hidden = false;
  el.scene.classList.add('decorating');
  // 이미 저장해 둔 테마가 있으면 그 테마로 시작
  if (tone === 'natural' && tower && tower.tone) applyTone(tower.tone);
  resize();
  const on = el.tones.querySelector('.tone-btn.on');
  if (on) on.focus();
}

function closeDecor() {
  if (!decorating) return;
  decorating = false;
  el.decor.hidden = true;
  el.scene.classList.remove('decorating');
  el.result.hidden = false;
  resize();
  // 내 돌탑에 테마 저장 → 캠퍼스·다른 사람 화면에도 같은 색으로 보여요
  const before = validTone(tower && tower.tone);
  if (tower && Store.setTone) Store.setTone(tower.id, tone);
  if (tone !== before || tone !== 'natural') {
    toast(tone === 'natural' ? '🪨 자연석톤으로 되돌렸어요' : '🎨 ' + TONES[tone].name + '으로 꾸몄어요! 캠퍼스 돌탑에도 보여요');
  }
  setTimeout(function () { el.rsDecorate.focus(); }, 50);
}

// 2D 좌표(x, 중심 y) → 3D 위치 (2D는 위쪽이 음수, 3D는 위쪽이 +)
function place(mesh, x, yc) {
  mesh.position.set(x * K, -yc * K, 0);
}

function disposeMesh(m) {
  if (m && m.parent) m.parent.remove(m);
}

/* ---------------- 진행 (2D와 동일한 규칙) ---------------- */

function typeOf(id) { return STONES.byId(id); }

function moverMesh() {
  const m = stoneMesh(mover.type, mover.seed);
  m.rotation.y = 0; // 얼굴이 카메라 쪽 면에 잘 붙도록 정면을 보게
  scene.add(m);
  return m;
}

// 돌 종류는 매번 무작위로 바뀌어요 (고를 수 없음). 층별 비율은 stones.js에 있어요
function randomType() { return STONES.pick(height() + 1); }

function newMover() {
  selected = randomType();
  mover = { type: typeOf(selected), x: 0, yb: topY() - HOVER_GAP, vy: 0, seed: seedNo++ };
  mover.mesh = moverMesh();
  markTray(selected);
}

function rollWind() {
  const h = height();
  if (h < WIND_FROM) { wind = 0; return; }
  const max = Math.min(30 + (h - WIND_FROM) * 9, 140);
  wind = (Math.random() < 0.5 ? -1 : 1) * max * (0.45 + Math.random() * 0.55);
}

// 화면에 보이는 반폭(px) — 2D의 vw/2/scale 에 해당
function visibleHalfWidth() {
  const tanV = Math.tan(FOV / 2 * Math.PI / 180);
  return view.dist * tanV * (vw / vh) / K;
}

function amplitude() {
  const halfW = visibleHalfWidth();
  return Math.max(40, Math.min(165, halfW - mover.type.w / 2 - 12));
}

function omega() { return Math.min(1.5 + height() * 0.13, 4.2); }

function tremor() { return height() >= TREMOR_FROM ? (height() - TREMOR_FROM + 1) * 0.9 : 0; }

// 다음 돌 준비: 내 차례면 돌을 꺼내고, 친구 차례면 친구 돌이 올 때까지 기다려요
function nextTurn() {
  if (!myTurn()) {
    wind = 0; mover = null; state = 'wait';
    markTray('');
    updateHud();
    return;
  }
  rollWind();
  state = 'hover';
  newMover();
  if (coop) { coop.remote = false; sendMover(); }
  updateHud();
}

function drop() {
  if (state !== 'hover' || !mover || (coop && coop.remote)) return;
  state = 'falling';
  mover.vy = 0;
  if (tremor()) mover.x += (Math.random() - 0.5) * tremor();
  if (coop) { coop.dropX = mover.x; sendMover(); }
}

function land() {
  if (coop) landed();
  const top = stack[stack.length - 1];
  const c = contact(top, mover);
  mover.yb = topY();
  if (c.r - c.l < 2) {
    // 돌이 아랫돌에 닿지 않음 → 굴러떨어짐
    const dir = mover.x >= top.x ? 1 : -1;
    debris.push(toDebris(mover, dir, 1.2));
    mover = null;
    endHeight = height();
    startEnd('miss');
    return;
  }
  const prevH = height();
  const s = { type: mover.type, x: mover.x, yb: mover.yb, seed: mover.seed, mesh: mover.mesh };
  stack.push(s);
  stackGroup.add(s.mesh);
  place(s.mesh, s.x, s.yb - s.type.h / 2);
  const offset = Math.abs(mover.x - top.x);
  mover = null;
  const a = analyze();
  if (a.failK >= 0) {
    // 무너짐: failK 위의 돌들이 쏟아짐
    const fallen = stack.splice(a.failK + 1);
    fallen.forEach(function (f, i) {
      scene.attach(f.mesh);
      debris.push(toDebris(f, a.dir, 1 + i * 0.12));
    });
    puff(fallen[0].x, fallen[0].yb, 12);
    endHeight = prevH;
    minMargin = 0;
    startEnd('collapse');
    return;
  }
  minMargin = a.min;
  const lt = stack[stack.length - 1];
  puff(lt.x, lt.yb, 6);
  let msg = '+1층';
  if (a.min < 0.22) msg = '아슬아슬! 😰';
  else if (offset < 3) msg = '완벽해요! ✨';
  popup(msg, lt.x, lt.yb - lt.type.h - 10, '#3d3229');
  if (height() >= DATA.GAUGE_MAX && !reached15) {
    reached15 = true;
    popup('🌟 소원 게이지 100%!', 0, lt.yb - lt.type.h - 50, '#d9822b');
  }
  if (height() === WIND_FROM) popup('🍃 바람이 불기 시작해요', 0, lt.yb - lt.type.h - 80, '#3f7cc0');
  if (height() === TREMOR_FROM) popup('🫨 손이 떨리기 시작해요', 0, lt.yb - lt.type.h - 80, '#b4645f');
  nextTurn();
}

function toDebris(s, dir, power) {
  return {
    type: s.type, seed: s.seed, mesh: s.mesh,
    x: s.x, y: s.yb - s.type.h / 2,
    vx: dir * (50 + Math.random() * 110) * power + wind * 0.5,
    vy: -60 - Math.random() * 120,
    ang: 0, av: dir * (1.2 + Math.random() * 2.4),
    // 3D 연출용: 앞뒤로도 조금 흩어지고 굴러요
    z: 0, vz: (Math.random() - 0.5) * 1.6, rx: 0, avx: (Math.random() - 0.5) * 3
  };
}

function startEnd(reason) {
  state = reason;
  endReason = reason;
  endTimer = reason === 'collapse' ? 1.9 : 1.3;
  updateHud();
}

function showResult(reason) {
  state = 'result';
  endReason = reason;
  const h = reason === 'finish' ? (coop && !coop.host && coop.finH != null ? coop.finH : height()) : endHeight;
  let res = { best: tower.best, isRecord: false };
  const guest = !!coop && !coop.host;   // 도와주러 온 친구 화면 — 기록은 주인 돌탑에만 남아요
  if (guest) {
    res = { best: Math.max(tower.best, h), isRecord: false };
    tower.best = res.best;
    recorded = true;
  } else if (!recorded) {
    res = h > 0 ? Store.recordHeight(tower.id, h) : { best: tower.best, isRecord: false };
    recorded = true;
  }
  const gauge = DATA.gauge(res.best);
  let emoji = '🪨', title = '돌탑 완성!', note;
  if (reason === 'collapse') {
    emoji = '💥'; title = '와르르! 무너졌어요';
    note = '위에 올린 돌들의 무게중심이 아랫돌을 벗어났어요. 무너지기 직전 높이(' + h + '층)가 기록돼요.';
  } else if (reason === 'miss') {
    emoji = '😵'; title = '돌이 굴러떨어졌어요';
    note = '돌이 아랫돌에 닿지 않았어요. 둥근돌·뾰족돌 위는 특히 좁아요!';
  } else {
    note = h >= DATA.GAUGE_MAX ? '소원 기원 게이지가 가득 찼어요. 소원이 꼭 이뤄지길! 🌟'
      : '앞으로 ' + (DATA.GAUGE_MAX - res.best) + '층 더 쌓으면 소원 기원 게이지 100%예요.';
  }
  if (res.isRecord) emoji = res.best >= DATA.GAUGE_MAX ? '🌟' : '🏆';
  if (h === 0 && reason !== 'finish') note += ' (0층은 기록되지 않아요)';
  if (guest) note = '🤝 ' + coop.name + '님의 돌탑 쌓기를 도왔어요! 기록은 ' + coop.name + '님 돌탑에 남아요. 주인이 다시 도전하면 자동으로 이어져요.';
  else if (coop) note += ' 🤝 ' + coop.name + '님과 함께 쌓았어요.';
  if (reason === 'finish' && h > 0) Bgm.sfx('success'); // 돌탑 완성 효과음
  el.rsEmoji.textContent = emoji;
  el.rsTitle.textContent = title;
  el.rsHeight.textContent = h + '층';
  el.rsBest.textContent = res.best + '층';
  el.rsRecord.hidden = !res.isRecord;
  el.rsGaugeFill.style.width = gauge.pct + '%';
  el.rsGaugeLabel.textContent = gauge.label;
  el.rsNote.textContent = note;
  el.rsDecorate.hidden = guest || stack.length + debris.length < 2; // 꾸밀 돌이 있을 때만 (주인만)
  el.rsRetry.hidden = guest;
  el.result.hidden = false;
  el.skBest.textContent = res.best;
  if (mover) { disposeMesh(mover.mesh); mover = null; }
  if (coop) { coop.remote = false; coop.pend = null; updateHud(); if (coop.host) coop.send(Object.assign({ k: 'hb' }, Stack.coopBeat())); }
  setTimeout(function () { (guest ? el.rsExit : el.rsRetry).focus(); }, 50);
}

function finish() {
  if (coop && !coop.host) return;
  if (state !== 'hover' && state !== 'wait') return;
  if (height() === 0) { toast('돌을 하나 이상 쌓아 주세요 🪨'); return; }
  showResult('finish');
}

function toast(msg) { if (window.App && App.toast) App.toast(msg); }

/* ---------------- 효과: 먼지·글자·잎 ---------------- */

let dustTex = null;
function puff(x, y, n) {
  dustTex = dustTex || TX.glowTexture();
  for (let i = 0; i < n; i++) {
    const mat = new THREE.SpriteMaterial({ map: dustTex, color: 0xe8dcc4, transparent: true, depthWrite: false, opacity: 0.8 });
    const sp = new THREE.Sprite(mat);
    scene.add(sp);
    dust.push({
      x: x + (Math.random() - 0.5) * 60, y: y, z: (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 60, vz: (Math.random() - 0.5) * 80,
      r: 4 + Math.random() * 6, life: 1, sprite: sp
    });
  }
}

function popup(text, x, y, color) {
  const d = document.createElement('div');
  d.className = 'sk3d-pop';
  d.textContent = text;
  d.style.color = color;
  popLayer.appendChild(d);
  popups.push({ text: text, x: x, y: y, life: 1.4, el: d });
}

const leafGeo = new THREE.PlaneGeometry(0.14, 0.07);
const leafMat = new THREE.MeshStandardMaterial({ color: 0x7cc46a, side: THREE.DoubleSide, roughness: 0.8 });

/* ---------------- 업데이트 ---------------- */

function update(dt) {
  time += dt;
  if (state === 'hover' && mover) {
    phase += omega() * dt;
    const A = coop && coop.remote ? coop.A : amplitude();
    let x = Math.sin(phase) * A;
    const tr = tremor();
    if (tr) x += (Math.sin(time * 31) + Math.sin(time * 17.3)) * 0.5 * tr;
    mover.x = x;
    mover.yb = topY() - HOVER_GAP + Math.sin(time * 3) * 4;
  } else if (state === 'falling' && mover) {
    mover.vy += G * dt;
    mover.yb += mover.vy * dt;
    mover.x += wind * 0.8 * dt;
    if (mover.yb >= topY()) {
      if (!(coop && coop.remote)) land();
      else if (coop.pend) { mover.x = coop.pend.x; land(); }   // 친구가 알려 준 정확한 자리에 착지
      else mover.yb = topY();                                  // 착지 신호를 기다려요
    }
  }

  debris.forEach(function (d) {
    d.vy += G * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.ang += d.av * dt;
    d.z += d.vz * dt;
    d.rx += d.avx * dt;
    const bottom = d.y + d.type.h / 2;
    if (bottom > 0) {
      d.y = -d.type.h / 2;
      if (Math.abs(d.vy) > 120) puff(d.x, 0, 2);
      d.vy *= -0.32;
      d.vx *= 0.7;
      d.av *= 0.6;
      d.vz *= 0.6;
      d.avx *= 0.5;
    }
  });

  dust.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy += 80 * dt; p.life -= dt * 1.6; });
  dust = dust.filter(function (p) {
    if (p.life > 0) return true;
    scene.remove(p.sprite); p.sprite.material.dispose();
    return false;
  });
  popups.forEach(function (p) { p.y -= 40 * dt; p.life -= dt; });
  popups = popups.filter(function (p) { if (p.life > 0) return true; p.el.remove(); return false; });

  // 바람에 날리는 잎
  if (Math.abs(wind) > 0 && Math.random() < Math.abs(wind) / 900) {
    const halfW = visibleHalfWidth() * K + 1;
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.position.set(wind > 0 ? -halfW : halfW, view.y + (Math.random() - 0.3) * 3, (Math.random() - 0.2) * 3);
    scene.add(leaf);
    leaves.push({ mesh: leaf, v: wind * (2 + Math.random()) * K, r: Math.random() * 6, lim: halfW + 0.5 });
  }
  leaves.forEach(function (l) {
    l.mesh.position.x += l.v * dt;
    l.mesh.position.y += Math.sin(time * 3 + l.r) * 0.2 * dt;
    l.mesh.rotation.set(l.r + time * 3, l.r * 2 + time * 2, 0);
  });
  leaves = leaves.filter(function (l) {
    if (Math.abs(l.mesh.position.x) < l.lim) return true;
    scene.remove(l.mesh);
    return false;
  });

  if (state === 'collapse' || state === 'miss') {
    endTimer -= dt;
    if (endTimer <= 0) showResult(endReason);
  }

  updateView(dt);
}

/* ---------------- 카메라 ---------------- */

function updateView(dt) {
  const tanV = Math.tan(FOV / 2 * Math.PI / 180);
  const aspect = vw / vh;
  const effH = Math.max(0.35, (vh - bottomPad - topPad) / vh); // HUD·트레이를 뺀 높이 비율
  const topM = -topY() * K;
  let focusY, needV;
  if (state === 'result') {
    // 결과 화면: 탑 전체가 보이게 뒤로 물러나요
    focusY = Math.max(0.8, topM * 0.5 + 0.2);
    needV = topM + 1.6;
  } else if (state === 'collapse' || state === 'miss') {
    focusY = view.y;
    needV = null;
  } else {
    focusY = topM + HOVER_GAP * K * 0.15; // 움직이는 돌은 화면 위쪽, 탑은 최대한 많이 보이게
    needV = 4.6;
  }
  const k = 1 - Math.pow(0.02, dt);
  view.y += (focusY - view.y) * k;
  if (needV != null) {
    // 2D와 같은 폭(약 470px = 4.7m)이 화면에 들어오게
    const dist = Math.max(needV / 2 / (tanV * effH), 2.35 / (tanV * aspect), 5);
    view.dist += (dist - view.dist) * k;
  }

  const ch = Math.cos(CAM_PITCH) * view.dist;
  camera.position.set(Math.sin(CAM_YAW) * ch, view.y + Math.sin(CAM_PITCH) * view.dist, Math.cos(CAM_YAW) * ch);
  camera.lookAt(0, view.y, 0);

  // 그림자 범위를 탑 주변으로
  sun.target.position.set(0, Math.max(0, view.y - 1.5), 0);
  sun.position.set(-4.5, view.y + 9, 6.5);
}

/* ---------------- 그리기 ---------------- */

const tmpV = new THREE.Vector3();

function toScreen(xpx, ypx, out) {
  tmpV.set(xpx * K, -ypx * K, 0).project(camera);
  out.x = (tmpV.x + 1) / 2 * vw;
  out.y = (1 - tmpV.y) / 2 * vh;
  return out;
}

function draw() {
  // 흔들림: 균형이 아슬아슬할수록 탑이 살짝 흔들려요 (2D와 동일)
  const sway = (state === 'hover' || state === 'falling' || state === 'wait') ? Math.max(0, 0.35 - minMargin) * 0.05 * Math.sin(time * 3.2) : 0;
  stackGroup.rotation.z = -sway;

  // 움직이는 돌 + 낙하 안내선 + 착지 표시
  if (mover) {
    place(mover.mesh, mover.x, mover.yb - mover.type.h / 2);
    const ty = -topY() * K, my = -mover.yb * K;
    guide.visible = marker.visible = state === 'hover';
    if (state === 'hover') {
      guide.position.set(mover.x * K, (ty + my) / 2, 0);
      guide.scale.set(1, Math.max(0.01, my - ty), 1);
      const c = contact(stack[stack.length - 1], mover);
      marker.material.color.set(c.r - c.l >= 2 ? 0x5cb87a : 0xf05a5a);
      marker.position.set(mover.x * K, ty + 0.01, 0);
      marker.scale.set(mover.type.w * mover.type.bottom / 2 * K, 1, depthPx(mover.type) * 0.45 * K);
    }
    // 귀여운 얼굴: 카메라 쪽 면에 붙여요
    const a = mover.type.w / 2 * K, c2 = depthPx(mover.type) / 2 * K;
    const sy = Math.sin(CAM_YAW), cy = Math.cos(CAM_YAW);
    const rr = 1 / Math.sqrt((sy / a) * (sy / a) + (cy / c2) * (cy / c2));
    face.visible = true;
    face.position.set(mover.mesh.position.x + sy * rr * 1.1, mover.mesh.position.y + mover.type.h * K * 0.05, cy * rr * 1.1);
    face.rotation.y = CAM_YAW;
    const fs = Math.min(1, mover.type.h / 46) * Math.min(1, mover.type.w / 90);
    face.scale.setScalar(Math.max(0.55, fs));
  } else {
    guide.visible = marker.visible = face.visible = false;
  }

  debris.forEach(function (d) {
    d.mesh.position.set(d.x * K, -d.y * K, d.z);
    d.mesh.rotation.set(d.rx, d.mesh.rotation.y, -d.ang);
  });
  dust.forEach(function (p) {
    p.sprite.position.set(p.x * K, -p.y * K, p.z * K);
    const s = p.r * K * 3;
    p.sprite.scale.set(s, s, 1);
    p.sprite.material.opacity = Math.max(0, p.life) * 0.8;
  });

  renderer.render(scene, camera);

  // 글자(HTML)를 3D 위치에 맞춰 표시
  const sp = { x: 0, y: 0 };
  popups.forEach(function (p) {
    toScreen(p.x, p.y, sp);
    p.el.style.transform = 'translate(' + sp.x.toFixed(1) + 'px,' + sp.y.toFixed(1) + 'px) translate(-50%,-50%)';
    p.el.style.opacity = Math.min(1, p.life);
  });
  if (height() >= DATA.GAUGE_MAX) {
    const s = stack[DATA.GAUGE_MAX];
    toScreen(s.x + s.type.w / 2 + 14, s.yb - s.type.h / 2, sp);
    starTag.style.display = '';
    starTag.style.transform = 'translate(' + sp.x.toFixed(1) + 'px,' + sp.y.toFixed(1) + 'px) translate(-20%,-50%)';
  } else {
    starTag.style.display = 'none';
  }
}

/* ---------------- 3D 장면 만들기 ---------------- */

function blob(radius, seed, detail) {
  const g = new THREE.IcosahedronGeometry(radius, detail || 2);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise(v.x / radius * 1.4 + seed, v.y / radius * 1.4, v.z / radius * 1.4) - 0.5;
    v.multiplyScalar(1 + n * 0.35);
    if (v.y < 0) v.y *= 0.65;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function buildScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 3000);

  // 하늘
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x5f9fdc) }, bottom: { value: new THREE.Color(0xe4eef0) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP;\n' +
      'void main(){ float h = clamp(vP.y * 1.8 + 0.04, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.75)), 1.0);\n' +
      '#include <colorspace_fragment>\n}'
  }));
  scene.add(sky);
  scene.fog = new THREE.Fog(0xdde8ec, 60, 420);

  // 빛
  scene.add(new THREE.HemisphereLight(0xe3f0ff, 0x6a7a4c, 1.1));
  sun = new THREE.DirectionalLight(0xfff0d8, 2.8);
  sun.castShadow = true;
  const mobile = window.innerWidth < 700;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = -6; sc.right = 6; sc.top = 6; sc.bottom = -6; sc.near = 0.5; sc.far = 40;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // 땅: 잔디 + 자갈 마당
  const grass = TX.grassTexture();
  grass.repeat.set(60, 60);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(480, 480), new THREE.MeshStandardMaterial({ map: grass, roughness: 1, color: 0xf2f5ea }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const gravel = TX.gravelTexture();
  gravel.repeat.set(4, 4);
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(5, 64), new THREE.MeshStandardMaterial({ map: gravel, roughness: 1 }));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.005;
  plaza.receiveShadow = true;
  scene.add(plaza);
  const ring = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.22, 0), new THREE.MeshStandardMaterial({ color: 0xa79f92, roughness: 1, flatShading: true }), 56);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s3 = new THREE.Vector3(1, 0.7, 1), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 56; i++) {
    const a = i / 56 * Math.PI * 2;
    v.set(Math.cos(a) * 5, 0.08, Math.sin(a) * 5);
    q.setFromAxisAngle(up, i * 1.3);
    ring.setMatrixAt(i, m4.compose(v, q, s3));
  }
  ring.castShadow = ring.receiveShadow = true;
  scene.add(ring);

  // 배경: 중앙도서관·건물·나무·산 (돌탑 마당에서 보이는 풍경)
  const bgBuild = function (wall, roof, floors, w, d, x, z, rotY, glass) {
    const h = floors * 3.6;
    const fm = new THREE.MeshStandardMaterial({ map: TX.facadeTexture(wall, floors, w, glass ? 'glass' : 'normal', true, x * 7 + z), roughness: 0.85 });
    const sm = new THREE.MeshStandardMaterial({ map: TX.facadeTexture(wall, floors, d, glass ? 'glass' : 'normal', false, x + z * 3), roughness: 0.85 });
    const rm = new THREE.MeshStandardMaterial({ color: roof, roughness: 0.9 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [sm, sm, rm, rm, fm, fm]);
    b.position.set(x, h / 2, z);
    b.rotation.y = rotY;
    b.receiveShadow = true;
    scene.add(b);
  };
  bgBuild('#e9eef5', '#5b7fb5', 5, 27, 16, -2, -34, 0, true);      // 중앙도서관
  bgBuild('#f4e3c3', '#c76b4f', 5, 23, 13, -38, -24, 0.5, false);  // 대학본부
  bgBuild('#e3ecef', '#4f8f97', 6, 30, 15, 36, -30, -0.45, true);  // 공과대학
  const treeGeo = blob(1.6, 3), pineGeo = new THREE.ConeGeometry(1.4, 4, 8);
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 2.2, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5a43, roughness: 1 });
  for (let i = 0; i < 22; i++) {
    const a = i / 22 * Math.PI * 2 + Math.sin(i * 3.7) * 0.15;
    const r = 11 + Math.abs(Math.sin(i * 5.3)) * 12;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z > 4 && Math.abs(x) < 9) continue; // 카메라 앞은 비워 둬요
    const kind = i % 5 === 0 ? 'pine' : i % 4 === 0 ? 'blossom' : 'round';
    const tr = new THREE.Mesh(trunkGeo, trunkMat);
    tr.position.set(x, 1.1, z);
    tr.castShadow = true;
    scene.add(tr);
    const col = new THREE.Color().setHSL(kind === 'blossom' ? 0.96 : kind === 'pine' ? 0.37 : 0.26, kind === 'blossom' ? 0.6 : 0.45, kind === 'blossom' ? 0.82 : 0.33 + (i % 3) * 0.04);
    const top = new THREE.Mesh(kind === 'pine' ? pineGeo : treeGeo, new THREE.MeshStandardMaterial({ color: col, roughness: 0.95, flatShading: true }));
    top.position.set(x, kind === 'pine' ? 3.9 : 3.3, z);
    top.castShadow = true;
    scene.add(top);
  }
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x6a8a55, roughness: 1, flatShading: true });
  const hillGeo = blob(1, 7, 2);
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI * 0.95 + i / 8 * Math.PI * 0.9;
    const hill = new THREE.Mesh(hillGeo, hillMat);
    const s = 60 + Math.abs(Math.sin(i * 2.7)) * 60;
    hill.scale.set(s, s * 0.35, s * 0.6);
    hill.position.set(Math.cos(a) * 220, -4, Math.sin(a) * 220);
    scene.add(hill);
  }

  // 탑(흔들림 기준점 = 받침돌 바닥 중앙)
  stackGroup = new THREE.Group();
  scene.add(stackGroup);

  // 낙하 안내선과 착지 표시
  guide = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 6),
    new THREE.MeshBasicMaterial({ color: 0x3d3229, transparent: true, opacity: 0.35, depthWrite: false }));
  scene.add(guide);
  marker = new THREE.Mesh(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x5cb87a, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false }));
  marker.renderOrder = 5;
  scene.add(marker);

  // 움직이는 돌의 얼굴(눈 2개 + 볼터치)
  face = new THREE.Group();
  const eyeG = new THREE.SphereGeometry(0.035, 10, 8), eyeM = new THREE.MeshBasicMaterial({ color: 0x2a211c });
  const blushG = new THREE.CircleGeometry(0.05, 14), blushM = new THREE.MeshBasicMaterial({ color: 0xff8f8f, transparent: true, opacity: 0.55, depthWrite: false });
  [-1, 1].forEach(function (sd) {
    const e = new THREE.Mesh(eyeG, eyeM);
    e.position.set(sd * 0.11, 0.02, 0);
    e.scale.z = 0.5;
    face.add(e);
    const b = new THREE.Mesh(blushG, blushM);
    b.position.set(sd * 0.19, -0.04, 0.005);
    b.scale.y = 0.6;
    face.add(b);
  });
  scene.add(face);
}

/* ---------------- HUD (2D와 동일) ---------------- */

function updateHud() {
  const h = height();
  renderTurn();
  Bgm.setLevel(h); // 돌탑 높이에 따라 배경음악 단계(1~3층 / 4~6층 / 7층~)
  el.skHeight.textContent = h;
  el.skBest.textContent = Math.max(tower.best, 0);
  let lv = 'Lv.' + (1 + Math.floor(h / 3));
  if (h >= TREMOR_FROM) lv += ' · 🫨 손떨림';
  el.skLevel.textContent = lv;
  let w;
  if (!wind) w = '🍃 바람 없음';
  else {
    const a = Math.abs(wind);
    w = (wind < 0 ? '← ' : '') + '💨 ' + (a < 50 ? '약한' : a < 95 ? '보통' : '강한') + ' 바람' + (wind > 0 ? ' →' : '');
  }
  el.skWind.textContent = w;
  const pct = Math.max(0, Math.min(1, minMargin)) * 100;
  el.skStab.style.width = pct + '%';
  el.skStab.className = pct > 50 ? 'ok' : pct > 22 ? 'warn' : 'danger';
}

/* ---------------- 친구와 번갈아 쌓기 ---------------- */

function renderTurn() {
  const t = el.turn;
  if (!coop || state === 'result' || state === 'collapse' || state === 'miss') { t.hidden = true; return; }
  const mine = myTurn();
  t.hidden = false;
  t.classList.toggle('mine', mine);
  t.textContent = mine ? '🙋 내 차례예요!' : '🤝 ' + coop.name + '님 차례예요';
}

// 지금 내가 움직이는 돌을 상대에게 알려요
function sendMover() {
  if (!coop || coop.remote || !mover || (state !== 'hover' && state !== 'falling')) return;
  coop.send({
    k: 'mv', r: coop.round, n: height(), t: mover.type.id, s: mover.seed, w: wind,
    p: phase, A: amplitude(), f: state === 'falling' ? 1 : 0, x: state === 'falling' ? coop.dropX : mover.x
  });
}

// 돌이 착지하는 순간: 내 돌이면 자리를 보내고, 상대 돌이면 받았다고 알려요
function landed() {
  const n = height();
  coop.doneN = n;
  if (coop.remote) {
    coop.send({ k: 'ak', r: coop.round, n: n });
  } else {
    coop.ld = { k: 'ld', r: coop.round, n: n, t: mover.type.id, s: mover.seed, x: mover.x };
    coop.send(Object.assign({}, coop.ld));
  }
  coop.remote = false;
  coop.pend = null;
}

function finite(v, lo, hi) { return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi; }

// 상대 돌을 화면에 꺼내요
function remoteMover(m) {
  if (mover) return;
  mover = { type: typeOf(m.t), x: 0, yb: topY() - HOVER_GAP, vy: 0, seed: m.s };
  mover.mesh = moverMesh();
  markTray(m.t);
  coop.remote = true;
  coop.A = 165;
  wind = 0;
  state = 'hover';
}

function coopRecv(m) {
  if (!coop) return;
  if (!finite(m.r, 0, 9999)) return;
  // 주인이 다시 도전하면 친구 화면도 새 판으로
  if (!coop.host && m.r > coop.round) { coop.round = m.r; reset(); }
  if (m.k === 'ak') {
    if (coop.ld && m.r === coop.ld.r && m.n === coop.ld.n) coop.ld = null;
    return;
  }
  if (m.k === 'hb') {
    if (!coop.host && m.r === coop.round && m.fin && state !== 'result' && finite(m.h, 0, 999)) {
      coop.finH = m.h;
      showResult('finish');
    }
    return;
  }
  if (m.k !== 'mv' && m.k !== 'ld') return;
  if (!finite(m.n, 0, 9999) || !finite(m.s, 0, 1e7) || !finite(m.x, -900, 900) ||
    !STONES.TYPES.some(function (t) { return t.id === m.t; })) return;
  // 이미 처리한(또는 지난 판·끝난 판의) 착지 신호는 받았다고만 다시 알려요
  if (m.k === 'ld' && (m.r < coop.round || (m.r === coop.round && (m.n <= coop.doneN || state === 'result')))) {
    coop.send({ k: 'ak', r: m.r, n: m.n });
    return;
  }
  if (m.r !== coop.round || m.n !== height() || myTurn()) return;
  if (state !== 'wait' && !(coop.remote && (state === 'hover' || state === 'falling'))) return;
  const first = !mover;
  remoteMover(m);
  if (m.k === 'mv') {
    if (finite(m.w, -200, 200)) wind = m.w;
    if (finite(m.A, 20, 200)) coop.A = m.A;
    if (state === 'hover' && finite(m.p, 0, 1e6)) {
      const err = m.p - phase;
      phase = first || Math.abs(err) > 1 ? m.p : phase + err * 0.5;
    }
    if (m.f && state === 'hover') { mover.x = m.x; mover.vy = 0; state = 'falling'; }
  } else {
    coop.pend = { x: m.x };
    if (state === 'hover') { mover.vy = 400; state = 'falling'; }
  }
  if (first) updateHud();
}

// 상대가 나갔거나 연결이 끊겼을 때
function coopLost(why, name) {
  if (!coop) return;
  const wasHost = coop.host, remote = coop.remote;
  const text = why === 'left' ? name + '님이 나갔어요.' : name + '님과 연결이 끊겼어요.';
  if (!wasHost) {
    toast('👋 ' + text + ' 도와줘서 고마워요!');
    coop.leave = function () {};   // 이미 끝난 연결이라 알릴 필요가 없어요
    if (running) close();
    return;
  }
  coop = null;
  toast('👋 ' + text + ' 이어서 혼자 쌓을 수 있어요');
  if (!running) return;
  if (state === 'wait' || remote) {
    if (mover) { disposeMesh(mover.mesh); mover = null; }
    nextTurn();
  }
  coopButtons();
  resize();
  updateHud();
}

// 주인/친구에 따라 버튼 바꾸기
function coopButtons() {
  const guest = !!coop && !coop.host;
  $('skFinish').hidden = guest;
  $('skExit').textContent = guest ? '← 그만 돕기' : '← 캠퍼스로';
  el.rsRetry.hidden = guest;
}

// 다시 도전 (함께 쌓을 땐 주인만, 친구 화면도 같이 새 판이 돼요)
function retry() {
  if (coop) {
    if (!coop.host) return;
    coop.round++;
  }
  reset();
}

function buildTray() {
  el.tray.innerHTML = '';
  STONES.TYPES.forEach(function (t, i) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tray-btn';
    b.dataset.id = t.id;
    b.title = t.name + ' — ' + t.tip;
    b.setAttribute('aria-label', t.name + ': ' + t.tip);
    b.appendChild(STONES.icon(t, 54));
    const name = document.createElement('span');
    name.className = 'tray-name';
    name.textContent = t.name;
    b.appendChild(name);
    b.tabIndex = -1;
    b.setAttribute('aria-disabled', 'true');
    el.tray.appendChild(b);
  });
}

// 지금 떨어뜨릴 돌을 트레이에 표시만 해요
function markTray(id) {
  if (!el || !el.tray) return;
  Array.prototype.forEach.call(el.tray.children, function (b) {
    b.classList.toggle('on', b.dataset.id === id);
  });
}

/* ---------------- 루프·크기 ---------------- */

function loop(t) {
  if (!running) return;
  const dt = Math.min(0.033, (t - lastT) / 1000 || 0);
  lastT = t;
  update(dt);
  draw();
  rafId = requestAnimationFrame(loop);
}

function resize() {
  if (!renderer) return;
  vw = window.innerWidth; vh = window.innerHeight;
  renderer.setSize(vw, vh);
  bottomPad = ((decorating ? el.decor : el.bottom).offsetHeight || 150) + 10;
  topPad = (el.scene.querySelector('.stack-hud').offsetHeight || 60) + 30 + (coop ? 70 : 0);   // 함께 쌓을 땐 차례 배너 자리만큼 더
  camera.aspect = vw / vh;
  // HUD와 돌 트레이 사이 빈 공간의 가운데에 탑이 오게 화면 중심을 옮겨요
  camera.setViewOffset(vw, vh, 0, Math.round((bottomPad - topPad) / 2), vw, vh);
  camera.updateProjectionMatrix();
}

function clearScene() {
  stack.forEach(function (s) { disposeMesh(s.mesh); });
  debris.forEach(function (d) { disposeMesh(d.mesh); });
  dust.forEach(function (p) { scene.remove(p.sprite); p.sprite.material.dispose(); });
  leaves.forEach(function (l) { scene.remove(l.mesh); });
  popups.forEach(function (p) { p.el.remove(); });
  if (mover) disposeMesh(mover.mesh);
  stack = []; debris = []; dust = []; leaves = []; popups = []; mover = null;
}

function endDecor() {
  // 새 판·캠퍼스로 나갈 때: 꾸미기 바를 닫고 자연석톤으로 되돌려요(저장하지 않음)
  decorating = false;
  el.decor.hidden = true;
  el.scene.classList.remove('decorating');
  tone = 'natural';
  applyTone('natural');
}

function reset() {
  endDecor();
  clearScene();
  const base = { type: BASE, x: 0, yb: 0, seed: 0, mesh: stoneMesh(BASE, 0) };
  base.mesh.rotation.y = 0.05;
  stackGroup.add(base.mesh);
  place(base.mesh, 0, -BASE.h / 2);
  stack = [base];
  wind = 0; minMargin = 1; phase = 0; recorded = false;
  reached15 = tower.best >= DATA.GAUGE_MAX;
  if (coop) { coop.remote = false; coop.pend = null; coop.ld = null; coop.doneN = -1; coop.finH = null; }
  nextTurn();
  view.y = -topY() * K + HOVER_GAP * K * 0.15;
  el.result.hidden = true;
  // 안내는 5초 뒤에 저절로 사라져요 (돌을 떨어뜨려도 그대로)
  clearTimeout(tipTimer);
  el.tip.classList.toggle('hide', !!coop && !coop.host);   // 친구는 자기 차례가 아니라서 안 보여요
  tipTimer = setTimeout(function () { el.tip.classList.add('hide'); }, TIP_MS);
  updateHud();
}

function close() {
  // 쌓던 중에 나가면 지금 높이를 조용히 기록
  let info = { height: 0, isRecord: false };
  const guest = !!coop && !coop.host;
  if (guest) info = { height: 0, isRecord: false, helped: coop.name };
  else if (!recorded && (state === 'hover' || state === 'falling' || state === 'wait') && height() > 0) {
    const r = Store.recordHeight(tower.id, height());
    info = { height: height(), isRecord: r.isRecord };
    recorded = true;
  }
  const co = coop;
  coop = null;
  if (co) co.leave();
  running = false;
  cancelAnimationFrame(rafId);
  Bgm.play('campus'); // 캠퍼스로 돌아가면 돌탑 음악 → 캠퍼스 음악 (자연스럽게 교차)
  endDecor();
  clearScene();
  el.scene.hidden = true;
  document.body.classList.remove('stacking');
  if (onClose) onClose(info);
}

function onKey(e) {
  if (!running) return;
  const tg = e.target;
  if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) return;
  if (decorating) {
    // 꾸미기 중: 1~3 테마 고르기, Esc 꾸미기 완료 (Enter/Space는 누른 버튼에 맡김)
    if (/^(Digit|Numpad)[1-3]$/.test(e.code)) applyTone(['natural', 'pastel', 'rainbow'][parseInt(e.code.slice(-1), 10) - 1]);
    else if (e.code === 'Escape') closeDecor();
    return;
  }
  if (state === 'result') {
    if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); retry(); }
    else if (e.code === 'Escape') close();
    return;
  }
  if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (!e.repeat) drop(); }
  else if (e.code === 'Escape') close();
}

function init() {
  el = {
    scene: $('stackScene'), canvas: $('stackCanvas'), tray: $('skTray'), bottom: $('skBottom'),
    skHeight: $('skHeight'), skBest: $('skBest'), skLevel: $('skLevel'), skWind: $('skWind'), skStab: $('skStab'),
    wish: $('skWish'), tip: $('skTip'), result: $('skResult'), turn: $('skTurn'),
    rsEmoji: $('rsEmoji'), rsTitle: $('rsTitle'), rsHeight: $('rsHeight'), rsBest: $('rsBest'), rsRecord: $('rsRecord'),
    rsGaugeFill: $('rsGaugeFill'), rsGaugeLabel: $('rsGaugeLabel'), rsNote: $('rsNote'), rsRetry: $('rsRetry'), rsExit: $('rsExit'),
    rsDecorate: $('rsDecorate'), decor: $('skDecor'), tones: $('skTones')
  };
  const mobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 700;
  renderer = new THREE.WebGLRenderer({ canvas: el.canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  buildScene();

  // 떠오르는 글자를 그릴 층 (캔버스 바로 위, HUD 아래)
  popLayer = document.createElement('div');
  popLayer.className = 'sk3d-layer';
  el.canvas.after(popLayer);
  starTag = document.createElement('div');
  starTag.className = 'sk3d-star';
  starTag.textContent = '🌟';
  starTag.style.display = 'none';
  popLayer.appendChild(starTag);

  buildTray();
  markTray(selected);

  el.canvas.addEventListener('pointerdown', function (e) { e.preventDefault(); drop(); });
  $('skFinish').addEventListener('click', finish);
  $('skExit').addEventListener('click', close);
  el.rsRetry.addEventListener('click', retry);
  el.rsExit.addEventListener('click', close);
  el.rsDecorate.addEventListener('click', openDecor);
  $('skDecorDone').addEventListener('click', closeDecor);
  el.tones.addEventListener('click', function (e) {
    const b = e.target.closest('.tone-btn');
    if (b) applyTone(b.dataset.tone);
  });
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', function () { if (running) resize(); });
  // 배경음악 ON/OFF 버튼(#skBgm)·M 키·첫 클릭 재생은 bgm.js에서 두 화면 공통으로 처리해요.
}

/* ---------------- 공개 API (2D의 window.Stack과 동일) ---------------- */

const Stack = {
  is3D: true,
  /**
   * 돌 쌓기 시작
   * @param t  쌓을 돌탑(Store의 tower 객체)
   * @param cb 끝나고 캠퍼스로 돌아갈 때 호출 (info: {height, isRecord})
   */
  start: function (t, cb, net) {
    if (!el) init();
    coop = net ? { host: !!net.host, name: net.partner, send: net.send, leave: net.leave, round: 0, remote: false, A: 165, pend: null, doneN: -1, ld: null, finH: null } : null;
    coopButtons();
    tower = t;
    onClose = cb;
    const cat = DATA.category(t.cat);
    el.wish.textContent = cat.emoji + ' ' + t.wish;
    el.scene.hidden = false;
    document.body.classList.add('stacking');
    resize();
    reset();
    view.dist = Math.max(5, view.dist);
    running = true;
    lastT = performance.now();
    rafId = requestAnimationFrame(loop);
    Bgm.play('stack'); // 캠퍼스 음악 → 돌탑 음악 (버튼 클릭으로 열리므로 자동재생 제한 없음, OFF면 재생 안 함)
  },
  isActive: function () { return running; },
  /* ---- 친구와 번갈아 쌓기 (coop.js에서 호출) ----
   *  start(t, cb, { host, partner, send, leave }) 로 시작해요 */
  canCoop: true,
  coopRecv: function (m) { if (running) coopRecv(m); },
  coopLost: coopLost,
  // 0.4초마다: 움직이는 돌 알리기 · 확인 못 받은 착지 다시 보내기
  coopTick: function () {
    if (!coop || !running) return;
    if (coop.ld) coop.send(Object.assign({}, coop.ld));
    sendMover();
  },
  // 살아 있다는 신호에 붙일 내용
  coopBeat: function () {
    if (!coop) return null;
    const fin = coop.host && state === 'result' && endReason === 'finish';
    return { r: coop.round, fin: fin ? 1 : 0, h: fin ? height() : 0 };
  },
  // 지금 쌓아 올린 층수 (쌓는 중이 아니면 -1) — 다른 사람 화면에 보여 줄 때 써요
  progress: function () { return running ? Math.max(0, height()) : -1; },
  // 테스트용(읽기 전용): 배경음악 상태
  bgm: function () { return Bgm.debug(); },
  // 테스트·디버그용(읽기 전용) 상태 확인
  debug: function () {
    return {
      state: state, x: mover ? mover.x : null, height: height(), margin: minMargin, wind: wind, debris: debris.length,
      tone: tone, decorating: decorating,
      coop: coop ? { host: coop.host, turn: myTurn(), remote: coop.remote, round: coop.round, wait: !!coop.ld } : null,
      stack: stack.map(function (s) { return s.type.id + '@' + s.x; }),
      colors: stack.map(function (s) { return '#' + s.mesh.material.color.getHexString(); })
    };
  }
};

window.Stack = Stack;
export default Stack;
