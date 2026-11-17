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
  let wishCat = DATA.CATEGORIES[0].id;
  let wishMode = 'create';     // create | edit
  let currentTowerId = null;   // 열려 있는 상세 돌탑
  let listSort = 'height';
  let listCat = 'all';
  let toastTimer = 0;

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
    $('btnBuild').innerHTML = mine ? '🪨 내 돌탑 다시 쌓기' : '🪨 여기에 돌탑 쌓기';
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
  }

  function openWelcome() {
    const p = Store.getProfile();
    $('inName').value = p ? p.name : '';
    pickColor(p ? p.color : DATA.COLORS[Math.floor(Math.random() * DATA.COLORS.length)]);
    $('btnStart').textContent = p ? '저장하기' : '캠퍼스 입장하기';
    openLayer('mWelcome');
    setTimeout(function () { $('inName').focus(); }, 100);
  }

  function submitWelcome() {
    const name = $('inName').value.trim().replace(/\s+/g, ' ');
    if (!name) { toast('닉네임을 입력해 주세요 🙂'); $('inName').focus(); return; }
    const first = !Store.getProfile();
    Store.setProfile(name.slice(0, 10), profileColor);
    Campus.setPlayer(name.slice(0, 10), profileColor);
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
    const p = Campus.getPlayer();
    const t = Store.createTower({ x: p.x, y: p.y, cat: wishCat, wish: wish });
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

  /* ---------------- 시작 ---------------- */

  function bind() {
    $('btnStart').addEventListener('click', submitWelcome);
    $('inName').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitWelcome(); } });
    $('profileChip').addEventListener('click', openWelcome);

    $('btnBuild').addEventListener('click', onBuild);
    $('btnList').addEventListener('click', function () { renderList(); openLayer('sList'); });
    $('btnHelp').addEventListener('click', function () { openLayer('mHelp'); });
    $('btnHelpClose').addEventListener('click', closeLayers);
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

    document.querySelectorAll('#listTabs button').forEach(function (b) {
      b.addEventListener('click', function () { listSort = b.dataset.sort; renderList(); });
    });

    document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeLayers); });
    $('backdrop').addEventListener('click', closeLayers);
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !Stack.isActive()) closeLayers();
    });
  }

  function start() {
    buildSwatches();
    buildCats();
    buildQuickCheers();
    buildListCats();
    bind();

    Campus.init($('campus'), {
      onTowerTap: openTower,
      onLocation: function (name) { $('locLabel').textContent = name; },
      blockKeys: anyLayerOpen
    });

    const p = Store.getProfile();
    if (p) Campus.setPlayer(p.name, p.color);
    refreshHud();
    refreshNet();
    // 서버에서 다른 사람의 돌탑을 받아 오면 캠퍼스·배지를 다시 그려요
    if (Store.onChange) Store.onChange(function () { refreshHud(); refreshNet(); });
    if (!p) openWelcome();
  }

  window.App = { toast: toast };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
