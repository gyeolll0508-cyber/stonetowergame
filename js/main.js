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
    dropAsk();
    document.querySelectorAll('.layer.open').forEach(function (l) { l.classList.remove('open'); });
    $('backdrop').classList.remove('show');
    currentTowerId = null;
    Campus.highlight(null);
  }

  // 도움 요청 창을 닫으면 요청도 취소(또는 거절)돼요
  function dropAsk() {
    if (!window.Coop) return;
    if (Coop.inviting()) Coop.cancelInvite();
    if (Coop.asked()) Coop.answer(false);
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
    b.hidden = online === 'online' || online === 'connecting';   // 잘 연결됐으면 안 보여요
  }

  /* ---------------- 처음 방문(프로필) ---------------- */

  function buildSwatches() {
    const box = $('colorPick');
    box.innerHTML = '';
    DATA.COLOR_GROUPS.forEach(function (g) {
      const label = document.createElement('div');
      label.className = 'swatch-label';
      label.textContent = g.label;
      const row = document.createElement('div');
      row.className = 'swatches sm';
      g.colors.forEach(function (c) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.style.background = c[0];
        b.dataset.color = c[0];
        b.title = c[1];
        b.setAttribute('aria-label', '옷 색 ' + c[1]);
        b.addEventListener('click', function () { pickColor(c[0]); });
        row.appendChild(b);
      });
      box.appendChild(label);
      box.appendChild(row);
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

  /* ---- 중복 이름 막기 ----
   *  띄어쓰기·대소문자만 다른 이름도 같은 이름으로 봐요.
   *  비교 대상: 다른 사람의 돌탑 이름 + (online이면) 지금 접속해 있는 사람 이름 */
  function nameKey(s) {
    return String(s || '').normalize('NFC').replace(/[\s\u200B-\u200D\u2060\u3164\uFEFF]+/g, '').toLowerCase();
  }
  function nameTaken(name, online) {
    const k = nameKey(name);
    if (Store.towers().some(function (t) { return !Store.isMine(t.id) && nameKey(t.name) === k; })) return true;
    return !!online && !!window.Live && Live.names().some(function (n) { return nameKey(n) === k; });
  }
  // 아무도 안 쓰는 랜덤 닉네임
  function freeNickname() {
    for (let i = 0; i < 60; i++) {
      const n = DATA.randomNickname();
      if (!nameTaken(n, true)) return n;
    }
    for (let i = 2; ; i++) {
      const n = DATA.randomNickname().slice(0, 10 - String(i).length) + i;
      if (!nameTaken(n, true)) return n;
    }
  }
  // 처음 받은 랜덤 닉네임이 서버 목록을 받아 보니 이미 있는 이름이면 다른 걸로 바꿔요
  function fixAutoName() {
    const p = Store.getProfile();
    if (!welcomeFirst || !p || Store.myTower() || !nameTaken(p.name, false)) return;
    const typed = $('inName').value.trim() !== p.name;   // 이미 직접 고쳐 쓰는 중이면 입력칸은 그대로 둬요
    const n = freeNickname();
    Store.setProfile(n, p.color, p);
    Campus.setPlayer(n, p.color, p);
    if (!typed) $('inName').value = n;
  }

  // 🎲 버튼: 닉네임과 색을 새로 뽑아요 (저장은 '저장하기'를 눌러야)
  function rerollProfile() {
    $('inName').value = freeNickname();
    pickColor(DATA.randomColor(profileColor));
  }

  // 처음 입장: 랜덤 닉네임·색을 바로 저장해서, 창을 그냥 닫거나
  // 새로고침해도 같은 프로필이 유지돼요(재접속 시 그대로 사용).
  function ensureProfile() {
    let p = Store.getProfile();
    if (p && p.name && p.color) return { profile: p, created: false };
    Store.setProfile(freeNickname(), DATA.randomColor(), DATA.randomLook());
    return { profile: Store.getProfile(), created: true };
  }

  function submitWelcome() {
    const name = $('inName').value.trim().replace(/\s+/g, ' ').slice(0, 10).trim();
    if (!nameKey(name)) { toast('닉네임을 입력해 주세요 🙂'); $('inName').focus(); return; }
    // 이름을 안 바꾸고 색·꾸미기만 저장하는 건, 이미 그 이름으로 세운 돌탑이 있으면 그대로 돼요
    const cur = Store.getProfile();
    const same = !!cur && nameKey(cur.name) === nameKey(name);
    if (!(same && Store.myTower()) && nameTaken(name, !same)) {
      toast('‘' + name + '’은(는) 이미 다른 사람이 쓰는 이름이에요. 다른 이름으로 해 주세요 🙏');
      $('inName').focus(); $('inName').select();
      return;
    }
    const first = welcomeFirst;
    welcomeFirst = false;
    Store.setProfile(name, profileColor, profileLook);
    Campus.setPlayer(name, profileColor, profileLook);
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
    if (!Store.myTower() && nameTaken(Store.getProfile() && Store.getProfile().name, false)) { closeLayers(); askNewName(); return; }
    if (Store.myTower()) { closeLayers(); refreshHud(); toast('돌탑은 한 사람당 1개만 세울 수 있어요 🪨'); return; }
    const p = Campus.getPlayer();
    // 돌탑은 쌓는 방법까지 고른 다음에 세워요
    const o = { x: p.x, y: p.y, cat: wishCat, wish: wish };
    chooseMode(wish, function () {
      const t = Store.createTower(o);
      if (!t) { closeLayers(); toast('돌탑은 한 사람당 1개만 세울 수 있어요 🪨'); }
      refreshHud();
      return t;
    });
  }

  /* ---------------- 쌓는 방법: 직접 / 친구에게 도움 요청 ---------------- */

  let plan = null, planTitle = '';   // plan() → 쌓을 내 돌탑

  // 친구와 함께 쌓기를 쓸 수 없는 화면(2D·실시간 꺼짐)이면 바로 혼자 쌓아요
  function chooseMode(title, fn) {
    plan = fn;
    planTitle = title;
    if (!$('mMode') || !liveOn || !window.Coop || !Stack.canCoop) { soloStart(); return; }
    openLayer('mMode');
    setTimeout(function () { $('btnModeSolo').focus(); }, 100);
  }

  function soloStart() {
    const t = plan && plan();
    plan = null;
    if (t) startStacking(t);
  }

  function restack(mine) { chooseMode(mine.wish, function () { return Store.myTower(); }); }

  function openInvite() {
    $('inFriend').value = '';
    setInviteWait(false);
    $('inviteMsg').textContent = '';
    renderFriends();
    openLayer('mInvite');
    setTimeout(function () { $('inFriend').focus(); }, 100);
  }

  // 지금 접속해 있는 친구 목록 (누르면 닉네임이 채워져요)
  function renderFriends() {
    const box = $('friendList');
    box.innerHTML = '';
    const list = Live.people();
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = '지금 접속해 있는 다른 사람이 없어요. 친구에게 게임을 켜 달라고 해 보세요!';
      box.appendChild(p);
      return;
    }
    list.forEach(function (f) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip-btn';
      b.textContent = f.name + (f.busy ? ' · 🪨 쌓는 중' : '');
      b.disabled = f.busy;
      b.addEventListener('click', function () { $('inFriend').value = f.name; $('inviteMsg').textContent = ''; });
      box.appendChild(b);
    });
  }

  function setInviteWait(on) {
    $('inFriend').disabled = on;
    $('btnInviteOk').disabled = on;
    $('btnInviteOk').textContent = on ? '기다리는 중…' : '🤝 요청 보내기';
    $('friendList').classList.toggle('off', on);
    $('btnInviteCancel').textContent = on ? '요청 취소' : '뒤로';
  }

  function sendInvite() {
    if (Coop.inviting()) return;
    const msg = function (s) { $('inviteMsg').textContent = s; };
    const name = $('inFriend').value;
    const k = nameKey(name);
    if (!k) { msg('친구 닉네임을 입력해 주세요 🙂'); $('inFriend').focus(); return; }
    if (!Live.isOnline()) { msg('아직 연결 중이에요. 잠시 후 다시 해 주세요'); return; }
    const found = Live.people().filter(function (f) { return nameKey(f.name) === k; });
    if (!found.length) {
      const me = Store.getProfile();
      msg(me && nameKey(me.name) === k ? '내 닉네임이에요. 친구 닉네임을 입력해 주세요 🙂' : '‘' + name.trim() + '’님은 지금 접속해 있지 않아요. 닉네임을 다시 확인해 주세요');
      renderFriends();
      return;
    }
    if (found.length > 1) { msg('같은 닉네임인 사람이 여러 명 접속해 있어요. 친구에게 닉네임을 바꿔 달라고 해 주세요'); return; }
    if (found[0].busy) { msg(found[0].name + '님은 지금 돌을 쌓는 중이에요. 잠시 후 다시 요청해 주세요'); return; }
    if (!Coop.invite(found[0].id, found[0].name, planTitle, function () { const t = plan && plan(); plan = null; return t; })) {
      msg('지금은 요청을 보낼 수 없어요. 잠시 후 다시 해 주세요');
      return;
    }
    setInviteWait(true);
    msg(found[0].name + '님에게 물어보고 있어요… (30초 안에 답이 없으면 취소돼요)');
  }

  function setupCoop() {
    if (!window.Coop || !$('mMode') || !Stack.canCoop) return;
    Coop.init({
      // 요청을 받을 수 없는 상태
      busy: function () {
        return Stack.isActive() || document.body.classList.contains('photo-open') || document.body.classList.contains('admin-on') ||
          ['mWelcome', 'mWish', 'mMode', 'mInvite', 'mAccount', 'mDelTower'].some(function (id) { return $(id) && $(id).classList.contains('open'); });
      },
      onAsk: function (name, title) {
        $('helpAskName').textContent = name;
        $('helpAskWish').textContent = title ? '“' + title + '”' : '';
        $('btnHelpYes').disabled = false;
        $('btnHelpYes').textContent = '🤝 도와주기';
        openLayer('mHelpAsk');
      },
      onAskGone: function (why, name) {
        $('mHelpAsk').classList.remove('open');
        if (!anyLayerOpen()) $('backdrop').classList.remove('show');
        toast(why === 'nogo' ? name + '님과 연결하지 못했어요. 다시 요청해 달라고 해 보세요' : name + '님의 도움 요청이 취소됐어요');
      },
      onInviteEnd: function (why, name) {
        setInviteWait(false);
        renderFriends();
        $('inviteMsg').textContent = why === 'no' ? name + '님이 지금은 어렵대요 😢 다른 친구에게 부탁해 볼까요?'
          : why === 'busy' ? name + '님은 지금 다른 걸 하는 중이에요. 잠시 후 다시 요청해 주세요'
            : name + '님이 답하지 않았어요. 다른 친구에게 부탁해 볼까요?';
      },
      where: function () {
        const s = Campus.getPlayerState();
        return { x: Math.round(s.x), y: Math.round(s.y), h: Math.round(s.h * 100) / 100 };
      },
      start: function (t, net) {
        // 도와주러 온 친구는 부른 사람의 돌탑 맞은편으로 이동해요
        if (!net.host && net.at && Campus.joinBeside) {
          Campus.joinBeside(net.at);
          toast('🏃 ' + net.partner + '님 곁으로 이동했어요');
        }
        startStacking(t, net);
      }
    });
    $('btnModeSolo').addEventListener('click', soloStart);
    $('btnModeHelp').addEventListener('click', openInvite);
    $('btnModeCancel').addEventListener('click', function () { plan = null; closeLayers(); });
    $('btnInviteOk').addEventListener('click', sendInvite);
    $('inFriend').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendInvite(); } });
    $('btnInviteCancel').addEventListener('click', function () {
      if (Coop.inviting()) { Coop.cancelInvite(); setInviteWait(false); $('inviteMsg').textContent = '요청을 취소했어요'; renderFriends(); }
      else openLayer('mMode');
    });
    $('btnHelpYes').addEventListener('click', function () {
      this.disabled = true;
      this.textContent = '연결하는 중…';
      Coop.answer(true);
    });
    $('btnHelpNo').addEventListener('click', closeLayers);
  }

  /* ---------------- 돌 쌓기 ---------------- */

  // net: 친구와 함께 쌓을 때만 (coop.js)
  function startStacking(t, net) {
    closeLayers();
    Campus.pause();
    Stack.start(t, function (info) {
      Campus.resume();
      refreshHud();
      if (info && info.helped) return;   // 도와주러 간 거라 내 기록은 그대로예요
      Campus.highlight(t.id);
      if (info && info.height > 0) toast(info.isRecord ? '🏆 새 최고 기록 ' + info.height + '층 저장!' : '이번 기록 ' + info.height + '층 (최고 ' + Store.getTower(t.id).best + '층)');
      setTimeout(function () { Campus.highlight(null); }, 2500);
    }, net);
  }

  function onBuild() {
    if (!Store.getProfile()) { openWelcome(); return; }
    const mine = Store.myTower();
    if (mine) { restack(mine); return; }
    const check = Campus.canBuildHere();
    if (!check.ok) { toast(check.reason); return; }
    if (nameTaken(Store.getProfile().name, false)) { askNewName(); return; }
    openWish('create');
  }

  // 돌탑을 세우려는데 내 이름과 같은 이름의 돌탑이 이미 있을 때
  function askNewName() {
    openWelcome();
    toast('같은 이름의 돌탑이 이미 있어요. 이름을 바꾼 뒤 쌓아 주세요 🙏');
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
    const x = cx + dx * k;
    let y = cy + dy * k;
    // 왼쪽 위 지도에 가려지면 지도 바로 아래로 내려요
    const dock = $('mapDock') && $('mapDock').getBoundingClientRect();
    if (dock && x - 70 < dock.right && y - 18 < dock.bottom) y = Math.min(bottom, dock.bottom + 24);
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

  let liveOn = false, unread = 0;

  // 👥 접속자 수 (나 포함) — 연결되기 전에는 숨겨요
  function updateLiveCount() {
    const el = $('liveCount');
    if (!el) return;
    const on = liveOn && Live.isOnline();
    el.hidden = !on;
    if (on) el.textContent = '👥 ' + (Live.count() + 1) + '명 접속 중';
  }

  function chatTime(at) {
    const d = new Date(at);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function chatItem(e) {
    const li = document.createElement('li');
    li.chatEntry = e;
    if (e.me) li.className = 'me';
    const who = document.createElement('b');
    who.textContent = e.me ? '나' : e.name;
    const txt = document.createElement('span');
    txt.textContent = e.text;
    const tm = document.createElement('time');
    tm.textContent = chatTime(e.at);
    li.appendChild(who); li.appendChild(txt); li.appendChild(tm);
    if (e.me) {
      // 내가 한 말만 지울 수 있어요 (지금 접속한 사람들의 기록에서도 지워져요)
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'chat-del';
      del.textContent = '🗑️';
      del.title = '이 말 지우기';
      del.setAttribute('aria-label', '내가 한 말 지우기: ' + e.text);
      del.addEventListener('click', function () {
        const r = Live.removeLog(e);   // 화면에서는 onUnlog가 지워요
        if (r) toast(r === 'all' ? '지웠어요 🗑️ 지금 접속한 사람들 기록에서도 지워져요' : '내 기록에서만 지웠어요 🗑️');
      });
      // Enter 단축키(말풍선 열기)보다 버튼 누르기가 먼저예요
      del.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') ev.stopPropagation(); });
      li.appendChild(del);
    }
    return li;
  }

  function showChatEmpty() {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '아직 주고받은 말이 없어요. 첫 인사를 건네 보세요 👋';
    $('chatLog').appendChild(li);
  }

  function renderChatLog() {
    const ol = $('chatLog');
    ol.innerHTML = '';
    const list = Live.log();
    if (!list.length) showChatEmpty();
    list.forEach(function (e) { ol.appendChild(chatItem(e)); });
    ol.scrollTop = ol.scrollHeight;
  }

  function setUnread(n) {
    unread = n;
    $('chatUnread').textContent = n > 0 ? (n > 9 ? '9+' : String(n)) : '';
  }

  function setupLive() {
    if (!window.Live || !Campus.upsertPeer || !$('btnChat')) return;
    liveOn = Live.start({
      getSelf: Campus.getPlayerState,
      onPeer: Campus.upsertPeer,
      onLeave: Campus.removePeer,
      onSay: Campus.showBubble,
      onUnsay: Campus.hideBubble,
      onCoop: function (m) { if (window.Coop) Coop.recv(m); },
      onUnlog: function (e, newer) {
        if (!$('chatBox').hidden) {
          const ol = $('chatLog');
          const li = Array.prototype.find.call(ol.children, function (x) { return x.chatEntry === e; });
          if (li) li.remove();
          if (!ol.children.length) showChatEmpty();
        } else if (!e.me && newer < unread) {
          setUnread(unread - 1);   // 아직 안 읽은 말이 지워졌어요
        }
      },
      onCount: updateLiveCount,
      onStatus: updateLiveCount,
      onLog: function (e) {
        if (!$('chatBox').hidden) {
          const ol = $('chatLog');
          const empty = ol.querySelector('.empty');
          if (empty) empty.remove();
          ol.appendChild(chatItem(e));
          while (ol.children.length > 50) ol.removeChild(ol.firstChild);
          ol.scrollTop = ol.scrollHeight;
        } else if (!e.me) {
          setUnread(unread + 1);
        }
      }
    });
    $('btnChat').hidden = !liveOn;
    updateLiveCount();
    if (!liveOn) return;
    setupCoop();
    $('btnChat').addEventListener('click', function () {
      if ($('chatBox').hidden) openChat(); else closeChat();
    });
    $('chatClose').addEventListener('click', closeChat);
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
    setUIFolded(false);
    $('chatBox').hidden = false;
    setUnread(0);
    renderChatLog();
    $('inChat').focus();
  }

  function closeChat() {
    $('chatBox').hidden = true;
    $('inChat').blur();
  }

  /* ---------------- UI 접기·펼치기 (3D 화면) ---------------- */

  const UI_FOLD_KEY = 'cbnu-ui-folded';

  function setUIFolded(v) {
    const btn = $('uiFold');
    if (!btn) return;
    document.body.classList.toggle('ui-folded', v);
    btn.setAttribute('aria-pressed', v ? 'true' : 'false');
    btn.title = v ? '버튼·정보 펼치기 (H)' : '버튼·정보 접기 (H)';
    btn.innerHTML = v ? '👀 <span class="lbl">UI 펼치기</span>' : '🙈 <span class="lbl">UI 접기</span>';
    if (v && $('chatBox') && !$('chatBox').hidden) closeChat();
    try { window.localStorage.setItem(UI_FOLD_KEY, v ? '1' : '0'); } catch (e) { /* 저장 못 해도 괜찮아요 */ }
  }

  function setupUIFold() {
    const btn = $('uiFold');
    if (!btn) return;
    btn.addEventListener('click', function () { setUIFolded(!document.body.classList.contains('ui-folded')); });
    let saved = false;
    try { saved = window.localStorage.getItem(UI_FOLD_KEY) === '1'; } catch (e) { /* 무시 */ }
    setUIFolded(saved);
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
      if (mine) restack(mine);
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
      if (e.code === 'KeyH' && !typing && !anyLayerOpen() && !Stack.isActive() && $('uiFold') &&
        !document.body.classList.contains('admin-on')) {
        setUIFolded(!document.body.classList.contains('ui-folded'));
      }
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
      fixAutoName();
      refreshHud(); refreshNet(); renderAccountChip();
      if ($('mAccount') && $('mAccount').classList.contains('open')) renderAccount();
      // 열어 둔 돌탑이 사라졌으면(지움·계정 바뀜) 창을 닫아요
      if (currentTowerId && !Store.getTower(currentTowerId)) closeLayers();
    });
    if (Store.onNotice) Store.onNotice(toast);
    renderAccountChip();
setupLive();
setupUIFold();
if (prof.created) openWelcome();
requestAnimationFrame(updateMyArrow);
  }

  window.App = { toast: toast };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
