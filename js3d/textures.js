/* =========================================================
 * js3d/textures.js — 캔버스로 직접 그리는 텍스처
 *  이미지 파일 없이 잔디·보도블록·건물 외벽·운동장·간판을 만들어요.
 *  (나중에 실제 사진 텍스처로 바꾸기 쉬운 자리)
 * ========================================================= */
import * as THREE from 'three';

function rng(seed) {
  let s = seed;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = function (v) { return Math.max(0, Math.min(255, Math.round(v + amt))); };
  return 'rgb(' + c((n >> 16) & 255) + ',' + c((n >> 8) & 255) + ',' + c(n & 255) + ')';
}

function makeTexture(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 잔디 (8m 마다 반복)
export function grassTexture() {
  return makeTexture(512, 512, function (g, w, h) {
    const r = rng(11);
    g.fillStyle = '#7fad55';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const x = r() * w, y = r() * h, rad = 30 + r() * 70;
      const tone = r() < 0.5 ? 'rgba(70,110,40,0.18)' : 'rgba(160,190,90,0.16)';
      // 가장자리를 넘는 얼룩은 반대편에도 그려서 이음새 없이 반복되게
      for (let ox = -w; ox <= w; ox += w) {
        for (let oy = -h; oy <= h; oy += h) {
          const cx = x + ox, cy = y + oy;
          if (cx + rad < 0 || cx - rad > w || cy + rad < 0 || cy - rad > h) continue;
          const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
          gr.addColorStop(0, tone); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr;
          g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
        }
      }
    }
    for (let i = 0; i < 14000; i++) {
      const x = r() * w, y = r() * h;
      const l = 28 + r() * 26, hue = 78 + r() * 30;
      g.strokeStyle = 'hsla(' + hue + ',42%,' + l + '%,0.55)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4);
      g.stroke();
    }
  }, true);
}

// 보도블록 (4m 마다 반복)
export function pavingTexture() {
  return makeTexture(256, 256, function (g, w, h) {
    const r = rng(23);
    g.fillStyle = '#b9ab90';
    g.fillRect(0, 0, w, h);
    const bw = 32, bh = 16;
    for (let row = 0; row < h / bh; row++) {
      const off = (row % 2) * bw / 2;
      for (let col = -1; col < w / bw + 1; col++) {
        const v = Math.round((r() - 0.5) * 22);
        g.fillStyle = shade('#d8ccb3', v);
        g.fillRect(col * bw + off + 1, row * bh + 1, bw - 2, bh - 2);
      }
    }
    for (let i = 0; i < 900; i++) {
      g.fillStyle = 'rgba(80,70,55,' + (0.05 + r() * 0.08) + ')';
      g.fillRect(r() * w, r() * h, 1.5, 1.5);
    }
  }, true);
}

// 자갈 (돌탑 마당 바닥)
export function gravelTexture() {
  return makeTexture(256, 256, function (g, w, h) {
    const r = rng(31);
    g.fillStyle = '#d9cfbb';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = Math.round((r() - 0.5) * 70);
      g.fillStyle = shade('#c8bca5', v);
      g.beginPath();
      g.ellipse(r() * w, r() * h, 1 + r() * 2.6, 1 + r() * 1.8, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }, true);
}

// 생울타리 (울타리 표면)
export function hedgeTexture() {
  return makeTexture(128, 128, function (g, w, h) {
    const r = rng(41);
    g.fillStyle = '#3f6b2f';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = 'hsla(' + (85 + r() * 25) + ',45%,' + (22 + r() * 22) + '%,0.8)';
      g.beginPath();
      g.arc(r() * w, r() * h, 1 + r() * 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }, true);
}

/**
 * 건물 외벽: 층마다 창문 줄을 그린 텍스처
 * @param wall   외벽 색
 * @param floors 층 수
 * @param widthM 벽 너비(m)
 * @param style  'glass'(유리창 많음) | 'normal'
 * @param door   1층 가운데에 출입문을 그릴지
 */
export function facadeTexture(wall, floors, widthM, style, door, seed) {
  const cols = Math.max(2, Math.round(widthM / 3.4));
  const cw = 40, fh = 56;
  const W = cols * cw, H = floors * fh;
  return makeTexture(W, H, function (g) {
    const r = rng(seed || 3);
    g.fillStyle = wall;
    g.fillRect(0, 0, W, H);
    // 외벽 얼룩
    for (let i = 0; i < W * H / 60; i++) {
      g.fillStyle = 'rgba(90,80,70,' + (r() * 0.05) + ')';
      g.fillRect(r() * W, r() * H, 2, 2);
    }
    const glass = style === 'glass';
    const ww = cw * (glass ? 0.84 : 0.56), wh = fh * (glass ? 0.7 : 0.5);
    for (let f = 0; f < floors; f++) {
      const y0 = H - (f + 1) * fh;
      // 층 경계 띠
      g.fillStyle = shade(wall, -26);
      g.fillRect(0, y0 + fh - 4, W, 4);
      for (let c = 0; c < cols; c++) {
        const x = c * cw + (cw - ww) / 2, y = y0 + (fh - wh) / 2 - 2;
        if (door && f === 0 && Math.abs(c - (cols - 1) / 2) < 0.6) {
          // 출입문
          g.fillStyle = '#4b5a63';
          g.fillRect(c * cw + 4, y0 + 10, cw - 8, fh - 14);
          g.fillStyle = 'rgba(190,215,230,0.55)';
          g.fillRect(c * cw + 7, y0 + 13, (cw - 17) / 2, fh - 20);
          g.fillRect(c * cw + cw / 2 + 1.5, y0 + 13, (cw - 17) / 2, fh - 20);
          continue;
        }
        g.fillStyle = shade(wall, -45);
        g.fillRect(x - 2, y - 2, ww + 4, wh + 4);
        const lit = r();
        const gr = g.createLinearGradient(x, y, x + ww * 0.6, y + wh);
        gr.addColorStop(0, lit < 0.15 ? '#c9dbe6' : '#7f9db3');
        gr.addColorStop(1, '#3f5a70');
        g.fillStyle = gr;
        g.fillRect(x, y, ww, wh);
        // 창틀
        g.fillStyle = 'rgba(235,240,240,0.85)';
        g.fillRect(x + ww / 2 - 1, y, 2, wh);
        if (!glass) g.fillRect(x, y + wh * 0.38, ww, 1.5);
        // 반사광
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.beginPath();
        g.moveTo(x, y + wh); g.lineTo(x + ww * 0.35, y); g.lineTo(x + ww * 0.5, y); g.lineTo(x + ww * 0.15, y + wh);
        g.closePath(); g.fill();
      }
    }
  }, false);
}

// 운동장(트랙 + 잔디)
export function trackTexture() {
  return makeTexture(1024, 640, function (g, w, h) {
    g.fillStyle = '#6f9f4a';
    g.fillRect(0, 0, w, h);
    const stadium = function (pad) {
      const rr = (h - pad * 2) / 2;
      g.beginPath();
      g.moveTo(pad + rr, pad);
      g.lineTo(w - pad - rr, pad);
      g.arc(w - pad - rr, h / 2, rr, -Math.PI / 2, Math.PI / 2);
      g.lineTo(pad + rr, h - pad);
      g.arc(pad + rr, h / 2, rr, Math.PI / 2, Math.PI * 1.5);
      g.closePath();
    };
    stadium(18);
    g.fillStyle = '#b4573f';
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2;
    for (let i = 0; i <= 5; i++) { stadium(18 + i * 16); g.stroke(); }
    stadium(98);
    g.fillStyle = '#76a94e';
    g.fill();
    // 잔디 줄무늬
    g.save();
    stadium(98); g.clip();
    for (let x = 0; x < w; x += 64) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x, 0, 32, h); }
    g.restore();
    // 축구장 선
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 3;
    g.strokeRect(210, 150, w - 420, h - 300);
    g.beginPath(); g.moveTo(w / 2, 150); g.lineTo(w / 2, h - 150); g.stroke();
    g.beginPath(); g.arc(w / 2, h / 2, 50, 0, Math.PI * 2); g.stroke();
    g.strokeRect(210, h / 2 - 90, 80, 180);
    g.strokeRect(w - 290, h / 2 - 90, 80, 180);
  }, false);
}

// 부드럽게 퍼지는 빛(소원 게이지 100% 돌탑)
export function glowTexture() {
  return makeTexture(128, 128, function (g, w) {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,245,170,1)');
    gr.addColorStop(0.35, 'rgba(255,230,140,0.45)');
    gr.addColorStop(1, 'rgba(255,230,140,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, w);
  }, false);
}

/**
 * 글자 간판. 웹폰트가 늦게 로드되면 redraw()로 다시 그려요.
 * @param lines [{text, size, color}] 여러 줄
 * @param o     { w, h, bg, border }
 */
export function signTexture(lines, o) {
  o = o || {};
  const W = o.w || 1024, H = o.h || 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  function redraw() {
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    if (o.bg) {
      g.fillStyle = o.bg;
      g.beginPath();
      g.roundRect(6, 6, W - 12, H - 12, 22);
      g.fill();
      if (o.border) { g.lineWidth = 8; g.strokeStyle = o.border; g.stroke(); }
    }
    const total = lines.reduce(function (s, l) { return s + l.size * 1.15; }, 0);
    let y = (H - total) / 2;
    lines.forEach(function (l) {
      g.font = l.size + 'px "Jua", "Gowun Dodum", "Malgun Gothic", sans-serif';
      g.fillStyle = l.color || '#3d3229';
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillText(l.text, W / 2, y + l.size * 0.08, W - 40);
      y += l.size * 1.15;
    });
    tex.needsUpdate = true;
  }
  redraw();
  return { texture: tex, redraw: redraw };
}
