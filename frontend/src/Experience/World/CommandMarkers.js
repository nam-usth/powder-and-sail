import * as THREE from 'three';
import { ringEdgeMat, ringFillMat, RING_RENDER_ORDER, RING_Y } from '../Utils/RingMaterial.js';
import { slotToWorld } from '../Systems/Naval/Formations.js';

// ── COMMAND MARKERS (AU) ────────────────────────────────────────
// World-space feedback for RTS control:
//   • selection ring under every selected ship (fleet colour)
//   • hover ring (white = own ship, red = hostile)
//   • target rings on whatever the selection is attacking / besieging
//   • order lines: ship → each queued destination, coloured by order type,
//     with a small marker at every destination
// Everything is pooled; nothing is allocated per frame.

const ORDER_COL = {
  move:   new THREE.Color(0x40d0ff),
  amove:  new THREE.Color(0xff6a4a),
  patrol: new THREE.Color(0xe8c040),
  attack: new THREE.Color(0xff3b30),
  siege:  new THREE.Color(0xff9a3a),
};
const MAX_SEG = 256;
const LINE_Y = RING_Y + 0.05;
const PATH_SHOW = 2.5;   // s that order paths stay up after an order (Shift: always)

// Order paths look like StarCraft II rally lines: short soft dashes,
// translucent, drifting toward the destination. Dash phase is measured
// back from each segment's END (a fixed point), so the pattern does not
// crawl when the ship at the near end moves.
const PATH_VERT = /* glsl */`
  attribute vec3  aCol;
  attribute float aDist;   // world units back from the segment end
  attribute float aSide;   // -1 / +1 across the ribbon
  attribute float aFade;   // 0 at the ship … 1 at the destination
  varying vec3  vCol;
  varying float vDist, vSide, vFade;
  void main() {
    vCol = aCol; vDist = aDist; vSide = aSide; vFade = aFade;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const PATH_FRAG = /* glsl */`
  uniform float uTime, uPeriod, uDuty, uOpacity;
  varying vec3  vCol;
  varying float vDist, vSide, vFade;
  void main() {
    float ph   = fract((vDist + uTime * uPeriod * 0.55) / uPeriod);
    float dash = smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(uDuty - 0.12, uDuty, ph));
    float edge = 1.0 - smoothstep(0.25, 1.0, abs(vSide));
    float a = dash * edge * mix(0.18, 1.0, vFade) * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vCol, a);
  }
`;

export class CommandMarkers {
  constructor(scene, state) {
    this._scene = scene;
    this._st = state;
    this._ringGeo = new THREE.RingGeometry(1, 1.16, 40);
    this._ringGeo.rotateX(-Math.PI / 2);
    this._sel = new Map();             // ship → ring mesh
    this._tgtPool = [];
    this._wpPool = [];
    this._flash = null;                // { target, t }

    this._hover = this._ring(0xffffff, 0.55);
    this._hover.visible = false;

    // AV: order paths are flat ribbons (a quad per segment) — GL lines are
    // 1 px on most drivers and vanished against the sea — drawn dashed and
    // translucent by PATH_FRAG (SC2 rally-line look).
    const V = MAX_SEG * 4;
    const idx = new Uint16Array(MAX_SEG * 6);
    for (let i = 0; i < MAX_SEG; i++) idx.set([i*4, i*4+2, i*4+1, i*4+1, i*4+2, i*4+3], i * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(V * 3), 3));
    geo.setAttribute('aCol',     new THREE.BufferAttribute(new Float32Array(V * 3), 3));
    geo.setAttribute('aDist',    new THREE.BufferAttribute(new Float32Array(V), 1));
    geo.setAttribute('aSide',    new THREE.BufferAttribute(new Float32Array(V), 1));
    geo.setAttribute('aFade',    new THREE.BufferAttribute(new Float32Array(V), 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this._pathUniforms = {
      uTime: { value: 0 }, uPeriod: { value: 2.4 }, uDuty: { value: 0.55 }, uOpacity: { value: 0.62 },
    };
    this._lines = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: PATH_VERT, fragmentShader: PATH_FRAG, uniforms: this._pathUniforms,
      transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
    }));
    this._lines.renderOrder = RING_RENDER_ORDER;
    this._lines.frustumCulled = false;
    scene.add(this._lines);

    this._discGeo = new THREE.CircleGeometry(1, 40);
    this._discGeo.rotateX(-Math.PI / 2);
  }

  _ring(color, opacity, disc = false) {
    const m = new THREE.Mesh(this._ringGeo, ringEdgeMat(color, opacity));
    m.renderOrder = RING_RENDER_ORDER;
    m.position.y = RING_Y;
    if (disc) {   // faint fill under selected ships
      const d = new THREE.Mesh(this._discGeo, ringFillMat(color, 0.10));
      d.renderOrder = RING_RENDER_ORDER - 1;
      m.add(d);
      m.userData.disc = d;
    }
    this._scene.add(m);
    return m;
  }

  /** Briefly highlight the target of a fresh order (and show the paths). */
  flashTarget(target) {
    this._flash = target ? { target, t: 1.4 } : null;
    this._pathT = PATH_SHOW;
  }

  /** showPaths: Shift held — queued paths stay visible (SC2 behaviour). */
  update(dt, t, hover, fleets, showPaths = false) {
    const st = this._st;
    const sel = st.selection.filter(s => s.alive);
    const fleetCol = new Map((fleets || []).map(f => [f.id, f.color]));

    // ── Selection rings ─────────────────────────────────────────
    for (const [ship, ring] of this._sel) {
      if (!sel.includes(ship)) { ring.visible = false; }
    }
    sel.forEach(ship => {
      let ring = this._sel.get(ship);
      // declutter: a thin steady ring, no fill disc, no pulse
      if (!ring) { ring = this._ring(0x40ff90, 0.6); this._sel.set(ship, ring); }
      ring.visible = true;
      ring.material.color.set(fleetCol.get(ship.fleetId) || '#40ff90');
      ring.position.set(ship.x, RING_Y, ship.z);
      ring.scale.setScalar(2.3 * (ship.sc || 1));
    });

    // ── Hover ring ──────────────────────────────────────────────
    if (hover && hover.alive && !sel.includes(hover)) {
      this._hover.visible = true;
      this._hover.material.color.set(hover.team === 'player' ? 0xffffff : 0xff4a3a);
      this._hover.position.set(hover.x, RING_Y, hover.z);
      this._hover.scale.setScalar(2.3 * (hover.sc || 1));
    } else {
      this._hover.visible = false;
    }

    // ── Targets + order lines ───────────────────────────────────
    const targets = new Set();
    const A = this._lines.geometry.attributes;
    const pos = A.position.array, col = A.aCol.array, dist = A.aDist.array, side = A.aSide.array, fade = A.aFade.array;
    let seg = 0, wp = 0;
    const camD = st.camDist || 70;
    const HW = Math.max(0.16, camD * 0.0042);                 // ribbon half-width ≈ 2.5 px
    this._pathUniforms.uTime.value = t;
    // Declutter: paths fade out after an order unless Shift is held
    this._pathT = Math.max(0, (this._pathT || 0) - dt);
    const pathAlpha = showPaths ? 1 : Math.min(1, this._pathT / 0.6);
    this._pathUniforms.uOpacity.value = 0.62 * pathAlpha;
    if (pathAlpha <= 0) this._lines.visible = false; else this._lines.visible = true;
    this._pathUniforms.uPeriod.value = Math.max(1.6, camD * 0.034);   // dashes keep their on-screen size
    const pushSeg = (ax, az, bx, bz, c) => {
      if (seg >= MAX_SEG) return;
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 0.05) return;
      const nx = -dz / len * HW, nz = dx / len * HW;
      const v = seg * 4;
      pos.set([ax + nx, LINE_Y, az + nz,  ax - nx, LINE_Y, az - nz,
               bx + nx, LINE_Y, bz + nz,  bx - nx, LINE_Y, bz - nz], v * 3);
      col.set([c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b], v * 3);
      dist.set([len, len, 0, 0], v);
      side.set([1, -1, 1, -1], v);
      fade.set([0, 0, 1, 1], v);
      seg++;
    };
    const drawnDest = new Set();
    const putWaypoint = (x, z, c, key) => {
      if (pathAlpha <= 0 || (key && drawnDest.has(key))) return;
      if (key) drawnDest.add(key);
      let m = this._wpPool[wp];
      if (!m) { m = this._ring(0xffffff, 0.5); this._wpPool[wp] = m; }
      m.visible = true;
      m.material.color.copy(c);
      m.position.set(x, RING_Y, z);
      m.scale.setScalar(0.75);
      wp++;
    };

    // Current leg: one ribbon per ship (to its own slot / target). Queued
    // legs of a group order: ONE shared ribbon per group, from the previous
    // destination centre — per-ship fans made long queues unreadable.
    const sharedLeg = new Set();
    for (const ship of sel) {
      let px = ship.x, pz = ship.z, prevKey = 'ship';
      if (ship._engage?.target?.alive) targets.add(ship._engage.target);
      (ship.orders || []).forEach((o, i) => {
        const c = ORDER_COL[o.type];
        if (!c) return;
        if (o.target) {
          targets.add(o.target);
          pushSeg(px, pz, o.target.x, o.target.z, c);
          px = o.target.x; pz = o.target.z; prevKey = 'tgt';
          return;
        }
        const g = o.group;
        if (!g) return;
        putWaypoint(g.dest.x, g.dest.z, c, 'g' + g.id);
        if (i === 0) {
          const slot = g.slots.get(ship);
          const p = g.started && slot ? slotToWorld(g.dest.x, g.dest.z, g.heading, slot) : g.dest;
          pushSeg(px, pz, p.x, p.z, c);
        } else {
          const key = prevKey + '>' + g.id;
          if (!sharedLeg.has(key)) { sharedLeg.add(key); pushSeg(px, pz, g.dest.x, g.dest.z, c); }
        }
        px = g.dest.x; pz = g.dest.z; prevKey = 'g' + g.id;
      });
    }
    this._lines.geometry.setDrawRange(0, seg * 6);
    for (const k of ['position', 'aCol', 'aDist', 'aSide', 'aFade']) A[k].needsUpdate = true;
    for (let i = wp; i < this._wpPool.length; i++) this._wpPool[i].visible = false;

    // ── Target rings (+ a fresh-order flash) ────────────────────
    if (this._flash) {
      this._flash.t -= dt;
      if (this._flash.t <= 0) this._flash = null; else targets.add(this._flash.target);
    }
    let k = 0;
    for (const tg of targets) {
      if (tg.alive === false) continue;
      let m = this._tgtPool[k];
      if (!m) { m = this._ring(0xff3b30, 0.9); this._tgtPool[k] = m; }
      const R = tg.def ? tg.r + 2 : 2.4 * (tg.sc || 1);
      const pulse = this._flash?.target === tg ? 1 + 0.25 * Math.sin(t * 14) : 1 + 0.06 * Math.sin(t * 6);
      m.visible = true;
      m.material.color.set(tg.def ? 0xff9a3a : 0xff3b30);
      m.position.set(tg.x, RING_Y, tg.z);
      m.scale.setScalar(R * pulse);
      k++;
    }
    for (let i = k; i < this._tgtPool.length; i++) this._tgtPool[i].visible = false;
  }

  /** Drop the ring of a ship that left the game for good. */
  forget(ship) {
    const r = this._sel.get(ship);
    if (r) {
      this._scene.remove(r);
      r.material.dispose();
      r.userData.disc?.material.dispose();
      this._sel.delete(ship);
    }
  }
}
