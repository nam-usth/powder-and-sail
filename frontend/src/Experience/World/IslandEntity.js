import * as THREE from 'three';
// ── ISLAND ENTITY ────────────────────────────────────────────────
// AF8: procedural island shapes — CRESCENT, ATOLL, FORTRESS, SPRAWL.
// Each island generates its valid build grid from shape+seed.
// Enemy islands mirror the player home island shape.
import { generateShape, mirrorShape, GRID } from '../../data/islandShapes.js';
import { BUILD_CELL_WORLD } from '../../data/constants.js';

// AT: shared tree geometry/material — created once, reused by every island.
let _TREE_GEO = null, _TREE_MAT = null;
function _treeGeo() { return _TREE_GEO ||= new THREE.ConeGeometry(0.38, 1.5, 6); }
function _treeMat() { return _TREE_MAT ||= new THREE.MeshStandardMaterial({ color: 0x2d5a27 }); }

export class IslandEntity {
  constructor(scene, def) {
    this.def   = def;
    this.x     = def.x;
    this.z     = def.z;
    this.r     = def.r;
    this.nm    = def.nm;
    this.own   = def.own;
    // AP: Bastion trait hardens the fort at construction time.
    // Capture-weakening (×0.85 once) still applies on top — a captured
    // bastion stays stronger than a captured plain fort, as intended.
    const _fortMult = def.trait === 'bastion' ? 1.25 : 1;
    this.hp    = Math.round(def.hp * _fortMult);
    this.maxHp = Math.round(def.hp * _fortMult);
    this.tdmg  = Math.round(def.tdmg * _fortMult);
    this.trof  = def.trof;
    this.down  = false;
    this.ftimer     = 2 + Math.random() * 6;
    this.stockWood  = def.own==='enemy' ? 300 : def.own==='neutral' ? 180 : 0;
    this.stockGold  = def.own==='enemy' ? 200 : def.own==='neutral' ? 120 : 0;
    this.auraRing   = null;
    this.auraRing2  = null;
    this.auraPulseT = def.own==='enemy' ? Math.PI : 0;

    // AF7: persistent fire source
    this._fireSource = null;

    // AF8: generate valid build grid keys from shape + seed
    this.validGridKeys = this._buildGridKeys(def);
    this.shapeType     = def.shape === 'MIRROR' ? 'MIRROR' : (def.shape || 'SPRAWL');

    this.grp = new THREE.Group();
    this.grp.position.set(def.x, 0, def.z);

    this._build(scene, def);
    scene.add(this.grp);
  }

  // ── AF8: Shape-based grid key generation ─────────────────────
  _buildGridKeys(def) {
    if (def.shape === 'MIRROR') {
      // Enemy home: mirror of player home (same seed, flip col)
      const base = generateShape('SPRAWL', def.seed);
      return mirrorShape(base);
    }
    return generateShape(def.shape || 'SPRAWL', def.seed || 1);
  }

  // ── Build: shape-aware terrain + decoration ──────────────────
  _build(scene, def) {
    const type  = def.shape === 'MIRROR' ? 'SPRAWL' : (def.shape || 'SPRAWL');
    const gcol  = { player: 0x3a7a50, enemy: 0x7a3a3a, neutral: 0x7a9040 }[def.own];

    switch (type) {
      case 'CRESCENT':  this._buildCreMesh(def, gcol); break;
      case 'ATOLL':     this._buildAtollMesh(def, gcol); break;
      case 'FORTRESS':  this._buildFortressMesh(def, gcol); break;
      case 'SPRAWL':
      default:          this._buildSprawlMesh(def, gcol); break;
    }

    // Trees placed on valid grid cells (sampled, not all)
    this._placeTrees(def);
    this._buildFort(def);
    this._buildHPSprite();
  }

  // ── CRESCENT mesh: large disc + sunken bay depression ────────
  _buildCreMesh(def, gcol) {
    // Main shore disc
    const shore = new THREE.Mesh(
      new THREE.CylinderGeometry(def.r, def.r * 1.15, 0.7, 28),
      new THREE.MeshStandardMaterial({ color: 0xcfb07a, roughness: 0.95 })
    );
    shore.position.y = 0.15; shore.castShadow = true;
    this.grp.add(shore);

    // Grass plateau — slightly smaller, shows sandy shore
    const grass = new THREE.Mesh(
      new THREE.CylinderGeometry(def.r * 0.75, def.r * 0.82, 0.55, 22),
      new THREE.MeshStandardMaterial({ color: gcol, roughness: 0.9 })
    );
    grass.position.y = 0.82; this.grp.add(grass);

    // Bay inlet: a concave depression on one side (visual only — grid handles building)
    // Represented by a dark ellipsoid sunk into the island
    const bayMat = new THREE.MeshStandardMaterial({ color: 0x1a6080, roughness: 0.3 });
    const bay = new THREE.Mesh(
      new THREE.CylinderGeometry(def.r * 0.38, def.r * 0.42, 0.8, 14),
      bayMat
    );
    // Offset to edge — seed-deterministic using gridKeys center of mass
    bay.position.set(def.r * 0.55, 0.1, 0);
    this.grp.add(bay);
  }

  // ── ATOLL mesh: ring of raised land around a lagoon ──────────
  _buildAtollMesh(def, gcol) {
    // Outer sandy ring
    const shore = new THREE.Mesh(
      new THREE.CylinderGeometry(def.r, def.r * 1.1, 0.65, 28),
      new THREE.MeshStandardMaterial({ color: 0xcfb07a, roughness: 0.95 })
    );
    shore.position.y = 0.15; shore.castShadow = true;
    this.grp.add(shore);

    // Inner grass ring (annulus approximated by slightly smaller disc)
    const grass = new THREE.Mesh(
      new THREE.CylinderGeometry(def.r * 0.72, def.r * 0.80, 0.6, 24),
      new THREE.MeshStandardMaterial({ color: gcol, roughness: 0.9 })
    );
    grass.position.y = 0.80; this.grp.add(grass);

    // Lagoon center — sunken water disc
    const lagoon = new THREE.Mesh(
      new THREE.CylinderGeometry(def.r * 0.38, def.r * 0.40, 0.5, 18),
      new THREE.MeshStandardMaterial({ color: 0x1a7090, roughness: 0.15, metalness: 0.1 })
    );
    lagoon.position.y = 0.05; this.grp.add(lagoon);

    // Rim — slightly raised wall around lagoon edge
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(def.r * 0.44, 0.18, 6, 24),
      new THREE.MeshStandardMaterial({ color: 0xb09060, roughness: 0.9 })
    );
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.7;
    this.grp.add(rim);
  }

  // ── FORTRESS mesh: raised stone platform + bastions ──────────
  _buildFortressMesh(def, gcol) {
    // Heavy base platform — flatter, squarish
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(def.r * 0.92, def.r * 1.05, 0.9, 8),  // 8-sided = octagon
      new THREE.MeshStandardMaterial({ color: 0xb0a080, roughness: 0.85 })
    );
    base.position.y = 0.2; base.castShadow = true;
    this.grp.add(base);

    // Stone deck on top
    const deck = new THREE.Mesh(
      new THREE.CylinderGeometry(def.r * 0.75, def.r * 0.82, 0.6, 8),
      new THREE.MeshStandardMaterial({ color: gcol, roughness: 0.88 })
    );
    deck.position.y = 0.88; this.grp.add(deck);

    // 4 corner bastions
    const bastMat = new THREE.MeshStandardMaterial({ color: 0x908060, roughness: 0.9 });
    const bastGeo = new THREE.CylinderGeometry(0.9, 1.1, 1.2, 7);
    for (const [bx, bz] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const bast = new THREE.Mesh(bastGeo, bastMat);
      bast.position.set(bx * def.r * 0.52, 0.9, bz * def.r * 0.52);
      this.grp.add(bast);
    }
  }

  // ── SPRAWL mesh: wide organic island, gentle slopes ──────────
  _buildSprawlMesh(def, gcol) {
    // Wide sandy shore
    const shore = new THREE.Mesh(
      new THREE.CylinderGeometry(def.r * 1.05, def.r * 1.22, 0.6, 20),
      new THREE.MeshStandardMaterial({ color: 0xcfb07a, roughness: 0.95 })
    );
    shore.position.y = 0.12; shore.castShadow = true;
    this.grp.add(shore);

    // Broad grass — slightly irregular (ellipse effect via scale)
    const grass = new THREE.Mesh(
      new THREE.CylinderGeometry(def.r * 0.82, def.r * 0.90, 0.5, 18),
      new THREE.MeshStandardMaterial({ color: gcol, roughness: 0.9 })
    );
    // Slight squash on one axis for organic look
    grass.scale.set(1.12, 1.0, 0.88);
    grass.position.y = 0.78; this.grp.add(grass);

    // Low central mound
    const mound = new THREE.Mesh(
      new THREE.CylinderGeometry(def.r * 0.35, def.r * 0.55, 0.4, 12),
      new THREE.MeshStandardMaterial({ color: gcol, roughness: 0.92 })
    );
    mound.position.y = 1.15; this.grp.add(mound);
  }

  // ── Trees placed on valid grid cells ─────────────────────────
  // AT: shape-aware cell filter (no trees on lagoon/causeway/bastion/fort
  // cells) + one InstancedMesh per island with shared static geo/mat —
  // 1 draw call per island instead of 1 per tree, zero per-island GPU alloc.
  _placeTrees(def) {
    const cx = (GRID - 1) / 2, cz = (GRID - 1) / 2;
    const keys = Array.from(this.validGridKeys).filter(k => {
      const [c, r] = k.split('_').map(Number);
      const d = Math.hypot(c - cx, r - cz);
      if (d < 1.8) return false;                                // fort footprint at centre
      if (this.shapeType === 'ATOLL' && d < 3.0) return false;  // lagoon + causeway cells
      if (this.shapeType === 'FORTRESS') {
        for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
          if (Math.hypot(c - (cx + dx * 3.2), r - (cz + dz * 3.2)) < 1.6) return false; // stone bastions
      }
      return true;
    });
    if (!keys.length) return;

    const off       = (GRID - 1) / 2 * BUILD_CELL_WORLD;
    const treeCount = Math.max(1, Math.min(7, Math.floor(keys.length * 0.08)));
    const step      = Math.max(1, Math.floor(keys.length / treeCount));

    const inst = new THREE.InstancedMesh(_treeGeo(), _treeMat(), treeCount);
    const m    = new THREE.Matrix4();
    for (let i = 0; i < treeCount; i++) {
      const k = keys[i * step] || keys[i];
      const [c, r] = k.split('_').map(Number);
      m.makeRotationY((c * 7 + r * 13) % 7 * 0.9);              // deterministic variety
      m.setPosition(c * BUILD_CELL_WORLD - off, 2.0, r * BUILD_CELL_WORLD - off);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    this._trees = inst;
    this.grp.add(inst);
  }

  _buildFort(def) {
    this.fgrp = new THREE.Group();
    const fmat = new THREE.MeshStandardMaterial({ color: 0x8b7355, roughness: 0.8 });
    const fort = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2, 2.5), fmat);
    fort.position.set(0, 2, 0); fort.castShadow = true; this.fgrp.add(fort);

    const ftwr = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.5, 8), fmat);
    ftwr.position.set(0, 4.2, 0); this.fgrp.add(ftwr);

    const owner = this.own || def.own;
    const fcol = { player: 0x226699, enemy: 0x992222, neutral: 0x808844 }[owner];
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.7, 1.2, 8),
      new THREE.MeshStandardMaterial({ color: fcol })
    );
    cone.position.set(0, 5.8, 0); this.fgrp.add(cone);

    const flagcol = { player: 0x2266cc, enemy: 0xcc2222, neutral: 0x888844 }[owner];
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.7),
      new THREE.MeshStandardMaterial({ color: flagcol, side: THREE.DoubleSide })
    );
    flag.position.set(0.7, 7.1, 0); this.fgrp.add(flag);
    this.grp.add(this.fgrp);
  }

  _buildHPSprite() {
    const hc = document.createElement('canvas'); hc.width = 128; hc.height = 20;
    this._hpCtx = hc.getContext('2d');
    this._hpTex = new THREE.CanvasTexture(hc);
    this.hs = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._hpTex, transparent: true, depthTest: false,
    }));
    this.hs.scale.set(8, 1.2, 1); this.hs.position.y = 9.5;
    this.grp.add(this.hs);
    this.drawHP(1);
  }

  drawHP(frac) {
    const x = this._hpCtx, t = this._hpTex;
    x.clearRect(0, 0, 128, 20);
    x.fillStyle = '#1a3050'; x.fillRect(4, 4, 120, 12);
    x.fillStyle = frac > 0.6 ? '#3ddc84' : frac > 0.3 ? '#ffb300' : '#ff5252';
    x.fillRect(4, 4, Math.max(0, 120 * frac), 12);
    x.strokeStyle = '#4a7fa5'; x.lineWidth = 1; x.strokeRect(4, 4, 120, 12);
    t.needsUpdate = true;
  }

  destroyFort() {
    if (this.down) return;
    this.down = true;
    this.hp = 0;
    this.clearFire();
    this.grp.remove(this.fgrp);
    this.grp.remove(this.hs);
    this._rubble = [];
    for (let k = 0; k < 5; k++) {
      const rub = new THREE.Mesh(
        new THREE.BoxGeometry(0.3 + Math.random() * 0.7, 0.2 + Math.random() * 0.5, 0.3 + Math.random() * 0.7),
        new THREE.MeshStandardMaterial({ color: 0x7a6347, roughness: 1 })
      );
      const a = Math.random() * Math.PI * 2, r = Math.random() * 2.5;
      rub.position.set(Math.cos(a) * r, 0.7 + Math.random() * 0.3, Math.sin(a) * r);
      rub.rotation.y = Math.random() * Math.PI;
      this.grp.add(rub); this._rubble.push(rub);
    }
  }

  // AF7: fire source management ─────────────────────────────────
  setOnFire(vfx, intensity = 1.0) {
    // AN: escalate an already-burning fort instead of ignoring the call —
    // CombatSystem recomputes intensity from HP on every hit below 50 %.
    if (this._fireSource) { this._fireSource.setIntensity?.(intensity); return; }
    this._fireSource = vfx.startBurning(this.x, 5.5, this.z, intensity);
  }

  clearFire() {
    this._fireSource?.stop?.();
    this._fireSource = null;
  }

  updateFire(dt, vfx) {
    if (!this._fireSource) return;
    this._fireSource.update(dt, vfx._fire, vfx._smoke);
  }

  rebuildFort() {
    if (this._rubble) this._rubble.forEach(r => this.grp.remove(r));
    this._rubble = [];
    this.hp    = Math.round(this.maxHp * 0.6);
    this.down  = false;
    this.clearFire();
    this._buildFort(this.def);
    this._buildHPSprite();
    this.drawHP(this.hp / this.maxHp);
  }
}
