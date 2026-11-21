/* =========================================================
 * layout.js — 캠퍼스 배치(맵 크기·건물·길) 저장·불러오기 (관리자 모드)
 *  배치 = { world: {w, h, ox, oy}, start: {x, y}, places: [...], roads: [...] }
 *   ox·oy: 맵을 위쪽·왼쪽으로 넓혀서 모든 게 밀려난 만큼 (돌탑 서버 좌표 + ox·oy = 게임 좌표)
 *
 *  어떤 배치를 쓰나요? (아래로 갈수록 우선)
 *   1) js/data.js 에 적힌 기본값
 *   2) js/layout-data.js (관리자 모드 📥 파일 받기 → 이 파일을 덮어쓰고 커밋하면 모두에게 적용)
 *   3) 이 브라우저에 💾 저장한 미리보기 (layout-data.js가 바뀌면 자동으로 버려요)
 *   4) Supabase campus_layout 표 (supabase/campus_layout.sql을 실행했을 때만)
 *
 *  불러온 배치는 DATA.WORLD·START·PLACES·ROADS를 "그 자리에서" 바꿔요.
 *  (다른 파일이 이 객체·배열을 그대로 쓰고 있어서 새로 만들면 안 돼요)
 *  ※ data.js·layout-data.js·store.js 다음, campus/main.js 전에 불러와야 해요.
 * ========================================================= */
(function () {
  'use strict';

  const KEY = 'cbnu-campus-layout-v2';
  const OLD_KEY = 'cbnu-campus-layout-v1';
  const TABLE = 'campus_layout';
  const TYPES = ['building', 'pond', 'field', 'gate'];
  const LIMIT = { wMin: 1600, wMax: 6000, hMin: 1200, hMax: 6000 };   // 맵 크기 범위(px, 10px = 1m)

  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function snapshot() { return { world: copy(DATA.WORLD), start: copy(DATA.START), places: copy(DATA.PLACES), roads: copy(DATA.ROADS) }; }
  DATA.WORLD.ox = DATA.WORLD.ox || 0;
  DATA.WORLD.oy = DATA.WORLD.oy || 0;
  const DEFAULT = snapshot();   // data.js에 적힌 기본 배치

  function num(v, lo, hi, d) {
    v = Number(v);
    if (!isFinite(v)) return d;
    return Math.max(lo, Math.min(hi, Math.round(v)));
  }
  function str(v, n, d) { v = String(v == null ? '' : v).trim().slice(0, n); return v || d; }
  function color(v, d) { return /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : d; }

  // 저장된 값이 이상해도 게임이 깨지지 않게 다듬어요
  //  o: 배치 객체 (예전 형식인 places 배열만 와도 돼요) · 빠진 부분은 지금 값으로 채워요
  function clean(o) {
    if (Array.isArray(o)) o = { places: o };
    if (!o || typeof o !== 'object' || !Array.isArray(o.places)) return null;
    const cur = snapshot();
    const wd = o.world || cur.world;
    const W = num(wd.w, LIMIT.wMin, LIMIT.wMax, cur.world.w), H = num(wd.h, LIMIT.hMin, LIMIT.hMax, cur.world.h);
    const OX = num(wd.ox, -LIMIT.wMax, LIMIT.wMax, 0), OY = num(wd.oy, -LIMIT.hMax, LIMIT.hMax, 0);
    const st = o.start || cur.start;

    const places = [], ids = {};
    o.places.forEach(function (p, i) {
      if (!p || TYPES.indexOf(p.type) < 0) return;
      let id = str(p.id, 40, 'b' + i).replace(/[^\w-]/g, '_');
      while (ids[id]) id += '_';
      ids[id] = true;
      const q = {
        id: id, name: str(p.name, 20, '새 건물'), type: p.type,
        x: num(p.x, 0, W, 100), y: num(p.y, 0, H, 100),
        w: num(p.w, 40, 1200, 200), h: num(p.h, 30, 900, 120)
      };
      if (p.type === 'building') {
        q.wall = color(p.wall, '#f2ece0');
        q.roof = color(p.roof, '#8a7a6a');
        q.icon = str(p.icon, 4, '🏫');
        q.floors = num(p.floors, 1, 20, 4);
        q.glass = !!p.glass;
      }
      places.push(q);
    });
    // 정문은 울타리·출발점과 이어져 있어서 꼭 하나만 있어야 해요
    const gates = places.filter(function (p) { return p.type === 'gate'; });
    let out = places;
    if (gates.length !== 1) {
      out = places.filter(function (p) { return p.type !== 'gate'; });
      const g = copy(DEFAULT.places.find(function (p) { return p.type === 'gate'; }));
      g.y = H - 100;
      out.unshift(g);
    }

    const roads = (Array.isArray(o.roads) ? o.roads : cur.roads).filter(function (r) { return r; }).map(function (r) {
      return { x1: num(r.x1, 0, W, 0), y1: num(r.y1, 0, H, 0), x2: num(r.x2, 0, W, 0), y2: num(r.y2, 0, H, 0), w: num(r.w, 16, 200, 44) };
    }).filter(function (r) { return r.x1 !== r.x2 || r.y1 !== r.y2; });

    return {
      world: { w: W, h: H, ox: OX, oy: OY },
      start: { x: num(st.x, 40, W - 40, Math.round(W / 2)), y: num(st.y, 40, H - 40, H - 230) },
      places: out,
      roads: roads
    };
  }

  function replaceArr(arr, list) { arr.length = 0; list.forEach(function (x) { arr.push(x); }); }

  function apply(o) {
    const c = clean(o);
    if (!c || !c.places.length) return false;
    DATA.WORLD.w = c.world.w; DATA.WORLD.h = c.world.h;
    DATA.WORLD.ox = c.world.ox; DATA.WORLD.oy = c.world.oy;
    DATA.START.x = c.start.x; DATA.START.y = c.start.y;
    replaceArr(DATA.PLACES, c.places);
    replaceArr(DATA.ROADS, c.roads);
    syncFrame();
    return true;
  }

  // 돌탑(store.js)도 같은 맵 기준점을 쓰게
  function syncFrame() {
    if (window.Store && Store.setFrame) Store.setFrame(DATA.WORLD.ox || 0, DATA.WORLD.oy || 0);
  }

  function readLocal() {
    try { return JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function writeLocal(obj) {
    try {
      if (obj) window.localStorage.setItem(KEY, JSON.stringify(obj));
      else window.localStorage.removeItem(KEY);
      return true;
    } catch (e) { return false; }
  }

  // 예전 버전(건물만 저장하던 'cbnu-campus-layout-v1')에 저장한 배치 옮겨 오기
  //  - 새 저장이 없으면: 그대로 옮겨요
  //  - 새 저장이 있지만 건물은 기본 그대로면(예전 배치가 안 보인 채로 맵 크기만 바꾼 경우):
  //    새 저장의 맵 크기·길·정문은 두고 건물만 예전 걸로 되살려요
  function sameBuildings(a, b) {
    const pick = function (list) {
      return JSON.stringify(list.filter(function (p) { return p.type !== 'gate'; }).map(function (p) { return [p.id, p.x, p.y, p.w, p.h, p.name]; }));
    };
    return pick(a) === pick(b);
  }
  function migrateV1(cur) {
    let old = null;
    try { old = JSON.parse(window.localStorage.getItem(OLD_KEY) || 'null'); } catch (e) { return cur; }
    if (!old || !Array.isArray(old.places) || old.source === 'remote') return cur;
    let next = null;
    if (!cur || !cur.data) {
      next = { source: 'local', base: fileStamp, updatedAt: old.updatedAt, data: { places: old.places } };
    } else if (cur.source === 'local' && Array.isArray(cur.data.places) && sameBuildings(cur.data.places, DEFAULT.places)) {
      const gate = cur.data.places.find(function (p) { return p.type === 'gate'; });
      const places = old.places.filter(function (p) { return p.type !== 'gate'; });
      if (gate) places.unshift(gate);
      next = { source: 'local', base: cur.base, updatedAt: cur.updatedAt, data: Object.assign({}, cur.data, { places: places }) };
    } else {
      return cur;   // 새 저장에 건물 변경이 있으면 그걸 써요
    }
    writeLocal(next);
    try { window.localStorage.removeItem(OLD_KEY); } catch (e) { /* 무시 */ }
    console.info('[배치] 예전에 저장한 건물 배치를 되살렸어요');
    return next;
  }

  // 1) js/layout-data.js (커밋된 배치 파일)
  const FILE = window.LAYOUT_DATA && typeof window.LAYOUT_DATA === 'object' ? window.LAYOUT_DATA : null;
  const fileStamp = FILE ? String(FILE.savedAt || 'file') : 'none';
  if (FILE) apply(FILE);

  // 2) 이 브라우저의 미리보기 — 배치 파일이 바뀌었으면(새로 배포됨) 버려요
  let local = readLocal();
  local = migrateV1(local);
  if (local && local.data) {
    if (local.source === 'local' && local.base !== fileStamp) writeLocal(null);
    else apply(local.data);
  }

  syncFrame();   // 배치를 하나도 안 썼을 때도 돌탑 기준점은 맞춰요

  // 3) 서버 배치 (있으면 그게 우선)
  let remote = 'off';   // 'off' 설정 없음 | 'ok' 표 있음 | 'missing' 표 없음(SQL 미실행) | 'error'
  const client = window.Store && Store.realtimeClient ? Store.realtimeClient() : null;
  const ready = !client ? Promise.resolve() : client.from(TABLE).select('data, updated_at').eq('id', 1).maybeSingle()
    .then(function (r) {
      if (r.error) {
        remote = (r.error.code === '42P01' || r.error.code === 'PGRST205' || /does not exist|schema cache/.test(r.error.message || '')) ? 'missing' : 'error';
        if (remote === 'missing') console.info('[배치] Supabase에 campus_layout 표가 없어요 → js/layout-data.js·이 브라우저 배치를 써요');
        else console.warn('[배치] 서버 배치를 받아 오지 못했어요:', r.error);
        return;
      }
      remote = 'ok';
      if (r.data && r.data.data) {
        if (apply(r.data.data)) writeLocal({ source: 'remote', updatedAt: r.data.updated_at, data: r.data.data });
      } else if (local && local.source === 'remote') {
        writeLocal(null);   // 서버 배치가 지워짐 → 다음부터는 파일·기본 배치
      }
    }).catch(function (e) { remote = 'error'; console.warn('[배치] 서버 연결 실패:', e); });

  function rpcError(r) {
    if (!r.error) return null;
    const m = r.error.message || '';
    if (r.error.code === 'PGRST202' || /function/i.test(m)) return 'Supabase에 supabase/campus_layout.sql을 먼저 실행해 주세요';
    return '서버 오류: ' + m;
  }

  window.Layout = {
    DEFAULT: DEFAULT,
    LIMIT: LIMIT,
    clean: clean,
    current: function () { return clean(snapshot()); },
    // 서버 배치를 받아 올 때까지(최대 ms) 기다려요 — 3D 캠퍼스를 짓기 전에 불러요
    ready: function (ms) {
      return Promise.race([ready, new Promise(function (res) { setTimeout(res, ms || 2500); })]);
    },
    // 'shared'(서버에 저장 → 모두에게) | 'local'(이 브라우저만)
    mode: function () { return remote === 'ok' ? 'shared' : 'local'; },
    remoteStatus: function () { return remote; },

    // 배치 저장 → Promise<{ ok, shared, error }>
    save: function (o) {
      const c = clean(o);
      if (!c) return Promise.resolve({ ok: false, error: '배치가 비어 있어요' });
      if (remote !== 'ok') {
        const ok = writeLocal({ source: 'local', base: fileStamp, updatedAt: new Date().toISOString(), data: c });
        return Promise.resolve(ok ? { ok: true, shared: false } : { ok: false, error: '브라우저에 저장할 수 없어요' });
      }
      const body = Object.assign({ version: 2 }, c);
      return client.rpc('save_campus_layout', { p_data: body }).then(function (r) {
        const err = rpcError(r);
        if (err) return { ok: false, error: err };
        writeLocal({ source: 'remote', updatedAt: r.data, data: c });
        return { ok: true, shared: true };
      }, function () { return { ok: false, error: '서버에 연결하지 못했어요' }; });
    },

    // js/layout-data.js 파일 내용 (관리자 모드 📥 파일 받기)
    fileText: function (o) {
      const c = clean(o);
      c.savedAt = new Date().toISOString();
      return '/* =========================================================\n' +
        ' * layout-data.js — 관리자 모드(index3d.html?admin)에서 만든 캠퍼스 배치\n' +
        ' *  관리자 모드 → 📥 파일 받기로 받은 파일로 이 파일을 덮어쓰고 커밋·배포하면\n' +
        ' *  모든 사람에게 이 배치(맵 크기·건물·길)가 보여요.\n' +
        ' *  null이면 js/data.js에 적힌 기본 배치를 써요.\n' +
        ' * ========================================================= */\n' +
        'window.LAYOUT_DATA = ' + JSON.stringify(c, null, 2) + ';\n';
    }
  };
})();
