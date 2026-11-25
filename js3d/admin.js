/* =========================================================
 * js3d/admin.js — 관리자 모드: 캠퍼스 배치 바꾸기 (건물·길·맵 크기·돌탑)
 *  - index3d.html?admin 으로 열면 왼쪽에 🛠 관리자 버튼이 생겨요.
 *  - 🏢 건물: 건물·연못·운동장을 끌어서 옮기고 크기·층수·색·이름 바꾸기, 추가·복제·삭제
 *  - 🛣 길: 길을 누르면 양 끝에 손잡이 → 손잡이 끌기 = 끝점 옮기기, 길 끌기 = 통째로 옮기기
 *  - 🗺 맵: 맵 가로·세로 크기 (동쪽·남쪽으로 늘어나요, 적용하면 새로고침)
 *  - 🪨 돌탑: 돌탑 찾기·지우기
 *  - 💾 저장: Supabase(campus_layout)가 있으면 모두에게, 없으면 이 브라우저에만
 *  - 📥 파일 받기: js/layout-data.js 파일 → 프로젝트에 덮어쓰고 커밋하면 모두에게
 *    (저장·불러오기는 js/layout.js)
 *
 *  조작: 끌기 = 옮기기 (10px = 1m 단위) · 빈 땅 끌기/WASD = 지도 이동 · 휠 = 확대·축소
 *        오른쪽 드래그/Q·E = 회전 · Delete = 지우기 · Esc = 선택 해제 · Ctrl+S = 저장
 * ========================================================= */
import * as THREE from 'three';
import * as L from './logic.js?v=2026112501';

const DATA = window.DATA;
const Store = window.Store;
const SNAP = 10;
const PALETTE = [
  ['#f4e3c3', '#c76b4f'], ['#e9eef5', '#5b7fb5'], ['#fbe7d6', '#e0884f'], ['#efe4f6', '#8e6bb8'],
  ['#e3ecef', '#4f8f97'], ['#e8f3e2', '#5f9e57'], ['#f3e6e6', '#b4645f'], ['#eef0e2', '#7d8f3f']
];
const TYPE_LABEL = { building: '건물', pond: '연못', field: '운동장' };
const REOPEN_KEY = 'cbnu-admin-reopen';

let ctx = null;
let on = false;
let tab = 'places';      // 'places' 건물 | 'roads' 길 | 'map' 맵 | 'towers' 돌탑
let sel = null;          // 고른 장소 (DATA.PLACES 안의 객체)
let selRoad = null;      // 고른 길 (DATA.ROADS 안의 객체)
let selTower = null;     // 고른 돌탑 id
let drag = null;
let backup = null;       // 마지막으로 저장한(또는 들어올 때의) 배치
let dirty = false;
let helper = null;
const helperBox = new THREE.Box3();
let roadMarks = null;    // 고른 길 표시: { line, a, b }
let guideLines = null;   // 건물 정렬 안내선 2개 (하늘색)
let rebuildTimer = 0;
const el = {};

const api = {
  active: function () { return on; },
  down: down, move: move, up: up
};

export function init(c) {
  ctx = c;
  const q = new URLSearchParams(location.search);
  if (!q.has('admin') && location.hash !== '#admin') return api;
  buildUI();
  window.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', function (e) {
    if (on && dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  // 맵 크기를 바꾸고 새로고침했으면 관리자 모드로 다시 들어와요
  let reopen = null;
  try { reopen = sessionStorage.getItem(REOPEN_KEY); sessionStorage.removeItem(REOPEN_KEY); } catch (e) { /* 무시 */ }
  if (reopen) setTimeout(function () { open(); setTab(reopen); }, 300);
  return api;
}

/* ---------------- 도우미 ---------------- */

function toast(msg) { if (window.App && App.toast) App.toast(msg); else console.log(msg); }
function snap(v) { return Math.round(v / SNAP) * SNAP; }
function copy(o) { return JSON.parse(JSON.stringify(o)); }
function editable(p) { return p && p.type !== 'gate'; }
function h(tag, attrs, html) {
  const e = document.createElement(tag);
  Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
  if (html != null) e.innerHTML = html;
  return e;
}
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
function clampX(x) { return Math.max(0, Math.min(L.W, x)); }
function clampY(y) { return Math.max(0, Math.min(L.H, y)); }
function focus(x, y) { ctx.cam.fx = clampX(x); ctx.cam.fy = clampY(y); }

function clampPlace(p) {
  const b = L.BOUND;
  p.w = Math.max(40, Math.min(L.W - 60, p.w));
  p.h = Math.max(30, Math.min(L.H - 60, p.h));
  p.x = Math.max(b.x1 + 10, Math.min(b.x2 - 10 - p.w, p.x));
  p.y = Math.max(b.y1 + 10, Math.min(b.y2 - 30 - p.h, p.y));
}

function rectsOverlap(a, b, pad) {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

// 길이 장소 위를 지나가나? (길을 따라 점을 찍어서 확인)
function roadThrough(p) {
  return DATA.ROADS.some(function (r) {
    const n = Math.max(1, Math.ceil(Math.hypot(r.x2 - r.x1, r.y2 - r.y1) / 20));
    for (let i = 0; i <= n; i++) {
      const x = r.x1 + (r.x2 - r.x1) * i / n, y = r.y1 + (r.y2 - r.y1) * i / n;
      if (L.distToRect(x, y, p) < r.w / 2) return true;
    }
    return false;
  });
}

function warnings(p) {
  if (!p) return [];
  const out = [];
  DATA.PLACES.forEach(function (o) {
    if (o !== p && rectsOverlap(p, o, p.type === 'building' && o.type === 'building' ? 20 : 0)) out.push(o.name + '과(와) 겹쳐요');
  });
  if (p.type !== 'field' && roadThrough(p)) out.push('길을 막고 있어요');
  const tw = ctx.towers().filter(function (t) { return L.distToRect(t.x, t.y, p) < 20; });
  if (tw.length) out.push('돌탑 ' + tw.length + '개가 안에 묻혀요 (' + tw.slice(0, 3).map(function (t) { return t.name; }).join(', ') + ')');
  if (L.distToRect(DATA.START.x, DATA.START.y, p) < 30) out.push('출발 위치를 막고 있어요');
  return out;
}

// 건물·연못·길 위 나무는 숨겨요 (돌탑 가능 여부 판정에서도 빠져요)
function refreshTrees() {
  ctx.trees.forEach(function (t) {
    t.hidden = L.onRoad(t.x, t.y, 12) || DATA.PLACES.some(function (p) {
      if (p.type === 'pond') return L.inPond(t.x, t.y, p, 30);
      if (p.type === 'field') return L.distToRect(t.x, t.y, p) < 20;
      if (p.type === 'building') return L.distToRect(t.x, t.y, p) < 30;
      return false;
    });
  });
  ctx.world.setTreeHidden(function (t) { return t.hidden; });
}

function snapshot() { return { places: copy(DATA.PLACES), roads: copy(DATA.ROADS), start: copy(DATA.START) }; }

// keepInputs: 패널에 입력하는 중이면 입력칸은 다시 만들지 않아요 (커서가 빠지지 않게)
function changed(keepInputs) {
  dirty = true;
  refreshTrees();
  ctx.syncLabels();
  renderHead();
  if (tab === 'places') {
    renderList();
    if (keepInputs && sel) { fillPos(); renderWarns(); } else renderSel();
  } else if (tab === 'roads') {
    renderRoads(keepInputs);
  }
  updateHelper();
  updateRoadMarks();
}

/* ---------------- 선택 표시 ---------------- */

function updateHelper() {
  const e = sel && ctx.world.placeObject(sel);
  if (!e) { if (helper) helper.visible = false; return; }
  if (!helper) {
    helper = new THREE.Box3Helper(helperBox, 0xffc83d);
    helper.material.depthTest = false;
    helper.renderOrder = 10;
    ctx.scene.add(helper);
  }
  helperBox.setFromObject(e.group);
  helperBox.max.y = Math.max(helperBox.max.y, 1.5);
  helper.material.color.set(warnings(sel).length ? 0xff5a4f : 0xffc83d);
  helper.visible = on;
}

function updateRoadMarks() {
  if (!roadMarks) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc83d, depthTest: false, transparent: true, opacity: 0.95 });
    const geo = new THREE.CylinderGeometry(1.3, 1.3, 0.5, 20);
    roadMarks = {
      a: new THREE.Mesh(geo, mat), b: new THREE.Mesh(geo, mat),
      line: new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: 0xffc83d, depthTest: false }))
    };
    roadMarks.a.userData.handle = 'a';
    roadMarks.b.userData.handle = 'b';
    [roadMarks.a, roadMarks.b, roadMarks.line].forEach(function (m) { m.renderOrder = 11; ctx.scene.add(m); });
  }
  const show = on && !!selRoad && DATA.ROADS.indexOf(selRoad) >= 0;
  [roadMarks.a, roadMarks.b, roadMarks.line].forEach(function (m) { m.visible = show; });
  if (!show) return;
  const a = L.toV3(selRoad.x1, selRoad.y1), b = L.toV3(selRoad.x2, selRoad.y2);
  roadMarks.a.position.set(a.x, 0.4, a.z);
  roadMarks.b.position.set(b.x, 0.4, b.z);
  const pos = roadMarks.line.geometry.attributes.position;
  pos.setXYZ(0, a.x, 0.3, a.z);
  pos.setXYZ(1, b.x, 0.3, b.z);
  pos.needsUpdate = true;
  roadMarks.line.geometry.computeBoundingSphere();
}

function clearSelection() {
  sel = null; selRoad = null;
  if (selTower) { selTower = null; ctx.highlight(null); }
  updateHelper();
  updateRoadMarks();
}

function select(p) {
  clearSelection();
  sel = editable(p) ? p : null;
  if (sel) setTab('places');
  renderList();
  renderSel();
  updateHelper();
}

function selectRoad(r) {
  clearSelection();
  selRoad = r;
  setTab('roads');
  updateRoadMarks();
}

function selectTower(id) {
  clearSelection();
  selTower = id;
  ctx.highlight(id);
  setTab('towers');
}

/* ---------------- 포인터 (campus3d.js에서 불러요) ---------------- */

function hitPlace() {
  const objs = [];
  DATA.PLACES.forEach(function (p) {
    if (!editable(p)) return;
    const o = ctx.world.placeObject(p);
    if (o) objs.push(o.group);
  });
  const hits = ctx.raycaster.intersectObjects(objs, true);
  for (let i = 0; i < hits.length; i++) {
    let o = hits[i].object;
    while (o && !(o.userData && o.userData.place)) o = o.parent;
    if (o) return o.userData.place;
  }
  return null;
}

function hitRoad() {
  const hits = ctx.raycaster.intersectObjects(ctx.world.roadGroup.children, false);
  return hits.length ? hits[0].object.userData.road : null;
}

function hitHandle() {
  if (!selRoad || !roadMarks || !roadMarks.a.visible) return null;
  const hits = ctx.raycaster.intersectObjects([roadMarks.a, roadMarks.b], false);
  return hits.length ? hits[0].object.userData.handle : null;
}

function down(e) {
  const g = ctx.groundAt(e.clientX, e.clientY);
  ctx.setRay(e.clientX, e.clientY);
  const handle = hitHandle();
  if (handle && g) { drag = { mode: 'end', end: handle, moved: false }; return; }

  const tid = ctx.towerAt(e.clientX, e.clientY);
  if (tid) { selectTower(tid); drag = null; return; }

  ctx.setRay(e.clientX, e.clientY);
  const p = hitPlace();
  if (p && g) {
    select(p);
    drag = { mode: 'move', p: p, ox: p.x - g.x, oy: p.y - g.y, moved: false };
    return;
  }
  const r = hitRoad();
  if (r && g) {
    selectRoad(r);
    drag = { mode: 'road', r: r, gx: snap(g.x), gy: snap(g.y), orig: copy(r), moved: false };
    return;
  }
  drag = { mode: 'pan', lx: e.clientX, ly: e.clientY, sx: e.clientX, sy: e.clientY };
}

function move(e) {
  if (!drag) return;
  if (drag.mode === 'pan') {
    // 같은 카메라로 이전·지금 화면 위치를 땅에 비춰서 그 차이만큼 지도를 옮겨요
    const a = ctx.groundAt(drag.lx, drag.ly), b = ctx.groundAt(e.clientX, e.clientY);
    drag.lx = e.clientX; drag.ly = e.clientY;
    if (a && b) focus(ctx.cam.fx + a.x - b.x, ctx.cam.fy + a.y - b.y);
    return;
  }
  const g = ctx.groundAt(e.clientX, e.clientY);
  if (!g) return;
  if (drag.mode === 'move') {
    const p = drag.p;
    const a = alignPlace(p, snap(g.x + drag.ox), snap(g.y + drag.oy));
    showGuides(a.guides);
    if (a.x === p.x && a.y === p.y) return;
    p.x = a.x; p.y = a.y;
    clampPlace(p);
    ctx.world.movePlace(p);
    drag.moved = true;
    updateHelper();
    fillPos();
  } else if (drag.mode === 'end') {
    const k = drag.end === 'a' ? ['x1', 'y1'] : ['x2', 'y2'];
    const other = drag.end === 'a' ? { x: selRoad.x2, y: selRoad.y2 } : { x: selRoad.x1, y: selRoad.y1 };
    const pt = alignEnd(selRoad, snap(clampX(g.x)), snap(clampY(g.y)), other);
    const x = pt.x, y = pt.y;
    if (selRoad[k[0]] === x && selRoad[k[1]] === y) return;
    selRoad[k[0]] = x; selRoad[k[1]] = y;
    drag.moved = true;
    ctx.world.rebuildRoads();
    updateRoadMarks();
    fillRoad();
  } else if (drag.mode === 'road') {
    const o = drag.orig, r = drag.r;
    let dx = snap(g.x) - drag.gx, dy = snap(g.y) - drag.gy;
    // 맵 밖으로 나가지 않게
    dx = Math.max(-Math.min(o.x1, o.x2), Math.min(L.W - Math.max(o.x1, o.x2), dx));
    dy = Math.max(-Math.min(o.y1, o.y2), Math.min(L.H - Math.max(o.y1, o.y2), dy));
    if (r.x1 === o.x1 + dx && r.y1 === o.y1 + dy) return;
    r.x1 = o.x1 + dx; r.x2 = o.x2 + dx; r.y1 = o.y1 + dy; r.y2 = o.y2 + dy;
    drag.moved = true;
    ctx.world.rebuildRoads();
    updateRoadMarks();
    fillRoad();
  }
}

function up(e, cancel) {
  if (!drag) return;
  if (drag.mode === 'move') showGuides([]);
  if (drag.mode === 'move' && drag.moved) {
    ctx.world.rebuildPlace(drag.p);   // 옮긴 자리에서 다시 지어요 (간판·연못 정자 위치 등 정리)
    changed(true);
  } else if ((drag.mode === 'end' || drag.mode === 'road') && drag.moved) {
    ctx.world.rebuildLamps();
    changed(true);
  } else if (drag.mode === 'pan' && !cancel && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) {
    // 빈 땅을 톡 → 선택 해제
    clearSelection();
    renderTab();
  }
  drag = null;
}

/* ---------------- 키보드 ---------------- */

function onKey(e) {
  if (!api.active()) return;
  const tg = e.target;
  const typing = tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable);
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); save(); return; }
  if (typing) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (sel) { e.preventDefault(); removeSel(); }
    else if (selRoad) { e.preventDefault(); removeRoad(); }
    else if (selTower) { e.preventDefault(); removeTower(); }
  } else if (e.key === 'Escape') {
    clearSelection();
    renderTab();
  }
}

/* ---------------- 건물 편집 ---------------- */

function addBuilding() {
  const c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  const p = {
    id: 'b' + Date.now().toString(36), name: '새 건물', type: 'building',
    x: snap(ctx.cam.fx - 110), y: snap(ctx.cam.fy - 65), w: 220, h: 130,
    wall: c[0], roof: c[1], icon: '🏫', floors: 4, glass: false
  };
  clampPlace(p);
  DATA.PLACES.push(p);
  ctx.world.addPlace(p);
  select(p);
  changed();
  el.name.focus();
  el.name.select();
}

function duplicateSel() {
  if (!sel) return;
  const p = copy(sel);
  p.id = (sel.type === 'building' ? 'b' : sel.type) + Date.now().toString(36);
  p.name = sel.name + ' 2';
  p.x += 40; p.y += 40;
  clampPlace(p);
  DATA.PLACES.push(p);
  ctx.world.addPlace(p);
  select(p);
  changed();
}

function removeSel() {
  if (!sel || !confirm('‘' + sel.name + '’을(를) 지울까요?')) return;
  ctx.world.removePlace(sel);
  DATA.PLACES.splice(DATA.PLACES.indexOf(sel), 1);
  sel = null;
  changed();
}

// 패널 입력 → 장소에 반영 (크기·색 등은 다시 지어야 해서 잠깐 모았다가)
function fromInputs() {
  if (!sel) return;
  const p = sel;
  const n = function (inp, d) { const v = Number(inp.value); return isFinite(v) && inp.value !== '' ? v : d; };
  p.name = el.name.value.trim().slice(0, 20) || p.name;
  p.x = snap(n(el.x, p.x)); p.y = snap(n(el.y, p.y));
  p.w = snap(n(el.w, p.w)); p.h = snap(n(el.h, p.h));
  if (p.type === 'building') {
    p.icon = el.icon.value.trim().slice(0, 4) || '🏫';
    p.floors = Math.max(1, Math.min(20, Math.round(n(el.floors, p.floors || 4))));
    p.wall = el.wall.value; p.roof = el.roof.value;
    p.glass = el.glass.checked;
  }
  clampPlace(p);
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(function () {
    if (DATA.PLACES.indexOf(p) < 0) return;
    ctx.world.rebuildPlace(p);
    changed(true);
  }, 180);
}

/* ---------------- 길 편집 ---------------- */

function addRoad() {
  const cx = snap(ctx.cam.fx), cy = snap(ctx.cam.fy);
  const r = { x1: snap(clampX(cx - 200)), y1: cy, x2: snap(clampX(cx + 200)), y2: cy, w: 44 };
  DATA.ROADS.push(r);
  ctx.world.rebuildRoads();
  ctx.world.rebuildLamps();
  selectRoad(r);
  changed();
}

function removeRoad() {
  if (!selRoad || !confirm('이 길을 지울까요?')) return;
  DATA.ROADS.splice(DATA.ROADS.indexOf(selRoad), 1);
  selRoad = null;
  ctx.world.rebuildRoads();
  ctx.world.rebuildLamps();
  changed();
}

function fromRoadInputs() {
  if (!selRoad) return;
  const r = selRoad;
  const n = function (inp, d) { const v = Number(inp.value); return isFinite(v) && inp.value !== '' ? v : d; };
  r.x1 = snap(clampX(n(el.rx1, r.x1))); r.y1 = snap(clampY(n(el.ry1, r.y1)));
  r.x2 = snap(clampX(n(el.rx2, r.x2))); r.y2 = snap(clampY(n(el.ry2, r.y2)));
  r.w = Math.max(16, Math.min(200, Math.round(n(el.rw, r.w))));
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(function () {
    ctx.world.rebuildRoads();
    ctx.world.rebuildLamps();
    changed(true);
  }, 150);
}

/* 건물 정렬 맞춤 (📐 체크가 켜져 있을 때)
 *  끌고 있는 건물의 왼쪽·가운데·오른쪽(위·가운데·아래) 선이 주변 건물의 선과 3m 안으로 가까우면 딱 맞춰요.
 *  가로(x)·세로(y)를 따로 맞추고, 맞춘 곳에 안내선을 그려요. */
const ALIGN = 30;
function placeAlignOn() { return !el.placeAlign || el.placeAlign.checked; }
function alignPlace(p, x, y) {
  const guides = [];
  if (!placeAlignOn()) return { x: x, y: y, guides: guides };
  let bx = null, by = null;
  DATA.PLACES.forEach(function (o) {
    if (o === p) return;
    // 내 선 [왼쪽, 가운데, 오른쪽] ↔ 상대 선 [왼쪽, 가운데, 오른쪽]
    const mine = [0, p.w / 2, p.w], theirsX = [o.x, o.x + o.w / 2, o.x + o.w];
    mine.forEach(function (m) {
      theirsX.forEach(function (t) {
        const d = Math.abs(x + m - t);
        if (d < ALIGN && (!bx || d < bx.d)) bx = { d: d, x: t - m, line: t, o: o };
      });
    });
    const mineY = [0, p.h / 2, p.h], theirsY = [o.y, o.y + o.h / 2, o.y + o.h];
    mineY.forEach(function (m) {
      theirsY.forEach(function (t) {
        const d = Math.abs(y + m - t);
        if (d < ALIGN && (!by || d < by.d)) by = { d: d, y: t - m, line: t, o: o };
      });
    });
  });
  if (bx) x = bx.x;
  if (by) y = by.y;
  // 안내선: 두 건물을 잇는 길이로
  if (bx) guides.push({ axis: 'x', at: bx.line, from: Math.min(y, bx.o.y) - 20, to: Math.max(y + p.h, bx.o.y + bx.o.h) + 20 });
  if (by) guides.push({ axis: 'y', at: by.line, from: Math.min(x, by.o.x) - 20, to: Math.max(x + p.w, by.o.x + by.o.w) + 20 });
  return { x: x, y: y, guides: guides };
}

function showGuides(list) {
  if (!guideLines) {
    const mat = new THREE.LineBasicMaterial({ color: 0x4fc3f7, depthTest: false });
    guideLines = [0, 1].map(function () {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), mat);
      l.renderOrder = 12;
      l.visible = false;
      ctx.scene.add(l);
      return l;
    });
  }
  guideLines.forEach(function (l, i) {
    const gd = list[i];
    l.visible = !!gd;
    if (!gd) return;
    const a = gd.axis === 'x' ? L.toV3(gd.at, gd.from) : L.toV3(gd.from, gd.at);
    const b = gd.axis === 'x' ? L.toV3(gd.at, gd.to) : L.toV3(gd.to, gd.at);
    const pos = l.geometry.attributes.position;
    pos.setXYZ(0, a.x, 0.35, a.z);
    pos.setXYZ(1, b.x, 0.35, b.z);
    pos.needsUpdate = true;
    l.geometry.computeBoundingSphere();
  });
}

/* 직각 맞춤 (📐 체크가 켜져 있을 때)
 *  1) 끝점을 다른 끝점과 가로 또는 세로 일직선으로 (더 많이 움직인 쪽을 살려요)
 *  2) 근처(4m 안) 다른 길의 중심선·끝점에 딱 붙여요 → 길끼리 T자·十자로 깔끔하게 이어져요 */
const JOIN = 40;
function alignOn() { return !el.roadAlign || el.roadAlign.checked; }
function alignEnd(road, x, y, other) {
  if (!alignOn()) return { x: x, y: y };
  const horiz = Math.abs(x - other.x) >= Math.abs(y - other.y);
  if (horiz) y = other.y; else x = other.x;
  let best = JOIN, bx = x, by = y;
  DATA.ROADS.forEach(function (r) {
    if (r === road) return;
    // 다른 길의 끝점
    [[r.x1, r.y1], [r.x2, r.y2]].forEach(function (q) {
      const d = horiz ? Math.abs(q[0] - x) + Math.abs(q[1] - y) * 3 : Math.abs(q[1] - y) + Math.abs(q[0] - x) * 3;
      if (d < best) { best = d; bx = horiz ? q[0] : x; by = horiz ? y : q[1]; }
    });
    // 가로로 가는 길 끝 → 세로 길의 중심선에 / 세로로 가는 길 끝 → 가로 길의 중심선에
    if (horiz && r.x1 === r.x2 && y >= Math.min(r.y1, r.y2) - r.w && y <= Math.max(r.y1, r.y2) + r.w) {
      const d = Math.abs(x - r.x1);
      if (d < best) { best = d; bx = r.x1; by = y; }
    }
    if (!horiz && r.y1 === r.y2 && x >= Math.min(r.x1, r.x2) - r.w && x <= Math.max(r.x1, r.x2) + r.w) {
      const d = Math.abs(y - r.y1);
      if (d < best) { best = d; bx = x; by = r.y1; }
    }
  });
  return { x: clampX(bx), y: clampY(by) };
}

// 고른 길을 가로 또는 세로로 쭉 펴요 (더 긴 방향으로, 가운데를 기준으로)
function straightenRoad() {
  const r = selRoad;
  if (!r) return;
  if (r.x1 === r.x2 || r.y1 === r.y2) { toast('이미 반듯한 길이에요 📐'); return; }
  if (Math.abs(r.x2 - r.x1) >= Math.abs(r.y2 - r.y1)) { const y = snap((r.y1 + r.y2) / 2); r.y1 = r.y2 = y; }
  else { const x = snap((r.x1 + r.x2) / 2); r.x1 = r.x2 = x; }
  ctx.world.rebuildRoads();
  ctx.world.rebuildLamps();
  changed();
  toast('📐 길을 반듯하게 폈어요');
}

function roadName(r, i) {
  const len = Math.round(Math.hypot(r.x2 - r.x1, r.y2 - r.y1) / 10);
  const dir = r.y1 === r.y2 ? '가로' : (r.x1 === r.x2 ? '세로' : '대각선');
  return '길 ' + (i + 1) + ' · ' + dir + ' ' + len + 'm · 폭 ' + (r.w / 10) + 'm';
}

/* ---------------- 맵 크기 ---------------- */

// 고른 쪽으로 늘리거나 줄여요.
//  - 위쪽·왼쪽: 모든 게(건물·길·정문·출발점) 그만큼 아래·오른쪽으로 밀려요.
//    돌탑은 서버 좌표를 못 바꿔서, 대신 맵 기준점(world.ox·oy)을 옮겨 같이 밀려 보이게 해요 (store.js setFrame).
//  - 아래쪽: 정문·출발점·남쪽 끝에 닿은 길이 남쪽 끝을 따라가요. · 오른쪽: 아무것도 안 밀려요.
function applySize() {
  const lim = window.Layout.LIMIT;
  const W2 = Math.max(lim.wMin, Math.min(lim.wMax, snap(Number(el.mapW.value) * 10)));
  const H2 = Math.max(lim.hMin, Math.min(lim.hMax, snap(Number(el.mapH.value) * 10)));
  if (!isFinite(W2) || !isFinite(H2)) return;
  if (W2 === L.W && H2 === L.H) { toast('지금과 같은 크기예요'); return; }
  const shared = window.Layout.mode() === 'shared';
  if (!confirm('맵을 ' + W2 / 10 + 'm × ' + H2 / 10 + 'm로 바꿀까요?\n지금 배치도 함께 ' + (shared ? '저장(모두에게 적용)' : '이 브라우저에 저장') + '되고, 페이지가 새로고침돼요.')) return;
  const dw = W2 - L.W, dh = H2 - L.H;
  const sx = el.mapDirX.value === 'left' ? dw : 0;   // 모두 오른쪽으로 밀 만큼
  const sy = el.mapDirY.value === 'up' ? dh : 0;     // 모두 아래로 밀 만큼
  const o = {
    world: { w: W2, h: H2, ox: (DATA.WORLD.ox || 0) + sx, oy: (DATA.WORLD.oy || 0) + sy },
    start: copy(DATA.START), places: copy(DATA.PLACES), roads: copy(DATA.ROADS)
  };
  const downGate = el.mapDirY.value === 'down' ? dh : 0;   // 아래쪽: 정문·출발점이 남쪽 끝을 따라가요
  o.start.x += sx; o.start.y += sy + downGate;
  o.places.forEach(function (p) {
    p.x += sx; p.y += sy;
    if (p.type === 'gate') p.y += downGate;
    p.w = Math.min(p.w, W2 - 80); p.h = Math.min(p.h, H2 - 80);
    p.x = Math.max(30, Math.min(W2 - 30 - p.w, p.x));
    p.y = Math.max(30, Math.min(H2 - 40 - p.h, p.y));
  });
  o.roads.forEach(function (r) {
    const b1 = r.y1 >= L.H - 1, b2 = r.y2 >= L.H - 1;   // 남쪽 끝(정문)에 닿은 길
    r.x1 += sx; r.x2 += sx; r.y1 += sy; r.y2 += sy;
    if (b1) r.y1 = H2;
    if (b2) r.y2 = H2;
    r.x1 = Math.max(0, Math.min(r.x1, W2)); r.x2 = Math.max(0, Math.min(r.x2, W2));
    r.y1 = Math.max(0, Math.min(r.y1, H2)); r.y2 = Math.max(0, Math.min(r.y2, H2));
  });
  o.start.x = Math.max(40, Math.min(o.start.x, W2 - 40));
  o.start.y = Math.max(40, Math.min(o.start.y, H2 - 40));
  window.Layout.save(o).then(function (r) {
    if (!r.ok) { toast('저장 실패: ' + r.error); return; }
    dirty = false;
    try { sessionStorage.setItem(REOPEN_KEY, 'map'); } catch (e) { /* 무시 */ }
    location.reload();
  });
}

/* ---------------- 돌탑 지우기 ---------------- */

function removeTower() {
  const t = selTower && Store.getTower(selTower);
  if (!t) return;
  const where = t.rid ? '모든 사람에게서 사라지고 되돌릴 수 없어요.' : (t.demo ? '예시 돌탑이라 이 브라우저에서만 사라져요.' : '이 브라우저에서만 사라져요.');
  if (!confirm('‘' + t.name + '’님의 돌탑(' + t.best + '층)을 지울까요?\n' + where)) return;
  if (el.towerDel) el.towerDel.disabled = true;
  Store.adminRemoveTower(t.id).then(function (r) {
    if (el.towerDel) el.towerDel.disabled = false;
    if (!r.ok) { toast('삭제 실패: ' + r.error); return; }
    toast('🗑 ‘' + t.name + '’님의 돌탑을 지웠어요');
    selTower = null;
    ctx.highlight(null);
    renderTowers();
  });
}

/* ---------------- 저장 · 파일 ---------------- */

function save() {
  el.save.disabled = true;
  window.Layout.save(window.Layout.current()).then(function (r) {
    el.save.disabled = false;
    if (!r.ok) { toast('저장 실패: ' + r.error); return; }
    backup = snapshot();
    dirty = false;
    renderHead();
    toast(r.shared ? '💾 저장했어요! 모든 사람에게 새 배치가 보여요' : '💾 이 브라우저에 저장했어요 (모두에게는 📥 파일 받기)');
  });
}

function downloadFile() {
  const text = window.Layout.fileText(window.Layout.current());
  const blob = new Blob([text], { type: 'text/javascript;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'layout-data.js';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  toast('📥 layout-data.js를 받았어요 → 프로젝트의 js/layout-data.js에 덮어쓰고 커밋하면 모두에게 보여요');
}

// 배치 통째로 바꾸기 (되돌리기·기본 배치) — 맵 크기는 그대로
function replaceAll(o) {
  clearSelection();
  DATA.PLACES.slice().forEach(function (p) { ctx.world.removePlace(p); });
  DATA.PLACES.length = 0;
  copy(o.places).forEach(function (p) { DATA.PLACES.push(p); ctx.world.addPlace(p); });
  DATA.ROADS.length = 0;
  copy(o.roads).forEach(function (r) { DATA.ROADS.push(r); });
  if (o.start) { DATA.START.x = o.start.x; DATA.START.y = o.start.y; }
  ctx.world.rebuildRoads();
  ctx.world.rebuildLamps();
}

function resetDefault() {
  const D = window.Layout.DEFAULT;
  if (D.world.w !== L.W || D.world.h !== L.H || (D.world.ox || 0) !== (DATA.WORLD.ox || 0) || (D.world.oy || 0) !== (DATA.WORLD.oy || 0)) {
    if (!confirm('처음 기본 배치(맵 ' + D.world.w / 10 + 'm × ' + D.world.h / 10 + 'm)로 바꿀까요?\n맵 크기가 달라서 바로 ' + (window.Layout.mode() === 'shared' ? '저장(모두에게 적용)' : '이 브라우저에 저장') + '되고 새로고침돼요.')) return;
    window.Layout.save(D).then(function (r) {
      if (!r.ok) { toast('저장 실패: ' + r.error); return; }
      dirty = false;
      try { sessionStorage.setItem(REOPEN_KEY, tab); } catch (e) { /* 무시 */ }
      location.reload();
    });
    return;
  }
  if (!confirm('처음 기본 배치(data.js)로 바꿀까요? (💾 저장해야 적용돼요)')) return;
  replaceAll(D);
  changed();
}

/* ---------------- 들어가기 / 나가기 ---------------- */

function open() {
  if (on) return;
  on = true;
  el.panel.hidden = false;
  el.fab.hidden = true;
  document.body.classList.add('admin-on');
  backup = snapshot();
  dirty = false;
  ctx.enter();
  refreshTrees();
  renderHead();
  setTab(tab);
}

function close() {
  if (dirty) {
    if (!confirm('저장하지 않은 변경이 있어요. 버리고 나갈까요?')) return;
    replaceAll(backup);
    refreshTrees();
    ctx.syncLabels();
    dirty = false;
  }
  on = false;
  drag = null;
  clearSelection();
  el.panel.hidden = true;
  el.fab.hidden = false;
  document.body.classList.remove('admin-on');
  ctx.exit();
}

/* ---------------- 패널 UI ---------------- */

function buildUI() {
  el.fab = h('button', { class: 'admin-fab', type: 'button', title: '관리자 모드: 캠퍼스 배치 바꾸기' }, '🛠 관리자');
  el.fab.addEventListener('click', open);

  el.panel = h('aside', { class: 'admin-panel', 'aria-label': '관리자 모드' });
  el.panel.hidden = true;
  el.panel.innerHTML =
    '<div class="ad-top"><b>🛠 관리자 모드</b><button type="button" class="ad-x" data-a="close" aria-label="나가기">✕</button></div>' +
    '<div class="ad-edit">' +
      '<div class="ad-mode"></div>' +
      '<div class="ad-tabs">' +
        '<button type="button" data-tab="places">🏢 건물</button><button type="button" data-tab="roads">🛣 길</button>' +
        '<button type="button" data-tab="map">🗺 맵</button><button type="button" data-tab="towers">🪨 돌탑</button>' +
      '</div>' +
      '<div class="ad-pane" data-pane="places">' +
        '<div class="ad-row"><button type="button" class="btn primary" data-a="add">＋ 건물 추가</button></div>' +
        '<label class="ad-check"><input type="checkbox" class="ad-palign" checked> 📐 정렬 맞춤 (끌 때 옆·위아래 건물과 줄 맞추기)</label>' +
        '<ul class="ad-list ad-plist"></ul>' +
        '<div class="ad-sel"></div>' +
        '<p class="ad-hint">끌기: 옮기기 · 빈 땅 끌기/WASD: 지도 이동 · 휠: 확대 · 오른쪽 드래그/Q·E: 회전 · Del: 삭제</p>' +
      '</div>' +
      '<div class="ad-pane" data-pane="roads" hidden>' +
        '<div class="ad-row"><button type="button" class="btn primary" data-a="addRoad">＋ 길 추가</button></div>' +
        '<ul class="ad-list ad-rlist"></ul>' +
        '<label class="ad-check"><input type="checkbox" class="ad-align" checked> 📐 직각 맞춤 (가로·세로로 반듯하게, 다른 길에 딱 붙이기)</label>' +
        '<div class="ad-rsel"></div>' +
        '<p class="ad-hint">길을 누르면 양 끝에 노란 손잡이가 생겨요 · 손잡이 끌기: 끝점 옮기기 · 길 끌기: 통째로 옮기기 · Del: 삭제 (좌표 10 = 1m)</p>' +
      '</div>' +
      '<div class="ad-pane" data-pane="map" hidden>' +
        '<p class="ad-now"></p>' +
        '<div class="ad-grid">' +
          '<label><span>가로 (m)</span><input data-k="mapW" type="number" step="10"></label>' +
          '<label><span>세로 (m)</span><input data-k="mapH" type="number" step="10"></label>' +
          '<label><span>가로 늘릴 쪽</span><select data-k="mapDirX"><option value="right">오른쪽 (동쪽)</option><option value="left">왼쪽 (서쪽)</option></select></label>' +
          '<label><span>세로 늘릴 쪽</span><select data-k="mapDirY"><option value="up">위쪽 (북쪽)</option><option value="down">아래쪽 (남쪽)</option></select></label>' +
        '</div>' +
        '<div class="ad-row"><button type="button" class="btn primary" data-a="applySize">적용 (새로고침)</button></div>' +
        '<p class="ad-hint">고른 쪽으로 늘어나거나(줄이면 그쪽이 잘려요) 해요. 건물·길·돌탑은 지금 자리를 그대로 지켜요. ' +
          '아래쪽으로 바꾸면 정문·출발점·정문 큰길이 남쪽 끝을 따라가요. 줄여서 밖으로 나간 건물은 안쪽으로 당겨져요.</p>' +
      '</div>' +
      '<div class="ad-pane" data-pane="towers" hidden>' +
        '<input type="search" class="ad-search" placeholder="닉네임·소원으로 찾기">' +
        '<small class="ad-tcount muted"></small>' +
        '<ul class="ad-list ad-tlist"></ul>' +
        '<div class="ad-tsel"></div>' +
        '<p class="ad-hint">캠퍼스에서 돌탑을 눌러도 골라져요 · Del: 삭제 · 지운 돌탑은 되돌릴 수 없어요</p>' +
      '</div>' +
      '<div class="ad-foot">' +
        '<button type="button" class="btn primary" data-a="save">💾 저장</button>' +
        '<button type="button" class="btn" data-a="file">📥 파일 받기</button>' +
        '<button type="button" class="btn" data-a="revert">↩ 되돌리기</button>' +
        '<button type="button" class="btn" data-a="default">기본 배치로</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(el.fab);
  document.body.appendChild(el.panel);

  const $ = function (s) { return el.panel.querySelector(s); };
  el.mode = $('.ad-mode'); el.save = $('[data-a="save"]'); el.foot = $('.ad-foot');
  el.list = $('.ad-plist'); el.sel = $('.ad-sel');
  el.placeAlign = $('.ad-palign');
  try { el.placeAlign.checked = localStorage.getItem('cbnu-admin-palign') !== '0'; } catch (e) { /* 무시 */ }
  el.placeAlign.addEventListener('change', function () {
    try { localStorage.setItem('cbnu-admin-palign', el.placeAlign.checked ? '1' : '0'); } catch (e) { /* 무시 */ }
  });
  el.roadList = $('.ad-rlist'); el.roadSel = $('.ad-rsel'); el.roadAlign = $('.ad-align');
  try { el.roadAlign.checked = localStorage.getItem('cbnu-admin-align') !== '0'; } catch (e) { /* 무시 */ }
  el.roadAlign.addEventListener('change', function () {
    try { localStorage.setItem('cbnu-admin-align', el.roadAlign.checked ? '1' : '0'); } catch (e) { /* 무시 */ }
  });
  el.mapNow = $('.ad-now'); el.mapW = $('[data-k="mapW"]'); el.mapH = $('[data-k="mapH"]');
  el.mapDirX = $('[data-k="mapDirX"]'); el.mapDirY = $('[data-k="mapDirY"]');
  el.towerSearch = $('.ad-search'); el.towerCount = $('.ad-tcount'); el.towerList = $('.ad-tlist'); el.towerSel = $('.ad-tsel');

  el.towerSearch.addEventListener('input', renderTowers);
  el.towerList.addEventListener('click', function (ev) {
    const li = ev.target.closest('[data-t]');
    const t = li && Store.getTower(li.dataset.t);
    if (!t) return;
    selectTower(t.id);
    focus(t.x, t.y);
  });
  el.list.addEventListener('click', function (ev) {
    const li = ev.target.closest('[data-i]');
    const p = li && DATA.PLACES[+li.dataset.i];
    if (!p) return;
    select(p);
    focus(p.x + p.w / 2, p.y + p.h / 2);
  });
  el.roadList.addEventListener('click', function (ev) {
    const li = ev.target.closest('[data-r]');
    const r = li && DATA.ROADS[+li.dataset.r];
    if (!r) return;
    selectRoad(r);
    focus((r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2);
  });
  // 서버에서 돌탑 목록이 바뀌면 목록도 새로
  if (Store.onChange) Store.onChange(function () { if (on && tab === 'towers') renderTowers(); });

  el.panel.addEventListener('click', function (ev) {
    const b = ev.target.closest('[data-a], [data-tab]');
    if (!b) return;
    if (b.dataset.tab) { setTab(b.dataset.tab); return; }
    const a = b.dataset.a;
    if (a === 'close') close();
    else if (a === 'save') save();
    else if (a === 'file') downloadFile();
    else if (a === 'default') resetDefault();
    else if (a === 'revert') {
      if (!dirty || !confirm('마지막으로 저장한 배치로 되돌릴까요?')) return;
      replaceAll(backup); changed(); dirty = false; renderHead();
    }
    else if (a === 'add') addBuilding();
    else if (a === 'dup') duplicateSel();
    else if (a === 'del') removeSel();
    else if (a === 'focus' && sel) focus(sel.x + sel.w / 2, sel.y + sel.h / 2);
    else if (a === 'addRoad') addRoad();
    else if (a === 'rdel') removeRoad();
    else if (a === 'rstraight') straightenRoad();
    else if (a === 'rfocus' && selRoad) focus((selRoad.x1 + selRoad.x2) / 2, (selRoad.y1 + selRoad.y2) / 2);
    else if (a === 'applySize') applySize();
    else if (a === 'tdel') removeTower();
    else if (a === 'tfocus') { const t = Store.getTower(selTower); if (t) focus(t.x, t.y); }
  });
  // 패널 위에서 휠은 캠퍼스로 안 넘어가게
  el.panel.addEventListener('wheel', function (ev) { ev.stopPropagation(); }, { passive: true });
}

function setTab(t) {
  tab = t;
  if (!el.panel) return;
  el.panel.querySelectorAll('[data-tab]').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); });
  el.panel.querySelectorAll('[data-pane]').forEach(function (p) { p.hidden = p.dataset.pane !== t; });
  el.foot.hidden = t === 'towers';
  renderTab();
}

function renderTab() {
  if (tab === 'places') { renderList(); renderSel(); }
  else if (tab === 'roads') renderRoads();
  else if (tab === 'map') renderMap();
  else if (tab === 'towers') renderTowers();
}

function renderHead() {
  const shared = window.Layout.mode() === 'shared';
  el.mode.className = 'ad-mode ' + (shared ? 'shared' : 'local');
  el.mode.textContent = (shared ? '🌐 저장하면 모두에게 보여요' : '💻 💾 저장은 이 브라우저 미리보기예요 · 모두에게는 📥 파일 받기 → js/layout-data.js 덮어쓰기') +
    (dirty ? ' · 저장 안 됨' : '');
}

/* ----- 건물 탭 ----- */

function renderList() {
  el.list.innerHTML = DATA.PLACES.map(function (p, i) {
    if (!editable(p)) return '';
    const icon = p.type === 'building' ? (p.icon || '🏫') : (p.type === 'pond' ? '💧' : '⚽');
    const warn = warnings(p).length ? ' <span class="ad-warn-dot" title="겹침 주의">⚠</span>' : '';
    return '<li data-i="' + i + '" class="' + (p === sel ? 'on' : '') + '">' + icon + ' ' + esc(p.name) + warn + '</li>';
  }).join('');
  const li = el.list.querySelector('.on');
  if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
}

function field(label, key, attrs) {
  return '<label><span>' + label + '</span><input data-k="' + key + '" ' + (attrs || '') + '></label>';
}

function renderSel() {
  if (!sel) { el.sel.innerHTML = '<p class="muted small">건물을 누르거나 목록에서 골라요</p>'; return; }
  const p = sel, b = p.type === 'building';
  el.sel.innerHTML =
    '<div class="ad-sel-head">' + TYPE_LABEL[p.type] + ' 편집</div>' +
    '<div class="ad-grid">' +
      field('이름', 'name', 'maxlength="20" class="wide"') +
      (b ? field('아이콘', 'icon', 'maxlength="4"') + field('층수', 'floors', 'type="number" min="1" max="20" step="1"') : '') +
      field('X', 'x', 'type="number" step="10"') + field('Y', 'y', 'type="number" step="10"') +
      field('가로', 'w', 'type="number" step="10" min="40"') + field('세로', 'h', 'type="number" step="10" min="30"') +
      (b ? field('벽 색', 'wall', 'type="color"') + field('지붕 색', 'roof', 'type="color"') +
        '<label class="chk"><input type="checkbox" data-k="glass"> 유리 외벽</label>' : '') +
    '</div>' +
    '<ul class="ad-warns"></ul>' +
    '<div class="ad-row">' +
      '<button type="button" class="btn" data-a="focus">🔍 보기</button>' +
      '<button type="button" class="btn" data-a="dup">⧉ 복제</button>' +
      '<button type="button" class="btn danger" data-a="del">🗑 삭제</button>' +
    '</div>';
  ['name', 'icon', 'floors', 'x', 'y', 'w', 'h', 'wall', 'roof', 'glass'].forEach(function (k) {
    el[k] = el.sel.querySelector('[data-k="' + k + '"]') || { value: '', checked: false };
  });
  el.name.value = p.name;
  if (b) { el.icon.value = p.icon || ''; el.floors.value = p.floors || 4; el.wall.value = p.wall; el.roof.value = p.roof; el.glass.checked = !!p.glass; }
  fillPos();
  el.sel.querySelectorAll('input').forEach(function (inp) {
    inp.addEventListener(inp.type === 'checkbox' || inp.type === 'color' ? 'change' : 'input', fromInputs);
  });
  renderWarns();
}

function fillPos() {
  if (!sel || !el.x || !el.sel.contains(el.x)) return;
  const act = document.activeElement;
  ['x', 'y', 'w', 'h'].forEach(function (k) { if (el[k] !== act) el[k].value = sel[k]; });
}

function renderWarns() {
  const ul = el.sel.querySelector('.ad-warns');
  if (ul) ul.innerHTML = warnings(sel).map(function (w) { return '<li>⚠ ' + esc(w) + '</li>'; }).join('');
}

/* ----- 길 탭 ----- */

function renderRoads(keepInputs) {
  el.roadList.innerHTML = DATA.ROADS.map(function (r, i) {
    return '<li data-r="' + i + '" class="' + (r === selRoad ? 'on' : '') + '">🛣 ' + roadName(r, i) + '</li>';
  }).join('') || '<li class="muted">길이 없어요</li>';
  const li = el.roadList.querySelector('.on');
  if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
  if (keepInputs && selRoad && el.rx1 && el.roadSel.contains(el.rx1)) { fillRoad(); return; }
  if (!selRoad || DATA.ROADS.indexOf(selRoad) < 0) {
    selRoad = null;
    el.roadSel.innerHTML = '<p class="muted small">길을 누르거나 목록에서 골라요</p>';
    return;
  }
  el.roadSel.innerHTML =
    '<div class="ad-sel-head">길 편집</div>' +
    '<div class="ad-grid">' +
      field('시작 X', 'rx1', 'type="number" step="10"') + field('시작 Y', 'ry1', 'type="number" step="10"') +
      field('끝 X', 'rx2', 'type="number" step="10"') + field('끝 Y', 'ry2', 'type="number" step="10"') +
      field('폭 (10 = 1m)', 'rw', 'type="number" step="2" min="16" max="200"') +
    '</div>' +
    '<div class="ad-row">' +
      '<button type="button" class="btn" data-a="rfocus">🔍 보기</button>' +
      '<button type="button" class="btn" data-a="rstraight">📐 반듯하게</button>' +
      '<button type="button" class="btn danger" data-a="rdel">🗑 삭제</button>' +
    '</div>';
  ['rx1', 'ry1', 'rx2', 'ry2', 'rw'].forEach(function (k) { el[k] = el.roadSel.querySelector('[data-k="' + k + '"]'); });
  fillRoad(true);
  el.roadSel.querySelectorAll('input').forEach(function (inp) { inp.addEventListener('input', fromRoadInputs); });
}

function fillRoad(all) {
  if (!selRoad || !el.rx1 || !el.roadSel.contains(el.rx1)) return;
  const act = document.activeElement, r = selRoad;
  [['rx1', r.x1], ['ry1', r.y1], ['rx2', r.x2], ['ry2', r.y2], ['rw', r.w]].forEach(function (kv) {
    if (all || el[kv[0]] !== act) el[kv[0]].value = kv[1];
  });
}

/* ----- 맵 탭 ----- */

function renderMap() {
  const lim = window.Layout.LIMIT;
  el.mapNow.innerHTML = '지금 맵: <b>' + L.W / 10 + 'm × ' + L.H / 10 + 'm</b> (가로 ' + lim.wMin / 10 + '~' + lim.wMax / 10 + 'm, 세로 ' + lim.hMin / 10 + '~' + lim.hMax / 10 + 'm)';
  el.mapW.value = L.W / 10; el.mapH.value = L.H / 10;
  el.mapW.min = lim.wMin / 10; el.mapW.max = lim.wMax / 10;
  el.mapH.min = lim.hMin / 10; el.mapH.max = lim.hMax / 10;
}

/* ----- 돌탑 탭 ----- */

function renderTowers() {
  const q = (el.towerSearch.value || '').trim();
  const all = Store.towers();
  const list = all.filter(function (t) {
    return !q || t.name.indexOf(q) >= 0 || String(t.wish || '').indexOf(q) >= 0;
  }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
  el.towerCount.textContent = '돌탑 ' + all.length + '개' + (q ? ' · 찾은 것 ' + list.length + '개' : '');
  el.towerList.innerHTML = list.map(function (t) {
    return '<li data-t="' + esc(t.id) + '" class="' + (t.id === selTower ? 'on' : '') + '">' +
      DATA.category(t.cat).emoji + ' ' + esc(t.name) + ' · ' + t.best + '층' +
      (t.demo ? ' <span class="ad-tag">예시</span>' : '') + (Store.isMine(t.id) ? ' <span class="ad-tag">내 돌탑</span>' : '') + '</li>';
  }).join('') || '<li class="muted">돌탑이 없어요</li>';
  const t = selTower && Store.getTower(selTower);
  if (!t) {
    if (selTower) { selTower = null; ctx.highlight(null); }
    el.towerSel.innerHTML = '<p class="muted small">돌탑을 누르거나 목록에서 골라요</p>';
    el.towerDel = null;
    return;
  }
  el.towerSel.innerHTML =
    '<div class="ad-sel-head">' + DATA.category(t.cat).emoji + ' ' + esc(t.name) + '</div>' +
    '<p class="ad-wish">“' + esc(t.wish || '') + '”</p>' +
    '<p class="muted small">' + t.best + '층 · ♥ ' + (t.likes || 0) + ' · ' + esc(L.locationName(t.x, t.y)) +
      ' · ' + (t.rid ? '서버에 저장됨' : (t.demo ? '예시 (이 브라우저만)' : '이 브라우저만')) + '</p>' +
    '<div class="ad-row">' +
      '<button type="button" class="btn" data-a="tfocus">🔍 보기</button>' +
      '<button type="button" class="btn danger" data-a="tdel">🗑 돌탑 삭제</button>' +
    '</div>';
  el.towerDel = el.towerSel.querySelector('[data-a="tdel"]');
  const li = el.towerList.querySelector('.on');
  if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
}
