/* =========================================================
 * stones.js — 돌 7종의 모양·무게·균형 성질과 그리기 함수
 *  top    : 윗면 중 다른 돌을 받쳐 줄 수 있는 비율 (작을수록 위에 쌓기 어려움)
 *  bottom : 아랫면 중 바닥에 닿는 비율
 *  mass   : 무게(무게중심 계산에 사용)
 * ========================================================= */
(function () {
  'use strict';

  const TYPES = [
    { id: 'flat',   name: '납작돌', w: 124, h: 28, mass: 1.0, top: 0.92, bottom: 0.92, color: '#bdb5a8', shape: 'slab',   tip: '위에 쌓기 쉬워요' },
    { id: 'block',  name: '네모돌', w: 88,  h: 52, mass: 1.3, top: 0.88, bottom: 0.9,  color: '#a9a397', shape: 'block',  tip: '튼튼한 기본 돌' },
    { id: 'long',   name: '긴돌',   w: 172, h: 24, mass: 1.4, top: 0.9,  bottom: 0.86, color: '#c6bca7', shape: 'slab',   tip: '넓지만 무거워요' },
    { id: 'pebble', name: '조약돌', w: 64,  h: 34, mass: 0.5, top: 0.55, bottom: 0.55, color: '#d3cabc', shape: 'oval',   tip: '작고 가벼워요' },
    { id: 'mong',   name: '몽돌',   w: 104, h: 46, mass: 1.0, top: 0.66, bottom: 0.66, color: '#9fa8aa', shape: 'oval',   tip: '매끈한 타원형' },
    { id: 'round',  name: '둥근돌', w: 78,  h: 72, mass: 1.2, top: 0.28, bottom: 0.42, color: '#b6ab9c', shape: 'round',  tip: '위에 쌓기 어려워요' },
    { id: 'pointy', name: '뾰족돌', w: 84,  h: 70, mass: 0.9, top: 0.12, bottom: 0.9,  color: '#a49e93', shape: 'pointy', tip: '꼭대기용 마무리 돌' }
  ];

  function byId(id) {
    return TYPES.find(function (t) { return t.id === id; }) || TYPES[0];
  }

  // 색을 밝게(+) / 어둡게(-)
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.max(0, Math.min(255, Math.round(r + amt)));
    g = Math.max(0, Math.min(255, Math.round(g + amt)));
    b = Math.max(0, Math.min(255, Math.round(b + amt)));
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // (0,0)을 중심으로 돌 모양 경로 만들기
  function shapePath(ctx, t, w, h) {
    ctx.beginPath();
    const hw = w / 2, hh = h / 2;
    switch (t.shape) {
      case 'slab':
        roundRect(ctx, -hw, -hh, w, h, h * 0.48);
        break;
      case 'block':
        roundRect(ctx, -hw, -hh, w, h, 13);
        break;
      case 'oval':
      case 'round':
        ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
        break;
      case 'pointy':
        ctx.moveTo(-hw + 10, hh);
        ctx.lineTo(hw - 10, hh);
        ctx.quadraticCurveTo(hw, hh, hw - 4, hh - 12);
        ctx.quadraticCurveTo(hw * 0.35, -hh * 0.2, 4, -hh + 3);
        ctx.quadraticCurveTo(0, -hh - 2, -4, -hh + 3);
        ctx.quadraticCurveTo(-hw * 0.4, -hh * 0.15, -hw + 4, hh - 12);
        ctx.quadraticCurveTo(-hw, hh, -hw + 10, hh);
        ctx.closePath();
        break;
      default:
        ctx.rect(-hw, -hh, w, h);
    }
  }

  // 시드 기반 의사 난수(돌마다 무늬가 항상 같게)
  function rand(seed) {
    let s = (seed * 9301 + 49297) % 233280;
    return function () {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  /**
   * 돌 그리기
   * @param ctx    캔버스 컨텍스트
   * @param type   돌 종류 객체 또는 id
   * @param cx,cy  돌 중심 좌표
   * @param o      { angle, scale, seed, alpha, face, tint }
   */
  function draw(ctx, type, cx, cy, o) {
    const t = typeof type === 'string' ? byId(type) : type;
    o = o || {};
    const sc = o.scale || 1;
    const w = t.w * sc, h = t.h * sc;
    const base = o.tint || t.color;
    ctx.save();
    ctx.translate(cx, cy);
    if (o.angle) ctx.rotate(o.angle);
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;

    // 몸통(위쪽이 밝은 그라데이션)
    shapePath(ctx, t, w, h);
    const g = ctx.createLinearGradient(-w * 0.3, -h / 2, w * 0.2, h / 2);
    g.addColorStop(0, shade(base, 32));
    g.addColorStop(0.55, base);
    g.addColorStop(1, shade(base, -34));
    ctx.fillStyle = g;
    ctx.fill();

    // 무늬(점)
    ctx.save();
    ctx.clip();
    const r = rand((o.seed || 1) * 7 + t.w);
    ctx.fillStyle = shade(base, -42);
    ctx.globalAlpha *= 0.35;
    const dots = Math.max(3, Math.round((w * h) / 900));
    for (let i = 0; i < dots; i++) {
      const dx = (r() - 0.5) * w * 0.9, dy = (r() - 0.5) * h * 0.85;
      ctx.beginPath();
      ctx.arc(dx, dy, (0.8 + r() * 1.8) * sc, 0, Math.PI * 2);
      ctx.fill();
    }
    // 이끼 한 점
    if (r() < 0.45) {
      ctx.globalAlpha = (o.alpha != null ? o.alpha : 1) * 0.55;
      ctx.fillStyle = '#7fae5a';
      ctx.beginPath();
      ctx.ellipse((r() - 0.5) * w * 0.5, h * 0.32, w * 0.12, h * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 하이라이트
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.ellipse(-w * 0.2, -h * 0.22, w * 0.14, Math.max(2, h * 0.11), -0.25, 0, Math.PI * 2);
    ctx.fill();

    // 외곽선
    shapePath(ctx, t, w, h);
    ctx.lineWidth = Math.max(1.5, 2.6 * sc);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#4a3d33';
    ctx.stroke();

    // 귀여운 얼굴(선택)
    if (o.face) {
      const ey = h * 0.05;
      ctx.fillStyle = '#3a2f28';
      ctx.beginPath(); ctx.arc(-w * 0.12, ey, 2.4 * sc, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(w * 0.12, ey, 2.4 * sc, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#3a2f28';
      ctx.lineWidth = 1.6 * sc;
      ctx.beginPath(); ctx.arc(0, ey + 2 * sc, 3 * sc, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
      ctx.fillStyle = 'rgba(255,120,120,0.45)';
      ctx.beginPath(); ctx.ellipse(-w * 0.2, ey + 4 * sc, 3.5 * sc, 2 * sc, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(w * 0.2, ey + 4 * sc, 3.5 * sc, 2 * sc, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // 돌 선택 버튼용 작은 아이콘 캔버스
  function icon(type, size) {
    const t = typeof type === 'string' ? byId(type) : type;
    size = size || 56;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = document.createElement('canvas');
    c.width = size * dpr;
    c.height = size * 0.7 * dpr;
    c.style.width = size + 'px';
    c.style.height = size * 0.7 + 'px';
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const sc = Math.min((size - 8) / t.w, (size * 0.7 - 8) / t.h);
    draw(ctx, t, size / 2, size * 0.35, { scale: sc, seed: 3, face: true });
    return c;
  }

  window.STONES = {
    TYPES: TYPES,
    byId: byId,
    draw: draw,
    icon: icon,
    shade: shade,
    roundRect: roundRect
  };
})();
