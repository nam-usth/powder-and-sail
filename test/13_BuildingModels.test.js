// ── TEST: AW-art building models + island art ───────────────────
// World/BuildingModels (procedural period models), islandShapes HARBOR,
// IslandEntity HARBOR berths/colliders, Navigation collider flattening.
// Visual quality is judged from screenshots (production/qa/evidence/aw_art_*);
// these checks pin the contracts other systems rely on.

import { suite, test, assert, assertEqual } from './runner.js';
import * as THREE from 'three';
import { makeBuildingMesh, makeBuildingGhost, modelYaw, MODELLED_BUILDING_IDS }
  from '../frontend/src/Experience/World/BuildingModels.js';
import { BUILDINGS } from '../frontend/src/data/buildings.js';
import { DEFENSES } from '../frontend/src/data/defenses.js';
import { BUILD_CELL_WORLD } from '../frontend/src/data/constants.js';
import { generateShape, mirrorShape, harborLandSDF, harborWaterSDF, HARBOR } from '../frontend/src/data/islandShapes.js';
import { islandCircles, pushOutside } from '../frontend/src/Experience/Systems/Naval/Navigation.js';

const ALL = [...BUILDINGS, ...DEFENSES];
const meshesOf = g => { const out = []; g.traverse(c => { if (c.isMesh) out.push(c); }); return out; };

suite('BuildingModels — every building and defense has a model', () => {

  test('every data id has a bespoke model (no generic fallback)', () => {
    for (const d of ALL) assert(MODELLED_BUILDING_IDS.includes(d.id), `${d.id} has no model`);
  });

  test('each model is a Group of ≤ 25 plain meshes with Standard/Basic materials', () => {
    for (const d of ALL) {
      const g = makeBuildingMesh(d, { level: 7, team: 'enemy' });
      assert(g.isGroup, `${d.id}: not a Group`);
      const ms = meshesOf(g);
      assert(ms.length > 0 && ms.length <= 25, `${d.id}: ${ms.length} meshes`);
      for (const m of ms) {
        assert(m.material.isMeshStandardMaterial || m.material.isMeshBasicMaterial,
          `${d.id}: unexpected material ${m.material.type}`);
        assert(m.userData.baseMat === m.material, `${d.id}: baseMat not recorded`);
      }
    }
  });

  test('instances share geometry and materials (only the lure lantern owns one)', () => {
    for (const d of ALL) {
      const a = meshesOf(makeBuildingMesh(d)), b = meshesOf(makeBuildingMesh(d));
      assertEqual(a.length, b.length, `${d.id}: mesh count differs between instances`);
      a.forEach((m, i) => {
        assert(m.geometry === b[i].geometry, `${d.id}: geometry not shared`);
        if (d.id === 'deadmans_lure' && i === 0) assert(m.material !== b[i].material, 'lure lantern must own its material');
        else assert(m.material === b[i].material, `${d.id}: material not shared (mesh ${i})`);
      });
    }
  });

  test('shared resources survive per-instance teardown (dispose is pinned)', () => {
    const g = makeBuildingMesh(BUILDINGS[0]);
    const m = meshesOf(g)[0];
    m.geometry.dispose(); m.material.dispose();
    const again = meshesOf(makeBuildingMesh(BUILDINGS[0]))[0];
    assert(again.geometry === m.geometry && again.geometry.attributes.position.count > 0, 'cache lost its geometry');
  });

  test('deadman\'s lure: children[0] is the lantern with a colour CombatSystem can flash', () => {
    const g = makeBuildingMesh(DEFENSES.find(d => d.id === 'deadmans_lure'));
    const c0 = g.children[0];
    assert(c0.isMesh && c0.material && c0.material.color, 'children[0] is not a coloured mesh');
    c0.material.color.setHex(0xff2200);
    assert(meshesOf(makeBuildingMesh(DEFENSES.find(d => d.id === 'deadmans_lure')))[0].material.color.getHex() !== 0xff2200,
      'flash leaked into another lure');
  });

  test('models fit their footprint (static parts, pennants/flags excepted)', () => {
    const box = new THREE.Box3(), b = new THREE.Box3();
    for (const d of ALL) {
      const g = makeBuildingMesh(d, { facingDeg: 0 });
      g.updateMatrixWorld(true);
      box.makeEmpty();
      g.traverse(m => {
        if (!m.isMesh || m.userData.fx || m.material.map || m.material.name?.startsWith('bm:team')) return;
        m.geometry.computeBoundingBox();
        b.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
        box.union(b);
      });
      const hw = d.footprint.w * BUILD_CELL_WORLD / 2 + 0.25, hd = d.footprint.h * BUILD_CELL_WORLD / 2 + 0.25;
      assert(box.max.x <= hw && box.min.x >= -hw, `${d.id}: x ${box.min.x.toFixed(2)}..${box.max.x.toFixed(2)} > ±${hw}`);
      assert(box.max.z <= hd && box.min.z >= -hd, `${d.id}: z ${box.min.z.toFixed(2)}..${box.max.z.toFixed(2)} > ±${hd}`);
      assert(box.min.y >= -1.0 && box.max.y > 0.8, `${d.id}: implausible height`);
    }
  });

  test('rotation, level pennants, unknown ids', () => {
    const wh = BUILDINGS.find(b => b.id === 'warehouse');
    assertEqual(makeBuildingMesh(wh, { rotated: true }).rotation.y, Math.PI / 2, 'rotated footprint must yaw π/2');
    assertEqual(modelYaw(wh, { rotated: true }), Math.PI / 2, 'modelYaw disagrees with the model');
    const g = makeBuildingMesh(wh, { level: 1 });
    const pen = meshesOf(g).find(m => m.material.name?.startsWith('bm:team'));
    const before = pen.geometry;
    g.userData.setLevel(8);
    assert(pen.geometry !== before, 'setLevel did not change the pennants');
    const unk = makeBuildingMesh({ id: 'no_such_thing', footprint: { w: 2, h: 1 } });
    assert(meshesOf(unk).length > 0, 'unknown id must get the generic house');
  });

  test('ghost uses the hologram material on every mesh', () => {
    const mat = new THREE.MeshBasicMaterial(), edge = new THREE.LineBasicMaterial();
    const g = makeBuildingGhost(BUILDINGS.find(b => b.id === 'barracks'), mat, edge);
    const ms = meshesOf(g);
    assert(ms.length > 0 && ms.every(m => m.material === mat), 'ghost mesh with a foreign material');
    let lines = 0; g.traverse(c => { if (c.isLineSegments) lines++; });
    assert(lines === 1, 'ghost should carry one edge outline');
  });
});

suite('Island art — HARBOR shape, berths, colliders', () => {

  test('HARBOR grid: land only, ≥ 100 cells on 16×16, none on the waterfront', () => {
    const keys = generateShape('HARBOR', 1, 16);
    assert(keys.size >= 100, `only ${keys.size} cells`);
    keys.forEach(k => {
      const [c, r] = k.split('_').map(Number);
      const x = c * BUILD_CELL_WORLD - 7.5 * BUILD_CELL_WORLD, z = r * BUILD_CELL_WORLD - 7.5 * BUILD_CELL_WORLD;
      assert(harborLandSDF(x, z) < -1.2, `cell ${k} is not well inside the land`);
      assert(harborWaterSDF(x, z) > 1.2, `cell ${k} touches the waterfront`);
    });
  });

  test('battle shapes unchanged; mirrorShape honours the grid size', () => {
    assertEqual(generateShape('SPRAWL', 4242).size, 68, 'SPRAWL 4242 changed');
    const m = mirrorShape(new Set(['0_3']), 16);
    assert(m.has('15_3'), 'mirror on a 16 grid');
    assert(mirrorShape(new Set(['0_3'])).has('9_3'), 'default mirror still 10 wide');
  });

  test('HARBOR island: ≥ 10 berths in open water off the quay, clear of every collider', async () => {
    const { IslandEntity } = await import('../frontend/src/Experience/World/IslandEntity.js');
    const scene = new THREE.Scene();
    const isl = new IslandEntity(scene, { id: 't_harbor', x: 40, z: -20, r: 30, hp: 200, nm: 'T', own: 'player',
      tdmg: 1, trof: 1, shape: 'HARBOR', seed: 4242, gridSize: 16 });
    assertEqual(isl.gridSize, 16, 'grid size');
    assert(isl.berths.length >= 10, `${isl.berths.length} berths`);
    assert(isl.colliders.length >= 8, 'harbor needs collider circles');
    for (const b of isl.berths) {
      assert(!isl.landAt(b.x, b.z), 'berth on land');
      assert(Number.isFinite(b.angle), 'berth angle');
      for (const c of isl.colliders)
        assert(Math.hypot(b.x - c.x, b.z - c.z) > c.r + 1.5, `berth (${b.x},${b.z}) inside a collider`);
    }
    // the bay off the quay (between the piers) is sea, the build lowland is land
    assert(!isl.landAt(40 + HARBOR.quayX - 6, -20 + (HARBOR.piers[0] + HARBOR.piers[1]) / 2), 'water off the quay should be sea');
    assert(isl.landAt(40, -20 - 14), 'north terraces should be land');
    assert(isl.deckDropAt(40, -20 - 14) < 0.05, 'build terraces must be level with the deck');
    scene.remove(isl.grp);
  });

  test('Navigation flattens island colliders; plain islands stay circles', () => {
    const plain = { x: 0, z: 0, r: 10 };
    const harbor = { x: 50, z: 0, r: 30, colliders: [{ x: 50, z: -20, r: 8 }, { x: 70, z: 0, r: 6 }] };
    const cs = islandCircles([plain, harbor]);
    assertEqual(cs.length, 3, 'expected 1 + 2 circles');
    // a goal inside the harbor's bay (not in a collider) is left alone
    const p = pushOutside(50, 5, [plain, harbor], 2);
    assert(Math.abs(p.x - 50) < 1e-6 && Math.abs(p.z - 5) < 1e-6, 'bay goal was pushed out');
  });
});
