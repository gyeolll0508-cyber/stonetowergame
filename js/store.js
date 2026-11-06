/* =========================================================
 * store.js — 저장소 (서버 없이 브라우저 localStorage 사용)
 *  - 내 프로필(닉네임·색), 돌탑 목록, 좋아요, 응원을 저장해요.
 *  - localStorage를 쓸 수 없는 환경(사생활 보호 모드 등)에서도
 *    게임은 동작하고, 새로고침하면 기록만 사라져요.
 * ========================================================= */
(function () {
  'use strict';

  const KEY = 'cbnu-stonetower-v1';
  let storageOk = true;

  function seed() {
    const now = Date.now();
    const s = { version: 1, profile: null, myId: null, towers: {}, liked: {} };
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

    setProfile: function (name, color) {
      state.profile = { name: name, color: color };
      const mine = Store.myTower();
      if (mine) { mine.name = name; mine.color = color; }
      save();
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
      return t;
    },

    updateWish: function (id, cat, wish) {
      const t = state.towers[id];
      if (!t) return null;
      t.cat = cat;
      t.wish = wish;
      t.updatedAt = Date.now();
      save();
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
      save();
    }
  };

  window.Store = Store;
})();
