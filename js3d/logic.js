/* =========================================================
 * js3d/logic.js — 3D 캠퍼스의 "규칙" 부분 (그리기와 무관)
 *  - 2D 버전(js/campus.js)과 똑같은 픽셀 좌표·판정을 사용해요.
 *    그래서 2D/3D 어느 쪽에서 세운 돌탑이든 같은 자리에 보여요.
 *  - 3D 화면에서는 1px = 0.1m 로 바꿔서 그립니다.
 * ========================================================= */

const DATA = window.DATA;

export const W = DATA.WORLD.w;
export const H = DATA.WORLD.h;
export const S = 0.1; // 1px → 0.1m (캠퍼스 약 240m × 170m)

// 게임 좌표(px) ↔ 3D 좌표(m). 2D의 y(아래쪽이 +)는 3D의 z(남쪽이 +)
export function toV3(x, y) { return { x: (x - W / 2) * S, z: (y - H / 2) * S }; }
export function fromV3(x, z) { return { x: x / S + W / 2, y: z / S + H / 2 }; }

// 3D 버전에 새로 생긴 "소원 돌탑 마당" (중앙도서관 남쪽 잔디밭)
export const PLAZA = { name: '소원 돌탑 마당', x: 1465, y: 1400, r: 120 };

export function inPlaza(px, py) {
  return Math.hypot(px - PLAZA.x, py - PLAZA.y) < PLAZA.r;
}

/* ---------------- 지형 판정 (2D와 동일) ---------------- */

export function distToSeg(px, py, r) {
  const dx = r.x2 - r.x1, dy = r.y2 - r.y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - r.x1) * dx + (py - r.y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (r.x1 + t * dx), py - (r.y1 + t * dy));
}

export function distToRect(px, py, p) {
  const dx = Math.max(p.x - px, 0, px - (p.x + p.w));
  const dy = Math.max(p.y - py, 0, py - (p.y + p.h));
  return Math.hypot(dx, dy);
}

export function inPond(px, py, p, pad) {
  const rx = p.w / 2 + pad, ry = p.h / 2 + pad;
  const nx = (px - (p.x + p.w / 2)) / rx, ny = (py - (p.y + p.h / 2)) / ry;
  return nx * nx + ny * ny < 1;
}

export function onRoad(px, py, pad) {
  return DATA.ROADS.some(function (r) { return distToSeg(px, py, r) < r.w / 2 + (pad || 0); });
}

// 걸어갈 수 없는 곳인가?
export function blocked(px, py) {
  if (px < 24 || py < 40 || px > W - 24 || py > H - 16) return true;
  for (let i = 0; i < DATA.PLACES.length; i++) {
    const p = DATA.PLACES[i];
    if (p.type === 'building') {
      if (px > p.x - 12 && px < p.x + p.w + 12 && py > p.y - 6 && py < p.y + p.h + 14) return true;
    } else if (p.type === 'pond') {
      if (inPond(px, py, p, 6)) return true;
    } else if (p.type === 'gate') {
      if (Math.abs(py - (p.y + p.h - 10)) < 14 && (Math.abs(px - p.x) < 20 || Math.abs(px - (p.x + p.w)) < 20)) return true;
    }
  }
  return false;
}

// 시드 기반 난수 (2D와 같은 공식 → 같은 나무 배치)
export function seeded(seed) {
  let s = seed;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// 나무 배치: 2D와 같은 알고리즘·시드로 만든 뒤, 돌탑 마당 안의 나무만 뺍니다.
export function buildTrees() {
  const r = seeded(7);
  const trees = [];
  let tries = 0;
  while (trees.length < 150 && tries < 4000) {
    tries++;
    const x = 40 + r() * (W - 80), y = 70 + r() * (H - 100);
    if (onRoad(x, y, 30) || blocked(x, y)) continue;
    if (DATA.PLACES.some(function (p) {
      return (p.type === 'field' && distToRect(x, y, p) < 20) || (p.type !== 'pond' && distToRect(x, y, p) < 40);
    })) continue;
    if (DATA.DEMO_TOWERS.some(function (t) { return Math.hypot(t.x - x, t.y - y) < 80; })) continue;
    if (Math.hypot(x - DATA.START.x, y - DATA.START.y) < 140) continue;
    if (trees.some(function (t) { return Math.hypot(t.x - x, t.y - y) < 46; })) continue;
    trees.push({ x: x, y: y, s: 0.8 + r() * 0.5, kind: r() < 0.25 ? 'pine' : (r() < 0.25 ? 'blossom' : 'round') });
  }
  return trees.filter(function (t) { return Math.hypot(t.x - PLAZA.x, t.y - PLAZA.y) > PLAZA.r + 25; });
}

export function randomWalkable(r) {
  for (let i = 0; i < 50; i++) {
    const x = 60 + r() * (W - 120), y = 80 + r() * (H - 140);
    if (!blocked(x, y)) return { x: x, y: y };
  }
  return { x: DATA.START.x, y: DATA.START.y };
}

/* ---------------- 위치 이름 / 돌탑 가능 여부 ---------------- */

export function locationName(px, py) {
  if (inPlaza(px, py)) return PLAZA.name;
  let best = null, bd = 1e9;
  DATA.PLACES.forEach(function (p) {
    let d;
    if (p.type === 'pond') d = Math.max(0, Math.hypot((px - (p.x + p.w / 2)) / (p.w / 2), (py - (p.y + p.h / 2)) / (p.h / 2)) - 1) * p.w / 2;
    else d = distToRect(px, py, p);
    if (d < bd) { bd = d; best = p; }
  });
  if (!best) return '충북대학교 캠퍼스';
  if (best.type === 'field' && bd === 0) return best.name;
  if (best.type === 'gate' && bd < 180) return best.name;
  if (bd < 120) return best.name + ' 앞';
  if (onRoad(px, py)) return '캠퍼스 산책로';
  return '충북대학교 잔디밭';
}

// 2D의 Campus.canBuildHere와 같은 규칙
export function canBuild(x, y, towers, trees, ignoreId) {
  if (onRoad(x, y, 18)) return { ok: false, reason: '길 위에는 돌탑을 쌓을 수 없어요. 잔디밭으로 가 볼까요?' };
  for (let i = 0; i < DATA.PLACES.length; i++) {
    const p = DATA.PLACES[i];
    if (p.type === 'field' && distToRect(x, y, p) < 10) return { ok: false, reason: '운동장에서는 공놀이 중이에요 ⚽ 다른 곳을 찾아봐요.' };
    if (p.type === 'pond' && inPond(x, y, p, 40)) return { ok: false, reason: '연못과 너무 가까워요 🦆' };
    if ((p.type === 'building' || p.type === 'gate') && distToRect(x, y, p) < 34) return { ok: false, reason: p.name + '과(와) 너무 가까워요.' };
  }
  const near = towers.find(function (t) { return t.id !== ignoreId && Math.hypot(t.x - x, t.y - y) < 80; });
  if (near) return { ok: false, reason: '‘' + near.name + '’님의 돌탑과 너무 가까워요.' };
  if (trees.some(function (t) { return Math.hypot(t.x - x, t.y - y) < 40; })) return { ok: false, reason: '나무 아래는 좁아요 🌳 조금만 옮겨 볼까요?' };
  return { ok: true };
}
