/**
 * js/photo.js — 돌탑 인증샷 (폴라로이드)
 *
 *  - 화면 오른쪽 아래 📷 버튼을 누르면 찰칵! 지금 화면을 폴라로이드 사진으로 만들어요.
 *  - 사진 아래에는 장소·날짜·닉네임(가까운 돌탑이 있으면 돌탑 정보)이 손글씨처럼 들어가요.
 *  - 💾 사진 저장: PNG 파일로 내려받아요 (폰에서 공유 기능이 있으면 📤 공유도 돼요).
 *  - 3D(Campus.snapshot)와 2D 지도(#campus 캔버스) 둘 다 동작해요.
 */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  let btn, overlay, img, saveBtn, shareBtn, closeBtn, flash;
  let lastBlob = null, lastUrl = '', lastName = '';

  /* ---------------- 화면 만들기 ---------------- */

  function build() {
    btn = document.createElement('button');
    btn.id = 'btnPhoto';
    btn.className = 'photo-btn';
    btn.type = 'button';
    btn.title = '돌탑 인증샷 찍기 (P)';
    btn.setAttribute('aria-label', '돌탑 인증샷 찍기');
    btn.textContent = '📷';
    // 음악 버튼 옆 칸에 넣어요
    (document.querySelector('.zoom') || document.body).appendChild(btn);

    flash = document.createElement('div');
    flash.className = 'photo-flash';
    document.body.appendChild(flash);

    overlay = document.createElement('div');
    overlay.className = 'photo-overlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', '찍은 인증샷');
    overlay.innerHTML =
      '<div class="photo-card">' +
      '  <img class="photo-img" alt="돌탑 인증샷 폴라로이드 사진">' +
      '  <div class="photo-actions">' +
      '    <button class="btn" type="button" data-act="close">다시 찍기</button>' +
      '    <button class="btn" type="button" data-act="share" hidden>📤 공유</button>' +
      '    <button class="btn primary" type="button" data-act="save">💾 사진 저장</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(overlay);
    img = overlay.querySelector('.photo-img');
    saveBtn = overlay.querySelector('[data-act="save"]');
    shareBtn = overlay.querySelector('[data-act="share"]');
    closeBtn = overlay.querySelector('[data-act="close"]');

    btn.addEventListener('click', shoot);
    saveBtn.addEventListener('click', save);
    shareBtn.addEventListener('click', share);
    closeBtn.addEventListener('click', closeView);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeView(); });
    window.addEventListener('keydown', onKey, true); // 사진을 보는 동안 다른 단축키는 막아요
  }

  function onKey(e) {
    const tg = e.target;
    if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) return;
    if (!overlay.hidden) {
      // 버튼 위 Enter/Space는 그대로 눌리고, 게임 단축키로는 안 넘어가요
      e.stopImmediatePropagation();
      if (e.code === 'Escape') closeView();
      return;
    }
    if (e.code === 'KeyP' && canShoot()) shoot();
  }

  function canShoot() {
    if (document.body.classList.contains('stacking')) return false;
    if (document.querySelector('.layer.open')) return false;
    return true;
  }

  /* ---------------- 촬영 ---------------- */

  function sourceCanvas() {
    if (window.Campus && Campus.snapshot) return Campus.snapshot();
    return $('campus');
  }

  function shoot() {
    if (!canShoot()) return;
    const src = sourceCanvas();
    if (!src || !src.width) { toast('지금은 사진을 찍을 수 없어요 😢'); return; }
    let out;
    try { out = compose(src); } catch (err) {
      console.warn('[인증샷]', err);
      toast('사진을 만들지 못했어요 😢');
      return;
    }
    // 찰칵 효과
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');

    out.toBlob(function (blob) {
      if (!blob) { toast('사진을 만들지 못했어요 😢'); return; }
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastBlob = blob;
      lastUrl = URL.createObjectURL(blob);
      lastName = fileName();
      img.src = lastUrl;
      shareBtn.hidden = !canShareFile(blob);
      openView();
    }, 'image/png');
  }

  // 폴라로이드: 흰 테두리 + 정사각형 사진 + 아래 넓은 여백에 손글씨
  function compose(src) {
    const W = 1080, PAD = 54, PH = W - PAD * 2, BOTTOM = 250;
    const H = PAD + PH + BOTTOM;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');

    // 종이
    g.fillStyle = '#fbf8f1';
    g.fillRect(0, 0, W, H);

    // 사진: 화면 가운데를 정사각형으로 잘라요 (위아래 HUD·버튼은 피해서 살짝 위쪽)
    const sw = src.width, sh = src.height;
    const side = Math.min(sw, sh) * (sw > sh ? 0.92 : 0.96);
    const sx = (sw - side) / 2;
    const sy = Math.max(0, Math.min(sh - side, (sh - side) / 2 - sh * 0.02));
    g.save();
    if ('filter' in g) g.filter = 'saturate(1.12) contrast(1.05) brightness(1.03)';
    g.drawImage(src, sx, sy, side, side, PAD, PAD, PH, PH);
    g.restore();

    // 필름 느낌: 따뜻한 빛 + 가장자리 어둡게
    g.save();
    g.globalCompositeOperation = 'soft-light';
    g.fillStyle = 'rgba(255, 196, 120, .35)';
    g.fillRect(PAD, PAD, PH, PH);
    g.restore();
    const vg = g.createRadialGradient(W / 2, PAD + PH / 2, PH * 0.35, W / 2, PAD + PH / 2, PH * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(40,25,10,.32)');
    g.fillStyle = vg;
    g.fillRect(PAD, PAD, PH, PH);
    g.strokeStyle = 'rgba(0,0,0,.08)';
    g.lineWidth = 2;
    g.strokeRect(PAD, PAD, PH, PH);

    // 글귀
    const info = caption();
    const y0 = PAD + PH;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#3d3229';
    g.font = '64px "Gowun Dodum", "Jua", sans-serif';
    fitText(g, info.title, W / 2, y0 + 92, W - PAD * 2, 64);
    g.fillStyle = '#8a7a68';
    g.font = '38px "Gowun Dodum", sans-serif';
    fitText(g, info.sub, W / 2, y0 + 172, W - PAD * 2, 38);
    // 작은 돌 도장
    g.font = '42px sans-serif';
    g.textAlign = 'right';
    g.fillText('🪨', W - PAD, y0 + 214);
    return c;
  }

  function fitText(g, text, x, y, maxW, size) {
    let s = size;
    const fam = g.font.replace(/^\d+px\s*/, '');
    while (s > 20 && g.measureText(text).width > maxW) {
      s -= 2;
      g.font = s + 'px ' + fam;
    }
    g.fillText(text, x, y);
  }

  function caption() {
    const loc = ($('locLabel') && $('locLabel').textContent.trim()) || '충북대학교';
    const name = ($('profileName') && $('profileName').textContent.trim()) || '';
    const d = new Date();
    const date = d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
    const tw = nearTower();
    let title = '📍 ' + loc;
    if (tw) title = '🪨 ' + (tw.name || '익명') + '의 돌탑' + (tw.best ? ' · ' + tw.best + '층' : '');
    const bits = [date];
    if (tw && tw.wish) bits.push('“' + tw.wish + '”');
    else if (tw) bits.push(loc);
    if (name && name !== '이름 없음') bits.push('with ' + name);
    return { title: title, sub: bits.join('  ·  ') };
  }

  // 내 캐릭터 가까이(화면 안)에 있는 돌탑
  function nearTower() {
    if (!window.Campus || !Campus.playerPos || !window.Store) return null;
    const p = Campus.playerPos();
    let best = null, bd = 160;
    (Store.towers() || []).forEach(function (t) {
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      if (d < bd) { bd = d; best = t; }
    });
    return best;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function fileName() {
    const d = new Date();
    return '돌탑인증샷_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.png';
  }

  /* ---------------- 보기 · 저장 ---------------- */

  function openView() {
    overlay.hidden = false;
    document.body.classList.add('photo-open');
    if (window.Campus && Campus.pause) Campus.pause();
    requestAnimationFrame(function () { overlay.classList.add('show'); });
    saveBtn.focus();
  }

  function closeView() {
    overlay.classList.remove('show');
    overlay.hidden = true;
    document.body.classList.remove('photo-open');
    if (window.Campus && Campus.resume) Campus.resume();
    btn.focus();
  }

  // 사진 저장: PNG 파일로 내려받기
  function save() {
    if (!lastBlob) return;
    const a = document.createElement('a');
    a.href = lastUrl;
    a.download = lastName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('📸 인증샷을 저장했어요!');
  }

  function canShareFile(blob) {
    try {
      const f = new File([blob], 'photo.png', { type: 'image/png' });
      return !!(navigator.canShare && navigator.canShare({ files: [f] }));
    } catch (err) { return false; }
  }

  function share() {
    if (!lastBlob) return;
    const f = new File([lastBlob], lastName, { type: 'image/png' });
    navigator.share({ files: [f], title: '돌탑 인증샷', text: '사이버 돌탑에서 찍은 인증샷 🪨' })
      .catch(function () { /* 취소 */ });
  }

  function toast(msg) { if (window.App && App.toast) App.toast(msg); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
