/* =========================================================
 * js3d/campus3d.js — 3D 캠퍼스 화면 (Three.js)
 *  2D 버전(js/campus.js)과 "똑같은 공개 API"를 가진 window.Campus를 만들어요.
 *  그래서 main.js·store.js·stack.js(돌 쌓기)는 고치지 않고 그대로 동작해요.
 *
 *  조작
 *   - 탭/클릭: 그곳으로 걷기 · 꾹 눌러 끌기: 손가락 따라가기
 *   - WASD/방향키: 이동(카메라 기준) · Q/E: 시점 회전
 *   - 오른쪽 버튼 드래그 / 두 손가락: 시점 회전·확대
 *   - 휠 / ＋－ 버튼: 확대·축소
 * ========================================================= */
import * as THREE from 'three';
import * as L from './logic.js';
import { buildWorld } from './world.js';
import { makeTower, makeCharacter } from './actors.js';

const DATA = window.DATA;
const Store = window.Store;

const SPEED = 140;          // 플레이어 속도(px/초) = 14m/s (게임용으로 빠르게)
const NPC_SPEED = 55;
const DIST_MIN = 9, DIST_MAX = 120;
const PITCH_MIN = 0.32, PITCH_MAX = 1.35;

let renderer = null, scene, camera, world, canvas, labelLayer;
let opts = {};
let running = false, rafId = 0, lastT = 0, time = 0, firstFrame = true;
let trees = [];
let mobile = false;

const cam = { yaw: 0, yawT: 0, pitch: 0.92, dist: 36, x: 0, z: 0, free: false, fx: 0, fy: 0 };
const player = { x: DATA.START.x, y: DATA.START.y, tx: null, ty: null, name: '나', color: DATA.COLORS[0], walk: 0, moving: false, heading: Math.PI };
const npcs = [];
const keys = {};
const towers = new Map();   // id → { data, sig, obj, label }
let towerList = [];
let highlightId = null;
let lastLoc = '';
let buildRing = null, tapMark = null, buildCheckT = 0;

const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), ndc = new THREE.Vector2();

/* ---------------- 이름표(HTML) ---------------- */

const labels = [];
function addLabel(cls, text, getPos) {
  const el = document.createElement('div');
  el.className = 'lb3 ' + cls;
  el.textContent = text;
  labelLayer.appendChild(el);
  const lb = { el: el, getPos: getPos, maxDist: cls === 'place' ? 200 : 75, shown: true };
  labels.push(lb);
  return lb;
}
function removeLabel(lb) {
  const i = labels.indexOf(lb);
  if (i >= 0) labels.splice(i, 1);
  lb.el.remove();
}
function updateLabels() {
  const w = window.innerWidth, h = window.innerHeight;
  labels.forEach(function (lb) {
    lb.getPos(tmpV);
    const d = tmpV.distanceTo(camera.position);
    tmpV.project(camera);
    const vis = tmpV.z < 1 && tmpV.z > -1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1 && d < lb.maxDist * (cam.dist / 36 + 0.4);
    if (vis !== lb.shown) { lb.el.style.display = vis ? '' : 'none'; lb.shown = vis; }
    if (vis) {
      const x = (tmpV.x + 1) / 2 * w, y = (1 - tmpV.y) / 2 * h;
      lb.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-100%)';
      lb.el.style.zIndex = String(1000 - Math.round(d));
    }
  });
}

/* ---------------- 이동 ---------------- */

function moveChar(c, dx, dy) {
  const nx = c.x + dx, ny = c.y + dy;
  if (!L.blocked(nx, ny)) { c.x = nx; c.y = ny; return true; }
  if (dx && !L.blocked(nx, c.y)) { c.x = nx; return true; }
  if (dy && !L.blocked(c.x, ny)) { c.y = ny; return true; }
  return false;
}

function face(c, dx, dy) {
  if (Math.abs(dx) + Math.abs(dy) > 0.01) {
    const target = Math.atan2(dx, dy);
    let diff = target - c.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    c.heading += diff * 0.25;
  }
}

function stepChar(c, dt, speed) {
  if (c.tx == null) { c.moving = false; return; }
  const dx = c.tx - c.x, dy = c.ty - c.y;
  const d = Math.hypot(dx, dy);
  if (d < 4) { c.tx = c.ty = null; c.moving = false; return; }
  const s = Math.min(d, speed * dt);
  const ok = moveChar(c, dx / d * s, dy / d * s);
  face(c, dx, dy);
  c.moving = ok;
  if (ok) c.walk += dt;
  else { c.stuck = (c.stuck || 0) + dt; if (c.stuck > 0.3) { c.tx = c.ty = null; c.stuck = 0; } }
}

const npcRand = L.seeded(99);
function updateNpcs(dt) {
  npcs.forEach(function (n) {
    if (n.tx == null) {
      n.wait -= dt;
      if (n.wait <= 0) {
        const p = L.randomWalkable(npcRand);
        n.tx = n.x + (p.x - n.x) * 0.35;
        n.ty = n.y + (p.y - n.y) * 0.35;
        n.wait = 1.5 + npcRand() * 4;
      }
    }
    stepChar(n, dt, NPC_SPEED);
    placeChar(n);
  });
}

function placeChar(c) {
  const p = L.toV3(c.x, c.y);
  c.mesh.root.position.set(p.x, 0, p.z);
  c.mesh.root.rotation.y = c.heading;
  c.mesh.animate(c.walk, c.moving);
}

/* ---------------- 매 프레임 ---------------- */

function update(dt) {
  time += dt;

  // 키보드: 카메라가 보는 방향 기준으로 이동
  let f = 0, r = 0;
  if (keys.ArrowUp || keys.KeyW) f += 1;
  if (keys.ArrowDown || keys.KeyS) f -= 1;
  if (keys.ArrowRight || keys.KeyD) r += 1;
  if (keys.ArrowLeft || keys.KeyA) r -= 1;
  if (keys.KeyQ) cam.yawT += 1.8 * dt;
  if (keys.KeyE) cam.yawT -= 1.8 * dt;
  if (f || r) {
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
    let dx = -f * sy + r * cy, dy = -f * cy - r * sy;
    const l = Math.hypot(dx, dy);
    dx /= l; dy /= l;
    player.tx = player.ty = null;
    const ok = moveChar(player, dx * SPEED * dt, dy * SPEED * dt);
    player.moving = ok;
    if (ok) player.walk += dt;
    face(player, dx, dy);
  } else {
    stepChar(player, dt, SPEED);
  }
  if (player.moving) cam.free = false;
  placeChar(player);
  updateNpcs(dt);

  // 카메라
  cam.yaw += (cam.yawT - cam.yaw) * (1 - Math.pow(0.001, dt));
  const target = L.toV3(cam.free ? cam.fx : player.x, cam.free ? cam.fy : player.y);
  const k = 1 - Math.pow(0.003, dt);
  cam.x += (target.x - cam.x) * k;
  cam.z += (target.z - cam.z) * k;
  if (firstFrame) { cam.x = target.x; cam.z = target.z; cam.yaw = cam.yawT; }
  const hd = cam.dist * Math.cos(cam.pitch);
  camera.position.set(cam.x + Math.sin(cam.yaw) * hd, 1.2 + cam.dist * Math.sin(cam.pitch), cam.z + Math.cos(cam.yaw) * hd);
  camera.lookAt(cam.x, 1.2, cam.z);

  // 플레이어를 가리는 건물은 반투명하게
  fadeOccluders(dt);

  // 돌탑들
  towers.forEach(function (tw, id) { tw.obj.update(time, id === highlightId); });

  // 돌탑 가능 여부 링 (아직 내 돌탑이 없을 때만)
  buildCheckT -= dt;
  if (buildCheckT <= 0) {
    buildCheckT = 0.2;
    const show = !!Store.getProfile() && !Store.myTower();
    buildRing.visible = show;
    if (show) {
      const ok = Campus.canBuildHere().ok;
      buildRing.material.color.set(ok ? 0x4fd17a : 0xff7a6b);
    }
  }
  if (buildRing.visible) {
    const p = L.toV3(player.x, player.y);
    buildRing.position.set(p.x, 0.08, p.z);
    buildRing.material.opacity = 0.55 + Math.sin(time * 4) * 0.2;
  }
  if (tapMark.userData.life > 0) {
    tapMark.userData.life -= dt * 1.4;
    tapMark.visible = tapMark.userData.life > 0;
    const s = 0.6 + (1 - tapMark.userData.life) * 0.8;
    tapMark.scale.set(s, 1, s);
    tapMark.material.opacity = Math.max(0, tapMark.userData.life);
  }

  world.update(time, camera, { x: cam.x, z: cam.z }, cam.dist * 1.3);

  const loc = L.locationName(player.x, player.y);
  if (loc !== lastLoc) { lastLoc = loc; if (opts.onLocation) opts.onLocation(loc); }
}

function fadeOccluders(dt) {
  const head = L.toV3(player.x, player.y);
  tmpV.set(head.x, 1.4, head.z);
  tmpV2.copy(tmpV).sub(camera.position);
  const len = tmpV2.length();
  raycaster.set(camera.position, tmpV2.normalize());
  raycaster.far = len;
  const hits = raycaster.intersectObjects(world.buildings.map(function (b) { return b.mesh; }), false);
  raycaster.far = Infinity;
  world.buildings.forEach(function (b) {
    const target = hits.some(function (h) { return h.object === b.mesh; }) ? 0.28 : 1;
    if (Math.abs(b.opacity - target) < 0.001) return;
    b.opacity += (target - b.opacity) * Math.min(1, dt * 8);
    if (Math.abs(b.opacity - target) < 0.01) b.opacity = target;
    const faded = b.opacity < 0.999;
    b.mats.forEach(function (m) {
      m.transparent = faded || !!m.userData.wasTransparent;
      m.opacity = b.opacity;
      m.depthWrite = !faded;
    });
  });
}

function loop(t) {
  if (!running) return;
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
  lastT = t;
  update(dt);
  renderer.render(scene, camera);
  updateLabels();
  if (firstFrame) {
    firstFrame = false;
    document.body.classList.add('ready3d');
  }
  rafId = requestAnimationFrame(loop);
}

/* ---------------- 입력 ---------------- */

function setRay(clientX, clientY) {
  ndc.set(clientX / window.innerWidth * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}

function groundAt(clientX, clientY) {
  setRay(clientX, clientY);
  if (!raycaster.ray.intersectPlane(groundPlane, tmpV)) return null;
  return L.fromV3(tmpV.x, tmpV.z);
}

function towerAtScreen(clientX, clientY) {
  setRay(clientX, clientY);
  const hits = raycaster.intersectObjects(Array.from(towers.values()).map(function (t) { return t.obj.hit; }), false);
  return hits.length ? hits[0].object.userData.towerId : null;
}

function setTarget(p) {
  player.tx = Math.max(30, Math.min(L.W - 30, p.x));
  player.ty = Math.max(50, Math.min(L.H - 20, p.y));
  player.stuck = 0;
}

const pointers = new Map();
let gesture = null;

function pinchInfo() {
  const ps = Array.from(pointers.values());
  return { d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), mx: (ps[0].x + ps[1].x) / 2, my: (ps[0].y + ps[1].y) / 2 };
}

function onDown(e) {
  if (!running) return;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    const rotate = e.button === 2 || e.button === 1 || e.shiftKey;
    gesture = { type: rotate ? 'rotate' : 'tap', id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY };
  } else if (pointers.size === 2) {
    player.tx = player.ty = null;
    const pi = pinchInfo();
    gesture = { type: 'pinch', d: pi.d, mx: pi.mx, my: pi.my };
  }
}

function onMove(e) {
  const p = pointers.get(e.pointerId);
  if (!p || !gesture) return;
  p.x = e.clientX; p.y = e.clientY;
  if (gesture.type === 'tap' && Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > 10) gesture.type = 'drag';
  if (gesture.type === 'drag' && e.pointerId === gesture.id) {
    const g = groundAt(e.clientX, e.clientY);
    if (g) setTarget(g);
  } else if (gesture.type === 'rotate' && e.pointerId === gesture.id) {
    cam.yawT += (e.clientX - gesture.lx) * 0.006;
    cam.yaw = cam.yawT;
    cam.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, cam.pitch + (e.clientY - gesture.ly) * 0.004));
    gesture.lx = e.clientX; gesture.ly = e.clientY;
  } else if (gesture.type === 'pinch' && pointers.size >= 2) {
    const pi = pinchInfo();
    if (pi.d > 10) Campus.zoomBy(pi.d / gesture.d);
    cam.yawT += (pi.mx - gesture.mx) * 0.006;
    cam.yaw = cam.yawT;
    cam.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, cam.pitch + (pi.my - gesture.my) * 0.004));
    gesture.d = pi.d; gesture.mx = pi.mx; gesture.my = pi.my;
  }
}

function onUp(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (!gesture) return;
  if (gesture.type === 'tap' && e.pointerId === gesture.id) {
    const id = towerAtScreen(e.clientX, e.clientY);
    if (id) {
      if (opts.onTowerTap) opts.onTowerTap(id);
    } else {
      const g = groundAt(e.clientX, e.clientY);
      if (g) {
        setTarget(g);
        const p = L.toV3(player.tx, player.ty);
        tapMark.position.set(p.x, 0.09, p.z);
        tapMark.userData.life = 1;
        tapMark.visible = true;
      }
    }
  } else if (gesture.type === 'drag' && e.pointerId === gesture.id) {
    player.tx = player.ty = null;
  }
  if (pointers.size === 0) gesture = null;
  else if (gesture.type === 'pinch') gesture = { type: 'none' };
}

function isTyping(e) {
  const tg = e.target;
  return tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable);
}

const MOVE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'];
function onKey(e, down) {
  if (!running || isTyping(e)) return;
  if (MOVE_KEYS.indexOf(e.code) >= 0) {
    if (opts.blockKeys && opts.blockKeys()) { keys[e.code] = false; return; }
    keys[e.code] = down;
    if (e.code.indexOf('Arrow') === 0) e.preventDefault();
  }
}

function resize() {
  if (!renderer) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = w < h ? 58 : 45;   // 세로 화면은 시야를 넓게
  camera.updateProjectionMatrix();
}

/* ---------------- 돌탑 동기화 ---------------- */

function towerSig(t) {
  return [t.best, t.x, t.y, t.cat, t.color, t.name, Store.isMine(t.id)].join('|');
}
function labelText(t) {
  const mine = Store.isMine(t.id);
  return (mine ? '⭐ ' : '') + DATA.category(t.cat).emoji + ' ' + t.name + ' · ' + t.best + '층';
}

function syncTowers(list) {
  const seen = {};
  list.forEach(function (t) {
    seen[t.id] = true;
    const sig = towerSig(t);
    let tw = towers.get(t.id);
    if (tw && tw.sig === sig) { tw.data = t; return; }
    if (tw) { scene.remove(tw.obj.group); tw.obj.dispose(); removeLabel(tw.label); }
    const obj = makeTower(t);
    scene.add(obj.group);
    const label = addLabel(Store.isMine(t.id) ? 'tower mine' : 'tower', labelText(t), function (v) {
      v.set(obj.group.position.x, Math.max(obj.topY + 0.5, 3.1), obj.group.position.z); // 캐릭터 이름표보다 위
    });
    towers.set(t.id, { data: t, sig: sig, obj: obj, label: label });
  });
  towers.forEach(function (tw, id) {
    if (!seen[id]) { scene.remove(tw.obj.group); tw.obj.dispose(); removeLabel(tw.label); towers.delete(id); }
  });
}

/* ---------------- 준비 / 공개 API ---------------- */

// WebGL 사용 가능 여부 확인 + 렌더러 생성 (실패하면 예외 → 2D로 대체)
export function prepare(cv) {
  canvas = cv;
  const test = document.createElement('canvas');
  if (!test.getContext('webgl2')) throw new Error('WebGL2를 지원하지 않는 브라우저예요');
  mobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 700;
  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !mobile || window.devicePixelRatio < 2, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  window.Campus = Campus;
}

const Campus = {
  is3D: true,

  init: function (cv, o) {
    if (!renderer) prepare(cv);
    opts = o || {};
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.5, 4000);
    cam.dist = mobile ? 44 : 36;

    labelLayer = document.createElement('div');
    labelLayer.id = 'labels3d';
    document.body.appendChild(labelLayer);

    trees = L.buildTrees();
    world = buildWorld(scene, { trees: trees, mobile: mobile });

    // 건물 이름표
    world.buildings.forEach(function (b) {
      addLabel('place', b.place.icon + ' ' + b.place.name, function (v) { v.set(b.center.x, b.height + 5, b.center.z); });
    });
    const plazaC = L.toV3(L.PLAZA.x, L.PLAZA.y);
    addLabel('place plaza', '🪨 ' + L.PLAZA.name, function (v) { v.set(plazaC.x, 4, plazaC.z); });

    // 플레이어·NPC
    player.mesh = makeCharacter(player.color);
    scene.add(player.mesh.root);
    player.label = addLabel('me', player.name, function (v) {
      const p = L.toV3(player.x, player.y); v.set(p.x, 2.2, p.z);
    });
    const r = L.seeded(5);
    DATA.NPCS.forEach(function (n) {
      const p = L.randomWalkable(r);
      const npc = { name: n.name, color: n.color, x: p.x, y: p.y, tx: null, ty: null, walk: 0, moving: false, heading: r() * 6, wait: r() * 3 };
      npc.mesh = makeCharacter(n.color);
      scene.add(npc.mesh.root);
      addLabel('npc', n.name, function (v) { const q = L.toV3(npc.x, npc.y); v.set(q.x, 2.1, q.z); });
      npcs.push(npc);
    });

    // 돌탑 가능 여부 링 · 탭 표시
    buildRing = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.3, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x4fd17a, transparent: true, opacity: 0.7, depthWrite: false }));
    buildRing.visible = false;
    scene.add(buildRing);
    tapMark = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    tapMark.visible = false;
    tapMark.userData.life = 0;
    scene.add(tapMark);

    resize();
    window.addEventListener('resize', resize);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', function (e) { pointers.delete(e.pointerId); if (!pointers.size) gesture = null; });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      Campus.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });
    window.addEventListener('keydown', function (e) { onKey(e, true); });
    window.addEventListener('keyup', function (e) { onKey(e, false); });
    window.addEventListener('blur', function () { Object.keys(keys).forEach(function (k) { keys[k] = false; }); });

    // 3D 전용 버튼(있으면 연결)
    const rl = document.getElementById('rotLeft'), rr = document.getElementById('rotRight');
    if (rl) rl.addEventListener('click', function () { cam.yawT += Math.PI / 4; });
    if (rr) rr.addEventListener('click', function () { cam.yawT -= Math.PI / 4; });

    syncTowers(Store.towers());
    Campus.resume();
  },

  setTowers: function (list) {
    towerList = list.slice();
    if (scene) syncTowers(towerList);
  },

  setPlayer: function (name, color) {
    player.name = name || '나';
    player.color = color || DATA.COLORS[0];
    if (player.mesh) player.mesh.setColor(player.color);
    if (player.label) player.label.el.textContent = player.name;
  },

  getPlayer: function () { return { x: player.x, y: player.y }; },

  zoomBy: function (f) {
    cam.dist = Math.max(DIST_MIN, Math.min(DIST_MAX, cam.dist / f));
  },

  focus: function (x, y) {
    cam.free = true;
    cam.fx = x; cam.fy = y;
  },

  highlight: function (id) { highlightId = id; },

  canBuildHere: function (ignoreId) {
    const list = towerList.length ? towerList : Store.towers();
    return L.canBuild(player.x, player.y, list, trees, ignoreId);
  },

  pause: function () {
    running = false;
    cancelAnimationFrame(rafId);
    Object.keys(keys).forEach(function (k) { keys[k] = false; });
    pointers.clear();
    gesture = null;
    if (labelLayer) labelLayer.hidden = true;
  },

  resume: function () {
    if (running) return;
    running = true;
    if (labelLayer) labelLayer.hidden = false;
    lastT = performance.now();
    resize();
    rafId = requestAnimationFrame(loop);
  },

  // 테스트·디버그용
  debug: function () {
    return { x: player.x, y: player.y, loc: lastLoc, yaw: cam.yaw, dist: cam.dist, towers: towers.size, calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
  }
};

export default Campus;
