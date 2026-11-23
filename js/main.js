/* =========================================================
 * main.js — 화면(HTML)과 게임을 연결하는 시작 파일
 *  - 처음 방문 → 닉네임·색 고르기
 *  - 돌탑 세우기 → 소원 작성 → 돌 쌓기(Stack)
 *  - 돌탑 상세 / 목록 / 도움말 / 좋아요·응원
 * ========================================================= */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };

  let profileColor = DATA.COLORS[0];
  let profileLook = DATA.normLook(null);   // { hair, face } 캐릭터 꾸미기
  let wishCat = DATA.CATEGORIES[0].id;
  let wishMode = 'create';     // create | edit
  let currentTowerId = null;   // 열려 있는 상세 돌탑
  let listSort = 'height';
  let listCat = 'all';
  let toastTimer = 0;
  let welcomeFirst = false;    // 처음 입장(랜덤 프로필을 막 만든 상태)

  /* ---------------- 공통 UI ---------------- */

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function openLayer(id) {
    document.querySelectorAll('.layer.open').forEach(function (l) {
      if (l.id !== id) l.classList.remove('open');
    });
    $(id).classList.add('open');
    $('backdrop').classList.add('show');
  }

  function closeLayers() {
    // 프로필이 없으면 첫 화면은 닫을 수 없어요
    if (!Store.getProfile() && $('mWelcome').classList.contains('open')) return;
    document.querySelectorAll('.layer.open').forEach(function (l) { l.classList.remove('open'); });
    $('backdrop').classList.remove('show');
    currentTowerId = null;
    Campus.highlight(null);
  }

  function anyLayerOpen() { return !!document.querySelector('.layer.open'); }

  function setGauge(fillEl, labelEl, best) {
    const g = DATA.gauge(best);
    fillEl.style.width = g.pct + '%';
    fillEl.classList.toggle('full', g.pct >= 100);
    if (labelEl) labelEl.textContent = g.label;
  }

  /* ---------------- 상단 HUD ---------------- */

  function refreshHud() {
    const p = Store.getProfile();
    $('profileName').textContent = p ? p.name : '이름 없음';
    $('profileDot').style.background = p ? p.color : '#ccc';
    const mine = Store.myTower();
    $('myBest').textContent = mine ? mine.best + '층' : '-';
    setGauge($('myGaugeFill'), $('myGaugeLabel'), mine ? mine.best : 0);
    if (!mine) $('myGaugeLabel').textContent = '돌탑을 쌓아 소원을 빌어요';
    $('btnBuild').innerHTML = mine ? '🪨 <span class="lbl">내 돌탑 </span>다시 쌓기' : '🪨 여기에 돌탑 쌓기';
    $('btnGoMine').hidden = !mine;
    Campus.setTowers(Store.towers());
  }

  function refreshNet() {
    const b = $('netBadge');
    const online = Store.onlineStatus ? Store.onlineStatus() : 'off';
    if (online === 'online') {
      b.textContent = '🌐 모두와 공유 중';
      b.className = 'badge ok';
      b.title = '돌탑이 서버에 저장되고 다른 사람의 돌탑도 함께 보여요.';
    } else if (online === 'connecting') {
      b.textContent = '연결 중…';
      b.className = 'badge';
      b.title = '서버에 연결하고 있어요.';
    } else if (online === 'readonly') {
      b.textContent = '👀 구경만 가능 · 내 기기에 저장';
      b.className = 'badge warn';
      b.title = '다른 사람의 돌탑은 보이지만, 로그인이 안 돼서 내 돌탑은 이 브라우저에만 저장돼요.';
    } else if (online === 'offline') {
      b.textContent = '⚠️ 오프라인 · 내 기기에 저장';
      b.className = 'badge warn';
      b.title = '서버에 연결하지 못했어요. 기록은 이 브라우저에 저장되고, 연결되면 다시 올려요.';
    } else if (Store.isPersistent()) {
      b.textContent = '💾 내 기기에 저장';
      b.className = 'badge ok';
      b.title = '기록은 이 브라우저에 저장돼요(서버 없이 동작).';
    } else {
      b.textContent = '⚠️ 임시 저장';
      b.className = 'badge warn';
      b.title = '이 브라우저에서는 저장을 할 수 없어 새로고침하면 기록이 사라져요.';
    }
  }

  /* ---------------- 처음 방문(프로필) ---------------- */

  function buildSwatches() {
    const box = $('colorPick');
    box.innerHTML = '';
    DATA.COLORS.forEach(function (c) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = c;
      b.dataset.color = c;
      b.setAttribute('aria-label', '캐릭터 색 ' + c);
      b.addEventListener('click', function () { pickColor(c); });
      box.appendChild(b);
    });
  }

  function pickColor(c) {
    profileColor = c;
    document.querySelectorAll('#colorPick .swatch').forEach(function (b) {
      b.classList.toggle('on', b.dataset.color === c);
    });
    renderDeco();
  }

  /* ---------------- 캐릭터 꾸미기 ---------------- */

  const decoOpts = [];   // { kind, id, btn, cv }

  function buildDeco() {
    [['hair', DATA.HAIRS, 'hairPick'], ['face', DATA.FACES, 'facePick']].forEach(function (g) {
      const box = $(g[2]);
      box.innerHTML = '';
      g[1].forEach(function (o) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'deco-opt';
        b.setAttribute('role', 'radio');
        b.title = o.label;
        const cv = document.createElement('canvas');
        const lb = document.createElement('span');
        lb.textContent = o.label;
        b.appendChild(cv);
        b.appendChild(lb);
        b.addEventListener('click', function () {
          profileLook[g[0]] = o.id;
          renderDeco();
        });
        box.appendChild(b);
        decoOpts.push({ kind: g[0], id: o.id, btn: b, cv: cv });
      });
    });
  }

  // 머리색 동그라미
  function buildHairColors() {
    const box = $('hairColorPick');
    if (!box) return;
    box.innerHTML = '';
    DATA.HAIR_COLORS.forEach(function (c) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = c.hex;
      b.dataset.id = c.id;
      b.title = c.label;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', '머리색 ' + c.label);
      b.addEventListener('click', function () { profileLook.hairColor = c.id; renderDeco(); });
      box.appendChild(b);
    });
  }

  // 미리보기 + 선택 버튼 그림을 지금 고른 색·머리·표정으로 다시 그려요
  function renderDeco() {
    if (!window.AVATAR || !$('decoPreview')) return;
    AVATAR.preview($('decoPreview'), { color: profileColor, hair: profileLook.hair, face: profileLook.face, hairColor: profileLook.hairColor });
    document.querySelectorAll('#hairColorPick .swatch').forEach(function (b) {
      const on = b.dataset.id === profileLook.hairColor;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    decoOpts.forEach(function (o) {
      const on = profileLook[o.kind] === o.id;
      o.btn.classList.toggle('on', on);
      o.btn.setAttribute('aria-checked', on ? 'true' : 'false');
      const look = { color: profileColor, hair: profileLook.hair, face: profileLook.face, hairColor: profileLook.hairColor, headOnly: true };
      look[o.kind] = o.id;
      AVATAR.preview(o.cv, look);
    });
  }

  function openWelcome() {
    const p = Store.getProfile();
    $('inName').value = p ? p.name : '';
    profileLook = DATA.normLook(p);
    $('btnStart').textContent = welcomeFirst ? '이 이름으로 입장하기' : '저장하기';
    openLayer('mWelcome');
    pickColor(p ? p.color : DATA.COLORS[Math.floor(Math.random() * DATA.COLORS.length)]);   // 창이 열린 뒤 그려야 크기가 맞아요
    setTimeout(function () { $('inName').focus(); }, 100);
  }

  // 🎲 버튼: 닉네임과 색을 새로 뽑아요 (저장은 '저장하기'를 눌러야)
  function rerollProfile() {
    $('inName').value = DATA.randomNickname();
    pickColor(DATA.randomColor(profileColor));
  }

  // 처음 입장: 랜덤 닉네임·색을 바로 저장해서, 창을 그냥 닫거나
  // 새로고침해도 같은 프로필이 유지돼요(재접속 시 그대로 사용).
  function ensureProfile() {
    let p = Store.getProfile();
    if (p && p.name && p.color) return { profile: p, created: false };
    Store.setProfile(DATA.randomNickname(), DATA.randomColor(), DATA.randomLook());
    return { profile: Store.getProfile(), created: true };
  }

  function submitWelcome() {
    const name = $('inName').value.trim().replace(/\s+/g, ' ');
    if (!name) { toast('닉네임을 입력해 주세요 🙂'); $('inName').focus(); return; }
    const first = welcomeFirst;
    welcomeFirst = false;
    Store.setProfile(name.slice(0, 10), profileColor, profileLook);
    Campus.setPlayer(name.slice(0, 10), profileColor, profileLook);
    refreshHud();
    closeLayers();
    toast(first ? name + '님, 환영해요! 마음에 드는 잔디밭을 찾아가 보세요 🌿' : '프로필을 바꿨어요');
  }

  /* ---------------- 소원 작성 ---------------- */

  function buildCats() {
    const box = $('catPick');
    box.innerHTML = '';
    DATA.CATEGORIES.forEach(function (c) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat';
      b.dataset.cat = c.id;
      b.style.setProperty('--c', c.color);
      b.textContent = c.emoji + ' ' + c.label;
      b.addEventListener('click', function () { pickCat(c.id); });
      box.appendChild(b);
    });
  }

  function pickCat(id) {
    wishCat = id;
    document.querySelectorAll('#catPick .cat').forEach(function (b) { b.classList.toggle('on', b.dataset.cat === id); });
  }

  function updateWishCount() {
    $('wishCount').textContent = $('inWish').value.length + '/60';
  }

  function openWish(mode) {
    wishMode = mode;
    const mine = Store.myTower();
    if (mode === 'edit' && mine) {
      pickCat(mine.cat);
      $('inWish').value = mine.wish;
      $('wishTitle').textContent = '소원을 고쳐 볼까요?';
      $('btnWishOk').textContent = '저장하기';
    } else {
      pickCat(DATA.CATEGORIES[0].id);
      $('inWish').value = '';
      $('wishTitle').textContent = '어떤 소원을 빌까요?';
      $('btnWishOk').textContent = '돌 쌓으러 가기';
    }
    updateWishCount();
    openLayer('mWish');
    setTimeout(function () { $('inWish').focus(); }, 100);
  }

  function submitWish() {
    const wish = $('inWish').value.trim().replace(/\s+/g, ' ');
    if (!wish) { toast('소원을 한 줄 적어 주세요 ✍️'); $('inWish').focus(); return; }
    if (wishMode === 'edit') {
      const mine = Store.myTower();
      if (mine) Store.updateWish(mine.id, wishCat, wish);
      refreshHud();
      if (mine) openTower(mine.id); else closeLayers();
      toast('소원을 고쳤어요 ✏️');
      return;
    }
    const check = Campus.canBuildHere();
    if (!check.ok) { closeLayers(); toast(check.reason); return; }
    if (Store.myTower()) { closeLayers(); refreshHud(); toast('돌탑은 한 사람당 1개만 세울 수 있어요 🪨'); return; }
    const p = Campus.getPlayer();
    const t = Store.createTower({ x: p.x, y: p.y, cat: wishCat, wish: wish });
    if (!t) { closeLayers(); refreshHud(); toast('돌탑은 한 사람당 1개만 세울 수 있어요 🪨'); return; }
    refreshHud();
    closeLayers();
    startStacking(t);
  }

  /* ---------------- 돌 쌓기 ---------------- */

  function startStacking(t) {
    closeLayers();
    Campus.pause();
    Stack.start(t, function (info) {
      Campus.resume();
      refreshHud();
      Campus.highlight(t.id);
      if (info && info.height > 0) toast(info.isRecord ? '🏆 새 최고 기록 ' + info.height + '층 저장!' : '이번 기록 ' + info.height + '층 (최고 ' + Store.getTower(t.id).best + '층)');
      setTimeout(function () { Campus.highlight(null); }, 2500);
    });
  }

  function onBuild() {
    if (!Store.getProfile()) { openWelcome(); return; }
    const mine = Store.myTower();
    if (mine) { startStacking(mine); return; }
    const check = Campus.canBuildHere();
    if (!check.ok) { toast(check.reason); return; }
    openWish('create');
  }

  /* ---------------- 내 돌탑 위치 ---------------- */

  const M_PER_PX = 0.1; // 게임 좌표 1px ≈ 0.1m

  function distText(px) {
    const m = Math.round(px * M_PER_PX);
    return m < 1000 ? m + 'm' : (m / 1000).toFixed(1) + 'km';
  }

  function placeOf(t) {
    return Campus.locationOf ? Campus.locationOf(t.x, t.y) : '';
  }

  // 내 돌탑 바로 앞으로 이동
  function goToMine() {
    const mine = Store.myTower();
    if (!mine) { toast('아직 내 돌탑이 없어요. 잔디밭에서 ‘여기에 돌탑 쌓기’를 눌러 보세요!'); return; }
    closeLayers();
    if (Campus.teleport) Campus.teleport(mine.x, mine.y);
    else Campus.focus(mine.x, mine.y);
    Campus.highlight(mine.id);
    const place = placeOf(mine);
    toast('📍 내 돌탑 앞으로 왔어요' + (place ? ' · ' + place : ''));
    setTimeout(function () { if (!currentTowerId) Campus.highlight(null); }, 2500);
  }

  // 내 돌탑이 화면 밖이면 가장자리에 방향 화살표 표시
  function updateMyArrow() {
    requestAnimationFrame(updateMyArrow);
    const el = $('myArrow');
    const mine = Store.myTower();
    const pos = mine && Campus.screenPos ? Campus.screenPos(mine.x, mine.y) : null;
    const busy = anyLayerOpen() || (window.Stack && Stack.isActive && Stack.isActive());
    const w = window.innerWidth, h = window.innerHeight;
    const top = 120, bottom = h - 110, left = 44, right = w - 44;
    const onScreen = pos && !pos.behind && pos.x > 0 && pos.x < w && pos.y > 60 && pos.y < h - 70;
    if (!pos || busy || onScreen || right <= left || bottom <= top) { if (!el.hidden) el.hidden = true; return; }
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    let dx = pos.x - cx, dy = pos.y - cy;
    if (Math.abs(dx) + Math.abs(dy) < 1) dy = 1;
    const k = Math.min((right - cx) / Math.max(Math.abs(dx), 1e-6), (bottom - cy) / Math.max(Math.abs(dy), 1e-6));
    const x = cx + dx * k, y = cy + dy * k;
    const ang = Math.atan2(dy, dx);
    if (el.hidden) el.hidden = false;
    el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-50%)';
    el.querySelector('.arr').style.transform = 'rotate(' + ang.toFixed(3) + 'rad)';
    const p = Campus.getPlayer();
    const txt = '⭐ 내 돌탑 · ' + distText(Math.hypot(mine.x - p.x, mine.y - p.y));
    const t = $('myArrowText');
    if (t.textContent !== txt) t.textContent = txt;
  }

  /* ---------------- 돌탑 상세 ---------------- */

  function openTower(id) {
    const t = Store.getTower(id);
    if (!t) return;
    currentTowerId = id;
    Campus.highlight(id);
    const cat = DATA.category(t.cat);
    const mine = Store.isMine(id);
    $('twCat').textContent = cat.emoji + ' ' + cat.label;
    $('twCat').style.background = cat.color;
    $('twMine').hidden = !mine;
    $('twDemo').hidden = !t.demo;
    $('twName').textContent = t.name + '님의 돌탑';
    $('twWish').textContent = '“' + t.wish + '”';
    const place = placeOf(t);
    const me = Campus.getPlayer();
    $('twLoc').textContent = '📍 ' + (place || '캠퍼스') + ' · 여기서 약 ' + distText(Math.hypot(t.x - me.x, t.y - me.y));
    $('twHeight').textContent = t.best + '층';
    setGauge($('twGaugeFill'), $('twGaugeLabel'), t.best);
    $('twOwner').hidden = !mine;
    renderLike(t);
    renderCheers(t);
    $('twTime').textContent = '처음 세운 날 ' + DATA.timeAgo(t.createdAt) + ' · 마지막 기록 ' + DATA.timeAgo(t.updatedAt);
    $('inCheer').value = '';
    openLayer('sTower');
  }

  function renderLike(t) {
    const liked = Store.isLiked(t.id);
    $('twLike').classList.toggle('on', liked);
    $('twLike').firstChild.textContent = (liked ? '♥ ' : '♡ ');
    $('twLikeCount').textContent = t.likes;
  }

  function renderCheers(t) {
    const ul = $('twCheers');
    ul.innerHTML = '';
    if (!t.cheers.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '아직 응원이 없어요. 첫 응원을 남겨 주세요!';
      ul.appendChild(li);
      return;
    }
    t.cheers.forEach(function (c) {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = c.name;
      const span = document.createElement('span');
      span.textContent = c.text;
      const small = document.createElement('small');
      small.textContent = DATA.timeAgo(c.t);
      li.appendChild(b); li.appendChild(span); li.appendChild(small);
      ul.appendChild(li);
    });
  }

  function sendCheer(text) {
    if (!currentTowerId) return;
    text = (text || '').trim();
    if (!text) { toast('응원 한마디를 적어 주세요 💬'); return; }
    if (!Store.getProfile()) { openWelcome(); return; }
    Store.addCheer(currentTowerId, text.slice(0, 40));
    renderCheers(Store.getTower(currentTowerId));
    $('inCheer').value = '';
    toast('응원을 남겼어요 💌');
  }

  function buildQuickCheers() {
    const box = $('quickCheers');
    box.innerHTML = '';
    DATA.QUICK_CHEERS.forEach(function (q) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip-btn';
      b.textContent = q;
      b.addEventListener('click', function () { sendCheer(q); });
      box.appendChild(b);
    });
  }

  /* ---------------- 돌탑 목록 ---------------- */

  function buildListCats() {
    const box = $('listCats');
    box.innerHTML = '';
    [{ id: 'all', label: '전체', emoji: '🌈' }].concat(DATA.CATEGORIES).forEach(function (c) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip-btn';
      b.dataset.cat = c.id;
      b.textContent = c.emoji + ' ' + c.label;
      b.addEventListener('click', function () { listCat = c.id; renderList(); });
      box.appendChild(b);
    });
  }

  function renderList() {
    document.querySelectorAll('#listTabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.sort === listSort); });
    document.querySelectorAll('#listCats .chip-btn').forEach(function (b) { b.classList.toggle('on', b.dataset.cat === listCat); });
    const all = Store.towers();
    const items = all.filter(function (t) { return listCat === 'all' || t.cat === listCat; });
    items.sort(function (a, b) {
      if (listSort === 'likes') return b.likes - a.likes || b.best - a.best;
      if (listSort === 'recent') return b.updatedAt - a.updatedAt;
      return b.best - a.best || b.likes - a.likes;
    });
    const done = all.filter(function (t) { return t.best >= DATA.GAUGE_MAX; }).length;
    $('listSummary').textContent = '캠퍼스에 돌탑 ' + all.length + '개 · 소원 기원 완료 ' + done + '개';
    const ol = $('listItems');
    ol.innerHTML = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '이 카테고리에는 아직 돌탑이 없어요.';
      ol.appendChild(li);
      return;
    }
    items.forEach(function (t, i) {
      const cat = DATA.category(t.cat);
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tower-item' + (Store.isMine(t.id) ? ' mine' : '');
      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = listSort === 'recent' ? cat.emoji : (i < 3 ? ['🥇', '🥈', '🥉'][i] : (i + 1));
      const body = document.createElement('span');
      body.className = 'body';
      const nm = document.createElement('b');
      nm.textContent = t.name + (Store.isMine(t.id) ? ' (나)' : '');
      const ws = document.createElement('small');
      ws.textContent = cat.emoji + ' ' + t.wish;
      body.appendChild(nm); body.appendChild(ws);
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.innerHTML = '<b></b><small></small>';
      meta.firstChild.textContent = t.best + '층';
      meta.lastChild.textContent = '♥ ' + t.likes;
      btn.appendChild(rank); btn.appendChild(body); btn.appendChild(meta);
      btn.addEventListener('click', function () {
        Campus.focus(t.x, t.y);
        openTower(t.id);
      });
      li.appendChild(btn);
      ol.appendChild(li);
    });
  }

  /* ---------------- 내 돌탑 지우기 ---------------- */
  //  3D 화면(index3d.html)에만 버튼이 있어요. 없으면 조용히 건너뛰어요.

  let deleting = false;

  function askDeleteTower() {
    const mine = Store.myTower();
    if (!mine || !$('mDelTower')) return;
    $('delTowerWish').textContent = '“' + mine.wish + '” · 최고 ' + mine.best + '층';
    openLayer('mDelTower');
  }

  function confirmDeleteTower() {
    if (deleting || !Store.removeMyTower) return;
    deleting = true;
    const btn = $('btnDelTowerOk');
    btn.disabled = true;
    btn.textContent = '지우는 중…';
    Store.removeMyTower().then(function (r) {
      deleting = false;
      btn.disabled = false;
      btn.textContent = '🗑 지우기';
      if (!r.ok) { toast(r.error || '지우지 못했어요'); return; }
      closeLayers();
      refreshHud();
      toast('돌탑을 지웠어요. 새 돌탑을 세울 수 있어요 🌱');
    });
  }

  /* ---------------- 계정: 다른 기기에서 이어 하기 ---------------- */

  let codeMode = null;   // 'link' | 'login'
  let codeEmail = '';
  let accBusy = false;

  function hasAccountUi() { return !!$('mAccount') && !!Store.account && Store.account().enabled; }

  function renderAccountChip() {
    const b = $('btnAccount');
    if (!b) return;
    if (!hasAccountUi()) { b.hidden = true; return; }
    const a = Store.account();
    b.hidden = false;
    b.textContent = a.anonymous ? '🔐 기기 연결' : '✅ ' + a.email;
    b.title = a.anonymous ? '이메일을 연결하면 다른 기기에서도 내 돌탑을 이어서 쌓을 수 있어요' : '이메일 계정으로 로그인돼 있어요';
  }

  function renderAccount() {
    if (!hasAccountUi()) return;
    const a = Store.account();
    const linked = a.signedIn && !a.anonymous;
    $('accLinked').hidden = !linked;
    $('accLink').hidden = linked || !!codeMode;
    $('accLogin').hidden = linked || !!codeMode;
    $('accCode').hidden = linked || !codeMode;
    if (linked) {
      $('accStatus').textContent = '이 기기는 ' + a.email + ' 계정으로 로그인돼 있어요. 다른 기기에서도 같은 이메일로 로그인하면 내 돌탑이 그대로 보여요.';
    } else if (codeMode) {
      $('accStatus').textContent = codeEmail + '(으)로 인증 메일을 보냈어요.';
      $('accCodeMsg').textContent = codeMode === 'link'
        ? '메일의 링크를 누르거나, 메일에 있는 숫자 코드를 입력하면 이메일이 연결돼요. (지금 돌탑은 그대로예요)'
        : '메일의 링크를 누르거나, 메일에 있는 숫자 코드를 입력하면 원래 계정으로 로그인돼요.';
    } else {
      $('accStatus').textContent = a.pendingEmail
        ? a.pendingEmail + ' 인증을 기다리는 중이에요. 메일을 확인해 주세요.'
        : '지금은 이 브라우저에서만 쓰는 익명 계정이에요. 이메일을 연결해 두면 다른 기기에서도 같은 사람으로 이어 할 수 있어요.';
    }
  }

  function openAccount() {
    if (!hasAccountUi()) return;
    if (Store.reloadAccount) Store.reloadAccount();
    renderAccount();
    openLayer('mAccount');
  }

  function accRun(btn, job, onOk) {
    if (accBusy) return;
    accBusy = true;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '잠시만요…';
    job().then(function (r) {
      accBusy = false;
      btn.disabled = false;
      btn.textContent = label;
      if (!r || !r.ok) { toast((r && r.error) || '실패했어요'); return; }
      onOk(r);
      renderAccount();
      renderAccountChip();
    });
  }

  function bindAccount() {
    if (!$('mAccount') || !$('btnAccount')) return;
    $('btnAccount').addEventListener('click', openAccount);
    $('btnAccClose').addEventListener('click', closeLayers);
    $('btnLinkSend').addEventListener('click', function () {
      const email = $('inLinkEmail').value;
      accRun(this, function () { return Store.linkEmail(email); }, function () {
        codeMode = 'link'; codeEmail = email.trim().toLowerCase(); $('inCode').value = '';
        toast('인증 메일을 보냈어요 📧');
      });
    });
    $('btnLoginSend').addEventListener('click', function () {
      const email = $('inLoginEmail').value;
      accRun(this, function () { return Store.sendLoginCode(email); }, function () {
        codeMode = 'login'; codeEmail = email.trim().toLowerCase(); $('inCode').value = '';
        toast('로그인 메일을 보냈어요 📧');
      });
    });
    $('btnCodeOk').addEventListener('click', function () {
      const mode = codeMode, code = $('inCode').value;
      accRun(this, function () { return Store.verifyCode(mode, codeEmail, code); }, function () {
        codeMode = null;
        toast(mode === 'link' ? '✅ 이메일을 연결했어요! 다른 기기에서도 로그인할 수 있어요' : '✅ 로그인했어요! 내 돌탑을 불러올게요');
      });
    });
    $('btnCodeBack').addEventListener('click', function () { codeMode = null; renderAccount(); });
    $('btnLogout').addEventListener('click', function () {
      if (!window.confirm('로그아웃할까요?\n돌탑은 이메일 계정에 그대로 남고, 같은 이메일로 다시 로그인하면 이어서 할 수 있어요.')) return;
      accRun(this, function () { return Store.signOut(); }, function () {
        closeLayers();
        toast('로그아웃했어요');
      });
    });
  }

  /* ---------------- 실시간 함께 보기 · 말풍선 ---------------- */
  //  3D 화면 + Supabase 연결이 있을 때만 켜져요(2D·오프라인이면 💬 버튼이 안 보여요)

  let liveOn = false;

  function setupLive() {
    if (!window.Live || !Campus.upsertPeer || !$('btnChat')) return;
    liveOn = Live.start({
      getSelf: Campus.getPlayerState,
      onPeer: Campus.upsertPeer,
      onLeave: Campus.removePeer,
      onSay: Campus.showBubble,
      onCount: function (n) { $('peerCount').textContent = n > 0 ? String(n) : ''; }
    });
    $('btnChat').hidden = !liveOn;
    if (!liveOn) return;
    $('btnChat').addEventListener('click', function () {
      if ($('chatBar').hidden) openChat(); else closeChat();
    });
    $('chatBar').addEventListener('submit', function (e) {
      e.preventDefault();
      const r = Live.say($('inChat').value);
      if (!r.ok) { toast(r.reason); return; }
      $('inChat').value = '';
    });
    $('inChat').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeChat(); }
    });
  }

  function openChat() {
    $('chatBar').hidden = false;
    $('inChat').focus();
  }

  function closeChat() {
    $('chatBar').hidden = true;
    $('inChat').blur();
  }

  /* ---------------- 시작 ---------------- */

  function bind() {
    $('btnStart').addEventListener('click', submitWelcome);
    $('inName').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitWelcome(); } });
    $('profileChip').addEventListener('click', openWelcome);
    $('btnRandomName').addEventListener('click', rerollProfile);

    $('btnBuild').addEventListener('click', onBuild);
    $('btnList').addEventListener('click', function () { renderList(); openLayer('sList'); });
    $('btnHelp').addEventListener('click', function () { openLayer('mHelp'); });
    $('btnHelpClose').addEventListener('click', closeLayers);
    $('btnGoMine').addEventListener('click', goToMine);
    $('myArrow').addEventListener('click', goToMine);
    $('myCard').addEventListener('click', function () {
      const mine = Store.myTower();
      if (mine) { Campus.focus(mine.x, mine.y); openTower(mine.id); }
      else toast('아직 내 돌탑이 없어요. 잔디밭에서 ‘여기에 돌탑 쌓기’를 눌러 보세요!');
    });

    $('zoomIn').addEventListener('click', function () { Campus.zoomBy(1.2); });
    $('zoomOut').addEventListener('click', function () { Campus.zoomBy(1 / 1.2); });

    $('inWish').addEventListener('input', updateWishCount);
    $('btnWishCancel').addEventListener('click', function () {
      const mine = Store.myTower();
      if (wishMode === 'edit' && mine) openTower(mine.id); else closeLayers();
    });
    $('btnWishOk').addEventListener('click', submitWish);

    $('twLike').addEventListener('click', function () {
      if (!currentTowerId) return;
      const r = Store.toggleLike(currentTowerId);
      if (!r) return;
      renderLike(Store.getTower(currentTowerId));
      if (r.liked) toast('♥ 좋아요를 눌렀어요');
    });
    $('cheerForm').addEventListener('submit', function (e) { e.preventDefault(); sendCheer($('inCheer').value); });
    $('btnRestack').addEventListener('click', function () {
      const mine = Store.myTower();
      if (mine) startStacking(mine);
    });
    $('btnEditWish').addEventListener('click', function () { openWish('edit'); });
    if ($('btnDelTower')) {
      $('btnDelTower').addEventListener('click', askDeleteTower);
      $('btnDelTowerCancel').addEventListener('click', function () {
        const mine = Store.myTower();
        if (mine) openTower(mine.id); else closeLayers();
      });
      $('btnDelTowerOk').addEventListener('click', confirmDeleteTower);
    }
    bindAccount();

    document.querySelectorAll('#listTabs button').forEach(function (b) {
      b.addEventListener('click', function () { listSort = b.dataset.sort; renderList(); });
    });

    document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeLayers); });
    $('backdrop').addEventListener('click', closeLayers);
    window.addEventListener('resize', function () { if ($('mWelcome').classList.contains('open')) renderDeco(); });
    window.addEventListener('keydown', function (e) {
      // Enter: 말풍선 입력창 열기 (다른 창이 열려 있거나 입력 중이면 무시)
      const tg = e.target;
      const typing = tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable);
      if (e.key === 'Enter' && liveOn && !typing && !anyLayerOpen() && !Stack.isActive()) {
        e.preventDefault();
        openChat();
        return;
      }
      if (e.key === 'Escape' && !Stack.isActive()) closeLayers();
 
      if (e.code === 'KeyM' && !typing && !anyLayerOpen() && !Stack.isActive() && Store.myTower()) goToMine();
    });
  }

  function start() {
    buildSwatches();
    buildDeco();
    buildHairColors();
    buildCats();
    buildQuickCheers();
    buildListCats();
    bind();

    Campus.init($('campus'), {
      onTowerTap: openTower,
      onLocation: function (name) { $('locLabel').textContent = name; },
      blockKeys: anyLayerOpen
    });

    const prof = ensureProfile();
    const p = prof.profile;
    welcomeFirst = prof.created;
    Campus.setPlayer(p.name, p.color, p);
    refreshHud();
    refreshNet();
    // 서버에서 다른 사람의 돌탑을 받아 오면 캠퍼스·배지를 다시 그려요
    if (Store.onChange) Store.onChange(function () {
      refreshHud(); refreshNet(); renderAccountChip();
      if ($('mAccount') && $('mAccount').classList.contains('open')) renderAccount();
      // 열어 둔 돌탑이 사라졌으면(지움·계정 바뀜) 창을 닫아요
      if (currentTowerId && !Store.getTower(currentTowerId)) closeLayers();
    });
    if (Store.onNotice) Store.onNotice(toast);
    renderAccountChip();
setupLive();
if (prof.created) openWelcome();
requestAnimationFrame(updateMyArrow);
  }

  window.App = { toast: toast };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
