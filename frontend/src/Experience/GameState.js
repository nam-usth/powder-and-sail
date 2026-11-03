import * as THREE from 'three';
import { WOOD_START, GOLD_START, AURA_LEVELS } from '../data/constants.js';

// ── GAME STATE ──────────────────────────────────────────────────
// Single mutable object passed to all systems.
// No globals — everything lives here.
export function createGameState() {
  return {
    // Resources
    resWood:    WOOD_START,
    resGold:    GOLD_START,
    lootPts:    0,
    econTimer:  0,

    // Scores
    score:      0,
    gameOver:   false,
    paused:     false,
    frame:      0,

    // Wave system
    waveNumber: 0,
    waveTimer:  90,

    // Fog / overlay
    fogOn:      false,
    ovrOn:      false,
    // Graphics settings (persisted to localStorage)
    rangeFill:  true,   // true = filled ranges, false = edge-only

    // Build
    selectedBuilding: null,
    buildMode:        false,
    buildGridMeshes:  [],
    islandBuildings:  {},  // { islId: [instance, ...] } — ARRAY, allows multiples

    selectedIslandId: null,  // currently selected island def.id
    // Defense selection (separate from building selection)
    selectedDefense:  null,
    buildRotated:     false,  // true = footprint rotated 90° (w↔h swapped)
    buildFacingDeg:   0,      // defense facing angle in degrees (0=north, Q/E to rotate)

    // Warehouse bonus (recalculated by BuildSystem)
    _warehouseCapBonus:  0,
    _warehouseProtected: 0,

    // Speed research multiplier (applied to new ships)
    _spdResearchMult: 1,
    labLevel: 0,

    // Home island reference (set by GameApp after island construction)
    _homeIsland: null,

    // Aura upgrades
    auraLevel:  0,
    regenLevel: 0,
    getAuraRange(){ return AURA_LEVELS[Math.min(this.auraLevel, 4)].range; },
    getRegenRate(){ return AURA_LEVELS[Math.min(this.regenLevel, 4)].regen; },

    // Research
    researched:        new Set(),
    combatDmgMult:     1,
    cmdDmgMult:        1,   // AT: Commander ability (Broadside Barrage) multiplier
    hitChanceBuff:     0,
    mortarAoeMult:     1,
    towerDmgReduction: 0,
    towerBurn:         false,
    chainShotSlow:     false,

    // Building effects
    WOOD_RATE_BONUS: 0,
    GOLD_RATE_BONUS: 0,
    shipyardBuilt:   false,
    fortressBuilt:   false,
    lighthouseBuilt: false,

    // Stats
    stats: { fired:0, hit:0, sunk:0, dmgDealt:0, dmgTaken:0, timeSec:0 },
    statsTimer: 0,

    // Navigation
    tgtX: null,
    tgtZ: null,

    // UI
    selectedShip: null,

    // Ships (set by FleetEntity after construction)
    playerShips: [],
    enemyShips:  [],
    allShips:    [],
    shipUpgrades:[],
    lhist:       [],
    elhist:      [],

    // Fleets = control groups 1–9 (AU). fleets: [{id, num, name, color, role}]
    // ship.fleetId connects each ship to its fleet. Max FLEET_MAX_SHIPS per fleet.
    fleets:           [],
    selectedFleetId:  null,
    _nextFleetId:     1,

    // RTS command layer (AU): current selection of player ships, and the
    // formation used for new group orders. Per-ship orders live on ship.orders.
    selection:        [],
    cmd:              { formation: 'column' },

    // Revive queue
    reviveQueue: [],

    // Raid
    activeRaid:       null,
    raidCooldown:     {},
    enemyRaidTarget:  null,
    enemyRaidTimer:   20,

    // Enemy AI
    aiState:          'attack',
    aiTgtX:           95,
    aiTgtZ:           -20,
    aiRetargetTimer:  0,

    // Vision
    visRange:   1,
    getVisionR(){ return this.visRange * 22 * (this.lighthouseBuilt ? 1.5 : 1); },

    // Camera
    camDist:    70,
    camTgt:     null,   // THREE.Vector3 — set after THREE loaded
    camMode:    'free',  // 'free' (RTS default) | 'fleet' (follow selection) | 'island'
    camLockedId: null,  // island def.id when camMode==='island'
    camPanSpeed: 0.8,   // WASD pan speed
  };
}
