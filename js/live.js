/* =========================================================
 * live.js — 같은 캠퍼스에 있는 사람끼리 실시간으로 보기 + 말풍선
 *  - Supabase Realtime 채널 하나('campus-live')를 모두 함께 써요.
 *    (테이블이 필요 없고, 아무것도 서버에 저장하지 않아요)
 *  - 위치: 움직일 때만 0.3초마다 보내고, 가만히 있으면 5초마다 "살아 있어요" 신호
 *  - 말풍선: 보낸 순간 접속해 있는 사람에게만 보여요. 서버에는 남지 않고,
 *    내가 보낸 말·받은 말은 이 브라우저에만 최근 LOG_MAX개까지 기록해요(💬 창).
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

  // 말풍선 기록 (이 브라우저에만) — { at, name, text, me }
  let log = [];
  try {
    const saved = JSON.parse(window.localStorage.getItem(LOG_KEY) || '[]');
    if (Array.isArray(saved)) log = saved.filter(function (e) { return e && typeof e.text === 'string'; }).slice(-LOG_MAX);
  } catch (e) { /* 무시 */ }

  function addLog(name, text, mine) {
    const e = { at: Date.now(), name: clip(name, 10) || '익명', text: text, me: !!mine };
    log.push(e);
    if (log.length > LOG_MAX) log = log.slice(-LOG_MAX);
    try { window.localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch (err) { /* 저장 못 해도 괜찮아요 */ }
    if (h.onLog) h.onLog(e);
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
    return {
      id: me, n: clip(p.name, 10) || '익명', c: p.color, hr: p.hair, fc: p.face, hc: p.hairColor,
      x: Math.round(s.x), y: Math.round(s.y), h: Math.round(s.h * 100) / 100, m: !!s.m
    };
  }

  function changed(a, b) {
    return !b || a.n !== b.n || a.c !== b.c || a.m !== b.m || a.hr !== b.hr || a.fc !== b.fc || a.hc !== b.hc ||
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
    peers.set(p.id, { t: Date.now(), n: name });
    const look = DATA.normLook({ hair: p.hr, face: p.fc, hairColor: p.hc });
    if (h.onPeer) h.onPeer({
      id: p.id, hair: look.hair, face: look.face, hairColor: look.hairColor,
      name: name,
      color: DATA.COLORS.indexOf(p.c) >= 0 ? p.c : DATA.COLORS[0],
      x: x, y: y, heading: num(p.h, -10, 10) || 0, moving: !!p.m
    });
    if (fresh) emitCount();
  }

  function onSay(p) {
    if (!p || typeof p.id !== 'string' || p.id === me || !peers.has(p.id)) return;
    const text = clean(p.text);
    if (!text) return;
    if (h.onSay) h.onSay(p.id, text);
    addLog(peers.get(p.id).n, text, false);
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
      channel.send({ type: 'broadcast', event: 'say', payload: { id: me, text: t } });
      if (h.onSay) h.onSay('me', t);
      addLog(myState().n, t, true);
      return { ok: true, text: t };
    },

    // 말풍선 기록 (오래된 것 → 최근 것)
    log: function () { return log.slice(); },
    clearLog: function () {
      log = [];
      try { window.localStorage.removeItem(LOG_KEY); } catch (e) { /* 무시 */ }
    },

    isOnline: function () { return joined; },
    count: function () { return peers.size; }
  };

  window.Live = Live;
})();
