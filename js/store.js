/* =========================================================
 * store.js — 저장소 (브라우저 localStorage + 선택: Supabase 공유)
 *  - 내 프로필(닉네임·색), 돌탑 목록, 좋아요, 응원을 저장해요.
 *  - localStorage를 쓸 수 없는 환경(사생활 보호 모드 등)에서도
 *    게임은 동작하고, 새로고침하면 기록만 사라져요.
 *  - window.SUPABASE_CONFIG(js/supabase-config.js)가 있으면
 *    돌탑을 Supabase에 올리고 다른 사람의 돌탑을 받아 와요.
 *    (좋아요·응원·예시 돌탑은 지금처럼 이 브라우저에만 저장)
 * ========================================================= */
(function () {
  'use strict';

  const KEY = 'cbnu-stonetower-v1';
  const TONE_IDS = ['natural', 'pastel', 'rainbow']; // 돌탑 꾸미기 테마 (3D)
  let storageOk = true;

  function seed() {
    const now = Date.now();
    const s = { version: 1, profile: null, myId: null, towers: {}, liked: {}, ox: 0, oy: 0 };
    DATA.DEMO_TOWERS.forEach(function (d, i) {
      s.towers[d.id] = {
        id: d.id, name: d.name, color: d.color, x: d.x, y: d.y,
        cat: d.cat, wish: d.wish, best: d.best, likes: d.likes,
        cheers: d.cheers.map(function (c, j) {
          return { name: c[0], text: c[1], t: now - (j + 1) * 3600e3 * (i + 1) };
        }),
        demo: true,
        createdAt: now - (i + 1) * 86400e3,
        updatedAt: now - (i + 1) * 3600e3 * 5
      };
    });
    return s;
  }

  function load() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.towers && typeof s.towers === 'object') {
          s.liked = s.liked || {};
          return s;
        }
      }
    } catch (e) {
      storageOk = false;
    }
    return seed();
  }

  let state = load();

  function save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
      storageOk = true;
    } catch (e) {
      storageOk = false;
    }
    return storageOk;
  }

  function uid() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  const Store = {
    isPersistent: function () { return storageOk; },

    getProfile: function () { return state.profile; },

    // look: { hair, face, hairColor } (캐릭터 꾸미기) — 없으면 지금 꾸민 모습 그대로
    setProfile: function (name, color, look) {
      const l = DATA.normLook(look || state.profile || null);
      state.profile = { name: name, color: color, hair: l.hair, face: l.face, hairColor: l.hairColor };
      const mine = Store.myTower();
      if (mine) { mine.name = name; mine.color = color; }
      save();
      if (mine) Online.push(mine);
    },

    myTower: function () {
      return state.myId ? state.towers[state.myId] || null : null;
    },

    isMine: function (id) { return !!state.myId && state.myId === id; },

    towers: function () {
      return Object.keys(state.towers).map(function (k) { return state.towers[k]; });
    },

    getTower: function (id) { return state.towers[id] || null; },

    createTower: function (o) {
      const p = state.profile || { name: '익명', color: DATA.COLORS[0] };
      const now = Date.now();
      const t = {
        id: uid(), name: p.name, color: p.color,
        x: Math.round(o.x), y: Math.round(o.y),
        cat: o.cat, wish: o.wish, best: 0, likes: 0, cheers: [],
        demo: false, createdAt: now, updatedAt: now
      };
      state.towers[t.id] = t;
      state.myId = t.id;
      save();
      Online.push(t);
      return t;
    },

    updateWish: function (id, cat, wish) {
      const t = state.towers[id];
      if (!t) return null;
      t.cat = cat;
      t.wish = wish;
      t.updatedAt = Date.now();
      save();
      if (id === state.myId) Online.push(t);
      return t;
    },

    // 쌓은 높이 기록 → 최고 기록이면 갱신
    recordHeight: function (id, h) {
      const t = state.towers[id];
      if (!t) return { best: 0, isRecord: false };
      const isRecord = h > t.best;
      if (isRecord) t.best = h;
      t.last = h;
      t.updatedAt = Date.now();
      save();
      if (id === state.myId) Online.push(t);
      return { best: t.best, isRecord: isRecord };
    },

    isLiked: function (id) { return !!state.liked[id]; },

    toggleLike: function (id) {
      const t = state.towers[id];
      if (!t) return null;
      if (state.liked[id]) {
        delete state.liked[id];
        t.likes = Math.max(0, t.likes - 1);
      } else {
        state.liked[id] = true;
        t.likes += 1;
      }
      save();
      return { liked: !!state.liked[id], count: t.likes };
    },

    addCheer: function (id, text) {
      const t = state.towers[id];
      if (!t) return null;
      const p = state.profile || { name: '익명' };
      const c = { name: p.name, text: text, t: Date.now() };
      t.cheers.unshift(c);
      if (t.cheers.length > 50) t.cheers.length = 50;
      save();
      return c;
    },

    // 개발·테스트용: 모든 기록 초기화
    reset: function () {
      state = seed();
      Store.setFrame(DATA.WORLD.ox || 0, DATA.WORLD.oy || 0);
      save();
    },

    // 돌탑 꾸미기 테마 저장 ('natural' 자연석톤 | 'pastel' 파스텔톤 | 'rainbow' 무지개톤)
    //  높이·닉네임·소원은 그대로 두고 테마만 바꿔요.
    setTone: function (id, tone) {
      const t = state.towers[id];
      if (!t) return null;
      const v = TONE_IDS.indexOf(tone) >= 0 ? tone : 'natural';
      if (t.tone === v || (!t.tone && v === 'natural')) return t; // 바뀐 게 없으면 저장 안 함
      t.tone = v;
      save();
      if (id === state.myId) Online.push(t);
      return t;
    },

    // 맵 기준점 맞추기 (layout.js가 불러요)
    //  관리자 모드에서 맵을 위쪽·왼쪽으로 넓히면 건물·길이 아래·오른쪽으로 밀려요.
    //  서버(stone_towers)의 돌탑 좌표는 그대로 두고, 게임 좌표 = 서버 좌표 + (ox, oy)로 바꿔서 보여 줘요.
    //  이 브라우저에 보관한 돌탑도 지금 기준점에 맞춰 함께 옮겨요.
    setFrame: function (ox, oy) {
      ox = ox | 0; oy = oy | 0;
      const dx = ox - (state.ox || 0), dy = oy - (state.oy || 0);
      if (!dx && !dy) return;
      Object.keys(state.towers).forEach(function (k) {
        state.towers[k].x += dx;
        state.towers[k].y += dy;
      });
      state.ox = ox; state.oy = oy;
      save();
    },

    // 관리자 모드: 돌탑 지우기 → Promise<{ ok, error }>
    //  서버에 올라간 돌탑은 서버에서 지워서 모두에게서 사라져요.
    //  예시 돌탑·이 브라우저에만 있는 돌탑은 이 브라우저에서만 지워져요.
    adminRemoveTower: function (id) {
      const t = state.towers[id];
      if (!t) return Promise.resolve({ ok: true });
      const job = t.rid ? Online.adminDelete(t.rid) : Promise.resolve({ ok: true, local: true });
      return job.then(function (r) {
        if (!r.ok) return r;
        delete state.towers[id];
        if (state.myId === id) state.myId = null;
        save();
        Online.emit();
        return r;
      });
    },

    // 온라인 공유 상태: 'off'(설정 없음) | 'connecting' | 'online' | 'readonly'(구경만) | 'offline'
    onlineStatus: function () { return Online.status(); },

    // 서버에서 돌탑 목록이 바뀌었거나 연결 상태가 바뀌면 알려 줘요
    onChange: function (fn) { Online.listen(fn); },

    // 실시간 기능(live.js)이 같은 Supabase 연결을 쓰도록 (없으면 null)
    realtimeClient: function () { return Online.client(); }
  };

  /* ---------------- 온라인 공유 (Supabase) ----------------
   *  - 접속하면 익명 로그인(회원가입 없음) → 고유 ID로 "내 돌탑"을 구별
   *  - 모든 돌탑을 30초마다(화면이 보일 때) 받아 와서 캠퍼스에 함께 세워요.
   *  - 내 돌탑은 만들기·기록·소원 수정·프로필 변경 때 서버에 저장해요.
   *  - 서버에서 받은 돌탑도 이 브라우저에 보관해서, 연결이 끊겨도 보여요.
   *  - 실패하면 게임은 그대로 진행되고, 다음 갱신 때 다시 시도해요.
   * ------------------------------------------------------- */
  const Online = (function () {
    const cfg = window.SUPABASE_CONFIG || {};
    const lib = window.supabase;
    // URL 끝에 /rest/v1/ 이나 / 가 붙어 있어도 프로젝트 주소만 사용
    const url = String(cfg.url || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
    const key = String(cfg.key || '').trim();
    const enabled = !!(url && key && lib && lib.createClient);
    const TABLE = 'stone_towers';
    const COLS = 'id, owner_id, nickname, wish, height, last_height, color, cat, x, y, created_at, updated_at';
    // 꾸미기 테마(tone) 칸: SQL을 아직 실행하지 않아 칸이 없으면 자동으로 빼고 동작해요
    let hasTone = true;
    function cols() { return hasTone ? COLS + ', tone' : COLS; }
    function missingTone(err) {
      return !!err && /tone/.test(err.message || '') && (err.code === '42703' || err.code === 'PGRST204');
    }
    function noToneColumn(err) {
      hasTone = false;
      console.warn('[온라인] stone_towers에 tone 칸이 없어서 꾸미기 테마는 이 브라우저에만 저장해요:', err.message);
    }
    const listeners = [];
    let client = null, userId = null, ready = null;
    let status = enabled ? 'connecting' : 'off';
    const chains = {};

    function emit() {
      listeners.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
    }
    function setStatus(s) { if (status !== s) { status = s; emit(); } }
    function clip(s, n) { return String(s || '').trim().slice(0, n); }
    function clampH(h) { return Math.max(0, Math.min(100, h | 0)); }
    function time(s) { const t = Date.parse(s); return isNaN(t) ? Date.now() : t; }

    function towerByRid(rid) {
      const k = Object.keys(state.towers).find(function (k2) { return state.towers[k2].rid === rid; });
      return k ? state.towers[k] : null;
    }

    // 익명 로그인 (이미 로그인돼 있으면 그대로 사용)
    function getReady() {
      if (!ready) {
        ready = client.auth.getSession().then(function (r) {
          if (r.data && r.data.session) return r.data.session;
          return client.auth.signInAnonymously().then(function (s) {
            if (s.error) throw s.error;
            return s.data.session;
          });
        }).then(function (session) {
          userId = session.user.id;
        }).catch(function (e) {
          ready = null; // 다음에 다시 시도
          throw e;
        });
      }
      return ready;
    }

    // 서버 행 → 게임 돌탑 (좋아요·응원은 이 브라우저 기록 유지)
    function apply(row, t) {
      t.rid = row.id;
      t.name = row.nickname;
      t.color = row.color;
      t.x = row.x + (state.ox || 0);   // 서버 좌표 → 게임 좌표 (Store.setFrame 참고)
      t.y = row.y + (state.oy || 0);
      t.cat = row.cat;
      t.wish = row.wish;
      t.best = row.height;
      t.last = row.last_height;
      if ('tone' in row) t.tone = TONE_IDS.indexOf(row.tone) >= 0 ? row.tone : 'natural';
      t.createdAt = time(row.created_at);
      t.updatedAt = time(row.updated_at);
      t.likes = t.likes || 0;
      t.cheers = t.cheers || [];
      t.demo = false;
      return t;
    }

    function merge(rows) {
      const seen = {};
      rows.forEach(function (row) {
        seen[row.id] = true;
        const mine = row.owner_id === userId;
        let t = towerByRid(row.id);
        // 서버에 있는 내 돌탑과 이 브라우저의 (아직 안 올린) 내 돌탑을 연결
        if (!t && mine && state.myId && state.towers[state.myId] && !state.towers[state.myId].demo) {
          t = state.towers[state.myId];
        }
        if (t && (mine || t.id === state.myId)) {
          state.myId = t.id;
          // 이 브라우저 기록이 더 새롭거나 높으면(예: 2D 버전에서 쌓음) 서버로 올려요
          if (t.dirty || t.best > row.height || (t.updatedAt || 0) > time(row.updated_at) + 1000) {
            t.rid = row.id;
            t.dirty = true;
            return;
          }
        }
        if (!t) t = { id: 'r' + row.id, likes: 0, cheers: [] };
        state.towers[t.id] = apply(row, t);
        if (mine) state.myId = t.id;
      });
      // 서버에서 사라진 돌탑은 정리
      //  내 돌탑도 서버에 올라간 적이 있는데(rid) 사라졌으면 관리자가 지운 거예요 → 새로 세울 수 있게
      //  (아직 올리는 중(dirty)인 건 빼고)
      Object.keys(state.towers).forEach(function (k) {
        const t = state.towers[k];
        if (!t.rid || seen[t.rid]) return;
        if (k !== state.myId) delete state.towers[k];
        else if (!t.dirty) { delete state.towers[k]; state.myId = null; }
      });
      save();
    }

    function insert(t) {
      return client.from(TABLE).insert({
        nickname: clip(t.name, 10) || '익명', wish: clip(t.wish, 60), color: t.color,
        cat: t.cat, x: Math.round(t.x - (state.ox || 0)), y: Math.round(t.y - (state.oy || 0))
      }).select('id, created_at').single().then(function (r) {
        if (r.error && r.error.code === '23505') {
          // 이미 서버에 내 돌탑이 있음(1인 1탑) → 그 돌탑과 연결
          return client.from(TABLE).select('id').eq('owner_id', userId).single().then(function (q) {
            if (q.error) throw q.error;
            t.rid = q.data.id;
          });
        }
        if (r.error) throw r.error;
        t.rid = r.data.id;
        t.createdAt = time(r.data.created_at);
      });
    }

    function update(t) {
      const body = {
        nickname: clip(t.name, 10) || '익명', wish: clip(t.wish, 60), color: t.color, cat: t.cat,
        height: clampH(t.best), last_height: clampH(t.last || 0)
      };
      if (hasTone && t.tone) body.tone = t.tone;
      return client.from(TABLE).update(body).eq('id', t.rid).select('height, updated_at').then(function (r) {
        // tone 칸이 없으면 테마만 빼고 다시 저장 (높이·소원 저장은 그대로)
        if (r.error && 'tone' in body && missingTone(r.error)) { noToneColumn(r.error); return update(t); }
        if (r.error) throw r.error;
        // RLS에 막히면 오류 없이 0행이 와요 → 실패로 처리
        if (!r.data || !r.data.length) throw new Error('돌탑을 수정할 권한이 없어요');
        t.best = Math.max(t.best, r.data[0].height);
        t.updatedAt = time(r.data[0].updated_at);
      });
    }

    // 내 돌탑을 서버에 저장 (같은 돌탑의 저장은 순서대로)
    function push(t) {
      if (!enabled || !t || t.demo) return;
      t.dirty = true;
      save();
      chains[t.id] = (chains[t.id] || Promise.resolve()).then(getReady).then(function () {
        if (t.rid) return update(t);
        return insert(t).then(function () {
          if (t.best > 0 || t.last || (t.tone && t.tone !== 'natural')) return update(t);
        });
      }).then(function () {
        t.dirty = false;
        save();
        setStatus('online');
      }, function (err) {
        console.warn('[온라인] 저장하지 못했어요. 다음에 다시 시도해요:', err);
        setStatus(status === 'readonly' ? 'readonly' : 'offline');
      });
    }

    // 모든 돌탑 받아 오기
    //  - 익명 로그인에 실패해도(대시보드에서 꺼져 있는 경우 등) 구경은 할 수 있게
    //    로그인 없이 목록을 읽고, 상태는 'readonly'(내 돌탑은 이 기기에만 저장)로 표시
    function refresh() {
      let signedIn = true;
      return getReady().catch(function (err) {
        signedIn = false;
        console.warn('[온라인] 익명 로그인에 실패했어요. Supabase 대시보드에서 Anonymous sign-ins를 켜 주세요:', err);
      }).then(function () {
        return client.from(TABLE).select(cols()).order('id').limit(2000).then(function (r) {
          if (r.error && hasTone && missingTone(r.error)) {
            noToneColumn(r.error);
            return client.from(TABLE).select(cols()).order('id').limit(2000);
          }
          return r;
        });
      }).then(function (r) {
        if (r.error) throw r.error;
        merge(r.data || []);
        const mine = state.myId && state.towers[state.myId];
        if (signedIn && mine && !mine.demo && (!mine.rid || mine.dirty)) push(mine);
        status = signedIn ? 'online' : 'readonly';
        emit();
      }).catch(function (err) {
        console.warn('[온라인] 돌탑을 받아 오지 못했어요:', err);
        setStatus('offline');
      });
    }

    if (enabled) {
      client = lib.createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cbnu-stonetower-auth' }
      });
      refresh();
      setInterval(function () { if (!document.hidden) refresh(); }, 30000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    }

    // 관리자: 서버의 돌탑 지우기 (서버 함수 admin_delete_tower)
    function adminDelete(rid) {
      if (!enabled) return Promise.resolve({ ok: true });
      return client.rpc('admin_delete_tower', { p_id: String(rid) }).then(function (r) {
        if (!r.error) return { ok: true, count: r.data };
        const m = r.error.message || '';
        if (r.error.code === 'PGRST202' || /function/i.test(m)) return { ok: false, error: 'Supabase에 supabase/campus_layout.sql을 다시 실행해 주세요' };
        return { ok: false, error: '서버 오류: ' + m };
      }, function () { return { ok: false, error: '서버에 연결하지 못했어요' }; });
    }

    return {
      push: push,
      adminDelete: adminDelete,
      emit: emit,
      client: function () { return client; },
      status: function () { return status; },
      listen: function (fn) { listeners.push(fn); }
    };
  })();

  window.Store = Store;
})();
