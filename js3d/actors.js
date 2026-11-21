/* =========================================================
 * js3d/actors.js — 3D 돌·돌탑·캐릭터 만들기
 *  - 돌 7종(stones.js의 모양 정보)을 울퉁불퉁한 3D 돌로 만들어요.
 *  - 돌탑: 최고 기록(best)만큼 돌을 쌓아 보여 줘요(2D 지도와 같은 규칙).
 * ========================================================= */
import * as THREE from 'three';
import { toV3 } from './logic.js?v=2026112206';
import { glowTexture } from './textures.js?v=2026112206';
import { paintStone } from './tones.js';

const DATA = window.DATA, STONES = window.STONES;
const MINI = ['flat', 'block', 'mong', 'flat', 'pebble', 'block', 'long', 'mong']; // 2D 지도와 같은 순서

/* ---------------- 간단한 3D 노이즈 ---------------- */

function hash(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function smooth(t) { return t * t * (3 - 2 * t); }
export function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
  const l = function (a, b, t) { return a + (b - a) * t; };
  return l(
    l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), xf), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), xf), yf),
    l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), xf), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), xf), yf),
    zf);
}

/* ---------------- 돌 ---------------- */

const geoCache = {};
const matCache = {};

// 크기 1×1×1 안에 들어가는 돌 모양 (shape: slab/block/oval/round/pointy)
function stoneGeometry(shape, variant) {
  const key = shape + ':' + variant;
  if (geoCache[key]) return geoCache[key];
  const g = new THREE.SphereGeometry(0.5, 26, 16);
  const pos = g.attributes.position;
  const colors = [];
  const v = new THREE.Vector3();
  const e = shape === 'block' ? 0.42 : shape === 'slab' ? 0.62 : 1;
  const sgn = function (a) { return a < 0 ? -1 : 1; };
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).multiplyScalar(2);
    if (e !== 1) {
      v.set(sgn(v.x) * Math.pow(Math.abs(v.x), e), sgn(v.y) * Math.pow(Math.abs(v.y), e), sgn(v.z) * Math.pow(Math.abs(v.z), e));
    }
    if (shape === 'pointy') {
      const t = (v.y + 1) / 2;
      const k = 1 - 0.82 * Math.pow(t, 1.25);
      v.x *= k; v.z *= k;
    }
    const o = variant * 7.31;
    const n1 = noise(v.x * 1.6 + o, v.y * 1.6, v.z * 1.6) - 0.5;
    const n2 = noise(v.x * 4.2 + o, v.y * 4.2 + 3, v.z * 4.2) - 0.5;
    v.multiplyScalar(1 + n1 * 0.2 + n2 * 0.06);
    pos.setXYZ(i, v.x * 0.5, v.y * 0.5, v.z * 0.5);
    // 꼭짓점 색: 위는 밝게, 아래는 어둡게, 군데군데 이끼
    let c = 0.8 + 0.2 * (v.y + 1) / 2 + n2 * 0.35;
    const moss = noise(v.x * 2.4 + 11 + o, v.y * 2.4, v.z * 2.4);
    if (moss > 0.7 && v.y > -0.3) colors.push(c * 0.62, c * 0.88, c * 0.5);
    else colors.push(c, c * 0.98, c * 0.95);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  geoCache[key] = g;
  return g;
}

function stoneMaterial(type) {
  if (!matCache[type.id]) {
    matCache[type.id] = new THREE.MeshStandardMaterial({ color: type.color, vertexColors: true, roughness: 0.93, metalness: 0 });
  }
  return matCache[type.id];
}

export function makeStone(typeId, seed) {
  const type = typeId === 'base'
    ? { id: 'base', color: '#9c9488', shape: 'block' }
    : STONES.byId(typeId);
  const m = new THREE.Mesh(stoneGeometry(type.shape, (seed || 0) % 4), stoneMaterial(type));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/* ---------------- 돌탑 ---------------- */

let glowTex = null;
const ringGeo = new THREE.RingGeometry(1.05, 1.35, 48).rotateX(-Math.PI / 2);
const poleGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6);
const poleMat = new THREE.MeshStandardMaterial({ color: 0x6b5240, roughness: 0.8 });
const flagGeo = (function () {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(0.55, -0.15); s.lineTo(0, -0.32); s.closePath();
  return new THREE.ShapeGeometry(s);
})();

/**
 * 캠퍼스에 서 있는 돌탑 하나
 * @returns { group, hit(터치 판정용), ring(강조 표시), topY, update(t) }
 */
export function makeTower(t) {
  const group = new THREE.Group();
  const p = toV3(t.x, t.y);
  group.position.set(p.x, 0, p.z);
  const own = []; // 이 돌탑만 쓰는 재질(삭제할 때 정리)

  // 받침돌
  const base = makeStone('base', t.x);
  base.scale.set(1.5, 0.34, 1.2);
  base.position.y = 0.15;
  base.rotation.y = (t.x % 7) * 0.4;
  group.add(base);

  let y = 0.3;
  const n = Math.min(t.best, DATA.GAUGE_MAX);
  for (let i = 0; i < n; i++) {
    const ty = STONES.byId(MINI[(i + t.x) % MINI.length]);
    const hh = ty.shape === 'oval' ? 0.26 : 0.22;
    let w = Math.min(ty.w / ty.h * hh, 1.15 - i * 0.04);
    w = Math.max(w, 0.36);
    const d = w * (ty.shape === 'slab' ? 0.72 : 0.82);
    const s = makeStone(ty.id, i + t.y);
    s.scale.set(w, hh, d);
    s.position.set(Math.sin(i * 1.7 + t.y) * 0.05, y + hh * 0.46, Math.cos(i * 1.3 + t.x) * 0.05);
    s.rotation.y = i * 1.9 + t.x;
    paintStone(s, t.tone, i + 1); // 꾸미기 테마(저장된 값, 없으면 자연석톤)
    group.add(s);
    y += hh * 0.86;
  }

  // 카테고리 깃발
  const cat = DATA.category(t.cat);
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.scale.y = 0.9;
  pole.position.y = y + 0.45;
  pole.castShadow = true;
  group.add(pole);
  const flagMat = new THREE.MeshStandardMaterial({ color: cat.color, side: THREE.DoubleSide, roughness: 0.7 });
  own.push(flagMat);
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.set(0, y + 0.88, 0);
  flag.castShadow = true;
  group.add(flag);
  const topY = y + 0.95;

  // 소원 게이지 100%: 은은한 빛
  let halo = null;
  if (t.best >= DATA.GAUGE_MAX) {
    glowTex = glowTex || glowTexture();
    const hm = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 });
    own.push(hm);
    halo = new THREE.Sprite(hm);
    halo.scale.set(4.2, 4.2, 1);
    halo.position.y = topY * 0.6;
    group.add(halo);
  }

  // 강조 링 (상세 보기·기록 갱신 때)
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: 0.9, depthWrite: false });
  own.push(ringMat);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.06;
  ring.visible = false;
  group.add(ring);

  // 터치 판정용 보이지 않는 원기둥
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  own.push(hitMat);
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, topY + 0.4, 10), hitMat);
  hit.position.y = (topY + 0.4) / 2;
  hit.userData.towerId = t.id;
  group.add(hit);

  return {
    group: group,
    hit: hit,
    ring: ring,
    topY: topY,
    update: function (time, highlighted) {
      ring.visible = highlighted;
      if (highlighted) {
        const k = 1 + Math.sin(time * 5) * 0.08;
        ring.scale.set(k, 1, k);
      }
      if (halo) halo.material.opacity = 0.6 + Math.sin(time * 2 + t.x) * 0.2;
      flag.rotation.y = Math.sin(time * 2.4 + t.y) * 0.35;
    },
    dispose: function () {
      hit.geometry.dispose();
      own.forEach(function (m) { m.dispose(); });
    }
  };
}

/* ---------------- 캐릭터 ----------------
 * 말랑한 점토 인형 느낌의 2등신 꼬마
 *  - 밝은 살구빛 큰 얼굴 + 웃는 눈(^ ^) + 작은 ω 입 + 분홍 볼
 *  - 까만 바가지 머리
 *  - 과잠(야구점퍼): 몸통 = 내가 고른 색, 소매 = 크림색,
 *    줄무늬 목깃·소매 끝·밑단, 똑딱단추, 가슴 와펜
 * ------------------------------------------------ */

const JK_BOTTOM = 0.34, JK_TOP = 0.94;
// 과잠 몸통 반지름 (높이 y에서) — 아래는 넉넉하고 어깨는 둥글게
function jacketR(y) {
  const t = (y - JK_BOTTOM) / (JK_TOP - JK_BOTTOM);
  return 0.31 - 0.03 * t - 0.09 * Math.pow(Math.max(0, t - 0.7) / 0.3, 2);
}
function jacketGeo() {
  const pts = [new THREE.Vector2(0, JK_BOTTOM)];
  for (let i = 0; i <= 24; i++) {
    const y = JK_BOTTOM + (JK_TOP - JK_BOTTOM) * i / 24;
    pts.push(new THREE.Vector2(jacketR(y), y));
  }
  pts.push(new THREE.Vector2(0, JK_TOP));
  return new THREE.LatheGeometry(pts, 32);
}

// 가슴 와펜(크림색 "C" 글자)
let patchTex = null;
function patchTexture() {
  if (patchTex) return patchTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.font = 'bold 110px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 14;
  g.strokeStyle = '#3a3550';
  g.strokeText('C', 64, 70);
  g.fillStyle = '#fff6e6';
  g.fillText('C', 64, 70);
  patchTex = new THREE.CanvasTexture(cv);
  patchTex.colorSpace = THREE.SRGBColorSpace;
  return patchTex;
}

// 웃는 눈(∩)·입(ω)에 쓰는 반원 고리
const arcGeo = new THREE.TorusGeometry(0.048, 0.013, 6, 14, Math.PI);
const mouthGeo = new THREE.TorusGeometry(0.024, 0.009, 6, 10, Math.PI);

const bodyGeo = jacketGeo();
const ribGeo = new THREE.TorusGeometry(1, 0.045, 8, 32);
const stripeGeo = new THREE.TorusGeometry(1, 0.012, 6, 32);
const armGeo = new THREE.CapsuleGeometry(0.095, 0.24, 6, 12);
const cuffGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.06, 14);
const handGeo = new THREE.SphereGeometry(0.075, 14, 10);
const legGeo = new THREE.CapsuleGeometry(0.09, 0.12, 6, 12);
const shoeGeo = new THREE.SphereGeometry(0.1, 14, 10);
const snapGeo = new THREE.SphereGeometry(0.022, 8, 6);
const patchGeo = new THREE.PlaneGeometry(0.15, 0.15);
const headGeo = new THREE.SphereGeometry(0.43, 32, 24);
const hairGeo = new THREE.SphereGeometry(0.455, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.52);
const blushGeo = new THREE.CircleGeometry(0.065, 18);
// 헤어스타일 부품
const shortHairGeo = new THREE.SphereGeometry(0.45, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.42);
const tuftGeo = new THREE.SphereGeometry(0.08, 12, 8);
const longBackGeo = new THREE.SphereGeometry(0.4, 24, 16);
const sideLockGeo = new THREE.CapsuleGeometry(0.07, 0.2, 4, 10);
const braidGeo = new THREE.SphereGeometry(0.085, 14, 10);
const ribbonGeo = new THREE.SphereGeometry(0.05, 10, 8);
const bunGeo = new THREE.SphereGeometry(0.17, 20, 14);
// 표정 부품
const dotEyeGeo = new THREE.SphereGeometry(0.04, 12, 10);
const smileGeo = new THREE.TorusGeometry(0.05, 0.011, 6, 14, Math.PI);
const lineGeo = new THREE.CapsuleGeometry(0.011, 0.07, 3, 6);
const oMouthGeo = new THREE.TorusGeometry(0.028, 0.012, 6, 16);

const skinMat = new THREE.MeshStandardMaterial({ color: 0xffe3cf, roughness: 0.6 });
const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xe8534a, roughness: 0.6 });
const wowMat = new THREE.MeshBasicMaterial({ color: 0xc4584e });
const hairMat = new THREE.MeshStandardMaterial({ color: 0x231d1c, roughness: 0.5, side: THREE.DoubleSide });
const faceMat = new THREE.MeshBasicMaterial({ color: 0x3a2a24 });
const blushMat = new THREE.MeshBasicMaterial({ color: 0xff9aa2, transparent: true, opacity: 0.55, depthWrite: false });
const sleeveMat = new THREE.MeshStandardMaterial({ color: 0xf6efe2, roughness: 0.8 });
const ribMat = new THREE.MeshStandardMaterial({ color: 0x34324a, roughness: 0.85 });
const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf6efe2, roughness: 0.8 });
const snapMat = new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.4, metalness: 0.2 });
const pantsMat = new THREE.MeshStandardMaterial({ color: 0x3d4a6e, roughness: 0.85 });
const shoeMat = new THREE.MeshStandardMaterial({ color: 0xfaf7f2, roughness: 0.7 });

export function makeCharacter(color, look) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // 걸을 때 통통 튀는 부분
  root.add(body);
  const jacketMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.78 });
  const patchMat = new THREE.MeshBasicMaterial({ map: patchTexture(), transparent: true, depthWrite: false });
  const meshes = [];
  function add(geo, mat, x, y, z, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    (parent || body).add(m);
    meshes.push(m);
    return m;
  }
  // 몸통을 감싸는 줄무늬 고리(밑단·목깃)
  function ring(y, r, stripes) {
    const rb = add(ribGeo, ribMat, 0, y, 0);
    rb.rotation.x = Math.PI / 2;
    rb.scale.set(r, r, 1);
    stripes.forEach(function (dy) {
      const st = add(stripeGeo, stripeMat, 0, y + dy, 0);
      st.rotation.x = Math.PI / 2;
      const sr = r + 0.04;
      st.scale.set(sr, sr, 1);
    });
  }

  // 다리 + 신발 (엉덩이 높이에서 앞뒤로 흔들리게)
  const legs = [-0.12, 0.12].map(function (x) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.32, 0);
    root.add(pivot);
    add(legGeo, pantsMat, 0, -0.14, 0, pivot);
    const shoe = add(shoeGeo, shoeMat, 0, -0.27, 0.04, pivot);
    shoe.scale.set(1, 0.6, 1.35);
    return pivot;
  });

  // 과잠 몸통
  add(bodyGeo, jacketMat, 0, 0, 0);
  ring(JK_BOTTOM + 0.02, jacketR(JK_BOTTOM) - 0.01, [0.02]);   // 밑단
  ring(JK_TOP - 0.01, 0.15, [-0.015]);                            // 목깃
  // 똑딱단추 4개 (앞 가운데)
  [0.46, 0.58, 0.7, 0.82].forEach(function (y) { add(snapGeo, snapMat, 0, y, jacketR(y) + 0.006); });
  // 가슴 와펜
  const px = -0.13, py = 0.74;
  const pz = Math.sqrt(Math.max(0, jacketR(py) * jacketR(py) - px * px)) + 0.008;
  const patch = new THREE.Mesh(patchGeo, patchMat);
  patch.position.set(px, py, pz);
  patch.rotation.y = Math.atan2(px, pz);
  body.add(patch);

  // 크림색 소매 + 줄무늬 소매 끝 + 손 (어깨에서 흔들리게)
  const arms = [-1, 1].map(function (side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.25, 0.86, 0);
    pivot.rotation.z = side * 0.4;
    body.add(pivot);
    add(armGeo, sleeveMat, 0, -0.18, 0, pivot);
    add(cuffGeo, ribMat, 0, -0.35, 0, pivot);
    add(handGeo, skinMat, 0, -0.42, 0, pivot);
    return pivot;
  });

  // 머리 (살짝 납작한 큰 얼굴) — 머리카락·표정은 setLook으로 바꿔 끼워요
  const head = new THREE.Group();
  head.position.y = 1.35;
  body.add(head);
  const face = add(headGeo, skinMat, 0, 0, 0, head);
  face.scale.set(1.04, 0.96, 1);
  const hairG = new THREE.Group(), faceG = new THREE.Group();
  const myHairMat = hairMat.clone();   // 캐릭터마다 머리색이 달라서 따로
  head.add(hairG, faceG);

  function part(group, geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = group === hairG;
    group.add(m);
    return m;
  }
  // 얼굴 앞면의 점 (x, y) → 머리 표면 위에 붙이기
  function onFace(geo, mat, x, y, lift) {
    const z = Math.sqrt(Math.max(0, 0.43 * 0.43 - x * x / 1.08 - y * y / 0.92)) + (lift || 0.004);
    const m = part(faceG, geo, mat, x, y, z);
    m.rotation.y = Math.atan2(x, z) * 0.9;
    m.rotation.x = -Math.atan2(y, z) * 0.9;
    return m;
  }

  function buildHair(id) {
    hairG.clear();
    if (id === 'short') {
      const cap = part(hairG, shortHairGeo, myHairMat, 0, 0.04, -0.02);
      cap.rotation.x = -0.18;
      cap.scale.set(1.04, 0.96, 1);
      part(hairG, tuftGeo, myHairMat, 0.07, 0.43, 0.04).scale.set(1, 0.7, 1);
      return;
    }
    const bowl = part(hairG, hairGeo, myHairMat, 0, 0.03, -0.015);
    bowl.rotation.x = -0.3;
    bowl.scale.set(1.04, 0.96, 1);
    if (id === 'long') {
      part(hairG, longBackGeo, myHairMat, 0, -0.22, -0.14).scale.set(1.08, 1.35, 0.75);
    }
    if (id === 'long' || id === 'twin') {
      [-1, 1].forEach(function (s) { part(hairG, sideLockGeo, myHairMat, s * 0.4, -0.1, 0.07); });
    }
    if (id === 'twin') {
      [-1, 1].forEach(function (s) {
        for (let i = 0; i < 3; i++) {
          part(hairG, braidGeo, myHairMat, s * (0.43 + i * 0.01), -0.28 - i * 0.13, -0.03).scale.setScalar(1 - i * 0.1);
        }
        part(hairG, ribbonGeo, ribbonMat, s * 0.455, -0.62, -0.03).scale.set(1.4, 0.8, 0.8);
      });
    }
    if (id === 'bun') part(hairG, bunGeo, myHairMat, 0, 0.47, -0.1);
  }

  function buildFace(id) {
    faceG.clear();
    const smileM = function (y) { onFace(smileGeo, faceMat, 0, y).rotation.z = Math.PI; };  // ∪ 입
    const dotE = function (x, k) { onFace(dotEyeGeo, faceMat, x, -0.03).scale.set(k || 1, (k || 1) * 1.25, 0.5); };
    if (id === 'dot') {
      dotE(-0.14); dotE(0.14); smileM(-0.13);
    } else if (id === 'wink') {
      dotE(-0.14); onFace(arcGeo, faceMat, 0.14, -0.04); smileM(-0.13);
    } else if (id === 'wow') {
      dotE(-0.14, 1.25); dotE(0.14, 1.25);
      onFace(oMouthGeo, wowMat, 0, -0.16);
    } else if (id === 'sleepy') {
      [-0.14, 0.14].forEach(function (x) { onFace(lineGeo, faceMat, x, -0.04).rotation.z = Math.PI / 2; });
      onFace(lineGeo, faceMat, 0, -0.15).rotation.z = Math.PI / 2;
    } else { // smile ^ ^ ω
      [-0.14, 0.14].forEach(function (x) { onFace(arcGeo, faceMat, x, -0.04); });
      [-0.024, 0.024].forEach(function (x) { onFace(mouthGeo, faceMat, x, -0.15).rotation.z = Math.PI; });
    }
    // 분홍 볼
    [-0.25, 0.25].forEach(function (x) { onFace(blushGeo, blushMat, x, -0.13, 0.012); });
  }

  function setLook(look) {
    const l = DATA.normLook(look);
    myHairMat.color.set(DATA.hairHex(l.hairColor));
    buildHair(l.hair);
    buildFace(l.face);
  }
  setLook(look);

  meshes.forEach(function (m) { m.castShadow = true; });

  return {
    root: root,
    setColor: function (c) { jacketMat.color.set(c); },
    setLook: setLook,
    animate: function (walkTime, moving) {
      if (moving) {
        const s = Math.sin(walkTime * 11);
        body.position.y = Math.abs(s) * 0.08;
        body.rotation.z = s * 0.05;
        head.rotation.z = -s * 0.04;
        legs[0].rotation.x = s * 0.6;
        legs[1].rotation.x = -s * 0.6;
        arms[0].rotation.x = -s * 0.5;
        arms[1].rotation.x = s * 0.5;
      } else {
        body.position.y *= 0.8;
        body.rotation.z *= 0.8;
        head.rotation.z *= 0.8;
        legs.forEach(function (l) { l.rotation.x *= 0.8; });
        arms.forEach(function (a) { a.rotation.x *= 0.8; });
      }
    }
  };
}
