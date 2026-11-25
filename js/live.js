/* =========================================================
 * live.js — 같은 캠퍼스에 있는 사람끼리 실시간으로 보기 + 말풍선
 *  - Supabase Realtime 채널 하나('campus-live')를 모두 함께 써요.
 *    (테이블이 필요 없고, 아무것도 서버에 저장하지 않아요)
 *  - 위치: 움직일 때만 0.3초마다 보내고, 가만히 있으면 5초마다 "살아 있어요" 신호
 *  - 말풍선: 보낸 순간 접속해 있는 사람에게만 보여요. 서버에는 남지 않고,
 *    내가 보낸 말·받은 말은 이 브라우저에만 최근 LOG_MAX개까지 기록해요(💬 창).
 *  - 내가 한 말 지우기: 내 기록과, 지금 접속해 있는 사람들의 기록에서 지워져요.
 *    말마다 열쇠(key)를 만들고 보낼 땐 열쇠의 해시(mid)만 보내요. 지울 때 열쇠를 보여 주면
 *    받은 쪽이 해시를 맞춰 보고 지워서, 남이 쓴 말은 지울 수 없어요.
 *  - Supabase 설정이 없거나 연결이 안 되면 조용히 꺼져요(게임은 그대로).
 * ========================================================= */
(function () {
  'use strict';

  const CHANNEL = 'campus-live';
  const SEND_MS = 300;        // 움직이는 중 위치 전송 간격
  const BEAT_MS = 5000;       // 가만히 있을 때 신호 간격
  const STALE_MS = 20000;     // 이만큼 소식이 없으면 사라진 걸로
  const SAY_GAP_MS = 1500;    // 말풍선 도배 방지
  const SAY_MAX = 40;
  const LOG_KEY = 'cbnu-chat-log';
  const LOG_MAX = 50;

  // 아주 기본적인 욕설 가리기
  const BAD = ['씨발', '시발', 'ㅅㅂ', 'ㅆㅂ', '병신', 'ㅂㅅ', '좆', '개새끼', '새끼', '지랄', 'fuck', 'shit'];

  const me = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const peers = new Map();    // id → { t: 마지막 소식 시각 }
  let channel = null, joined = false, h = {};
  let last = null, lastSent = 0, lastSay = 0;

  // 말풍선 기록 (이 브라우저에만) — { at, name, text, me, mid?, key?(내 말만) }
  let log = [];
  try {
    const saved = JSON.parse(window.localStorage.getItem(LOG_KEY) || '[]');
    if (Array.isArray(saved)) log = saved.filter(function (e) { return e && typeof e.text === 'string'; }).slice(-LOG_MAX);
  } catch (e) { /* 무시 */ }

  /* ---- 지우기 열쇠 ---- */
  function hex(buf) { return Array.from(new Uint8Array(buf), function (b) { return (b + 256).toString(16).slice(1); }).join(''); }
  function canHash() { return !!(window.crypto && crypto.subtle && window.TextEncoder); }   // https·localhost에서만 돼요
  function hash(key) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)).then(hex); }

  let nextKey = null;   // 다음 말에 쓸 { key, mid }
  function makeKey() {
    nextKey = null;
    if (!canHash()) return;
    const key = hex(crypto.getRandomValues(new Uint8Array(16)));
    hash(key).then(function (mid) { nextKey = { key: key, mid: mid }; }, function () { /* 없으면 내 기록에서만 지워져요 */ });
  }
  makeKey();

  function addLog(name, text, mine, mid, key) {
    const e = { at: Date.now(), name: clip(name, 10) || '익명', text: text, me: !!mine };
    if (mid) e.mid = mid;
    if (key) e.key = key;
    log.push(e);
    if (log.length > LOG_MAX) log = log.slice(-LOG_MAX);
    saveLog();
    if (h.onLog) h.onLog(e);
  }

  function saveLog() {
    try { window.localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch (err) { /* 저장 못 해도 괜찮아요 */ }
  }

  // 기록에서 빼고 화면에 알려요. newer = 이 말보다 뒤에 온 다른 사람 말의 수(안 읽음 표시용)
  function dropLog(e) {
    const i = log.indexOf(e);
    if (i < 0) return false;
    const newer = log.slice(i + 1).filter(function (x) { return !x.me; }).length;
    log.splice(i, 1);
    saveLog();
    if (h.onUnlog) h.onUnlog(e, newer);
    return true;
  }

  function clip(s, n) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n); }
  function num(v, lo, hi) { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null; }

  function clean(text) {
    let s = clip(text, SAY_MAX);
    BAD.forEach(function (w) { s = s.replace(new RegExp(w, 'gi'), '♡♡'); });
    return s;
  }

  function myState() {
    const p = (window.Store && Store.getProfile()) || { name: '익명', color: DATA.COLORS[0] };
    const s = h.getSelf ? h.getSelf() : { x: DATA.START.x, y: DATA.START.y, h: 0, m: false };
    const o = {
      id: me, n: clip(p.name, 10) || '익명', c: p.color, hr: p.hair, fc: p.face, hc: p.hairColor,
      x: Math.round(s.x), y: Math.round(s.y), h: Math.round(s.h * 100) / 100, m: !!s.m
    };
    if (s.b >= 0) o.b = s.b;   // 돌 쌓는 중이면 쌓은 층수
    const w = o.b >= 0 && window.Coop ? Coop.helping() : '';
    if (w) o.w = w;            // 친구를 돕는 중이면 돌탑 주인의 id
    return o;
  }

  function changed(a, b) {
    return !b || a.b !== b.b || a.w !== b.w || a.n !== b.n || a.c !== b.c || a.m !== b.m || a.hr !== b.hr || a.fc !== b.fc || a.hc !== b.hc ||
      Math.abs(a.x - b.x) > 2 || Math.abs(a.y - b.y) > 2 || Math.abs(a.h - b.h) > 0.15;
  }

  function sendState(force) {
    if (!joined) return;
    const s = myState();
    const now = Date.now();
    if (!force && !(changed(s, last) && now - lastSent >= SEND_MS) && now - lastSent < BEAT_MS) return;
    last = s;
    lastSent = now;
    channel.send({ type: 'broadcast', event: 'st', payload: s });
  }

  function emitCount() { if (h.onCount) h.onCount(peers.size); }

  function onState(p) {
    if (!p || typeof p.id !== 'string' || p.id === me || p.id.length > 40) return;
    const x = num(p.x, 0, DATA.WORLD.w), y = num(p.y, 0, DATA.WORLD.h);
    if (x == null || y == null) return;
    const fresh = !peers.has(p.id);
    const name = clip(p.n, 10) || '익명';
    peers.set(p.id, { t: Date.now(), n: name, b: typeof p.b === 'number' });
    const look = DATA.normLook({ hair: p.hr, face: p.fc, hairColor: p.hc });
    if (h.onPeer) h.onPeer({
      id: p.id, hair: look.hair, face: look.face, hairColor: look.hairColor,
      name: name,
      color: DATA.COLORS.indexOf(p.c) >= 0 ? p.c : DATA.COLORS[0],
      x: x, y: y, heading: num(p.h, -10, 10) || 0, moving: !!p.m,
      build: typeof p.b === 'number' && isFinite(p.b) ? Math.round(num(p.b, 0, 999)) : -1,
      helping: typeof p.w === 'string' && p.w.length <= 40 ? p.w : ''
    });
    if (fresh) emitCount();
  }

  function onSay(p) {
    if (!p || typeof p.id !== 'string' || p.id === me || !peers.has(p.id)) return;
    const text = clean(p.text);
    if (!text) return;
    if (h.onSay) h.onSay(p.id, text);
    addLog(peers.get(p.id).n, text, false, /^[0-9a-f]{64}$/.test(p.mid) ? p.mid : '');
  }

  // 다른 사람이 자기가 한 말을 지웠어요 (열쇠가 맞을 때만)
  function onDel(p) {
    if (!p || typeof p.key !== 'string' || !/^[0-9a-f]{32}$/.test(p.key) || !canHash()) return;
    hash(p.key).then(function (mid) {
      const e = log.find(function (x) { return !x.me && x.mid === mid; });
      if (!e) return;
      dropLog(e);
      if (typeof p.id === 'string' && peers.has(p.id) && h.onUnsay) h.onUnsay(p.id, e.text);
    }, function () { /* 무시 */ });
  }

  function drop(id) {
    if (!peers.delete(id)) return;
    if (h.onLeave) h.onLeave(id);
    emitCount();
  }

  function sweep() {
    const now = Date.now();
    peers.forEach(function (v, id) { if (now - v.t > STALE_MS) drop(id); });
  }

  const Live = {
    // 시작: 성공하면 true (Supabase가 없으면 false)
    start: function (handlers) {
      if (channel) return true;
      const client = window.Store && Store.realtimeClient && Store.realtimeClient();
      if (!client || !client.channel) return false;
      h = handlers || {};
      channel = client.channel(CHANNEL, { config: { broadcast: { self: false }, presence: { key: me } } });
      channel
        .on('broadcast', { event: 'st' }, function (m) { onState(m.payload); })
        .on('broadcast', { event: 'say' }, function (m) { onSay(m.payload); })
        .on('broadcast', { event: 'del' }, function (m) { onDel(m.payload); })
        // 친구와 함께 쌓기 (coop.js) — 나에게 온 것만
        .on('broadcast', { event: 'co' }, function (m) {
          const p = m.payload;
          if (!p || p.to !== me || typeof p.id !== 'string' || p.id === me || p.id.length > 40) return;
          if (peers.has(p.id) && h.onCoop) h.onCoop(p);
        })
        // 누가 새로 들어오면 내 위치를 바로 알려 줘요
        .on('presence', { event: 'join' }, function (m) { if (m.key !== me) setTimeout(function () { sendState(true); }, 300); })
        .on('presence', { event: 'leave' }, function (m) { drop(m.key); })
        .subscribe(function (status) {
          if (status === 'SUBSCRIBED') {
            joined = true;
            channel.track({ at: Date.now() });
            sendState(true);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            joined = false;
          }
          if (h.onStatus) h.onStatus(joined);
        });
      setInterval(function () { sendState(false); }, 100);
      setInterval(sweep, 3000);
      window.addEventListener('pagehide', function () { try { channel.untrack(); } catch (e) { /* 무시 */ } });
      return true;
    },

    // 말풍선 보내기 → { ok, text } 또는 { ok: false, reason }
    say: function (text) {
      const t = clean(text);
      if (!t) return { ok: false, reason: '할 말을 입력해 주세요 🙂' };
      if (!joined) return { ok: false, reason: '아직 연결 중이에요. 잠시 후 다시 보내 주세요' };
      const now = Date.now();
      if (now - lastSay < SAY_GAP_MS) return { ok: false, reason: '조금만 천천히 보내 주세요 🐢' };
      lastSay = now;
      sendState(true);
      const k = nextKey || {};
      makeKey();
      const msg = { id: me, text: t };
      if (k.mid) msg.mid = k.mid;
      channel.send({ type: 'broadcast', event: 'say', payload: msg });
      if (h.onSay) h.onSay('me', t);
      addLog(myState().n, t, true, k.mid, k.key);
      return { ok: true, text: t };
    },

    // 말풍선 기록 (오래된 것 → 최근 것)
    log: function () { return log.slice(); },
    // 내가 한 말 하나 지우기 (log()가 돌려준 항목을 그대로 넘겨요)
    //  → 'all' 지금 접속한 사람들에게도 지우라고 알림 / 'mine' 내 기록에서만 / false 못 지움
    removeLog: function (e) {
      if (!e || !e.me || !dropLog(e)) return false;
      if (h.onUnsay) h.onUnsay('me', e.text);
      if (!joined || !e.key) return 'mine';
      channel.send({ type: 'broadcast', event: 'del', payload: { id: me, key: e.key } });
      return 'all';
    },
    clearLog: function () {
      log = [];
      try { window.localStorage.removeItem(LOG_KEY); } catch (e) { /* 무시 */ }
    },

    isOnline: function () { return joined; },
    count: function () { return peers.size; },
    // 친구와 함께 쌓기 신호 보내기 (to: 받는 사람)
    sendCoop: function (to, m) {
      if (!joined) return false;
      m.id = me; m.to = to;
      channel.send({ type: 'broadcast', event: 'co', payload: m });
      return true;
    },
    nameOf: function (id) { return peers.has(id) ? peers.get(id).n : '친구'; },
    // 지금 접속해 있는 다른 사람들 { id, name, busy(돌 쌓는 중) }
    people: function () { return Array.from(peers, function (e) { return { id: e[0], name: e[1].n, busy: !!e[1].b }; }); },
    // 지금 접속해 있는 다른 사람들의 이름
    names: function () { return Array.from(peers.values(), function (v) { return v.n; }); }
  };

  window.Live = Live;
})();
