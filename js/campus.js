/* =========================================================
 * campus.js — 캠퍼스 지도 화면
 *  - 2D 지도(잔디·길·연못·건물·나무) 그리기
 *  - 캐릭터 이동(탭/드래그/키보드), 카메라·확대 축소
 *  - 지도 위 돌탑 표시와 탭 감지
 * ========================================================= */
(function () {
  'use strict';

  const W = DATA.WORLD.w, H = DATA.WORLD.h;
  const SPEED = 230;            // 캐릭터 이동 속도(px/초)
  const ZOOM_MIN = 0.45, ZOOM_MAX = 1.8;

  let canvas, ctx, dpr = 1, vw = 0, vh = 0;
  let ground = null;            // 미리 그려 둔 바닥 레이어
  let trees = [];
  let towers = [];
  let opts = {};
  let running = false, lastT = 0, rafId = 0;

  const cam = { x: DATA.START.x, y: DATA.START.y - 120, zoom: 1, free: false, fx: 0, fy: 0 };
  const player = { x: DATA.START.x, y: DATA.START.y, tx: null, ty: null, name: '나', color: DATA.COLORS[0], walk: 0, moving: false, face: 1 };
  const npcs = [];
  const keys = {};
  const pointer = { id: null, sx: 0, sy: 0, drag: false };
  let tapMark = null;           // 탭한 위치 표시
  let highlightId = null;
  let lastLoc = '';

  /* ---------------- 지형 판정 ---------------- */

  function distToSeg(px, py, r) {
    const dx = r.x2 - r.x1, dy = r.y2 - r.y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - r.x1) * dx + (py - r.y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = r.x1 + t * dx, cy = r.y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  function distToRect(px, py, p) {
    const dx = Math.max(p.x - px, 0, px - (p.x + p.w));
    const dy = Math.max(p.y - py, 0, py - (p.y + p.h));
    return Math.hypot(dx, dy);
  }

  function inPond(px, py, p, pad) {
    const rx = p.w / 2 + pad, ry = p.h / 2 + pad;
    const nx = (px - (p.x + p.w / 2)) / rx, ny = (py - (p.y + p.h / 2)) / ry;
    return nx * nx + ny * ny < 1;
  }

  function onRoad(px, py, pad) {
    return DATA.ROADS.some(function (r) { return distToSeg(px, py, r) < r.w / 2 + (pad || 0); });
  }

  // 걸어갈 수 없는 곳인가?
  function blocked(px, py) {
    if (px < 24 || py < 40 || px > W - 24 || py > H - 16) return true;
    for (let i = 0; i < DATA.PLACES.length; i++) {
      const p = DATA.PLACES[i];
      if (p.type === 'building') {
        if (px > p.x - 12 && px < p.x + p.w + 12 && py > p.y - 6 && py < p.y + p.h + 14) return true;
      } else if (p.type === 'pond') {
        if (inPond(px, py, p, 6)) return true;
      } else if (p.type === 'gate') {
        // 정문 기둥
        if (Math.abs(py - (p.y + p.h - 10)) < 14 && (Math.abs(px - p.x) < 20 || Math.abs(px - (p.x + p.w)) < 20)) return true;
      }
    }
    return false;
  }

  /* ---------------- 바닥 레이어 미리 그리기 ---------------- */

  function seeded(seed) {
    let s = seed;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function buildGround() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');

    // 잔디
    g.fillStyle = '#bfe3a0';
    g.fillRect(0, 0, W, H);
    const r = seeded(42);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(150,205,120,0.55)' : 'rgba(215,240,190,0.6)';
      g.beginPath();
      g.ellipse(r() * W, r() * H, 10 + r() * 30, 6 + r() * 14, 0, 0, Math.PI * 2);
      g.fill();
    }
    // 잔디 풀잎
    g.strokeStyle = 'rgba(110,170,85,0.6)';
    g.lineWidth = 2;
    g.lineCap = 'round';
    for (let i = 0; i < 1400; i++) {
      const x = r() * W, y = r() * H;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 2, y - 6); g.moveTo(x + 3, y); g.lineTo(x + 4, y - 5); g.stroke();
    }

    // 운동장
    DATA.PLACES.forEach(function (p) {
      if (p.type !== 'field') return;
      g.fillStyle = '#d9a36d';
      g.beginPath(); STONES.roundRect(g, p.x, p.y, p.w, p.h, 90); g.fill();
      g.fillStyle = '#7fc46a';
      g.beginPath(); STONES.roundRect(g, p.x + 34, p.y + 34, p.w - 68, p.h - 68, 60); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 3;
      g.beginPath(); STONES.roundRect(g, p.x + 17, p.y + 17, p.w - 34, p.h - 34, 75); g.stroke();
      g.beginPath(); g.moveTo(p.x + p.w / 2, p.y + 34); g.lineTo(p.x + p.w / 2, p.y + p.h - 34); g.stroke();
      g.beginPath(); g.arc(p.x + p.w / 2, p.y + p.h / 2, 30, 0, Math.PI * 2); g.stroke();
    });

    // 길(테두리 → 안쪽 순서로)
    g.lineCap = 'round';
    DATA.ROADS.forEach(function (rd) {
      g.strokeStyle = '#d8c9a6';
      g.lineWidth = rd.w + 8;
      g.beginPath(); g.moveTo(rd.x1, rd.y1); g.lineTo(rd.x2, rd.y2); g.stroke();
    });
    DATA.ROADS.forEach(function (rd) {
      g.strokeStyle = '#f3e9d2';
      g.lineWidth = rd.w;
      g.beginPath(); g.moveTo(rd.x1, rd.y1); g.lineTo(rd.x2, rd.y2); g.stroke();
    });
    // 보도블록 무늬
    g.strokeStyle = 'rgba(200,180,140,0.35)';
    g.lineWidth = 2;
    DATA.ROADS.forEach(function (rd) {
      const len = Math.hypot(rd.x2 - rd.x1, rd.y2 - rd.y1);
      const ux = (rd.x2 - rd.x1) / len, uy = (rd.y2 - rd.y1) / len;
      for (let d = 20; d < len; d += 36) {
        const cx = rd.x1 + ux * d, cy = rd.y1 + uy * d;
        g.beginPath();
        g.moveTo(cx - uy * rd.w * 0.35, cy + ux * rd.w * 0.35);
        g.lineTo(cx + uy * rd.w * 0.35, cy - ux * rd.w * 0.35);
        g.stroke();
      }
    });

    // 연못
    DATA.PLACES.forEach(function (p) {
      if (p.type !== 'pond') return;
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      g.fillStyle = '#a9d6c2';
      g.beginPath(); g.ellipse(cx, cy, p.w / 2 + 12, p.h / 2 + 12, 0, 0, Math.PI * 2); g.fill();
      const wg = g.createRadialGradient(cx - 40, cy - 30, 10, cx, cy, p.w / 2);
      wg.addColorStop(0, '#9fdcf2');
      wg.addColorStop(1, '#5fb3d6');
      g.fillStyle = wg;
      g.beginPath(); g.ellipse(cx, cy, p.w / 2, p.h / 2, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = 3;
      [[-60, -20, 40], [40, 30, 30], [70, -40, 22]].forEach(function (a) {
        g.beginPath(); g.arc(cx + a[0], cy + a[1], a[2], Math.PI * 1.1, Math.PI * 1.6); g.stroke();
      });
      // 연잎
      g.fillStyle = '#6fbf73';
      [[-100, 30], [-80, 50], [90, -10], [20, 60]].forEach(function (a) {
        g.beginPath(); g.arc(cx + a[0], cy + a[1], 13, 0.3, Math.PI * 2 - 0.1); g.lineTo(cx + a[0], cy + a[1]); g.fill();
      });
      g.fillStyle = '#ff9fb8';
      g.beginPath(); g.arc(cx - 80, cy + 50, 5, 0, Math.PI * 2); g.fill();
    });

    // 꽃밭
    const colors = ['#ffffff', '#ffd6e0', '#fff3a6', '#d9c8ff'];
    for (let i = 0; i < 380; i++) {
      const x = r() * W, y = r() * H;
      if (onRoad(x, y, 8) || blocked(x, y)) continue;
      g.fillStyle = colors[(r() * colors.length) | 0];
      g.beginPath(); g.arc(x, y, 2.6, 0, Math.PI * 2); g.fill();
    }
    ground = c;
  }

  function buildTrees() {
    const r = seeded(7);
    trees = [];
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
  }

  /* ---------------- 그리기: 개체 ---------------- */

  function drawShadow(x, y, rx, ry) {
    ctx.fillStyle = 'rgba(40,60,30,0.18)';
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  }

  function drawTree(t) {
    const s = t.s;
    drawShadow(t.x, t.y, 22 * s, 8 * s);
    ctx.fillStyle = '#8b5e3c';
    ctx.fillRect(t.x - 4 * s, t.y - 20 * s, 8 * s, 20 * s);
    ctx.strokeStyle = '#4a3d33';
    ctx.lineWidth = 2;
    if (t.kind === 'pine') {
      ctx.fillStyle = '#4f9a5a';
      for (let i = 0; i < 3; i++) {
        const yy = t.y - 18 * s - i * 16 * s, ww = (26 - i * 6) * s;
        ctx.beginPath();
        ctx.moveTo(t.x - ww, yy); ctx.lineTo(t.x + ww, yy); ctx.lineTo(t.x, yy - 28 * s); ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
    } else {
      ctx.fillStyle = t.kind === 'blossom' ? '#ffc4d6' : '#6cbf68';
      ctx.beginPath();
      ctx.arc(t.x - 12 * s, t.y - 30 * s, 15 * s, 0, Math.PI * 2);
      ctx.arc(t.x + 12 * s, t.y - 30 * s, 15 * s, 0, Math.PI * 2);
      ctx.arc(t.x, t.y - 44 * s, 18 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath(); ctx.arc(t.x, t.y - 44 * s, 18 * s, Math.PI * 0.95, Math.PI * 2.05); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.arc(t.x - 6 * s, t.y - 50 * s, 6 * s, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawBuilding(p) {
    const wallTop = p.y + p.h * 0.34;
    drawShadow(p.x + p.w / 2, p.y + p.h + 4, p.w * 0.55, 14);
    // 벽
    ctx.fillStyle = p.wall;
    ctx.strokeStyle = '#4a3d33';
    ctx.lineWidth = 3;
    ctx.beginPath(); STONES.roundRect(ctx, p.x, wallTop, p.w, p.y + p.h - wallTop, 8); ctx.fill(); ctx.stroke();
    // 창문
    const rows = 2, cols = Math.max(3, Math.floor(p.w / 48));
    const ww = 20, wh = 16;
    const gapX = (p.w - cols * ww) / (cols + 1);
    const areaH = p.y + p.h - wallTop - 34;
    for (let rr = 0; rr < rows; rr++) {
      for (let cc = 0; cc < cols; cc++) {
        const x = p.x + gapX + cc * (ww + gapX);
        const y = wallTop + 10 + rr * (areaH / rows);
        if (rr === rows - 1 && Math.abs(x + ww / 2 - (p.x + p.w / 2)) < 26) continue;
        ctx.fillStyle = '#bfe4ff';
        ctx.fillRect(x, y, ww, wh);
        ctx.strokeStyle = '#4a3d33'; ctx.lineWidth = 2;
        ctx.strokeRect(x, y, ww, wh);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillRect(x + 3, y + 3, 5, 4);
      }
    }
    // 문
    ctx.fillStyle = '#9b6b45';
    ctx.beginPath(); STONES.roundRect(ctx, p.x + p.w / 2 - 15, p.y + p.h - 30, 30, 30, 6); ctx.fill();
    ctx.strokeStyle = '#4a3d33'; ctx.lineWidth = 2.5; ctx.stroke();
    // 지붕
    ctx.fillStyle = p.roof;
    ctx.lineWidth = 3;
    ctx.beginPath(); STONES.roundRect(ctx, p.x - 10, p.y, p.w + 20, p.h * 0.38, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); STONES.roundRect(ctx, p.x - 2, p.y + 6, p.w + 4, 8, 4); ctx.fill();
    // 아이콘
    ctx.font = '26px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.icon || '🏫', p.x + p.w / 2, p.y + p.h * 0.2);
  }

  function drawGate(p) {
    const y = p.y + p.h - 10;
    drawShadow(p.x + p.w / 2, y + 6, p.w * 0.6, 10);
    ctx.fillStyle = '#e8dccb';
    ctx.strokeStyle = '#4a3d33';
    ctx.lineWidth = 3;
    [p.x, p.x + p.w].forEach(function (x) {
      ctx.beginPath(); STONES.roundRect(ctx, x - 14, y - 90, 28, 96, 6); ctx.fill(); ctx.stroke();
    });
    ctx.fillStyle = '#4b6f9e';
    ctx.beginPath(); STONES.roundRect(ctx, p.x - 30, y - 120, p.w + 60, 40, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '20px Jua, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('충북대학교', p.x + p.w / 2, y - 99);
  }

  function drawCharacter(c, label, isMe) {
    const bob = c.moving ? Math.abs(Math.sin(c.walk * 10)) * 4 : Math.sin(performance.now() / 500) * 1;
    const x = c.x, y = c.y;
    drawShadow(x, y, 15, 6);
    // 발
    ctx.fillStyle = '#4a3d33';
    const step = c.moving ? Math.sin(c.walk * 10) * 4 : 0;
    ctx.beginPath(); ctx.ellipse(x - 6 + step, y - 2, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 6 - step, y - 2, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    // 몸(동글동글)
    const by = y - 20 - bob;
    ctx.fillStyle = c.color;
    ctx.strokeStyle = '#4a3d33';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(x, by, 17, 18, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // 얼굴
    const fx = x + c.face * 3;
    ctx.fillStyle = '#3a2f28';
    ctx.beginPath(); ctx.arc(fx - 5, by - 3, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(fx + 5, by - 3, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,110,110,0.5)';
    ctx.beginPath(); ctx.ellipse(fx - 9, by + 3, 3.5, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(fx + 9, by + 3, 3.5, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3a2f28'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(fx, by + 1, 3, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    // 새싹 더듬이
    ctx.strokeStyle = '#4a8f3c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, by - 17); ctx.quadraticCurveTo(x + 2, by - 25, x, by - 27); ctx.stroke();
    ctx.fillStyle = '#7fcf5f';
    ctx.beginPath(); ctx.ellipse(x + 5, by - 27, 5, 3, -0.4, 0, Math.PI * 2); ctx.fill();
    // 이름표
    if (label) nameTag(label, x, by - 38, isMe ? '#ffb84d' : 'rgba(255,255,255,0.9)');
  }

  function nameTag(text, x, y, bg) {
    ctx.font = '13px "Gowun Dodum", sans-serif';
    const w = ctx.measureText(text).width + 14;
    ctx.fillStyle = bg;
    ctx.strokeStyle = '#4a3d33';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); STONES.roundRect(ctx, x - w / 2, y - 10, w, 20, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3d3229';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 1);
  }

  // 지도 위 미니 돌탑(최고 높이만큼 작은 돌을 쌓아서 표시)
  const MINI = ['flat', 'block', 'mong', 'flat', 'pebble', 'block', 'long', 'mong'];
  function towerVisualHeight(t) {
    return Math.min(t.best, 15) * 9 + 14;
  }

  function drawTower(t) {
    const cat = DATA.category(t.cat);
    const n = Math.min(t.best, 15);
    const sel = t.id === highlightId;
    drawShadow(t.x, t.y, 26, 9);
    if (sel) {
      ctx.strokeStyle = '#ffb84d';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(t.x, t.y, 34, 13, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (t.best >= DATA.GAUGE_MAX) {
      const gl = ctx.createRadialGradient(t.x, t.y - 60, 4, t.x, t.y - 60, 70);
      gl.addColorStop(0, 'rgba(255,240,150,0.6)');
      gl.addColorStop(1, 'rgba(255,240,150,0)');
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(t.x, t.y - 60, 70, 0, Math.PI * 2); ctx.fill();
    }
    // 받침돌
    STONES.draw(ctx, 'flat', t.x, t.y - 6, { scale: 0.42, seed: 1 });
    let y = t.y - 12;
    for (let i = 0; i < n; i++) {
      const ty = STONES.byId(MINI[(i + t.x) % MINI.length]);
      const hh = 9;
      const sc = Math.min(hh / ty.h, (44 - i * 1.2) / ty.w);
      const sway = Math.sin(i * 1.7 + t.y) * 2.5;
      const dh = ty.h * sc;
      STONES.draw(ctx, ty, t.x + sway, y - dh / 2, { scale: sc, seed: i + 2 });
      y -= dh;
    }
    // 깃발(카테고리)
    const top = y - 4;
    ctx.strokeStyle = '#6b5240';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(t.x, top); ctx.lineTo(t.x, top - 26); ctx.stroke();
    ctx.fillStyle = cat.color;
    ctx.strokeStyle = '#4a3d33';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(t.x, top - 26); ctx.lineTo(t.x + 22, top - 20); ctx.lineTo(t.x, top - 13); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.font = '15px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cat.emoji, t.x - 12, top - 20);
  }

  function drawTowerLabel(t) {
    const mine = Store.isMine(t.id);
    nameTag((mine ? '⭐ ' : '') + t.name + ' · ' + t.best + '층', t.x, t.y + 20, mine ? '#ffe2a8' : 'rgba(255,255,255,0.88)');
  }

  function drawPlaceLabel(p) {
    if (p.type === 'gate') return;
    let x = p.x + p.w / 2, y;
    if (p.type === 'building') y = p.y - 16;
    else if (p.type === 'pond') y = p.y + p.h / 2;
    else y = p.y + p.h / 2;
    ctx.font = '18px Jua, sans-serif';
    const w = ctx.measureText(p.name).width + 22;
    ctx.fillStyle = 'rgba(255,253,245,0.94)';
    ctx.strokeStyle = '#4a3d33';
    ctx.lineWidth = 2;
    ctx.beginPath(); STONES.roundRect(ctx, x - w / 2, y - 14, w, 28, 14); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3d3229';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.name, x, y + 1);
  }

  /* ---------------- 메인 렌더 ---------------- */

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#a8d48a';
    ctx.fillRect(0, 0, vw, vh);

    const z = cam.zoom;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (vw / 2 - cam.x * z), dpr * (vh / 2 - cam.y * z));
    ctx.drawImage(ground, 0, 0);

    // 화면 밖은 건너뛰기 위한 보이는 영역
    const vx0 = cam.x - vw / 2 / z - 120, vx1 = cam.x + vw / 2 / z + 120;
    const vy0 = cam.y - vh / 2 / z - 160, vy1 = cam.y + vh / 2 / z + 200;
    const vis = function (x, y) { return x > vx0 && x < vx1 && y > vy0 && y < vy1; };

    // 탭 위치 표시
    if (tapMark) {
      const a = tapMark.life;
      ctx.strokeStyle = 'rgba(255,184,77,' + a + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(tapMark.x, tapMark.y, 18 + (1 - a) * 14, 7 + (1 - a) * 5, 0, 0, Math.PI * 2); ctx.stroke();
    }

    // 깊이 정렬(아래쪽에 있는 것이 앞에 보이도록)
    const items = [];
    DATA.PLACES.forEach(function (p) {
      if (p.type === 'building' || p.type === 'gate') items.push({ y: p.y + p.h, f: p.type === 'gate' ? drawGate : drawBuilding, a: p });
    });
    trees.forEach(function (t) { if (vis(t.x, t.y)) items.push({ y: t.y, f: drawTree, a: t }); });
    towers.forEach(function (t) { if (vis(t.x, t.y)) items.push({ y: t.y, f: drawTower, a: t }); });
    npcs.forEach(function (n) { if (vis(n.x, n.y)) items.push({ y: n.y, f: function (c) { drawCharacter(c, z >= 0.8 ? c.name : null, false); }, a: n }); });
    items.push({ y: player.y + 0.5, f: function () { drawCharacter(player, player.name, true); }, a: null });
    items.sort(function (a, b) { return a.y - b.y; });
    items.forEach(function (it) { it.f(it.a); });

    // 라벨은 맨 위에
    DATA.PLACES.forEach(function (p) { if (vis(p.x + p.w / 2, p.y)) drawPlaceLabel(p); });
    if (z >= 0.75) {
      towers.forEach(function (t) {
        if (vis(t.x, t.y) && (t.id === highlightId || Store.isMine(t.id) || Math.hypot(t.x - player.x, t.y - player.y) < 260)) drawTowerLabel(t);
      });
    } else {
      const mine = Store.myTower();
      if (mine) drawTowerLabel(mine);
    }
  }

  /* ---------------- 업데이트 ---------------- */

  function moveChar(c, dx, dy) {
    const nx = c.x + dx, ny = c.y + dy;
    if (!blocked(nx, ny)) { c.x = nx; c.y = ny; return true; }
    if (dx && !blocked(nx, c.y)) { c.x = nx; return true; }
    if (dy && !blocked(c.x, ny)) { c.y = ny; return true; }
    return false;
  }

  function stepChar(c, dt, speed) {
    if (c.tx == null) { c.moving = false; return; }
    const dx = c.tx - c.x, dy = c.ty - c.y;
    const d = Math.hypot(dx, dy);
    if (d < 4) { c.tx = c.ty = null; c.moving = false; return; }
    const s = Math.min(d, speed * dt);
    const ok = moveChar(c, dx / d * s, dy / d * s);
    if (Math.abs(dx) > 2) c.face = dx > 0 ? 1 : -1;
    c.moving = ok;
    if (ok) c.walk += dt;
    else { c.stuck = (c.stuck || 0) + dt; if (c.stuck > 0.3) { c.tx = c.ty = null; c.stuck = 0; } }
  }

  function randomWalkable(r) {
    for (let i = 0; i < 50; i++) {
      const x = 60 + r() * (W - 120), y = 80 + r() * (H - 140);
      if (!blocked(x, y)) return { x: x, y: y };
    }
    return { x: DATA.START.x, y: DATA.START.y };
  }

  const npcRand = seeded(99);
  function updateNpcs(dt) {
    npcs.forEach(function (n) {
      if (n.tx == null) {
        n.wait -= dt;
        if (n.wait <= 0) {
          const p = randomWalkable(npcRand);
          // 너무 멀리 가지 않게 근처로
          n.tx = n.x + (p.x - n.x) * 0.35;
          n.ty = n.y + (p.y - n.y) * 0.35;
          n.wait = 1.5 + npcRand() * 4;
        }
      }
      stepChar(n, dt, 90);
    });
  }

  function update(dt) {
    // 키보드 이동
    let kx = 0, ky = 0;
    if (keys.ArrowLeft || keys.KeyA) kx -= 1;
    if (keys.ArrowRight || keys.KeyD) kx += 1;
    if (keys.ArrowUp || keys.KeyW) ky -= 1;
    if (keys.ArrowDown || keys.KeyS) ky += 1;
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      player.tx = player.ty = null;
      const ok = moveChar(player, kx / l * SPEED * dt, ky / l * SPEED * dt);
      player.moving = ok;
      if (ok) player.walk += dt;
      if (kx) player.face = kx > 0 ? 1 : -1;
    } else {
      stepChar(player, dt, SPEED);
    }
    if (player.moving) cam.free = false;

    updateNpcs(dt);

    // 카메라
    const tx = cam.free ? cam.fx : player.x;
    const ty = cam.free ? cam.fy : player.y - 40;
    const k = 1 - Math.pow(0.002, dt);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    clampCam();

    if (tapMark) { tapMark.life -= dt * 1.4; if (tapMark.life <= 0) tapMark = null; }

    // 현재 위치 이름
    const loc = locationName();
    if (loc !== lastLoc) { lastLoc = loc; if (opts.onLocation) opts.onLocation(loc); }
  }

  function clampCam() {
    const hw = vw / 2 / cam.zoom, hh = vh / 2 / cam.zoom;
    if (hw * 2 >= W) cam.x = W / 2; else cam.x = Math.max(hw, Math.min(W - hw, cam.x));
    if (hh * 2 >= H) cam.y = H / 2; else cam.y = Math.max(hh - 80, Math.min(H - hh + 40, cam.y));
  }

  function locationName() {
    let best = null, bd = 1e9;
    DATA.PLACES.forEach(function (p) {
      let d;
      if (p.type === 'pond') d = Math.max(0, Math.hypot((player.x - (p.x + p.w / 2)) / (p.w / 2), (player.y - (p.y + p.h / 2)) / (p.h / 2)) - 1) * p.w / 2;
      else d = distToRect(player.x, player.y, p);
      if (d < bd) { bd = d; best = p; }
    });
    if (!best) return '충북대학교 캠퍼스';
    if (best.type === 'field' && bd === 0) return best.name;
    if (best.type === 'gate' && bd < 180) return best.name;
    if (bd < 120) return best.name + ' 앞';
    if (onRoad(player.x, player.y)) return '캠퍼스 산책로';
    return '충북대학교 잔디밭';
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
    lastT = t;
    update(dt);
    render();
    rafId = requestAnimationFrame(loop);
  }

  /* ---------------- 입력 ---------------- */

  function toWorld(sx, sy) {
    return { x: (sx - vw / 2) / cam.zoom + cam.x, y: (sy - vh / 2) / cam.zoom + cam.y };
  }

  function towerAt(wx, wy) {
    let hit = null, bd = 1e9;
    towers.forEach(function (t) {
      const top = t.y - towerVisualHeight(t) - 40;
      if (wx > t.x - 30 && wx < t.x + 30 && wy > top && wy < t.y + 14) {
        const d = Math.abs(wy - t.y);
        if (d < bd) { bd = d; hit = t; }
      }
    });
    return hit;
  }

  function setTarget(wx, wy) {
    player.tx = Math.max(30, Math.min(W - 30, wx));
    player.ty = Math.max(50, Math.min(H - 20, wy));
    player.stuck = 0;
  }

  function onDown(e) {
    if (!running) return;
    if (pointer.id !== null) return; // 두 번째 손가락은 무시
    pointer.id = e.pointerId;
    pointer.sx = e.clientX; pointer.sy = e.clientY;
    pointer.drag = false;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
  }

  function onMove(e) {
    if (e.pointerId !== pointer.id) return;
    if (!pointer.drag && Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) > 10) pointer.drag = true;
    if (pointer.drag) {
      const w = toWorld(e.clientX, e.clientY);
      setTarget(w.x, w.y);
    }
  }

  function onUp(e) {
    if (e.pointerId !== pointer.id) return;
    pointer.id = null;
    if (pointer.drag) { player.tx = player.ty = null; return; }
    const w = toWorld(e.clientX, e.clientY);
    const t = towerAt(w.x, w.y);
    if (t) {
      if (opts.onTowerTap) opts.onTowerTap(t.id);
      return;
    }
    setTarget(w.x, w.y);
    tapMark = { x: w.x, y: w.y, life: 1 };
  }

  function isTyping(e) {
    const tg = e.target;
    return tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable);
  }

  function onKey(e, down) {
    if (!running || isTyping(e)) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].indexOf(e.code) >= 0) {
      if (opts.blockKeys && opts.blockKeys()) { keys[e.code] = false; return; }
      keys[e.code] = down;
      if (e.code.indexOf('Arrow') === 0) e.preventDefault();
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = window.innerWidth; vh = window.innerHeight;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    clampCam();
  }

  /* ---------------- 공개 API ---------------- */

  const Campus = {
    init: function (cv, o) {
      canvas = cv;
      ctx = canvas.getContext('2d');
      opts = o || {};
      cam.zoom = window.innerWidth < 600 ? 0.8 : 1;
      buildGround();
      buildTrees();
      const r = seeded(5);
      DATA.NPCS.forEach(function (n) {
        const p = randomWalkable(r);
        npcs.push({ name: n.name, color: n.color, x: p.x, y: p.y, tx: null, ty: null, walk: 0, moving: false, face: 1, wait: r() * 3 });
      });
      resize();
      window.addEventListener('resize', resize);
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', function (e) { if (e.pointerId === pointer.id) pointer.id = null; });
      canvas.addEventListener('wheel', function (e) {
        e.preventDefault();
        Campus.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
      }, { passive: false });
      window.addEventListener('keydown', function (e) { onKey(e, true); });
      window.addEventListener('keyup', function (e) { onKey(e, false); });
      window.addEventListener('blur', function () { Object.keys(keys).forEach(function (k) { keys[k] = false; }); });
      Campus.resume();
    },

    setTowers: function (list) { towers = list.slice(); },

    setPlayer: function (name, color) {
      player.name = name || '나';
      player.color = color || DATA.COLORS[0];
    },

    getPlayer: function () { return { x: player.x, y: player.y }; },

    zoomBy: function (f) {
      cam.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.zoom * f));
      clampCam();
    },

    // 특정 위치로 카메라 이동(플레이어가 움직이면 다시 따라감)
    focus: function (x, y) {
      cam.free = true;
      cam.fx = x; cam.fy = y - 40;
    },

    highlight: function (id) { highlightId = id; },

    // 현재 위치에 돌탑을 세울 수 있는지
    canBuildHere: function (ignoreId) {
      const x = player.x, y = player.y;
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
    },

    pause: function () {
      running = false;
      cancelAnimationFrame(rafId);
      Object.keys(keys).forEach(function (k) { keys[k] = false; });
      pointer.id = null;
    },

    resume: function () {
      if (running) return;
      running = true;
      lastT = performance.now();
      resize();
      rafId = requestAnimationFrame(loop);
    }
  };

  window.Campus = Campus;
})();
