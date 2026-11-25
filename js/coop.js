/* =========================================================
 * coop.js — 친구와 번갈아 돌 쌓기 (도움 요청 · 응답 · 연결 관리)
 *  - 돌탑 주인(host)이 지금 접속해 있는 친구(guest)에게 도움을 요청해요.
 *  - 신호는 live.js의 실시간 채널로 오가고, 서버에는 아무것도 저장하지 않아요.
 *  - 신호는 빠질 수 있어서 답이 올 때까지 다시 보내요. (화면·판정은 js3d/stack3d.js)
 *  - 돌탑과 기록은 주인 것: 친구 쪽에서는 아무것도 저장하지 않아요.
 *
 *  신호 종류(k): ask 도와줘 · cancel 요청 취소 · ans 응답 · go 시작 · hb 살아 있음 · bye 끝
 *               mv 움직이는 돌 · ld 착지 · ak 착지 확인 (이 셋은 Stack이 처리)
 * ========================================================= */
(function () {
  'use strict';

  const ASK_MS = 30000;       // 응답을 기다리는 시간
  const GO_MS = 12000;        // 수락한 뒤 시작을 기다리는 시간
  const LOST_MS = 12000;      // 이만큼 소식이 없으면 연결이 끊긴 걸로
  const MUTE_MS = 20000;      // 거절한 사람의 요청을 잠시 안 받는 시간

  let ui = {};                // main.js가 넘겨주는 화면 함수들
  let ask = null;             // 내가 보낸 요청 { sid, pid, name, until, plan }
  let inc = null;             // 받은 요청 { sid, pid, name, ok, until }
  let ses = null;             // 함께 쌓는 중 { sid, pid, name, host, rx, met, info }
  const muted = new Map();    // pid → 언제까지
  const done = new Map();     // sid → 내가 한 대답 ('no' | 'busy' | 'end')

  function now() { return Date.now(); }
  function newSid() { return now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function send(to, sid, m) { m.sid = sid; return Live.sendCoop(to, m); }
  function clip(s, n) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n); }
  // 받은 자리 정보 확인 { x, y, h }
  function spot(p) {
    if (!p || typeof p !== 'object') return null;
    const ok = [p.x, p.y, p.h].every(function (v) { return typeof v === 'number' && isFinite(v); });
    return ok && p.x >= 0 && p.x <= DATA.WORLD.w && p.y >= 0 && p.y <= DATA.WORLD.h ? { x: p.x, y: p.y, h: p.h } : null;
  }
  function remember(sid, v) {
    done.set(sid, v);
    if (done.size > 40) done.delete(done.keys().next().value);
  }

  /* ---------------- 주인: 요청 보내기 ---------------- */

  // plan() → 쌓을 내 돌탑(없으면 이때 세워요) 또는 null
  function invite(pid, name, title, plan) {
    if (ask || inc || ses) return false;
    if (!Live.isOnline()) return false;
    ask = { sid: newSid(), pid: pid, name: name, until: now() + ASK_MS, plan: plan, title: clip(title, 60), sent: 0 };
    tick();
    return true;
  }

  function cancelInvite() {
    if (!ask) return;
    const a = ask;
    ask = null;
    send(a.pid, a.sid, { k: 'cancel' });
  }

  function inviteEnded(why) {
    const a = ask;
    ask = null;
    if (a && ui.onInviteEnd) ui.onInviteEnd(why, a.name);
  }

  function onAns(m) {
    if (!ask || ask.sid !== m.sid || ask.pid !== m.id) {
      // 이미 취소했거나 시간이 지난 요청을 수락한 경우
      if (m.ok && !(ses && ses.sid === m.sid)) send(m.id, m.sid, { k: 'bye' });
      return;
    }
    if (!m.ok) { inviteEnded(m.why === 'busy' ? 'busy' : 'no'); return; }
    const a = ask;
    ask = null;
    const t = a.plan();
    if (!t) { send(a.pid, a.sid, { k: 'bye' }); return; }
    ses = {
      sid: a.sid, pid: a.pid, name: a.name, host: true, rx: now(), met: false,
      info: { name: t.name, cat: t.cat, wish: clip(t.wish, 60), best: t.best, tone: t.tone || 'natural' },
      at: ui.where ? ui.where() : null   // 내가 서 있는 자리 — 친구가 이 앞으로 와요
    };
    begin(t);
  }

  /* ---------------- 친구: 요청 받기 ---------------- */

  function onAsk(m) {
    const old = done.get(m.sid);
    if (old) { send(m.id, m.sid, { k: 'ans', ok: false, why: old }); return; }
    if (inc && inc.sid === m.sid) { if (inc.ok) send(m.id, m.sid, { k: 'ans', ok: true }); return; }
    if (ses && ses.sid === m.sid) return;
    const mute = muted.get(m.id) > now();
    if (ses || inc || ask || mute || (ui.busy && ui.busy())) {
      remember(m.sid, mute ? 'no' : 'busy');
      send(m.id, m.sid, { k: 'ans', ok: false, why: mute ? 'no' : 'busy' });
      return;
    }
    inc = { sid: m.sid, pid: m.id, name: Live.nameOf(m.id), ok: false, until: now() + ASK_MS };
    if (ui.onAsk) ui.onAsk(inc.name, clip(m.title, 60));
  }

  function answer(ok) {
    if (!inc || inc.ok) return;
    if (ok) {
      inc.ok = true;
      inc.until = now() + GO_MS;
      send(inc.pid, inc.sid, { k: 'ans', ok: true });
    } else {
      muted.set(inc.pid, now() + MUTE_MS);
      remember(inc.sid, 'no');
      send(inc.pid, inc.sid, { k: 'ans', ok: false, why: 'no' });
      inc = null;
    }
  }

  function askGone(why) {
    const i = inc;
    inc = null;
    if (!i) return;
    remember(i.sid, 'end');
    if (ui.onAskGone) ui.onAskGone(why, i.name);
  }

  function onGo(m) {
    if (!inc || inc.sid !== m.sid || inc.pid !== m.id || !inc.ok || !m.t || typeof m.t !== 'object') return;
    const t = {
      id: 'coop', name: clip(m.t.name, 10) || inc.name, cat: String(m.t.cat || ''), wish: clip(m.t.wish, 60),
      best: Math.max(0, Math.min(999, Math.round(Number(m.t.best) || 0))), tone: String(m.t.tone || 'natural')
    };
    ses = { sid: inc.sid, pid: inc.pid, name: inc.name, host: false, rx: now(), met: true, at: spot(m.p) };
    inc = null;
    begin(t);
  }

  /* ---------------- 함께 쌓는 중 ---------------- */

  function begin(t) {
    const s = ses;
    ui.start(t, {
      host: s.host,
      partner: s.name,
      at: s.host ? null : s.at,
      send: function (m) { if (ses === s) send(s.pid, s.sid, m); },
      leave: function () { if (ses === s) { end(); send(s.pid, s.sid, { k: 'bye' }); } }
    });
    beat();
  }

  function end() {
    if (ses) remember(ses.sid, 'end');
    ses = null;
  }

  function lost(why) {
    const s = ses;
    if (!s) return;
    end();
    if (why === 'lost') send(s.pid, s.sid, { k: 'bye' });
    Stack.coopLost(why, s.name);
  }

  function beat() {
    if (!ses) return;
    if (ses.host && !ses.met) send(ses.pid, ses.sid, { k: 'go', t: ses.info, p: ses.at });
    const m = Stack.coopBeat() || {};
    m.k = 'hb';
    send(ses.pid, ses.sid, m);
  }

  let lastBeat = 0, lastAns = 0;
  function tick() {
    const t = now();
    if (ask) {
      if (t > ask.until) { const a = ask; inviteEnded('late'); send(a.pid, a.sid, { k: 'cancel' }); }
      else if (t - ask.sent > 2500) { ask.sent = t; send(ask.pid, ask.sid, { k: 'ask', title: ask.title }); }
    }
    if (inc) {
      if (t > inc.until) askGone(inc.ok ? 'nogo' : 'late');
      else if (inc.ok && t - lastAns > 1500) { lastAns = t; send(inc.pid, inc.sid, { k: 'ans', ok: true }); }
    }
    if (ses) {
      if (t - ses.rx > LOST_MS) { lost('lost'); return; }
      Stack.coopTick();
      if (t - lastBeat > 1000) { lastBeat = t; beat(); }
    }
  }

  // 실시간 채널로 들어온 신호 (live.js가 나에게 온 것만 넘겨줘요)
  function recv(m) {
    if (typeof m.sid !== 'string' || m.sid.length > 40 || typeof m.k !== 'string') return;
    if (m.k === 'ask') { onAsk(m); return; }
    if (m.k === 'ans') { onAns(m); return; }
    if (m.k === 'cancel') {
      if (inc && inc.sid === m.sid && inc.pid === m.id) askGone('cancel');
      return;
    }
    if (m.k === 'go' && !ses) { onGo(m); return; }
    if (m.k === 'bye') {
      if (ses && ses.sid === m.sid && ses.pid === m.id) lost('left');
      else if (inc && inc.sid === m.sid && inc.pid === m.id) askGone('cancel');
      return;
    }
    if (!ses || ses.sid !== m.sid || ses.pid !== m.id) {
      // 이미 끝난 판의 신호면 끝났다고 알려 줘요
      if (m.k === 'hb' && done.get(m.sid) === 'end') send(m.id, m.sid, { k: 'bye' });
      return;
    }
    ses.rx = now();
    if (m.k === 'hb') ses.met = true;
    if (m.k !== 'go') Stack.coopRecv(m);
  }

  window.Coop = {
    // u = { busy(), where(), start(t, net), onAsk, onAskGone, onInviteEnd }
    init: function (u) {
      ui = u;
      setInterval(tick, 400);
      window.addEventListener('pagehide', function () {
        if (ask) cancelInvite();
        if (inc) send(inc.pid, inc.sid, { k: 'ans', ok: false, why: 'no' });
        if (ses) send(ses.pid, ses.sid, { k: 'bye' });
      });
    },
    recv: recv,
    invite: invite,
    cancelInvite: cancelInvite,
    answer: answer,
    inviting: function () { return !!ask; },
    asked: function () { return !!inc && !inc.ok; },
    active: function () { return !!ses; },
    // 도와주는 중이면 돌탑 주인의 id (다른 사람 화면에서 같은 돌탑을 쌓는 모습으로 보이게)
    helping: function () { return ses && !ses.host ? ses.pid : ''; }
  };
})();
