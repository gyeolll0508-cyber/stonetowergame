/* =========================================================
 * stack.js — 돌 쌓기 미니게임
 *  - 위에서 좌우로 움직이는 돌을 탭해서 떨어뜨려요.
 *  - 균형 판정: 각 돌 위에 올라간 돌들의 "무게중심"이
 *    두 돌이 맞닿은 면(접촉면) 안에 있어야 버텨요.
 *    벗어나면 그 위가 와르르 무너져요.
 *  - 난이도: 높을수록 빨라지고, 4층부터 바람, 12층부터 손떨림.
 * ========================================================= */
(function () {
  'use strict';

  const G = 2000;            // 중력 가속도(px/초²)
  const HOVER_GAP = 160;     // 탑 꼭대기와 움직이는 돌 사이 간격
  const WIND_FROM = 4;
  const TREMOR_FROM = 12;
  const BASE = { id: 'base', name: '받침돌', w: 230, h: 40, mass: 4, top: 0.96, bottom: 1, color: '#9c9488', shape: 'block' };

  const $ = function (id) { return document.getElementById(id); };
  let el = null;
  let canvas, ctx, dpr = 1, vw = 0, vh = 0, scale = 1, bottomPad = 160;
  let running = false, rafId = 0, lastT = 0, time = 0;

  let tower = null, onClose = null;
  let stack = [];            // {type, x, yb(아랫면 y, 위쪽이 음수), seed}
  let selected = 'flat';
  let state = 'hover';       // hover → falling → (hover | collapse | miss) → result
  let mover = null;
  let phase = 0;
  let wind = 0;
  let camY = 0;
  let debris = [], dust = [], popups = [], leaves = [], clouds = [], stars = [];
  let minMargin = 1;
  let endTimer = 0, endReason = '', endHeight = 0;
  let recorded = false, reached15 = false, seedNo = 1, dropped = false;

  /* ---------------- 균형 계산 ---------------- */

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

  /* ---------------- 진행 ---------------- */

  function typeOf(id) { return STONES.byId(id); }

  function newMover() {
    mover = { type: typeOf(selected), x: 0, yb: topY() - HOVER_GAP, vy: 0, seed: seedNo++ };
  }

  function rollWind() {
    const h = height();
    if (h < WIND_FROM) { wind = 0; return; }
    const max = Math.min(30 + (h - WIND_FROM) * 9, 140);
    wind = (Math.random() < 0.5 ? -1 : 1) * max * (0.45 + Math.random() * 0.55);
  }

  function amplitude() {
    const halfW = vw / 2 / scale;
    return Math.max(40, Math.min(165, halfW - mover.type.w / 2 - 12));
  }

  function omega() { return Math.min(1.5 + height() * 0.13, 4.2); }

  function tremor() { return height() >= TREMOR_FROM ? (height() - TREMOR_FROM + 1) * 0.9 : 0; }

  function drop() {
    if (state !== 'hover' || !mover) return;
    state = 'falling';
    mover.vy = 0;
    if (tremor()) mover.x += (Math.random() - 0.5) * tremor();
    if (!dropped) { dropped = true; el.tip.classList.add('hide'); }
  }

  function land() {
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
    stack.push({ type: mover.type, x: mover.x, yb: mover.yb, seed: mover.seed });
    const offset = Math.abs(mover.x - top.x);
    mover = null;
    const a = analyze();
    if (a.failK >= 0) {
      // 무너짐: failK 위의 돌들이 쏟아짐
      const fallen = stack.splice(a.failK + 1);
      fallen.forEach(function (s, i) { debris.push(toDebris(s, a.dir, 1 + i * 0.12)); });
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
    rollWind();
    state = 'hover';
    newMover();
    updateHud();
  }

  function toDebris(s, dir, power) {
    return {
      type: s.type, seed: s.seed,
      x: s.x, y: s.yb - s.type.h / 2,
      vx: dir * (50 + Math.random() * 110) * power + wind * 0.5,
      vy: -60 - Math.random() * 120,
      ang: 0, av: dir * (1.2 + Math.random() * 2.4)
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
    const h = reason === 'finish' ? height() : endHeight;
    let res = { best: tower.best, isRecord: false };
    if (!recorded) {
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
    el.rsEmoji.textContent = emoji;
    el.rsTitle.textContent = title;
    el.rsHeight.textContent = h + '층';
    el.rsBest.textContent = res.best + '층';
    el.rsRecord.hidden = !res.isRecord;
    el.rsGaugeFill.style.width = gauge.pct + '%';
    el.rsGaugeLabel.textContent = gauge.label;
    el.rsNote.textContent = note;
    el.result.hidden = false;
    el.skBest.textContent = res.best;
    setTimeout(function () { el.rsRetry.focus(); }, 50);
  }

  function finish() {
    if (state !== 'hover') return;
    if (height() === 0) { toast('돌을 하나 이상 쌓아 주세요 🪨'); return; }
    showResult('finish');
  }

  function toast(msg) { if (window.App && App.toast) App.toast(msg); }

  /* ---------------- 효과 ---------------- */

  function puff(x, y, n) {
    for (let i = 0; i < n; i++) {
      dust.push({ x: x + (Math.random() - 0.5) * 60, y: y, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 60, r: 4 + Math.random() * 6, life: 1 });
    }
  }

  function popup(text, x, y, color) {
    popups.push({ text: text, x: x, y: y, life: 1.4, color: color });
  }

  /* ---------------- 업데이트 ---------------- */

  function update(dt) {
    time += dt;
    if (state === 'hover' && mover) {
      phase += omega() * dt;
      const A = amplitude();
      let x = Math.sin(phase) * A;
      const tr = tremor();
      if (tr) x += (Math.sin(time * 31) + Math.sin(time * 17.3)) * 0.5 * tr;
      mover.x = x;
      mover.yb = topY() - HOVER_GAP + Math.sin(time * 3) * 4;
    } else if (state === 'falling' && mover) {
      mover.vy += G * dt;
      mover.yb += mover.vy * dt;
      mover.x += wind * 0.8 * dt;
      if (mover.yb >= topY()) land();
    }

    debris.forEach(function (d) {
      d.vy += G * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.ang += d.av * dt;
      const bottom = d.y + d.type.h / 2;
      if (bottom > 0) {
        d.y = -d.type.h / 2;
        if (Math.abs(d.vy) > 120) puff(d.x, 0, 2);
        d.vy *= -0.32;
        d.vx *= 0.7;
        d.av *= 0.6;
      }
    });

    dust.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 80 * dt; p.life -= dt * 1.6; });
    dust = dust.filter(function (p) { return p.life > 0; });
    popups.forEach(function (p) { p.y -= 40 * dt; p.life -= dt; });
    popups = popups.filter(function (p) { return p.life > 0; });

    // 바람에 날리는 잎(화면 좌표)
    if (Math.abs(wind) > 0 && Math.random() < Math.abs(wind) / 900) {
      leaves.push({ x: wind > 0 ? -20 : vw + 20, y: Math.random() * vh * 0.7, v: wind * (2 + Math.random()), r: Math.random() * 6, life: 1 });
    }
    leaves.forEach(function (l) { l.x += l.v * dt; l.y += Math.sin(time * 3 + l.r) * 20 * dt; l.r += dt * 3; });
    leaves = leaves.filter(function (l) { return l.x > -40 && l.x < vw + 40; });

    if (state === 'collapse' || state === 'miss') {
      endTimer -= dt;
      if (endTimer <= 0) showResult(endReason);
    }

    // 카메라
    const limit = (bottomPad - vh / 2) / scale;
    let target;
    if (state === 'collapse' || state === 'miss' || state === 'result') {
      target = Math.min(limit, Math.max(camY, topY() + 120));
    } else {
      const hoverScreen = Math.max(0.3 * vh, 200);
      target = Math.min(topY() - HOVER_GAP - (hoverScreen - vh / 2) / scale, limit);
    }
    camY += (target - camY) * (1 - Math.pow(0.02, dt));
  }

  /* ---------------- 그리기 ---------------- */

  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
    const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
    const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  function sy(y) { return (y - camY) * scale + vh / 2; }
  function sx(x) { return x * scale + vw / 2; }

  function drawBackground() {
    // 높이 올라갈수록 하늘이 노을 → 밤하늘로
    const alt = Math.max(0, Math.min(1, -camY / 2600));
    const topC = alt < 0.5 ? mix('#8fd3ff', '#ffb98a', alt * 2) : mix('#ffb98a', '#2b2f6b', (alt - 0.5) * 2);
    const botC = alt < 0.5 ? mix('#e8f7ff', '#ffe3c2', alt * 2) : mix('#ffe3c2', '#6a5a9e', (alt - 0.5) * 2);
    const g = ctx.createLinearGradient(0, 0, 0, vh);
    g.addColorStop(0, topC);
    g.addColorStop(1, botC);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);

    if (alt > 0.55) {
      ctx.fillStyle = 'rgba(255,255,240,' + Math.min(1, (alt - 0.55) * 3) + ')';
      stars.forEach(function (s) {
        const yy = ((s.y - camY * 0.1) % vh + vh) % vh;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 2 + s.p);
        ctx.beginPath(); ctx.arc(s.x * vw, yy, s.r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    // 구름(느린 시차)
    clouds.forEach(function (c) {
      const x = ((c.x + time * c.v) % (vw + 300) + vw + 300) % (vw + 300) - 150;
      const y = (c.y - camY * 0.5) * scale * 0.6 + vh / 2;
      if (y < -80 || y > vh + 80) return;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(x, y, 26 * c.s, 0, Math.PI * 2);
      ctx.arc(x + 30 * c.s, y - 10 * c.s, 32 * c.s, 0, Math.PI * 2);
      ctx.arc(x + 64 * c.s, y, 24 * c.s, 0, Math.PI * 2);
      ctx.fill();
    });

    // 땅·언덕·캠퍼스 실루엣
    const gy = sy(0);
    if (gy < vh + 400) {
      ctx.fillStyle = '#a8d98c';
      ctx.beginPath(); ctx.ellipse(sx(-260), gy, 420 * scale, 130 * scale, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#95cf7a';
      ctx.beginPath(); ctx.ellipse(sx(300), gy, 480 * scale, 100 * scale, 0, Math.PI, Math.PI * 2); ctx.fill();
      // 멀리 보이는 건물
      ctx.fillStyle = 'rgba(120,150,170,0.45)';
      [[-330, 70, 90], [-220, 50, 120], [210, 90, 80], [320, 60, 110]].forEach(function (b) {
        ctx.fillRect(sx(b[0]), gy - b[2] * scale, b[1] * scale, b[2] * scale);
      });
      ctx.fillStyle = '#86c46a';
      ctx.fillRect(0, gy, vw, vh - gy + 10);
      ctx.fillStyle = '#76b75c';
      ctx.fillRect(0, gy, vw, 6 * scale);
      // 꽃
      for (let i = 0; i < 14; i++) {
        const fx = (i * 97 + 30) % Math.max(1, vw);
        ctx.fillStyle = i % 2 ? '#fff6a6' : '#ffd1df';
        ctx.beginPath(); ctx.arc(fx, gy + 18 + (i % 3) * 10, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawStoneAt(type, x, ycenter, o) {
    ctx.save();
    ctx.translate(sx(x), sy(ycenter));
    ctx.scale(scale, scale);
    STONES.draw(ctx, type, 0, 0, o);
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground();

    // 흔들림: 균형이 아슬아슬할수록 탑이 살짝 흔들려요
    const sway = (state === 'hover' || state === 'falling') ? Math.max(0, 0.35 - minMargin) * 0.05 * Math.sin(time * 3.2) : 0;
    ctx.save();
    ctx.translate(sx(0), sy(0));
    ctx.rotate(sway);
    ctx.translate(-sx(0), -sy(0));
    // 받침돌 그림자
    ctx.fillStyle = 'rgba(40,60,30,0.2)';
    ctx.beginPath(); ctx.ellipse(sx(0), sy(0) + 4, 130 * scale, 12 * scale, 0, 0, Math.PI * 2); ctx.fill();
    stack.forEach(function (s, i) {
      const isTop = i === stack.length - 1 && i > 0;
      drawStoneAt(s.type, s.x, s.yb - s.type.h / 2, { seed: s.seed, face: i === 0 || isTop });
    });
    // 15층 깃발
    if (height() >= DATA.GAUGE_MAX) {
      const s = stack[DATA.GAUGE_MAX];
      const fx = sx(s.x + s.type.w / 2 + 8), fy = sy(s.yb - s.type.h / 2);
      ctx.font = Math.round(22 * scale) + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('🌟', fx, fy);
    }
    ctx.restore();

    // 움직이는 돌 + 낙하 안내선
    if (mover) {
      const ty = topY();
      if (state === 'hover') {
        ctx.strokeStyle = 'rgba(61,50,41,0.35)';
        ctx.setLineDash([6, 8]);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx(mover.x), sy(mover.yb)); ctx.lineTo(sx(mover.x), sy(ty)); ctx.stroke();
        ctx.setLineDash([]);
        const c = contact(stack[stack.length - 1], mover);
        ctx.fillStyle = c.r - c.l >= 2 ? 'rgba(92,184,122,0.55)' : 'rgba(240,90,90,0.55)';
        ctx.beginPath(); ctx.ellipse(sx(mover.x), sy(ty), mover.type.w * mover.type.bottom / 2 * scale, 5 * scale, 0, 0, Math.PI * 2); ctx.fill();
      }
      drawStoneAt(mover.type, mover.x, mover.yb - mover.type.h / 2, { seed: mover.seed, face: true });
    }

    debris.forEach(function (d) { drawStoneAt(d.type, d.x, d.y, { seed: d.seed, angle: d.ang }); });

    dust.forEach(function (p) {
      ctx.fillStyle = 'rgba(230,220,200,' + Math.max(0, p.life) * 0.8 + ')';
      ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), p.r * scale, 0, Math.PI * 2); ctx.fill();
    });

    leaves.forEach(function (l) {
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.r);
      ctx.fillStyle = '#7cc46a';
      ctx.beginPath(); ctx.ellipse(0, 0, 7, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });

    popups.forEach(function (p) {
      ctx.globalAlpha = Math.min(1, p.life);
      ctx.font = Math.round(20 * Math.max(scale, 0.8)) + 'px Jua, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(p.text, sx(p.x), sy(p.y));
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, sx(p.x), sy(p.y));
      ctx.globalAlpha = 1;
    });
  }

  /* ---------------- HUD ---------------- */

  function updateHud() {
    const h = height();
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

  function buildTray() {
    el.tray.innerHTML = '';
    STONES.TYPES.forEach(function (t, i) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tray-btn';
      b.dataset.id = t.id;
      b.title = t.name + ' — ' + t.tip;
      b.setAttribute('aria-label', t.name + ' (' + (i + 1) + '번): ' + t.tip);
      b.appendChild(STONES.icon(t, 54));
      const name = document.createElement('span');
      name.className = 'tray-name';
      name.textContent = t.name;
      const key = document.createElement('kbd');
      key.textContent = i + 1;
      b.appendChild(name);
      b.appendChild(key);
      b.addEventListener('click', function () { select(t.id); });
      el.tray.appendChild(b);
    });
  }

  function select(id) {
    selected = id;
    if (state === 'hover' && mover) mover.type = typeOf(id);
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
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = window.innerWidth; vh = window.innerHeight;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    bottomPad = (el.bottom.offsetHeight || 150) + 10;
    scale = Math.max(0.55, Math.min(1.35, Math.min(vw / 470, (vh - bottomPad - 150) / 560)));
  }

  function reset() {
    stack = [{ type: BASE, x: 0, yb: 0, seed: 0 }];
    debris = []; dust = []; popups = []; leaves = [];
    wind = 0; minMargin = 1; phase = 0; recorded = false; dropped = false;
    reached15 = tower.best >= DATA.GAUGE_MAX;
    state = 'hover';
    newMover();
    camY = (bottomPad - vh / 2) / scale;
    el.result.hidden = true;
    el.tip.classList.remove('hide');
    updateHud();
  }

  function close() {
    // 쌓던 중에 나가면 지금 높이를 조용히 기록
    let info = { height: 0, isRecord: false };
    if (!recorded && (state === 'hover' || state === 'falling') && height() > 0) {
      const r = Store.recordHeight(tower.id, height());
      info = { height: height(), isRecord: r.isRecord };
      recorded = true;
    }
    running = false;
    cancelAnimationFrame(rafId);
    el.scene.hidden = true;
    document.body.classList.remove('stacking');
    if (onClose) onClose(info);
  }

  function onKey(e) {
    if (!running) return;
    const tg = e.target;
    if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) return;
    if (state === 'result') {
      if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); reset(); }
      else if (e.code === 'Escape') close();
      return;
    }
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (!e.repeat) drop(); }
    else if (/^Digit[1-7]$/.test(e.code) || /^Numpad[1-7]$/.test(e.code)) {
      const n = parseInt(e.code.slice(-1), 10) - 1;
      select(STONES.TYPES[n].id);
    } else if (e.code === 'Escape') close();
  }

  function init() {
    el = {
      scene: $('stackScene'), canvas: $('stackCanvas'), tray: $('skTray'), bottom: $('skBottom'),
      skHeight: $('skHeight'), skBest: $('skBest'), skLevel: $('skLevel'), skWind: $('skWind'), skStab: $('skStab'),
      wish: $('skWish'), tip: $('skTip'), result: $('skResult'),
      rsEmoji: $('rsEmoji'), rsTitle: $('rsTitle'), rsHeight: $('rsHeight'), rsBest: $('rsBest'), rsRecord: $('rsRecord'),
      rsGaugeFill: $('rsGaugeFill'), rsGaugeLabel: $('rsGaugeLabel'), rsNote: $('rsNote'), rsRetry: $('rsRetry'), rsExit: $('rsExit')
    };
    canvas = el.canvas;
    ctx = canvas.getContext('2d');
    buildTray();
    select(selected);
    for (let i = 0; i < 7; i++) clouds.push({ x: Math.random() * 900, y: -i * 520 + 80 - Math.random() * 200, v: 8 + Math.random() * 14, s: 0.7 + Math.random() * 0.6 });
    for (let i = 0; i < 60; i++) stars.push({ x: Math.random(), y: Math.random() * 2000, r: 0.8 + Math.random() * 1.6, p: Math.random() * 6 });

    canvas.addEventListener('pointerdown', function (e) { e.preventDefault(); drop(); });
    $('skFinish').addEventListener('click', finish);
    $('skExit').addEventListener('click', close);
    el.rsRetry.addEventListener('click', reset);
    el.rsExit.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', function () { if (running) resize(); });
  }

  window.Stack = {
    /**
     * 돌 쌓기 시작
     * @param t  쌓을 돌탑(Store의 tower 객체)
     * @param cb 끝나고 캠퍼스로 돌아갈 때 호출 (info: {height, isRecord})
     */
    start: function (t, cb) {
      if (!el) init();
      tower = t;
      onClose = cb;
      const cat = DATA.category(t.cat);
      el.wish.textContent = cat.emoji + ' ' + t.wish;
      el.scene.hidden = false;
      document.body.classList.add('stacking');
      resize();
      reset();
      running = true;
      lastT = performance.now();
      rafId = requestAnimationFrame(loop);
    },
    isActive: function () { return running; },
    // 테스트·디버그용(읽기 전용) 상태 확인
    debug: function () {
      return { state: state, x: mover ? mover.x : null, height: height(), margin: minMargin, wind: wind };
    }
  };
})();
