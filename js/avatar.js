/* =========================================================
 * avatar.js — 2D 캐릭터 그리기 (2D 지도 + 캐릭터 꾸미기 미리보기)
 *  AVATAR.draw(ctx, x, y, o)
 *   - (x, y): 발바닥 위치
 *   - o: { color, hair, face, hairColor, bob, step, dir, headOnly }
 *     hair: bowl | short | long | twin | bun
 *     face: smile | dot | wink | wow | sleepy
 *  3D 캐릭터(js3d/actors.js)와 같은 디자인: 큰 얼굴 + 과잠
 * ========================================================= */
(function () {
  'use strict';

  const LINE = '#4a3d33';
  const SKIN = '#ffe3cf';
  const INK = '#3a2a24';
  const CREAM = '#f6efe2';

  function rr(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function ell(ctx, x, y, rx, ry, rot) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2);
  }

  // 머리카락 중 얼굴 "뒤"에 그릴 부분 (긴 머리·땋은 머리·똥머리)
  function hairBack(ctx, x, hy, hair, hc) {
    ctx.fillStyle = hc;
    if (hair === 'long') {
      ctx.beginPath(); rr(ctx, x - 17, hy - 6, 34, 30, 10); ctx.fill();
    } else if (hair === 'twin') {
      [-1, 1].forEach(function (s) {
        for (let i = 0; i < 3; i++) { ell(ctx, x + s * (15 + i * 0.6), hy + 8 + i * 6, 4.2 - i * 0.4, 3.6); ctx.fill(); }
        ctx.fillStyle = '#e8534a';
        ell(ctx, x + s * 16.4, hy + 24, 2.6, 1.8); ctx.fill();
        ctx.fillStyle = hc;
      });
    } else if (hair === 'bun') {
      ell(ctx, x, hy - 17, 7.5, 6.5); ctx.fill();
    }
  }

  // 머리카락 중 얼굴 "위"에 그릴 부분
  function hairFront(ctx, x, hy, hair, hc) {
    ctx.fillStyle = hc;
    if (hair === 'short') {
      ctx.beginPath(); ctx.ellipse(x, hy - 2, 16.5, 14.5, 0, Math.PI * 1.08, Math.PI * 1.92); ctx.closePath(); ctx.fill();
      ell(ctx, x + 3, hy - 16, 4, 2.5, -0.5); ctx.fill();   // 삐죽 올라온 머리
    } else {
      ctx.beginPath(); ctx.ellipse(x, hy - 1, 17, 16, 0, Math.PI, Math.PI * 2); ctx.closePath(); ctx.fill();
      if (hair === 'long' || hair === 'twin') {
        // 옆머리
        ctx.beginPath(); rr(ctx, x - 17, hy - 2, 5, 12, 2.5); ctx.fill();
        ctx.beginPath(); rr(ctx, x + 12, hy - 2, 5, 12, 2.5); ctx.fill();
      }
    }
  }

  function eyeArc(ctx, x, y) { ctx.beginPath(); ctx.arc(x, y, 2.6, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
  function eyeDot(ctx, x, y, r) { ctx.fillStyle = INK; ell(ctx, x, y, r || 1.9, (r || 1.9) * 1.25); ctx.fill(); }
  function smileMouth(ctx, x, y) { ctx.beginPath(); ctx.arc(x, y - 1, 2.6, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
  function omegaMouth(ctx, x, y) {
    ctx.beginPath(); ctx.arc(x - 1.3, y, 1.3, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + 1.3, y, 1.3, 0, Math.PI); ctx.stroke();
  }

  function drawFace(ctx, fx, hy, face) {
    ctx.strokeStyle = INK; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    const ey = hy + 4, my = hy + 7.5;
    if (face === 'dot') {
      eyeDot(ctx, fx - 5.5, ey); eyeDot(ctx, fx + 5.5, ey);
      ctx.lineWidth = 1.4; smileMouth(ctx, fx, my);
    } else if (face === 'wink') {
      eyeDot(ctx, fx - 5.5, ey); eyeArc(ctx, fx + 5.5, ey + 0.5);
      ctx.lineWidth = 1.4; smileMouth(ctx, fx, my);
    } else if (face === 'wow') {
      eyeDot(ctx, fx - 5.5, ey - 0.5, 2.3); eyeDot(ctx, fx + 5.5, ey - 0.5, 2.3);
      ctx.fillStyle = '#c4584e'; ell(ctx, fx, my + 0.8, 1.8, 2.2); ctx.fill();
    } else if (face === 'sleepy') {
      ctx.beginPath(); ctx.moveTo(fx - 8, ey); ctx.lineTo(fx - 3.5, ey); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx + 3.5, ey); ctx.lineTo(fx + 8, ey); ctx.stroke();
      ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(fx - 1.5, my + 0.5); ctx.lineTo(fx + 1.5, my + 0.5); ctx.stroke();
    } else { // smile ^ ^ ω
      eyeArc(ctx, fx - 5.5, ey); eyeArc(ctx, fx + 5.5, ey);
      ctx.lineWidth = 1.3; omegaMouth(ctx, fx, my);
    }
    ctx.lineCap = 'butt';
    ctx.fillStyle = 'rgba(255,140,150,0.5)';
    ell(ctx, fx - 10, hy + 7, 3, 1.8); ctx.fill();
    ell(ctx, fx + 10, hy + 7, 3, 1.8); ctx.fill();
  }

  function drawBody(ctx, x, y, color, step, by) {
    // 다리(청바지) + 하얀 신발
    ctx.fillStyle = '#3d4a6e';
    ctx.fillRect(x - 9 + step, y - 10, 6, 7);
    ctx.fillRect(x + 3 - step, y - 10, 6, 7);
    ctx.fillStyle = '#faf7f2';
    ctx.strokeStyle = LINE; ctx.lineWidth = 1.5;
    ell(ctx, x - 6 + step, y - 2, 5, 3); ctx.fill(); ctx.stroke();
    ell(ctx, x + 6 - step, y - 2, 5, 3); ctx.fill(); ctx.stroke();
    // 과잠: 크림색 소매 → 몸통(내 색) → 줄무늬 밑단 → 단추·와펜
    ctx.strokeStyle = LINE; ctx.lineWidth = 2;
    ctx.fillStyle = CREAM;
    ell(ctx, x - 13, by + 1, 5, 9, 0.35); ctx.fill(); ctx.stroke();
    ell(ctx, x + 13, by + 1, 5, 9, -0.35); ctx.fill(); ctx.stroke();
    ctx.fillStyle = SKIN;
    ctx.beginPath(); ctx.arc(x - 16, by + 9, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 16, by + 9, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); rr(ctx, x - 11, by - 9, 22, 19, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#34324a';
    ctx.fillRect(x - 11, by + 6, 22, 4);
    ctx.fillStyle = CREAM;
    ctx.fillRect(x - 11, by + 7.5, 22, 1);
    ctx.fillStyle = '#f2ece0';
    [-4, 0, 4].forEach(function (dy) { ctx.beginPath(); ctx.arc(x, by + dy, 1.1, 0, Math.PI * 2); ctx.fill(); });
    ctx.font = 'bold 8px Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('C', x - 5.5, by - 3);
  }

  // 얼굴 위쪽 끝(이름표 위치 계산용): 발바닥 기준 위로 몇 px
  const TOP = 58;

  function draw(ctx, x, y, o) {
    o = o || {};
    const look = DATA.normLook(o);
    const bob = o.bob || 0, step = o.step || 0, dir = o.dir || 0;
    const by = y - 18 - bob;          // 몸통 중심
    const hy = by - 19;               // 얼굴 중심
    ctx.save();
    if (!o.headOnly) drawBody(ctx, x, y, o.color || DATA.COLORS[0], step, by);
    const hc = DATA.hairHex(look.hairColor);
    hairBack(ctx, x, hy, look.hair, hc);
    ctx.fillStyle = SKIN;
    ctx.strokeStyle = LINE; ctx.lineWidth = 2;
    ell(ctx, x, hy, 16, 15); ctx.fill(); ctx.stroke();
    hairFront(ctx, x, hy, look.hair, hc);
    drawFace(ctx, x + dir * 2, hy, look.face);
    ctx.restore();
  }

  // 캔버스 하나에 캐릭터를 크게 그려요 (미리보기·선택 버튼용)
  //  headOnly면 얼굴만 크게
  function preview(canvas, o) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const k = o.headOnly ? Math.min(w, h) / 54 : Math.min(w / 46, h / (TOP + 12));
    ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    const cx = w / 2 / k;
    // headOnly: 얼굴 중심(발바닥 기준 -37)이 가운데보다 살짝 아래 오도록(똥머리 자리)
    const footY = o.headOnly ? h / 2 / k + 40 : h / k - 6;
    draw(ctx, cx, footY, o);
  }

  window.AVATAR = { draw: draw, preview: preview, TOP: TOP };
})();
