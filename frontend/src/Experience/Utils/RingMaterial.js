import * as THREE from 'three';

// ── RingMaterial helpers ─────────────────────────────────────────────
// ALL range rings / aura rings must use these helpers so they are always
// rendered above the ocean surface (depthTest:false, renderOrder:12) and
// look consistent (AdditiveBlending for edge rings → natural glow).
//
// Usage:
//   import { ringEdgeMat, ringFillMat, applyRingDefaults } from './RingMaterial.js';
//   const ring = new THREE.Mesh(geo, ringEdgeMat(0xff8844, 0.75));
//   applyRingDefaults(ring);  // sets renderOrder + removes polygonOffset

export const RING_RENDER_ORDER = 12;   // above ocean (default renderOrder=0)
export const RING_Y            = 1.6;  // world-space Y, safely above max wave (~0.74)

/**
 * Edge / outline ring material — uses AdditiveBlending for a glowing look.
 * @param {number} color  0xRRGGBB
 * @param {number} opacity 0..1
 */
export function ringEdgeMat(color, opacity = 0.55) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent:  true,
    opacity,
    side:         THREE.DoubleSide,
    depthWrite:   false,
    depthTest:    false,   // never occluded by ocean geometry
    fog:          false,   // storm fog must not wash out ring colors
    blending:     THREE.AdditiveBlending,
  });
}

/**
 * Fill / area material — NormalBlending, soft transparent fill.
 * @param {number} color  0xRRGGBB
 * @param {number} opacity 0..1
 */
export function ringFillMat(color, opacity = 0.10) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent:  true,
    opacity,
    side:         THREE.DoubleSide,
    depthWrite:   false,
    depthTest:    false,
    fog:          false,   // storm fog must not wash out ring colors
    blending:     THREE.NormalBlending,
  });
}

/**
 * Line material for dashed rings / arc lines.
 */
export function ringLineMat(color, opacity = 0.70) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest:   false,
    fog:         false,
  });
}

/**
 * Apply renderOrder and clear any leftover polygonOffset flags on a mesh.
 */
export function applyRingDefaults(mesh) {
  mesh.renderOrder = RING_RENDER_ORDER;
  if (mesh.material) {
    mesh.material.polygonOffset       = false;
    mesh.material.polygonOffsetFactor = 0;
    mesh.material.polygonOffsetUnits  = 0;
  }
  return mesh;
}
