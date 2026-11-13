/* =========================================================
 * js3d/world.js — 움직이지 않는 3D 캠퍼스 배경 만들기
 *  잔디·길·건물·정문·솔못·운동장·나무·가로등·하늘·빛
 *  ※ 배치는 data.js의 캠퍼스 지도를 따르며, 실제 충북대를 "참고"해
 *    단순화한 것이에요. 층수는 게임용 추정값이에요.
 * ========================================================= */
import * as THREE from 'three';
import { S, W, H, toV3, PLAZA, onRoad } from './logic.js';
import * as TX from './textures.js';

const DATA = window.DATA;

// 건물별 층수(추정) — 실제 자료로 바꾸기 쉬운 자리
const FLOORS = { hq: 5, library: 5, union: 4, culture: 3, eng: 6, it: 6, science: 5, human: 4, social: 5, biz: 5, dorm: 8 };
const GLASSY = { library: true, it: true, eng: true };
const FLOOR_H = 3.6;

function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

function shadowed(mesh, cast, receive) {
  mesh.castShadow = cast !== false;
  mesh.receiveShadow = receive !== false;
  return mesh;
}

export function buildWorld(scene, o) {
  const mobile = !!o.mobile;
  const trees = o.trees;
  const signs = [];           // 웹폰트 로드 후 다시 그릴 간판
  const buildings = [];       // 카메라를 가릴 때 반투명 처리할 건물
  const animated = [];        // 매 프레임 움직이는 것들

  /* ---------------- 하늘·빛·안개 ---------------- */

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x5f9fdc) },
      bottom: { value: new THREE.Color(0xe4eef0) }
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP;' +
      'void main(){ float h = clamp(vP.y * 1.8 + 0.04, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.75)), 1.0);\n' +
      '#include <colorspace_fragment>\n}'
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMat);
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.Fog(0xdde8ec, 220, 1100);

  const hemi = new THREE.HemisphereLight(0xe3f0ff, 0x5f7246, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 320;
  scene.add(sun, sun.target);
  const SUN_OFFSET = new THREE.Vector3(70, 110, 45);

  /* ---------------- 땅·길 ---------------- */

  const grass = TX.grassTexture();
  const GROUND = 2400; // m
  grass.repeat.set(GROUND / 8, GROUND / 8);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND, GROUND),
    new THREE.MeshStandardMaterial({ map: grass, roughness: 1, color: 0xf2f5ea })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);

  const paving = TX.pavingTexture();
  const roadMat = new THREE.MeshStandardMaterial({ map: paving, roughness: 0.95 });
  DATA.ROADS.forEach(function (r, i) {
    const a = toV3(r.x1, r.y1), b = toV3(r.x2, r.y2);
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz), w = r.w * S;
    const y = 0.02 + i * 0.01;
    const geo = scaleUV(new THREE.PlaneGeometry(len, w), len / 4, w / 4);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, roadMat);
    m.rotation.y = Math.atan2(-dz, dx);
    m.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
    m.receiveShadow = true;
    scene.add(m);
    [a, b].forEach(function (p) {
      const cg = scaleUV(new THREE.CircleGeometry(w / 2, 24), w / 4, w / 4);
      cg.rotateX(-Math.PI / 2);
      const cap = new THREE.Mesh(cg, roadMat);
      cap.position.set(p.x, y, p.z);
      cap.receiveShadow = true;
      scene.add(cap);
    });
  });

  /* ---------------- 장소들 ---------------- */

  DATA.PLACES.forEach(function (p) {
    if (p.type === 'building') addBuilding(p);
    else if (p.type === 'gate') addGate(p);
    else if (p.type === 'pond') addPond(p);
    else if (p.type === 'field') addField(p);
  });

  function addSign(lines, wM, hM, o2) {
    const s = TX.signTexture(lines, o2);
    signs.push(s);
    return new THREE.Mesh(
      new THREE.PlaneGeometry(wM, hM),
      new THREE.MeshStandardMaterial({ map: s.texture, transparent: true, roughness: 0.6 })
    );
  }

  function addBuilding(p) {
    const floors = FLOORS[p.id] || 4;
    const w = p.w * S, d = p.h * S, h = floors * FLOOR_H;
    const c = toV3(p.x + p.w / 2, p.y + p.h / 2);
    const style = GLASSY[p.id] ? 'glass' : 'normal';
    const seed = p.x + p.y;
    const mat = function (tex) { return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82 }); };
    const side = mat(TX.facadeTexture(p.wall, floors, d, style, false, seed));
    const roof = new THREE.MeshStandardMaterial({ color: p.roof, roughness: 0.9 });
    const roofDark = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.roof).multiplyScalar(0.8), roughness: 0.9 });
    // BoxGeometry 면 순서: +x, -x, +y, -y, +z(남쪽 정면), -z
    const mats = [side, side, roof, roof,
      mat(TX.facadeTexture(p.wall, floors, w, style, true, seed + 1)),
      mat(TX.facadeTexture(p.wall, floors, w, style, false, seed + 2))];
    const g = new THREE.Group();
    g.position.set(c.x, 0, c.z);

    const box = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats));
    box.position.y = h / 2;
    g.add(box);
    const cap = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.7, d + 0.6), roofDark));
    cap.position.y = h + 0.35;
    g.add(cap);
    const hut = shadowed(new THREE.Mesh(new THREE.BoxGeometry(Math.min(6, w * 0.25), 3, Math.min(5, d * 0.35)), roof));
    hut.position.set(w * 0.22, h + 2.2, -d * 0.12);
    g.add(hut);
    const plinth = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.5, d + 0.8), new THREE.MeshStandardMaterial({ color: 0x9f978a, roughness: 1 })));
    plinth.position.y = 0.25;
    g.add(plinth);
    // 정면 현관 지붕
    const canopy = shadowed(new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, 2.6), roofDark));
    canopy.position.set(0, 3.6, d / 2 + 1.3);
    g.add(canopy);
    [-2.6, 2.6].forEach(function (x) {
      const col = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.4, 0.35), new THREE.MeshStandardMaterial({ color: 0xe8e2d6 })));
      col.position.set(x, 1.7, d / 2 + 2.3);
      g.add(col);
    });
    // 건물 이름 간판
    const sw = Math.min(w * 0.6, 14);
    const sign = addSign([{ text: p.name, size: 150, color: '#3d3229' }], sw, sw / 4, { bg: 'rgba(255,253,246,0.92)', border: '#4a3d33' });
    sign.position.set(0, h - 2, d / 2 + 0.06);
    g.add(sign);

    scene.add(g);
    const fadeMats = [];
    g.traverse(function (o2) {
      if (o2.isMesh) [].concat(o2.material).forEach(function (m) {
        if (fadeMats.indexOf(m) < 0) { m.userData.wasTransparent = m.transparent; fadeMats.push(m); }
      });
    });
    buildings.push({ place: p, center: c, height: h, mesh: box, mats: fadeMats, opacity: 1 });
  }

  function addGate(p) {
    const stone = new THREE.MeshStandardMaterial({ color: 0xcfc6b6, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x5d4c3f, roughness: 0.8 });
    const left = toV3(p.x, p.y + p.h - 10), right = toV3(p.x + p.w, p.y + p.h - 10);
    const span = right.x - left.x;
    [left, right].forEach(function (q) {
      const pil = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2.6, 9, 2.6), stone));
      pil.position.set(q.x, 4.5, q.z);
      scene.add(pil);
      const top = shadowed(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.6, 3.2), dark));
      top.position.set(q.x, 9.3, q.z);
      scene.add(top);
    });
    const beam = shadowed(new THREE.Mesh(new THREE.BoxGeometry(span + 3.2, 2.2, 1.8), dark));
    beam.position.set((left.x + right.x) / 2, 8.4, left.z);
    scene.add(beam);
    [1, -1].forEach(function (side) {
      const sign = addSign([
        { text: '충북대학교', size: 150, color: '#fff8e8' },
        { text: 'CHUNGBUK NATIONAL UNIVERSITY', size: 46, color: '#f2dfc0' }
      ], span * 0.8, 2.0, { w: 1536, h: 256 });
      sign.position.set((left.x + right.x) / 2, 8.4, left.z + side * 0.92);
      if (side < 0) sign.rotation.y = Math.PI;
      scene.add(sign);
    });
  }

  function addPond(p) {
    const c = toV3(p.x + p.w / 2, p.y + p.h / 2);
    const rx = p.w / 2 * S, rz = p.h / 2 * S;
    // 물가 흙
    const bank = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: 0x9c8f6e, roughness: 1 }));
    bank.rotation.x = -Math.PI / 2;
    bank.scale.set(rx + 1.4, rz + 1.4, 1);
    bank.position.set(c.x, 0.04, c.z);
    bank.receiveShadow = true;
    scene.add(bank);
    const water = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: 0x3f7f9c, roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.92 }));
    water.rotation.x = -Math.PI / 2;
    water.scale.set(rx, rz, 1);
    water.position.set(c.x, 0.07, c.z);
    water.receiveShadow = true;
    scene.add(water);
    animated.push(function (t) { water.material.color.setHSL(0.55, 0.42, 0.40 + Math.sin(t * 0.6) * 0.015); });

    // 물가 바위
    const rockGeo = new THREE.DodecahedronGeometry(0.7, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 1, flatShading: true }), 70);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < 70; i++) {
      const a = i / 70 * Math.PI * 2 + Math.sin(i * 7.3) * 0.03;
      const k = 1 + Math.sin(i * 3.1) * 0.03;
      v.set(c.x + Math.cos(a) * rx * k, 0.15, c.z + Math.sin(a) * rz * k);
      e.set(i, i * 2.1, i * 0.7); q.setFromEuler(e);
      const s = 0.7 + Math.abs(Math.sin(i * 12.9)) * 0.8;
      sc.set(s, s * 0.6, s);
      rocks.setMatrixAt(i, m4.compose(v, q, sc));
    }
    shadowed(rocks);
    scene.add(rocks);

    // 연잎
    const pads = new THREE.InstancedMesh(new THREE.CircleGeometry(0.6, 12).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4f8a3a, roughness: 0.8 }), 26);
    for (let i = 0; i < 26; i++) {
      const a = Math.sin(i * 9.7) * Math.PI, rr = 0.45 + Math.abs(Math.sin(i * 4.3)) * 0.45;
      v.set(c.x + Math.cos(a) * rx * rr, 0.1, c.z + Math.sin(a) * rz * rr);
      q.identity(); const s = 0.6 + Math.abs(Math.sin(i * 2.2)) * 0.8;
      sc.set(s, 1, s);
      pads.setMatrixAt(i, m4.compose(v, q, sc));
    }
    scene.add(pads);

    // 정자(물 위의 작은 쉼터)
    const pv = toV3(520, 1330);
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.8 });
    const roofM = new THREE.MeshStandardMaterial({ color: 0x4f5a5f, roughness: 0.7 });
    const deck = shadowed(new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 5), wood));
    deck.position.set(pv.x, 0.6, pv.z);
    scene.add(deck);
    [[-2, -2], [2, -2], [-2, 2], [2, 2]].forEach(function (o2) {
      const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 3.2, 8), wood));
      post.position.set(pv.x + o2[0], 2.2, pv.z + o2[1]);
      scene.add(post);
    });
    const proof = shadowed(new THREE.Mesh(new THREE.ConeGeometry(4.4, 1.8, 4), roofM));
    proof.rotation.y = Math.PI / 4;
    proof.position.set(pv.x, 4.6, pv.z);
    scene.add(proof);
  }

  function addField(p) {
    const c = toV3(p.x + p.w / 2, p.y + p.h / 2);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(p.w * S, p.h * S), new THREE.MeshStandardMaterial({ map: TX.trackTexture(), roughness: 1 }));
    f.rotation.x = -Math.PI / 2;
    f.position.set(c.x, 0.03, c.z);
    f.receiveShadow = true;
    scene.add(f);
    // 골대
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    [-1, 1].forEach(function (sd) {
      const gx = c.x + sd * p.w * S * 0.3;
      [-1.8, 1.8].forEach(function (oz) {
        const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2, 6), white));
        post.position.set(gx, 1, c.z + oz);
        scene.add(post);
      });
      const bar = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.6, 6), white));
      bar.rotation.x = Math.PI / 2;
      bar.position.set(gx, 2, c.z);
      scene.add(bar);
    });
  }

  /* ---------------- 소원 돌탑 마당 ---------------- */
  (function addPlaza() {
    const c = toV3(PLAZA.x, PLAZA.y), r = PLAZA.r * S;
    const gravel = TX.gravelTexture();
    const geo = scaleUV(new THREE.CircleGeometry(r, 64), r / 2, r / 2);
    geo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: gravel, roughness: 1 }));
    floor.position.set(c.x, 0.015, c.z);
    floor.receiveShadow = true;
    scene.add(floor);
    // 테두리 돌
    const n = 64;
    const border = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.35, 0), new THREE.MeshStandardMaterial({ color: 0xa79f92, roughness: 1, flatShading: true }), n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 0.7, 1);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      v.set(c.x + Math.cos(a) * r, 0.12, c.z + Math.sin(a) * r);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.3);
      border.setMatrixAt(i, m4.compose(v, q, sc));
    }
    shadowed(border);
    scene.add(border);
    // 나무 안내판 (큰길 쪽)
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.85 });
    const sp = toV3(PLAZA.x - PLAZA.r + 6, PLAZA.y - 30);
    [-0.9, 0.9].forEach(function (oz) {
      const post = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.2, 0.16), wood));
      post.position.set(sp.x, 1.1, sp.z + oz);
      scene.add(post);
    });
    const board = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 2.6), wood));
    board.position.set(sp.x, 1.8, sp.z);
    scene.add(board);
    const sign = addSign([{ text: '🪨 소원 돌탑 마당', size: 110, color: '#fff8e8' }, { text: '여기에 돌탑을 쌓아요', size: 70, color: '#ffe2a8' }], 2.4, 0.9, { w: 1024, h: 384 });
    sign.rotation.y = -Math.PI / 2;
    sign.position.set(sp.x - 0.07, 1.8, sp.z);
    scene.add(sign);
    // 벤치 4개
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x9b6b47, roughness: 0.8 });
    [0.6, 2.2, 3.8, 5.4].forEach(function (a) {
      const b = new THREE.Group();
      const seat = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 0.6), benchMat));
      seat.position.y = 0.5;
      b.add(seat);
      const back = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 0.1), benchMat));
      back.position.set(0, 0.85, -0.28);
      b.add(back);
      [-0.8, 0.8].forEach(function (x) {
        const leg = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.5), benchMat));
        leg.position.set(x, 0.25, 0);
        b.add(leg);
      });
      b.position.set(c.x + Math.cos(a) * (r + 1.6), 0, c.z + Math.sin(a) * (r + 1.6));
      b.lookAt(c.x, 0, c.z);
      scene.add(b);
    });
  })();

  /* ---------------- 담장(생울타리) ---------------- */
  (function addHedges() {
    const tex = TX.hedgeTexture();
    const gate = DATA.PLACES.find(function (p) { return p.type === 'gate'; });
    const segs = [
      [0, 12, W, 12], [12, 0, 12, H], [W - 12, 0, W - 12, H],
      [0, H - 8, gate.x - 10, H - 8], [gate.x + gate.w + 10, H - 8, W, H - 8]
    ];
    segs.forEach(function (sg) {
      const a = toV3(sg[0], sg[1]), b = toV3(sg[2], sg[3]);
      const lx = Math.abs(b.x - a.x) || 1.2, lz = Math.abs(b.z - a.z) || 1.2;
      const t2 = tex.clone();
      t2.repeat.set(Math.max(lx, lz) / 3, 0.5);
      const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(lx, 1.3, lz), new THREE.MeshStandardMaterial({ map: t2, roughness: 1 })));
      m.position.set((a.x + b.x) / 2, 0.65, (a.z + b.z) / 2);
      scene.add(m);
    });
  })();

  /* ---------------- 나무 (InstancedMesh로 가볍게) ---------------- */
  (function addTrees() {
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 2.4, 7);
    trunkGeo.translate(0, 1.2, 0);
    const roundGeo = blobGeometry(1.7, 5);
    roundGeo.translate(0, 3.4, 0);
    const pineGeo = new THREE.ConeGeometry(1.5, 4.2, 8);
    pineGeo.translate(0, 4.0, 0);
    const counts = { round: 0, pine: 0, blossom: 0 };
    trees.forEach(function (t) { counts[t.kind]++; });
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x7a5a43, roughness: 1 }), trees.length);
    const round = new THREE.InstancedMesh(roundGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), Math.max(1, counts.round));
    const blossom = new THREE.InstancedMesh(roundGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), Math.max(1, counts.blossom));
    const pine = new THREE.InstancedMesh(pineGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), Math.max(1, counts.pine));
    const idx = { round: 0, pine: 0, blossom: 0 };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    trees.forEach(function (t, i) {
      const p = toV3(t.x, t.y);
      const s = t.s * 1.15;
      v.set(p.x, 0, p.z);
      q.setFromAxisAngle(up, i * 2.4);
      sc.set(s, s, s);
      m4.compose(v, q, sc);
      trunks.setMatrixAt(i, m4);
      const k = (Math.sin(i * 12.7) + 1) / 2;
      if (t.kind === 'round') { round.setMatrixAt(idx.round, m4); round.setColorAt(idx.round++, col.setHSL(0.25 + k * 0.06, 0.45, 0.33 + k * 0.08)); }
      else if (t.kind === 'pine') { pine.setMatrixAt(idx.pine, m4); pine.setColorAt(idx.pine++, col.setHSL(0.36 + k * 0.04, 0.4, 0.24 + k * 0.05)); }
      else { blossom.setMatrixAt(idx.blossom, m4); blossom.setColorAt(idx.blossom++, col.setHSL(0.95 + k * 0.03, 0.62, 0.8 + k * 0.06)); }
    });
    [trunks, round, pine, blossom].forEach(function (m) { shadowed(m); scene.add(m); });
  })();

  /* ---------------- 가로등 (큰길 양쪽) ---------------- */
  (function addLamps() {
    const xs = [1200 - 52, 1200 + 52];
    const spots = [];
    for (let y = 230; y < 1600; y += 110) {
      xs.forEach(function (x) {
        const others = DATA.ROADS.filter(function (r) { return r.x1 !== 1200 || r.x2 !== 1200; });
        if (others.some(function (r) { return Math.abs(r.y1 - y) < r.w && r.y1 === r.y2; })) return;
        spots.push(toV3(x, y));
      });
    }
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.1, 4.6, 6); poleGeo.translate(0, 2.3, 0);
    const headGeo = new THREE.SphereGeometry(0.28, 10, 8); headGeo.translate(0, 4.75, 0);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x3e4447, roughness: 0.5, metalness: 0.4 }), spots.length);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xffe9b0, emissiveIntensity: 0.35 }), spots.length);
    const m4 = new THREE.Matrix4();
    spots.forEach(function (p, i) { m4.makeTranslation(p.x, 0, p.z); poles.setMatrixAt(i, m4); heads.setMatrixAt(i, m4); });
    shadowed(poles, true, false);
    scene.add(poles, heads);
  })();

  /* ---------------- 캠퍼스 바깥 (산·아파트) ---------------- */
  (function addSurroundings() {
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x6a8a55, roughness: 1, flatShading: true });
    const hillGeo = blobGeometry(1, 3);
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2 + 0.3;
      const d = 420 + Math.abs(Math.sin(i * 5.1)) * 260;
      const hill = new THREE.Mesh(hillGeo, hillMat);
      const s = 120 + Math.abs(Math.sin(i * 2.7)) * 140;
      hill.scale.set(s, s * (0.28 + Math.abs(Math.sin(i * 1.9)) * 0.22), s * 0.8);
      hill.position.set(Math.cos(a) * d, -6, Math.sin(a) * d);
      scene.add(hill);
    }
    const blockMat = new THREE.MeshStandardMaterial({ map: TX.facadeTexture('#e9e4dc', 15, 18, 'normal', false, 9), roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xb9b2a6 });
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2 + 0.15;
      const d = 190 + Math.abs(Math.sin(i * 3.3)) * 90;
      const h = 30 + Math.abs(Math.sin(i * 7.7)) * 24;
      const b = new THREE.Mesh(new THREE.BoxGeometry(18, h, 12), [blockMat, blockMat, roofMat, roofMat, blockMat, blockMat]);
      b.position.set(Math.cos(a) * d, h / 2, Math.sin(a) * d * 0.85);
      b.lookAt(0, h / 2, 0);
      scene.add(b);
    }
  })();

  // 간판 글꼴(Jua)이 늦게 로드되면 다시 그리기
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { signs.forEach(function (s) { s.redraw(); }); });
  }

  return {
    ground: ground,
    buildings: buildings,
    // 매 프레임: 하늘을 카메라에 붙이고, 그림자 범위를 초점 주변으로 옮겨요
    update: function (t, camera, focus, spread) {
      sky.position.copy(camera.position);
      sun.target.position.set(focus.x, 0, focus.z);
      sun.position.copy(sun.target.position).add(SUN_OFFSET);
      const sc = sun.shadow.camera;
      const half = Math.max(45, Math.min(120, spread));
      if (sc.right !== half) {
        sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
        sc.updateProjectionMatrix();
      }
      animated.forEach(function (f) { f(t); });
    }
  };
}

// 울퉁불퉁한 구(나뭇잎·언덕)
function blobGeometry(radius, seed) {
  const g = new THREE.IcosahedronGeometry(radius, 2);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 2.1 / radius + seed) * Math.sin(v.y * 2.7 / radius + seed * 2) * Math.sin(v.z * 1.9 / radius + seed * 3);
    v.multiplyScalar(1 + n * 0.18);
    if (v.y < 0) v.y *= 0.6;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
