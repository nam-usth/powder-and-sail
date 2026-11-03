import * as THREE from 'three';

// ── Core ───────────────────────────────────────────────────────
import { createGameState }              from './GameState.js';
import { EventBus, bus }                from './EventBus.js';
import { InputManager }                 from './InputManager.js';
import { time }                         from './Time.js';
import { sizes }                        from './Sizes.js';
import { Renderer }                     from './Renderer.js';
import { Resources }                    from './Resources.js';
import { Debug }                        from './Debug.js';

// ── Controllers (new) ─────────────────────────────────────────
import { SceneController }              from './Controllers/SceneController.js';
import { CameraController }             from './Controllers/CameraController.js';
import { InputController }              from './Controllers/InputController.js';
import { BuildingController }           from './Controllers/BuildingController.js';
import { CommandController }            from './Controllers/CommandController.js';

// ── World ─────────────────────────────────────────────────────
import { Ocean, getWaveHeight }         from './World/Ocean.js';
import { PlanarReflection }             from './World/PlanarReflection.js';
import { ringEdgeMat, RING_RENDER_ORDER, RING_Y } from './Utils/RingMaterial.js';
import { Sky }                          from './World/Sky.js';
import { WakeSystem }                   from './World/WakeSystem.js';
import { IslandEntity }                 from './World/IslandEntity.js';
import { makeShip, applySpeed, updateSailTime, disposeShipMesh } from './World/ShipEntity.js';
import { CommandMarkers }               from './World/CommandMarkers.js';

// ── Systems ───────────────────────────────────────────────────
import { Physics }                      from './Physics.js';
import { CombatSystem }                 from './Systems/Combat/CombatSystem.js';
import { VFX }                          from './Systems/VFX/VFX.js';
import { AuraSystem }                   from './Systems/Naval/AuraSystem.js';
import { EconomySystem }                from './Systems/Economy/EconomySystem.js';
import { WaveSystem }                   from './Systems/Match/WaveSystem.js';
import { EnemyAI }                      from './Systems/AI/EnemyAI.js';
import { ResearchSystem }               from './Systems/Economy/ResearchSystem.js';
import { BuildSystem }                  from './Systems/Economy/BuildSystem.js';
import { CaptureSystem }                from './Systems/Match/CaptureSystem.js';
import { SeaEvents }                    from './Systems/Match/SeaEvents.js';
import { FleetCommander }               from './Systems/Naval/FleetCommander.js';
import { ReviveSystem }                 from './Systems/Naval/ReviveSystem.js';
import { FogSystem }                    from './Systems/Vision/FogSystem.js';
import { TradeSystem }                  from './Systems/Economy/TradeSystem.js';
import { separateFleet }                from './Systems/Naval/MovementSystem.js';
import { OrderSystem }                  from './Systems/Naval/OrderSystem.js';

// ── UI ────────────────────────────────────────────────────────
import { PanelManager }                 from './UI/PanelManager.js';
import { HudController }                from './UI/HudController.js';
import { MinimapController }            from './UI/MinimapController.js';
import { LoadoutPanel }                 from './UI/LoadoutPanel.js';
import { OverlaySystem }                from './UI/OverlaySystem.js';
import { VisionSystem }                 from './UI/VisionSystem.js';
import { BuildPanel }                   from './UI/BuildPanel.js';
import { ResearchPanel }                from './UI/ResearchPanel.js';
import { RevivePanel }                  from './UI/RevivePanel.js';
import { IslandPanel }                  from './UI/IslandPanel.js';
import { CommandCard }                  from './UI/CommandCard.js';
import { ShipBars }                     from './UI/ShipBars.js';

// ── Data ──────────────────────────────────────────────────────
import { DEFENSES }                     from '../data/defenses.js';
import { BUILDINGS }                    from '../data/buildings.js';
import { ISLAND_DEFS }                  from '../data/maps.js';
import { getTrait }                     from '../data/traits.js';
import { PCFG, ECFG }                   from '../data/ships.js';
import { MAP }                          from '../data/constants.js';
import { T }                            from '../i18n.js';
import { audio }                        from './Utils/Audio.js';
import { toasts }                       from './UI/ToastQueue.js';
import { EmpirePanel }                  from './UI/EmpirePanel.js';
import { WarFront }                     from './Systems/Match/WarFront.js';
import { CommanderSystem }              from './Systems/Naval/CommanderSystem.js';
import { WarFrontHUD }                  from './UI/WarFrontHUD.js';
import { getAlivePlayerShipCount, getShipCapacity } from './Utils/ShipCapacity.js';

// ─────────────────────────────────────────────────────────────
// GameApp — thin facade that wires controllers + runs the loop.
// Heavy logic lives in Controllers/, Systems/, and UI/.
// ─────────────────────────────────────────────────────────────
export class GameApp {
  constructor() {
    this._state = createGameState();
    audio.load('cannon', 'Assets/Sounds/cannon_body_sfx.mp3');
    audio.load('fire_burning', 'Assets/Sounds/fire_burning_sfx.mp3');
    audio.load('water_splash', 'Assets/Sounds/water_impact_splash_sfx.mp3');
    audio.load('explosion_01', 'Assets/Sounds/explosion_01_sfx.mp3');
    audio.load('explosion_02', 'Assets/Sounds/explosion_02_sfx.mp3');
    audio.load('explosion_03', 'Assets/Sounds/explosion_03_sfx.mp3');
    this._setupRenderer();
    this._setupScene();
    this._setupSystems();
    this._buildFleet();
    this._setupControllers();
    this._setupBusEvents();
    this._initUI();
    this._debug = new Debug(this._renderer);
    this._start();
  }

  // ── RENDERER ────────────────────────────────────────────────
  _setupRenderer() {
    this._threeScene = new THREE.Scene();
    this._camera     = new THREE.PerspectiveCamera(52, sizes.aspect, .5, 600);
    this._renderer   = new Renderer(document.getElementById('canvas'), this._threeScene, this._camera);
    sizes.on('resize.camera', () => {
      this._camera.aspect = sizes.aspect;
      this._camera.updateProjectionMatrix();
      this._refl?.resize(sizes.width, sizes.height);
    });
  }

  // ── SCENE CONTROLLER ────────────────────────────────────────
  _setupScene() {
    this._state.camTgt = new THREE.Vector3(0, 0, 0);
    this._scene = new SceneController(this._threeScene, this._state);
    // Legacy: expose ThreeJS scene directly for systems that need scene.add()
    this._scene.three = this._threeScene;
  }

  // ── SYSTEMS ─────────────────────────────────────────────────
  _setupSystems() {
    const sc = this._threeScene, st = this._state;

    // World
    this._ocean   = new Ocean(sc);
    this._sky     = new Sky(sc);
    this._wake    = new WakeSystem(sc);

    // High-graphics planar reflection (toggled via setGraphicsQuality)
    this._graphicsHigh = false;
    this._refl         = new PlanarReflection(sc);
    this._physics = new Physics();
    this._physics.init().then(() => {
      st.allShips.forEach(s => this._physics.addShip(s));
      this._islands.forEach(isl => this._physics.addIsland(isl));
    });

    // Build islands
    this._islands = ISLAND_DEFS.map(def => {
      const isl = new IslandEntity(sc, def);
      st.islandBuildings[def.id] = [];
      return isl;
    });
    st._homeIsland = this._islands[0];
    window._BUILDINGS = BUILDINGS;
    window._DEFENSES  = DEFENSES;
    window._ALL_DEFS  = [...BUILDINGS, ...DEFENSES];

    // Combat + FX
    this._vfx     = new VFX(sc, this._camera);
    this._combat  = new CombatSystem(sc, st, this._vfx, bus);
    this._overlay = new OverlaySystem(sc, st);
    this._vision  = new VisionSystem(sc, st, this._camera);
    this._aura    = new AuraSystem(sc, st, this._islands, this._vfx);

    // Economy + progression
    this._build    = new BuildSystem(sc, st, this._islands, this._vfx, bus);
    this._build.seedNeutralStarters();   // AP: neutral islands carry scoutable, inheritable producers
    this._empire   = new EmpirePanel(st, this._islands, this._build, bus, this);  // AP: O key / ⚜ button
    this._warFront = new WarFront(st, this._islands, bus, this);   // AS: tug-of-war core
    this._warHUD   = new WarFrontHUD(st);                          // AS: always-visible front bar
    this._commander = new CommanderSystem(st, bus, this._vfx);     // AT: Z/X/C abilities
    this._economy  = new EconomySystem(st, this._islands, this._vfx, bus, this._build);
    this._wave     = new WaveSystem(sc, st, this._islands, this._vfx, bus);
    this._ai       = new EnemyAI(st, this._islands, this._vfx, this._combat, bus, this._threeScene);
    this._fog      = new FogSystem(this._threeScene);
    this._trade    = new TradeSystem(st, this._islands, bus);
    this._research = new ResearchSystem(st, bus);
    this._revive   = new ReviveSystem(st, sc, this._islands, this._vfx, bus);
    this._capture  = new CaptureSystem(sc, st, this._islands, this._vfx, bus);
    this._events   = new SeaEvents(sc, st, this._islands, this._vfx, bus);
    this._fleet    = null; // created after _buildFleet
  }

  // ── FLEET ───────────────────────────────────────────────────
  _buildFleet() {
    const st = this._state, sc = this._threeScene;
    st.playerShips = PCFG.map((cfg, i) => {
      const ship = makeShip(cfg, i, -75, 25 - i * 5.5, 'player', sc);
      ship.angle = 0;
      return ship;
    });
    st.enemyShips = ECFG.map((cfg, i) => makeShip(cfg, i, 78 - i * 4, -22, 'enemy', sc));

    const es = st.enemyShips;
    es[0].loadout['L'] = 'demi_can';  es[0].loadout['R'] = 'demi_can';  es[0].loadout['B'] = 'mortar1';
    es[1].loadout['L'] = 'demi_culv'; es[1].loadout['R'] = 'demi_culv';
    es[2].loadout['L'] = 'falconet';  es[2].loadout['R'] = 'carronade';
    es.forEach(s => {
      Object.keys(s.slotTimers).forEach(sl => s.slotTimers[sl] = 4 + Math.random() * 8);
      applySpeed(s);
    });

    st.allShips    = [...st.playerShips, ...st.enemyShips];
    st.shipUpgrades = st.playerShips.map(() => ({ spd: 0, hp: 0, rof: 0 }));
    st.allShips.forEach(s => { this._overlay.build(s); this._wake.addShip(s); });
    // AU: RTS command layer — per-ship orders, fleets as control groups
    this._orders = new OrderSystem(st, this._islands, {
      hostiles:  () => [...st.enemyShips, ...(this._events?.getPirateShips?.() || [])],
      isVisible: (x, z) => !st.fogOn || this._fog.isVisible(x, z),
    });
    this._fleet   = new FleetCommander(st, this._islands, this._orders);
    this._markers = new CommandMarkers(sc, st);

    // Register initial player ships + player-owned islands into FogSystem.
    // setVisionRadius must come first so addShip picks up the correct radius.
    this._fog.setVisionRadius(st.getVisionR());
    st.playerShips.forEach(s => this._fog.addShip(s));
    this._islands.filter(i => i.own === 'player').forEach(i => this._fog.addIsland(i));
  }

  // ── CONTROLLERS ─────────────────────────────────────────────
  _setupControllers() {
    const st = this._state;
    const crew = st.playerShips.filter(s => s.alive);
    if (crew.length) st.camTgt.set(crew.reduce((a, s) => a + s.x, 0) / crew.length, 0,
                                   crew.reduce((a, s) => a + s.z, 0) / crew.length);
    st.camMode = 'free';
    this._input      = new InputManager(document.getElementById('canvas'));
    this._cam        = new CameraController(this._camera, this._state, this._input);
    this._cam.init();
    this._inputCtrl  = new InputController(this);
    this._command    = new CommandController(this);   // AU: selection + orders
    this._bldCtrl    = new BuildingController(this);
  }

  // ── UI ──────────────────────────────────────────────────────
  _initUI() {
    const st = this._state;
    this._hud        = new HudController(st, bus, this._fleet, this._orders);
    this._cmdCard    = new CommandCard(st, this._command);
    this._shipBars   = new ShipBars(st, this._camera);       // AV: floating hull bars
    this._islandPanel = new IslandPanel(st, this._build, this._islands, bus);
    this._islandPanel._scene = this._threeScene;
    this._minimap    = new MinimapController(st, this._islands, this);
    this._panels     = PanelManager;
    this._loadout    = new LoadoutPanel(st, this._overlay, bus);
    this._buildUI    = new BuildPanel(st, this._build, this._islands, bus);
    this._researchUI = new ResearchPanel(st, this._research, bus);
    this._reviveUI   = new RevivePanel(st, this._revive, bus);
    this._vision.rebuild();
    this._registerGlobals();
    this._updateObjectivesUI();
    if (st.fleets[0]) this._command.selectFleet(st.fleets[0].id);
  }

  _registerGlobals() {
    window._game        = this;
    window._audio       = audio;  // accessible from console / HUD buttons
    window.setGraphicsHigh = (on) => {
      this._graphicsHigh = !!on;
      if (!on) this._ocean.setReflection(null, null);
    };
    window.buyShip      = hull => this._buyShip(hull);
    window.rebuildFort  = islId => this._bldCtrl.startFortRebuild(islId);
    window.repairBuilding  = (id, islId) => this._bldCtrl.repair(id, islId);
    window.rebuildBuilding = (id, islId) => this._bldCtrl.rebuild(id, islId);
    // AR: Build button / key 1 → open the island dock (build palette lives
    // inside it now). Targets the selected player island, else the first one.
    this._openBuildDock = () => {
      let isl = this._islands.find(i => i.def.id === this._state.selectedIslandId && i.own === 'player');
      if (!isl) isl = this._islands.find(i => i.own === 'player');
      if (!isl) { this._showMsg('No island to build on', 1800); return; }
      this._islandPanel._openGroup = 'resource';
      if (this._state.selectedIslandId !== isl.def.id) this._selectIsland(isl);
      else this._islandPanel.show(isl);
    };
    window.selectFleet  = fid => this._command.selectFleet(fid);
    window.newFleet     = () => {
      if (!this._fleet) return;
      const f = this._fleet.createFleet();
      if (!f) { this._showMsg('All 9 fleet slots are in use', 1800); return; }
      this._fleet.selectFleet(f.id);
      this._hud.rebuild();
      this._showMsg(T.fleetCreated(f.name), 2500);
    };
    window.setFleetRole = (fid, role) => { this._fleet?.setRole(fid, role); this._hud.rebuild(); };
    window.disbandFleet = fid => {
      if (!this._fleet) return;
      this._fleet.disbandFleet(fid)
        ? (this._hud.rebuild(), this._showMsg(T.fleetDisbanded, 1500))
        : this._showMsg(T.fleetCantDisband, 1800);
    };
    window.moveShipToFleet = (shipIdx, targetFleetId) => {
      if (!this._fleet) return;
      const ship = this._state.playerShips[shipIdx];
      if (!ship) return;
      const r = this._fleet.moveShip(ship, targetFleetId);
      if (!r.ok) { this._showMsg(r.reason, 1800); return; }
      this._showMsg(T.shipMoved(ship.nm, r.fleet.name), 1500);
      this._hud.rebuild();
    };
  }

  // ── BUS EVENTS ──────────────────────────────────────────────
  _setupBusEvents() {
    bus.on('ship:destroyed',      ({ ship }) => { this._onShipDestroyed(ship); this._orders.onShipDestroyed(ship); });
    bus.on('ship:removed',        ({ ship }) => {
      // S3 (complete): wave-culled ships free EVERYTHING — overlay, wake,
      // physics body, scene node, GPU material (geometry rules in disposeShipMesh)
      this._overlay.remove(ship);
      this._wake.removeShip(ship);
      this._markers.forget(ship);
      this._physics?.removeShip?.(ship);
      if (ship.mesh) {
        this._threeScene.remove(ship.mesh);
        disposeShipMesh(ship.mesh);
        ship.mesh = null;
      }
    });
    bus.on('ship:spawned',        ({ ship }) => {
      this._overlay.build(ship);
      this._wake.addShip(ship);
      if (this._physics.ready) this._physics.addShip(ship);
      if (ship.team === 'player') this._fog.addShip(ship);
    });
    bus.on('building:placed',     ({ building, instance, island }) => {
      this._onBuildingPlaced(building, instance, island);
      this._recalcFortStats(island);
      this._overlay.rebuildStaticRings(this._islands);
      this._aura.rebuild();
      this._build.recalcWarehouse?.();  // S8: immediate recalc on structural change
    });
    bus.on('building:upgraded',   ({ island }) => { this._recalcFortStats(island); this._overlay.rebuildStaticRings(this._islands); this._aura.rebuild(); this._build.recalcWarehouse?.(); });
    bus.on('building:demolished', ({ island }) => { this._recalcFortStats(island); this._overlay.rebuildStaticRings(this._islands); this._aura.rebuild(); this._build.recalcWarehouse?.(); });
    bus.on('building:destroyed',  ({ instance, island }) => {
      this._onBuildingDestroyed(instance, island);
      this._recalcFortStats(island);
      this._overlay.rebuildStaticRings(this._islands);
      this._build.recalcWarehouse?.();  // S8
    });
    bus.on('building:ready',      () => { this._build.recalcWarehouse?.(); this._vfx.playSound('build'); });  // S8 + AW cue
    bus.on('research:done',       () => this._vfx.playSound('research'));        // AW cue
    bus.on('treasure:collected',  () => this._vfx.playSound('coin'));            // AW cue
    bus.on('revive:complete',     ({ ship }) => {
      this._overlay.build(ship);
      if (this._physics.ready) this._physics.addShip(ship);   // S3: body was freed on destroy
      if (ship.team === 'player') this._fog.addShip(ship);
      this._hud.rebuild();
    });
    bus.on('island:fort_destroyed', ({ island }) => {
      this._onFortDestroyed(island);
      this._overlay.rebuildStaticRings(this._islands);
    });
    bus.on('island:captured',     ({ island, oldOwner, newOwner }) => {
      this._onIslandCaptured(island, oldOwner, newOwner);
      this._overlay.rebuildStaticRings(this._islands);
    });
    bus.on('building:cell_clicked', ({ instance, island }) =>
      this._islandPanel.showBuildingDetail(instance, island));
    bus.on('game:win',  ({ reason }) => this._endGame(true, reason));
    bus.on('game:lose', ({ reason }) => this._endGame(false, reason));
  }

  // ── GAME EVENTS ─────────────────────────────────────────────
  _onShipDestroyed(ship) {
    if (!ship.alive) return; // guard against double-fire
    ship.alive = false;
    if (ship.mesh) this._threeScene.remove(ship.mesh);
    this._overlay.remove(ship);
    this._wake.removeShip(ship);  // S3: clean up wake trail to avoid GPU/memory leak
    this._physics?.removeShip?.(ship);  // S3: dead hulls must not tick physics
    // Enemy ships are never revived → free their materials now.
    // Player meshes are KEPT: ReviveSystem re-uses ship.mesh on revive
    // (and revive:complete re-adds physics — see _setupBusEvents).
    if (ship.team !== 'player' && ship.mesh) {
      disposeShipMesh(ship.mesh);
      ship.mesh = null;
    }
    if (ship.team === 'player') this._fog.removeShip(ship);
    this._vfx.spawnShipExplosion(ship.x, 1, ship.z);

    const REVIVE_COSTS = { light:{wood:60,gold:40}, standard:{wood:110,gold:70}, heavy:{wood:180,gold:120} };
    const st = this._state;
    if (ship.team === 'player') {
      ship.reviveCost = REVIVE_COSTS[ship.hull] || { wood:80, gold:60 };
      this._vfx.playSound('sink');
      this._showMsg(T.shipLost(ship.nm), 2500);
      if (!st.playerShips.some(s => s.alive)) this._showMsg(T.allShipsSunkWarn, 4000);
    } else {
      st.lootPts  += ship.loot || 10;
      st.score    += 1;
      this._vfx.playSound('build');
      // AS: flagship kill & wipeouts no longer auto-win — they feed the
      // WarFront as large impulses (see WarFront ship:destroyed handler),
      // keeping the tug-of-war alive to the final push.
    }
    this._updateObjectivesUI();
  }

  _onFortDestroyed(isl) {
    if (isl.own === 'player') {
      this._showMsg(T.fortLost(isl.nm), 3000);
      this._vfx.playSound('sink');
    }
  }

  _onIslandCaptured(isl, oldOwner, newOwner) {
    // Keep FogSystem layer in sync with ownership changes
    if (newOwner === 'player') {
      this._fog.addIsland(isl);
      this._showMsg(T.islandCaptured(isl.nm), 3000);
      this._vfx.playSound('build');
      const allEnemy = this._islands.filter(i => i.own === 'enemy');
      if (!allEnemy.length) bus.emit('game:win', { reason: T.allIslandsCaptured });
    } else if (oldOwner === 'player') {
      this._fog.removeIsland(isl);
      this._showMsg(T.islandLost(isl.nm), 3000);
      this._vfx.playSound('sink');
      if (!this._islands.some(i => i.own === 'player')) {
        bus.emit('game:lose', { reason: T.allIslandsLost });
      }
    }
    this._updateObjectivesUI();
  }

  _recalcFortStats(isl) {
    if (!isl?.def) return;
    const wallDef = BUILDINGS.find(b => b.id === 'fortress_wall');
    if (!wallDef) return;
    const blds = this._state.islandBuildings[isl.def.id] || [];
    let hpB = 0, dmgB = 0;
    for (const inst of blds) {
      if (inst.buildingId !== 'fortress_wall' || inst.state === 'destroyed') continue;
      const lv = Math.max(0, (inst.level || 1) - 1);
      hpB  += wallDef.fortHpBonusByLevel[lv]  || 0;
      dmgB += wallDef.towerDmgBonusByLevel[lv] || 0;
    }
    // Delta-based: subtract old bonus, add new bonus → immune to other modifiers (capture penalty etc.)
    isl.maxHp = Math.max(50, isl.maxHp - (isl._wallHpBonus || 0) + hpB);
    isl.tdmg  = Math.max(1,  isl.tdmg  - (isl._wallDmgBonus || 0) + dmgB);
    isl._wallHpBonus  = hpB;
    isl._wallDmgBonus = dmgB;
    if (isl.hp > isl.maxHp) isl.hp = isl.maxHp;
    if (!isl.down) isl.drawHP(isl.hp / isl.maxHp);
  }

  _onBuildingPlaced(bld, inst, isl) {
    this._economy.onBuildingPlaced?.(bld, inst, isl);
    this._build.recalcWarehouse?.();
    this._showMsg(T.buildPlaced(bld.name), 1800);
  }

  _onBuildingDestroyed(inst, isl) {
    if (!isl || isl.own !== 'player') return;
    const def = (window._ALL_DEFS || []).find(b => b.id === inst.buildingId);
    this._showMsg(T.buildingDestroyed(def?.name || 'Building', isl.nm), 3200);
    this._vfx.playSound('sink');
    this._islandPanel?._refresh();
    this._buildUI?._render();
  }

  // ── HELPERS ─────────────────────────────────────────────────
  _getSelectedPlayerIsland() {
    const st = this._state;
    if (st.selectedIslandId) {
      const sel = this._islands.find(i => i.def.id === st.selectedIslandId && i.own === 'player');
      if (sel) return sel;
    }
    return this._islands.find(i => i.own === 'player') || this._islands[0];
  }

  // Called when leaving island focus (Space / fleet cam button / free cam button).
  // Clears the build grid, cancels build mode, hides selection ring.
  exitIslandFocus() {
    const st = this._state;

    // Cancel any in-progress build
    if (st._moveMode && st._movingInst) this._build.cancelMove?.();
    st.selectedBuilding = null;
    st.selectedDefense  = null;
    st.buildMode        = false;
    st.buildRotated     = false;
    this._build.clearGrid();
    const hint = document.getElementById('build-hint');
    if (hint) hint.style.display = 'none';

    // Hide island selection ring
    if (st.selectedIslandId) {
      const prev = this._islands.find(i => i.def.id === st.selectedIslandId);
      if (prev?.selRing) prev.selRing.visible = false;
    }
    st.selectedIslandId = null;
    st._camIslandSnapped = false;
  }

  _selectIsland(isl) {
    const st = this._state;
    if (st.selectedIslandId && st.selectedIslandId !== isl.def.id) {
      const prev = this._islands.find(i => i.def.id === st.selectedIslandId);
      if (prev?.selRing) prev.selRing.visible = false;
    }
    st.selectedIslandId = isl.def.id;
    if (!isl.selRing) {
      const geo = new THREE.RingGeometry(isl.r + 1, isl.r + 1.8, 48);
      isl.selRing = new THREE.Mesh(geo, ringEdgeMat(0xe8b840, 0.90));
      isl.selRing.rotation.x = -Math.PI / 2;
      isl.selRing.position.y = RING_Y;
      isl.selRing.renderOrder = RING_RENDER_ORDER;
      isl.grp.add(isl.selRing);
    }
    isl.selRing.visible = true;
    this._cam.setMode('island', isl.def.id);
    if (isl.own === 'player') {
      this._build.showGrid(isl);
      this._buildUI._homeIsl = isl;
      if (this._buildUI._render) this._buildUI._render();
    } else {
      this._build.clearGrid();
    }
    this._islandPanel.show(isl);
  }

  _buyShip(hull) {
    const BUY_CFG = {
      light:    { col: 0xb08050, spd: 0.16, sc: 0.85, disp: 200 },
      standard: { col: 0xd09040, spd: 0.14, sc: 1.00, disp: 450 },
      heavy:    { col: 0xe8b840, spd: 0.13, sc: 1.25, disp: 900 },
    };
    const BUY_COST = {
      light:    { wood: 100, gold:  60 },
      standard: { wood: 180, gold: 120 },
      heavy:    { wood: 300, gold: 200 },
    };
    const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X'];
    const BASE_NM = { light: 'Sloop', standard: 'Brigantine', heavy: 'Galleon' };

    const baseCfg = BUY_CFG[hull];
    const cost    = BUY_COST[hull];
    if (!baseCfg) return;

    const st   = this._state;
    const sc   = this._threeScene;
    const home = this._islands.find(i => i.own === 'player');
    if (!home) { this._showMsg(T.noIslandsOwned, 1800); return; }

    const maxShips  = getShipCapacity(st, this._islands);
    const aliveCount = getAlivePlayerShipCount(st);
    const reservedCount = aliveCount + st.reviveQueue.length;
    if (reservedCount >= maxShips) { this._showMsg(T.shipAtCap(reservedCount, maxShips), 1800); return; }
    if (st.resWood < cost.wood || st.resGold < cost.gold) {
      this._showMsg(T.needResources(cost.wood, cost.gold), 1800); return;
    }

    st.resWood -= cost.wood;
    st.resGold -= cost.gold;

    st._buyCount = (st._buyCount || 0) + 1;
    const nm  = `${BASE_NM[hull]} ${ROMAN[(st._buyCount - 1) % 10] || st._buyCount}`;
    const cfg = { ...baseCfg, hull, nm };

    const angle = Math.random() * Math.PI * 2;
    const spawnR = home.r + 7;
    const sx = home.x + Math.cos(angle) * spawnR;
    const sz = home.z + Math.sin(angle) * spawnR;

    const ship = makeShip(cfg, st.playerShips.length, sx, sz, 'player', sc, st);
    ship.angle = angle;
    applySpeed(ship);

    st.playerShips.push(ship);
    st.allShips.push(ship);

    // Join the selected fleet if it has room, otherwise any fleet with room
    ship.fleetId = this._fleet.findFleetWithRoom().id;

    this._overlay.build(ship);
    this._wake.addShip(ship);
    if (this._physics.ready) this._physics.addShip(ship);
    this._fog.addShip(ship);
    this._hud.rebuild();
  }

  _togglePause() {
    const st = this._state;
    st.paused = !st.paused;
    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.style.display = st.paused ? 'flex' : 'none';
  }

  _toggleMarket() {
    const panel = document.getElementById('market-panel');
    if (!panel) return;
    const open = panel.style.display !== 'none' && panel.style.display !== '';
    panel.style.display = open ? 'none' : 'block';
    if (!open) this._refreshMarketUI();
  }

  _refreshMarketUI() {
    const info = this._trade.getMarketInfo();
    const pricesEl = document.getElementById('market-prices');
    if (pricesEl) {
      const w = (info.woodSellRate * 100).toFixed(0);
      const b = (info.woodBuyRate * 10).toFixed(1);
      pricesEl.innerHTML =
        `<b>🪵 Sell rate:</b> ${w} 🪙 per 100 wood<br>` +
        `<b>🪵 Buy rate:</b> ${b} wood per 🪙<br>`;
    }
    const routeOwned = (this._islands || []).filter(i => i.team === 'player' && !i.down).length;
    const routes = Math.max(0, routeOwned - 1);
    const routesEl = document.getElementById('market-routes');
    if (routesEl) {
      routesEl.textContent = routes > 0
        ? `Trade routes: ${routes} active · +${routes * 4} 🪙 / 3s`
        : 'No trade routes yet — own 2+ islands';
    }
    window._refreshMarket = () => this._refreshMarketUI();
  }

  _updateObjectivesUI() {
    const el = document.getElementById('objectives');
    if (!el) return;
    const st = this._state;
    const enemyAlive   = st.enemyShips.filter(s => s.alive).length;
    const playerIslands = this._islands.filter(i => i.own === 'player').length;
    const enemyIslands  = this._islands.filter(i => i.own === 'enemy').length;
    const front = Math.round(st.warFront ?? 50);
    // AS: framed around the tug-of-war. The bar is the goal; these are the
    // levers that move it.
    const trend = front > 52 ? '<span class="obj-done">▲ gaining</span>'
                : front < 48 ? '<span style="color:#e07070">▼ losing</span>'
                : '<span style="color:var(--txt-faint)">— even</span>';
    el.innerHTML =
      `<div class="obj-title">WAR FRONT</div>` +
      `<div class="obj">${front}% &nbsp; ${trend}</div>` +
      `<div class="obj">⚐ Islands: you ${playerIslands} · foe ${enemyIslands}</div>` +
      `<div class="obj">🚢 Enemy ships: ${enemyAlive} afloat</div>` +
      `<div class="obj" style="color:var(--txt-faint);font-size:9px;margin-top:3px">Push the front to 100% to win</div>`;
  }

  _endGame(won, reason) {
    const st = this._state;
    if (st.gameOver) return;
    st.gameOver = true;
    st.frozen = true;
    this._orders.stop(st.playerShips);
    st.allShips.forEach(s => { s.speed = 0; });
    this._vfx.playSound(won ? 'victory' : 'defeat');   // AW: dedicated end-game stingers
    document.getElementById('end-title').textContent = won ? '🏆 VICTORY!' : '💀 DEFEATED';
    document.getElementById('end-title').className   = won ? 'win' : 'lose';
    document.getElementById('end-sub').textContent   = reason || '';
    document.getElementById('end-score').textContent =
      `Loot: ${Math.floor(st.lootPts)} · Forts: ${st.score}/${this._islands.length} · Wave ${st.waveNumber}`;
    document.getElementById('endscreen').classList.add('show');
  }

  _updateFrozenView(dt, t, focus) {
    this._cam.update(focus, dt, this._vfx.shake, this._islands);
    audio.setCameraPos(this._camera.position.x, this._camera.position.y, this._camera.position.z);
    this._hud.update();
    this._minimap.draw();
    this._debug.update(dt);

    if (this._graphicsHigh) {
      this._refl.update(this._renderer.instance, this._camera);
      this._ocean.setReflection(this._refl.texture, this._refl.projViewMatrix);
    }

    this._renderer.render();
  }

  _showMsg(txt, dur = 2500, type = null) {
    // AN/G1: routed through the stacked ToastQueue — overlapping events no
    // longer overwrite each other. Signature unchanged for all call-sites.
    toasts.show(txt, dur, type);
  }

  // ── GRACE HALO ──────────────────────────────────────────────
  _updateGraceHalo(ship, t) {
    if (!ship._graceHalo) {
      const ringGeo = new THREE.RingGeometry(1.6, 2.1, 32);
      const ring    = new THREE.Mesh(ringGeo, ringEdgeMat(0x60d8ff, 0.60));
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = RING_RENDER_ORDER;
      const sphGeo = new THREE.SphereGeometry(1.9, 16, 12);
      const sphMat = new THREE.MeshBasicMaterial({ color: 0x60d8ff, transparent: true, opacity: .12, depthWrite: false });
      const sph    = new THREE.Mesh(sphGeo, sphMat);
      const grp    = new THREE.Group();
      grp.add(ring); grp.add(sph);
      this._threeScene.add(grp);
      ship._graceHalo     = grp;
      ship._graceHaloRing = ring;
      ship._graceHaloSph  = sph;
    }
    const remain   = Math.max(0, ship._graceTimer || 0);
    const lifeFrac = Math.max(0, Math.min(1, remain / 5.0));
    const pulse    = .5 + .5 * Math.sin(t * 5);
    ship._graceHalo.position.set(ship.x, .35, ship.z);
    ship._graceHaloRing.material.opacity = .25 + .45 * lifeFrac * (.65 + pulse * .35);
    ship._graceHaloSph.material.opacity  = .06 + .14 * lifeFrac;
    ship._graceHalo.scale.setScalar(1 + (1 - lifeFrac) * .15);
  }

  // ── MAIN LOOP ───────────────────────────────────────────────
  _start() {
    this._overlay.rebuildStaticRings(this._islands);
    this._showMsg(T.welcomeMsg, 3800);
    time.on('tick.gameapp', () => this._update());
  }

  _update() {
    const st = this._state;
    const dt = time.delta;
    const t  = time.elapsed;

    if (st.paused) { this._renderer.render(); return; }

    // World
    updateSailTime(t);
    this._sky.update(t);
    // AF7: sync DirectionalLight + ambient + fog with Sky's sun each frame
    const sunDir  = this._sky.getSunDir();
    const dayPhase = Math.sin(t * 0.035 + 1.5708) * 0.5 + 0.5;  // mirrors Sky shader (+ π/2 offset)
    this._scene.setSunDir(sunDir, dayPhase);
    this._ocean.update(t, this._camera, sunDir);
    window._getWaveHeight = getWaveHeight;

    // AU: camera follows the selection's centroid in 'fleet' mode. The world
    // keeps running with zero ships afloat (revives, economy, AI) — the old
    // leader gate froze the whole game when the last ship sank.
    const focus = st.camMode === 'fleet' ? this._command.centroid() : null;
    if (st.gameOver) { this._updateFrozenView(dt, t, focus); return; }

    this._vfx.update(dt);
    this._empire?.tick(dt);   // AP: 1 Hz re-render while open
    this._warFront?.update(dt);   // AS: continuous tug-of-war pressure
    this._warHUD?.update();       // AS: refresh front bar
    this._commander?.update(dt);  // AT: ability cooldowns + heal-over-time

    // Movement: fleet automation issues orders, OrderSystem sails every ship
    this._fleet.update(dt);
    this._orders.update(dt);
    separateFleet(st.playerShips);

    // Status effects + burn
    const gameT = st.stats.timeSec;
    st.allShips.forEach(s => {
      if (!s.alive) { this._overlay.sync(s); return; }  // keep rings hidden for dead ships
      s.effects = s.effects.filter(ef => {
        ef.timer -= dt;
        if (ef.type === 'burn' && ef.timer > 0) { s.hp = Math.max(0, s.hp - 5 * dt); if (s.hp <= 0) bus.emit('ship:destroyed', { ship: s }); }
        return ef.timer > 0;
      });
      if (s.statusEffects) Object.keys(s.statusEffects).forEach(type => {
        if (s.statusEffects[type].expiresAt <= gameT) delete s.statusEffects[type];
      });
    });

    // S8: recalcWarehouse is now triggered by bus events (building:placed/ready/upgraded/demolished/destroyed)
    // No need for periodic polling timer

    // AP: Haven trait — player-owned haven islands repair nearby friendly
    // ships. Ticked at 2 Hz (not per-frame): O(havens × ships) stays trivial
    // and regen is too slow for sub-frame precision to matter.
    this._havenT = (this._havenT || 0) + dt;
    if (this._havenT >= 0.5) {
      const step = this._havenT; this._havenT = 0;
      for (const isl of this._islands) {
        const trait = getTrait(isl);
        if (!trait?.repairRate || isl.own !== 'player' || isl.down) continue;
        const R = isl.r + (trait.repairRange || 16), R2 = R * R;
        for (const sh of st.playerShips) {
          if (!sh.alive || sh.hp >= sh.maxHp) continue;
          const dx = sh.x - isl.x, dz = sh.z - isl.z;
          if (dx * dx + dz * dz > R2) continue;
          sh.hp = Math.min(sh.maxHp, sh.hp + trait.repairRate * step);
          if (Math.random() < 0.25)
            this._vfx.floatText(sh.x, 3.2, sh.z, '+⚓', { col: '#5cc8a8', size: 11, life: 1.0, rise: 1.8 });
        }
      }
    }

    // Combat
    const eForts = this._islands.filter(i => !i.down && i.own === 'enemy');
    const nForts = this._islands.filter(i => !i.down && i.own === 'neutral');
    const pirates = this._events.getPirateShips();
    // AU: pirates attack everyone — player ships now return fire (they were
    // never in the player's target list before)
    const hostiles = [...st.enemyShips.filter(e => e.alive), ...pirates];
    st.playerShips.forEach(s => this._combat.tickShip(s, hostiles, [...eForts, ...nForts], dt));
    this._ai.update(dt);
    if (pirates.length) {
      const allTargets = [...st.playerShips, ...st.enemyShips].filter(s => s.alive);
      pirates.forEach(p => this._combat.tickShip(p, allTargets, [], dt));
    }
    this._islands.forEach(isl => {
      const targets = isl.own === 'enemy' ? st.playerShips : isl.own === 'player' ? st.enemyShips : [...st.playerShips, ...st.enemyShips];
      this._combat.tickIsland(isl, targets, dt);
      isl.updateFire(dt, this._vfx);  // AF7: tick persistent fort fire
    });

    // Systems
    this._build.update(dt);
    this._capture.update(dt);
    this._events.update(dt);
    this._aura.update(dt, t);
    this._economy.update(dt);
    this._trade.update(dt);
    this._wave.update(dt);
    this._revive.update(dt);
    this._bldCtrl.tickFortRebuild(dt);

    // Stats
    if (!st.gameOver) { st.statsTimer += dt; st.stats.timeSec = Math.floor(st.statsTimer); }
    // AS: loot is now just a resource/score, not a separate win line —
    // the WarFront is the single victory axis. (Loot still feeds econ edge.)

    // Physics + ship mesh sync
    this._wake.update(dt, t);
    if (this._physics.ready) {
      st.allShips.forEach(s => { if (s.alive) this._physics.syncToShip(s); });
      this._physics.update(dt, t);
    }
    st.allShips.forEach(s => {
      if (!s.alive) return;
      if (!this._physics.ready) {
        // Spring buoyancy — ported from threejs_ocean_buoy_fixed.html
        if (s._buoyY === undefined) {
          s._buoyY = 0.35; s._buoyVY = 0;
          s._pitchA = 0; s._rollA = 0; s._pitchV = 0; s._rollV = 0;
        }
        const ep  = 0.7;
        const wy   = getWaveHeight(s.x, s.z, t);
        const wyPX = getWaveHeight(s.x + ep, s.z, t);
        const wyMX = getWaveHeight(s.x - ep, s.z, t);
        const wyPZ = getWaveHeight(s.x, s.z + ep, t);
        const wyMZ = getWaveHeight(s.x, s.z - ep, t);

        // Vertical spring: buoyancy force vs gravity
        const waterLine  = wy + 0.35;
        const submersion = waterLine - s._buoyY;
        const accel      = 22.0 * submersion - 9.8;
        s._buoyVY  = (s._buoyVY + accel * dt) * 0.90;
        s._buoyY  += s._buoyVY * dt;
        if (s._buoyY < wy) { s._buoyY = wy; s._buoyVY *= -0.15; }

        // Pitch / roll spring toward wave slope
        const sinA    = Math.sin(s.angle), cosA = Math.cos(s.angle);
        const slopeX  = (wyPX - wyMX) / (2 * ep);
        const slopeZ  = (wyPZ - wyMZ) / (2 * ep);
        const tgtPitch = (cosA * slopeZ - sinA * slopeX) * 0.65;
        const tgtRoll  = (sinA * slopeZ + cosA * slopeX) * 0.65;
        s._pitchV += ((tgtPitch - s._pitchA) * 12 - s._pitchV * 5) * dt;
        s._rollV  += ((tgtRoll  - s._rollA)  * 12 - s._rollV  * 5) * dt;
        s._pitchA  = Math.max(-0.40, Math.min(0.40, s._pitchA + s._pitchV * dt));
        s._rollA   = Math.max(-0.40, Math.min(0.40, s._rollA  + s._rollV  * dt));

        s.mesh.position.set(s.x, s._buoyY, s.z);
        s.mesh.rotation.y = s.angle;
        s.mesh.rotation.x = s._pitchA;
        s.mesh.rotation.z = s._rollA;
      }
      // Player ships always visible; enemy ships controlled by FogSystem below
      if (!st.fogOn || s.team === 'player') s.mesh.visible = true;
      if (s._gracePeriod) this._updateGraceHalo(s, t);
      else if (s._graceHalo) { this._threeScene.remove(s._graceHalo); s._graceHalo = null; }
      this._overlay.sync(s);

      // ── Night lantern ─────────────────────────────────────────
      const nightF = Math.max(0, (0.42 - dayPhase) / 0.42);
      if (nightF > 0.04) {
        if (!s._lantern) {
          s._lantern = new THREE.PointLight(0xff9040, 0, 11);
          s._lantern.position.set(0, 3.5, 0);
          s.mesh.add(s._lantern);
        }
        s._lantern.intensity = nightF * 1.8 * (0.82 + 0.18 * Math.sin(t * 7.3 + s.rank * 1.9));
      } else if (s._lantern) {
        s.mesh.remove(s._lantern); s._lantern.dispose(); s._lantern = null;
      }
    });

    // Fort torches at night
    const nightF = Math.max(0, (0.42 - dayPhase) / 0.42);
    this._islands.forEach(isl => {
      if (isl.down) {
        if (isl._torch) { isl.grp.remove(isl._torch); isl._torch.dispose(); isl._torch = null; }
        return;
      }
      if (nightF > 0.04) {
        if (!isl._torch) {
          isl._torch = new THREE.PointLight(0xff7020, 0, 22);
          isl._torch.position.set(0, 9, 0);
          isl.grp.add(isl._torch);
        }
        isl._torch.intensity = nightF * 2.8 * (0.78 + 0.22 * Math.sin(t * 4.8 + isl.x * 0.07));
      } else if (isl._torch) {
        isl.grp.remove(isl._torch); isl._torch.dispose(); isl._torch = null;
      }
    });

    // Fog of War — ship positions feed into VisionLayer which does O(1) visibility
    // checks. Islands are registered once on init/capture, not re-scanned each frame.
    this._fog.update(st, st.playerShips);

    // Vision + ring pulse + RTS markers
    this._vision.follow(st.selection.find(s => s.alive) || st.playerShips.find(s => s.alive));
    if (this._vision._grp) this._vision._grp.visible = !!st.fogOn;   // declutter: vision ring only matters under fog
    this._scene.updateMoveRing(t, dt);
    this._markers.update(dt, t, this._command.hover, st.fleets, this._input.isDown('shift'));

    // Camera
    this._cam.update(focus, dt, this._vfx.shake, this._islands);
    // Sync spatial audio listener to camera position
    audio.setCameraPos(this._camera.position.x, this._camera.position.y, this._camera.position.z);

    // HUD
    this._hud.update();
    this._minimap.draw();
    this._shipBars.update(this._command.hover, hostiles, !!this._overlay._tacticalOn);

    // Periodic UI refresh (0.25s)
    this._uiTimer = (this._uiTimer || 0) + dt;
    if (this._uiTimer >= 0.25) {
      this._uiTimer = 0;
      // AV: the right-hand island dock shares the bottom-right corner with
      // the command console — the console makes room while it is open
      const dock = this._panels.isOpen('island-panel');
      if (document.body.classList.contains('dock-open') !== dock) {
        document.body.classList.toggle('dock-open', dock);
        this._hud.fit();                      // cards re-pack into the narrower row
      }
      if (window.refreshAuraPanel) window.refreshAuraPanel();
      if (this._panels.isOpen('bp')            && this._buildUI?._updateAffordability) this._buildUI._updateAffordability();
      if (this._panels.isOpen('rp')            && this._researchUI?._render)  this._researchUI._render();
      if (this._panels.isOpen('island-panel')  && this._islandPanel?._refresh) this._islandPanel._refresh();
      if (this._panels.isOpen('revive-panel')  && this._reviveUI?._render)   this._reviveUI._render();
      this._cmdCard.refresh();
    }

    // Fleet capacity (1s)
    this._capTimer = (this._capTimer || 0) + dt;
    if (this._capTimer >= 1) {
      this._capTimer = 0;
      const maxFleet     = getShipCapacity(st, this._islands);
      const aliveCount   = getAlivePlayerShipCount(st);
      const fleetCount   = st.fleets?.length || 0;
      const capEl        = document.getElementById('fleet-capacity');
      if (capEl) {
        const over = aliveCount > maxFleet ? ' over cap' : '';
        capEl.textContent = `Ships ${aliveCount}/${maxFleet}${over} · ${fleetCount} fleet${fleetCount > 1 ? 's' : ''}`;
      }
    }

    this._debug.update(dt);

    // Planar reflection pass (high-graphics only)
    if (this._graphicsHigh) {
      this._refl.update(this._renderer.instance, this._camera);
      this._ocean.setReflection(this._refl.texture, this._refl.projViewMatrix);
    }

    this._renderer.render();
  }
}
