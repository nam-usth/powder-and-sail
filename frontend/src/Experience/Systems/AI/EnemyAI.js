import * as THREE from 'three';
import { moveToward, separateFleet } from '../Naval/MovementSystem.js';
import { DEFENSES, getDefenseStats } from '../../../data/defenses.js';

// ── EnemyAI v2 ────────────────────────────────────────────────────
// Priority-weighted decision system with wolfpack tactics and adaptive
// difficulty. Replaces the flat state machine from v1.
//
// Decision loop (every retargetInterval seconds):
//   1. Compute situation scores for each strategy
//   2. Pick highest-score strategy, break ties randomly
//   3. Assign each ship a role (leader / flanker-L / flanker-R / rear)
//
// Strategies:
//   RETREAT   — avg HP < threshold → reform at home
//   SIEGE     — bombard player islands at range, destroy buildings
//   RAID      — fast ships capture neutral/player islands
//   ENGAGE    — engage player fleet (wolfpack surround)
//   EXPAND    — move toward uncaptured neutral islands
//   BUILDUP   — idle near home while building up defenses

const STRAT = { RETREAT:'retreat', SIEGE:'siege', RAID:'raid',
                ENGAGE:'engage', EXPAND:'expand', BUILDUP:'buildup' };

// Fan formation offsets for 5 ships around a target (relative to approach dir)
const FAN_OFFSETS = [
  { fwd: 0,   lat:  0  },   // leader
  { fwd: -4,  lat:  8  },   // flanker L
  { fwd: -4,  lat: -8  },   // flanker R
  { fwd: -10, lat:  5  },   // rear L
  { fwd: -10, lat: -5  },   // rear R
];

export class EnemyAI {
  constructor(state, islands, vfx, combat, bus, scene){
    this._state  = state;
    this._islands= islands;
    this._vfx    = vfx;
    this._combat = combat;
    this._bus    = bus;
    this._scene  = scene;

    this._buildTimer     = 25;
    this._repairTimer    = 8;
    this._retargetTimer  = 0;
    this._strat          = STRAT.BUILDUP;
    this._stratTimer     = 0;   // how long current strategy has been active
    this._targets        = [];  // [{ ship, tx, tz }] one entry per enemy ship
  }

  // ── Main update ───────────────────────────────────────────────
  update(dt) {
    const st = this._state;
    const alive = st.enemyShips.filter(s => s.alive);
    if (!alive.length) { this._tickRepair(dt, st); return; }

    this._retargetTimer -= dt;
    this._stratTimer    += dt;

    if (this._retargetTimer <= 0) {
      this._retargetTimer = this._retargetInterval();
      this._decideStrategy(alive, st);
      this._assignTargets(alive, st);
    }

    this._executeStrategy(alive, dt, st);
    this._buildHistory(alive[0], dt, st);
    this._executeMovement(alive, dt);
    separateFleet(st.enemyShips);

    // S4: enemy ships only attack player forts, NOT neutrals (neutrals are passive unless attacked)
    const forts = this._islands.filter(i => !i.down && i.own === 'player');
    alive.forEach(s => this._combat.tickShip(s, st.playerShips.filter(p => p.alive), forts, dt));

    this._tickBuild(dt, st);
    this._tickRepair(dt, st);
  }

  // ── Strategy decision ─────────────────────────────────────────
  _retargetInterval() {
    // Faster decisions during combat, slower during buildup/retreat
    return (this._strat === STRAT.ENGAGE || this._strat === STRAT.SIEGE)
      ? 4 + Math.random() * 3
      : 7 + Math.random() * 5;
  }

  _decideStrategy(alive, st) {
    const avgHP   = alive.reduce((a, s) => a + s.hp / s.maxHp, 0) / alive.length;
    const wave    = st.waveNumber || 1;
    const player  = st.playerShips.filter(s => s.alive);
    const playerIslands  = this._islands.filter(i => i.own === 'player');
    const neutralIslands = this._islands.filter(i => i.own === 'neutral');
    const enemyIslands   = this._islands.filter(i => i.own === 'enemy' && !i.down);

    // Threat level: how strong is the player relative to us?
    const threatRatio = player.length / Math.max(1, alive.length);

    // Score each strategy (higher = more likely to pick)
    const scores = {
      [STRAT.RETREAT]: avgHP < 0.22 ? 100 : 0,
      [STRAT.BUILDUP]: (enemyIslands.length > 0 && alive.length < 2) ? 60 : 0,
      [STRAT.ENGAGE]:  (player.length > 0 && threatRatio < 1.5 && avgHP > 0.35)
                         ? 20 + wave * 2 + (1 - threatRatio) * 20 : 0,
      [STRAT.SIEGE]:   (playerIslands.length > 0 && avgHP > 0.40 && wave >= 3)
                         ? 15 + wave + Math.random() * 10 : 0,
      [STRAT.RAID]:    ((neutralIslands.length > 0 || playerIslands.length > 0) && alive.length >= 2)
                         ? 10 + neutralIslands.length * 5 + playerIslands.length * 8 : 0,
      [STRAT.EXPAND]:  (neutralIslands.length > 0)
                         ? 8 + Math.random() * 5 : 0,
    };

    // Don't switch strategy too often (min 8s in current strat, unless retreating)
    if (this._stratTimer < 8 && this._strat !== STRAT.RETREAT &&
        scores[STRAT.RETREAT] === 0) {
      return;
    }

    // Pick highest score
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    if (best[1] > 0) {
      this._strat = best[0];
      this._stratTimer = 0;
    }
  }

  _assignTargets(alive, st) {
    const player  = st.playerShips.filter(s => s.alive);
    const strat   = this._strat;

    // Compute approach direction toward primary target
    let primaryX = 95, primaryZ = -20;

    if (strat === STRAT.RETREAT) {
      const home = this._islands.find(i => i.own === 'enemy');
      primaryX = home ? home.x + 8 : 95;
      primaryZ = home ? home.z     : -20;

    } else if (strat === STRAT.ENGAGE && player.length) {
      // B5: squared distance for comparator — no sqrt needed for min-distance reduce
      const ax0 = alive[0].x, az0 = alive[0].z;
      const tgt = player.reduce((a, b) => {
        const db = (b.x-ax0)*(b.x-ax0)+(b.z-az0)*(b.z-az0);
        const da = (a.x-ax0)*(a.x-ax0)+(a.z-az0)*(a.z-az0);
        return db < da ? b : a;
      });
      primaryX = tgt.x;
      primaryZ = tgt.z;

    } else if (strat === STRAT.SIEGE) {
      const pi = this._islands.filter(i => i.own === 'player');
      if (pi.length) {
        const tgt = pi[Math.floor(Math.random() * pi.length)];
        const dx = alive[0].x - tgt.x, dz = alive[0].z - tgt.z;
        const d  = Math.hypot(dx, dz) || 1;
        const r  = tgt.r + 20;
        primaryX = tgt.x + (dx / d) * r;
        primaryZ = tgt.z + (dz / d) * r;
      }
    } else if (strat === STRAT.RAID || strat === STRAT.EXPAND) {
      const targets = this._islands.filter(i => i.own !== 'enemy');
      if (targets.length) {
        const tgt = targets[Math.floor(Math.random() * targets.length)];
        primaryX = tgt.x + (Math.random() - 0.5) * 4;
        primaryZ = tgt.z + (Math.random() - 0.5) * 4;
      }
    }

    // Build wolfpack fan assignments
    const approach = Math.atan2(primaryX - alive[0].x, primaryZ - alive[0].z);
    const cos = Math.cos(approach), sin = Math.sin(approach);
    const perpX = -sin, perpZ = cos; // perpendicular to approach

    this._targets = alive.map((ship, rank) => {
      const off = FAN_OFFSETS[Math.min(rank, FAN_OFFSETS.length - 1)];
      return {
        ship,
        tx: primaryX + perpX * off.lat + sin * off.fwd,
        tz: primaryZ + perpZ * off.lat + cos * off.fwd,
      };
    });
  }

  _executeStrategy(alive, dt, st) {
    // Extra logic per strategy (not just movement)
    if (this._strat === STRAT.RETREAT) {
      // Rally all ships to home — override individual targets
      const home = this._islands.find(i => i.own === 'enemy');
      if (home) {
        this._targets.forEach((t, i) => {
          t.tx = home.x + (Math.random() - 0.5) * 12;
          t.tz = home.z + (Math.random() - 0.5) * 12;
        });
      }
    }
  }

  // ── Trail history for followers (position-based, not frame-based) ─
  _buildHistory(leader, dt, st) {
    if (!leader) return;
    this._histTimer = (this._histTimer || 0) + dt;
    if (this._histTimer < 0.15) return;
    // AT: subtract the interval instead of resetting to 0 — leftover time
    // carries over, so sampling stays at a steady 0.15 s cadence instead of
    // drifting with frame-rate (fixes "all ships sample same tick" jitter).
    this._histTimer -= 0.15;
    st.elhist.unshift({ x: leader.x, z: leader.z });
    if (st.elhist.length > st.enemyShips.length * 40) st.elhist.pop();
  }

  _executeMovement(alive, dt) {
    if (this._strat === STRAT.ENGAGE || this._strat === STRAT.SIEGE ||
        this._strat === STRAT.RAID   || this._strat === STRAT.EXPAND) {
      // Fan formation: each ship moves to its own assigned target
      this._targets.forEach(({ ship, tx, tz }) => {
        if (ship.alive) moveToward(ship, tx, tz, dt, this._islands);
      });
    } else {
      // Retreat / buildup: line trail behind leader
      const leader = alive[0];
      moveToward(leader, this._targets[0]?.tx ?? 95, this._targets[0]?.tz ?? -20, dt, this._islands);
      alive.forEach((s, rank) => {
        if (rank === 0) return;
        const hist = this._state.elhist[rank * 18];
        if (hist) moveToward(s, hist.x, hist.z, dt, this._islands);
      });
    }
  }

  // ── AI island building (adaptive by wave) ─────────────────────
  _tickBuild(dt, st) {
    this._buildTimer -= dt;
    if (this._buildTimer > 0) return;

    // Build frequency scales with wave number
    const wave = st.waveNumber || 1;
    this._buildTimer = Math.max(20, 55 - wave * 2) + Math.random() * 15;

    const enemyIsl = this._islands.find(i => i.own === 'enemy' && !i.down);
    if (!enemyIsl) return;

    const instances  = st.islandBuildings[enemyIsl.def.id] || [];
    const active     = instances.filter(i => i.state !== 'destroyed');
    const maxCells   = enemyIsl.validGridKeys ? enemyIsl.validGridKeys.size : 100;
    if (active.length >= Math.min(maxCells, 6 + wave * 2)) return;

    // Build priority scales with wave: early = watchtowers, later = stronger defenses
    const defPool = DEFENSES.filter(d => {
      if (d.id === 'deadmans_lure' && wave < 5) return false; // unlock at wave 5
      if (d.id === 'bunker'        && wave < 3) return false;
      return true;
    });

    const existingCounts = {};
    active.filter(i => i.isDefense).forEach(i =>
      existingCounts[i.buildingId] = (existingCounts[i.buildingId] || 0) + 1
    );

    // Pick defense with lowest build count (diversify)
    const pick = defPool.reduce((best, d) =>
      (existingCounts[d.id] || 0) < (existingCounts[best.id] || 0) ? d : best
    , defPool[0]);
    if (!pick) return;

    // Place around island at valid radius
    const angle = Math.random() * Math.PI * 2;
    const r     = enemyIsl.r * (0.4 + Math.random() * 0.4);
    const wx    = enemyIsl.x + Math.cos(angle) * r;
    const wz    = enemyIsl.z + Math.sin(angle) * r;

    // S5: pick a valid, unoccupied gridKey from the island's actual grid
    const occupiedKeys = new Set(active.map(i => i.gridKey).filter(Boolean));
    const validKeys    = enemyIsl.validGridKeys ? Array.from(enemyIsl.validGridKeys) : [];
    const freeKeys     = validKeys.filter(k => !occupiedKeys.has(k));
    const gridKey      = freeKeys.length
      ? freeKeys[Math.floor(Math.random() * freeKeys.length)]
      : `${active.length % 10}_${Math.floor(active.length / 10)}`; // fallback

    const stats = getDefenseStats(pick, 1);
    const inst  = {
      instanceId: 'ai_bld_' + Math.random().toString(36).slice(2, 8),
      buildingId: pick.id,
      level:      1,
      hp: stats.hp, maxHp: stats.hp,
      gridKey,
      worldX: wx, worldZ: wz,
      state:      'active',
      isDefense:  true,
      footprint:  { w: 1, h: 1 },
      rotated:    false,
      fireTimer:  stats.reloadSec || 4,
      // Face toward map center (player side)
      facingDeg:  Math.atan2(wx - 0, wz - 0) * 180 / Math.PI + 180,
      ...stats,
    };

    if (!Array.isArray(st.islandBuildings[enemyIsl.def.id])) {
      st.islandBuildings[enemyIsl.def.id] = [];
    }
    st.islandBuildings[enemyIsl.def.id].push(inst);
    this._spawnDefenseMesh(inst);
  }

  _tickRepair(dt, st) {
    this._repairTimer -= dt;
    if (this._repairTimer > 0) return;
    this._repairTimer = 4 + Math.random() * 3;

    const enemyIslands = this._islands.filter(i => i.own === 'enemy');
    for (const isl of enemyIslands) {
      if (isl.down) {
        isl._aiRepairProgress = (isl._aiRepairProgress || 0) + 1;
        if (isl._aiRepairProgress >= 4) {
          isl._aiRepairProgress = 0;
          isl.rebuildFort();
          this._bus.emit('building:ready', { island: isl });
        }
        continue;
      }

      isl._aiRepairProgress = 0;
      if (isl.hp < isl.maxHp) {
        isl.hp = Math.min(isl.maxHp, isl.hp + Math.max(6, isl.maxHp * 0.06));
        isl.drawHP(isl.hp / isl.maxHp);
      }

      const instances = st.islandBuildings[isl.def.id];
      if (!Array.isArray(instances)) continue;
      for (const inst of instances) {
        if (inst.state === 'destroyed') {
          inst._aiRepairProgress = (inst._aiRepairProgress || 0) + 1;
          if (inst._aiRepairProgress < 3) continue;
          inst._aiRepairProgress = 0;
          inst.state = 'active';
          inst.hp = Math.max(1, Math.round((inst.maxHp || 20) * 0.55));
          if (inst.mesh) inst.mesh.visible = true;
          this._bus.emit('building:ready', { instance: inst, island: isl });
          continue;
        }
        if (inst.hp != null && inst.maxHp != null && inst.hp < inst.maxHp) {
          inst.hp = Math.min(inst.maxHp, inst.hp + Math.max(3, inst.maxHp * 0.08));
        }
      }
    }
  }

  _spawnDefenseMesh(inst) {
    const mat  = new THREE.MeshStandardMaterial({ color: 0x5a3a3a, roughness: 0.8 });
    const geo  = new THREE.CylinderGeometry(0.6, 0.8, 1.4, 8);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(inst.worldX, 1.5, inst.worldZ);
    mesh.castShadow = true;
    this._scene?.add(mesh);
    inst.mesh = mesh;
  }
}
