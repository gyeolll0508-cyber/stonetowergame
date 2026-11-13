/* =========================================================
 * js3d/actors.js — 3D 돌·돌탑·캐릭터 만들기
 *  - 돌 7종(stones.js의 모양 정보)을 울퉁불퉁한 3D 돌로 만들어요.
 *  - 돌탑: 최고 기록(best)만큼 돌을 쌓아 보여 줘요(2D 지도와 같은 규칙).
 * ========================================================= */
import * as THREE from 'three';
import { toV3 } from './logic.js';
import { glowTexture } from './textures.js';

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

/* ---------------- 캐릭터 ---------------- */

const bodyGeo = new THREE.CapsuleGeometry(0.3, 0.5, 4, 14);
const headGeo = new THREE.SphereGeometry(0.31, 20, 14);
const hairGeo = new THREE.SphereGeometry(0.325, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.52);
const eyeGeo = new THREE.SphereGeometry(0.045, 8, 6);
const bagGeo = new THREE.BoxGeometry(0.38, 0.44, 0.2);
const skinMat = new THREE.MeshStandardMaterial({ color: 0xffdcbf, roughness: 0.7 });
const hairMat = new THREE.MeshStandardMaterial({ color: 0x3d2f28, roughness: 0.8 });
const eyeMat = new THREE.MeshBasicMaterial({ color: 0x2a211c });

export function makeCharacter(color) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // 걸을 때 통통 튀는 부분
  root.add(body);
  const clothMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.75 });
  const bagMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.62), roughness: 0.8 });

  const torso = new THREE.Mesh(bodyGeo, clothMat);
  torso.position.y = 0.62;
  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.y = 1.36;
  const hair = new THREE.Mesh(hairGeo, hairMat);
  hair.position.set(0, 1.39, -0.02);
  hair.rotation.x = -0.35;
  const bag = new THREE.Mesh(bagGeo, bagMat);
  bag.position.set(0, 0.72, -0.3);
  [torso, head, hair, bag].forEach(function (m) { m.castShadow = true; body.add(m); });
  [-0.11, 0.11].forEach(function (x) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(x, 1.38, 0.28);
    body.add(eye);
  });

  return {
    root: root,
    setColor: function (c) {
      clothMat.color.set(c);
      bagMat.color.set(c).multiplyScalar(0.62);
    },
    animate: function (walkTime, moving) {
      if (moving) {
        body.position.y = Math.abs(Math.sin(walkTime * 11)) * 0.12;
        body.rotation.z = Math.sin(walkTime * 11) * 0.06;
      } else {
        body.position.y *= 0.8;
        body.rotation.z *= 0.8;
      }
    }
  };
}
