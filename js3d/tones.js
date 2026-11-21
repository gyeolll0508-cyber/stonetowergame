/* =========================================================
 * js3d/tones.js — 돌탑 꾸미기 색상 테마 (돌 쌓기 화면·캠퍼스 공용)
 *  - natural(자연석톤): 원래 돌 색 그대로
 *  - pastel(파스텔톤): 층마다 연핑크·연하늘·연보라·연민트·연노랑·연살구 순서
 *  - rainbow(무지개톤): 아래층부터 빨주노초파남보
 *  같은 돌탑은 어디서 보든 같은 색이 되도록 "층 번호"로 색을 정해요.
 *  돌의 명암·이끼 무늬(꼭짓점 색)는 그대로 두고 바탕색만 바꿔요.
 * ========================================================= */
import * as THREE from 'three';

export const TONE_IDS = ['natural', 'pastel', 'rainbow'];

export const TONES = {
  natural: { name: '자연석톤' },
  pastel: { name: '파스텔톤', colors: ['#f6c1cf', '#bfe3f7', '#d9c8f0', '#bfeedd', '#fde7b0', '#f7d0b5'] },
  rainbow: { name: '무지개톤', colors: ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#5c7cfa', '#b197fc'] }
};

export function validTone(id) {
  return TONES[id] ? id : 'natural';
}

const mats = {};
function toneMaterial(hex) {
  if (!mats[hex]) mats[hex] = new THREE.MeshStandardMaterial({ color: hex, vertexColors: true, roughness: 0.85, metalness: 0 });
  return mats[hex];
}

/**
 * 돌 하나에 테마 색 입히기
 * @param mesh  makeStone()으로 만든 돌
 * @param tone  'natural' | 'pastel' | 'rainbow'
 * @param floor 1층부터의 번호 (0 = 받침돌 → 항상 원래 색)
 */
export function paintStone(mesh, tone, floor) {
  if (!mesh) return;
  if (!mesh.userData.baseMat) mesh.userData.baseMat = mesh.material;
  const t = TONES[validTone(tone)];
  if (!t.colors || floor < 1) { mesh.material = mesh.userData.baseMat; return; }
  mesh.material = toneMaterial(t.colors[(floor - 1) % t.colors.length]);
}
