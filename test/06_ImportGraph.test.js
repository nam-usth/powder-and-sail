// ── TEST: Import Graph Integrity ──────────────────────────────────
// After the reorganize (game/ → Experience/), every module must:
//   1. Import without error
//   2. Export its expected symbols
//   3. Not leave stale references to old paths (checked via dynamic import)
//
// This test file is the primary "did the reorganize break anything?" check.
// It doesn't test behavior — just that the module graph resolves.

import { suite, test, assert, assertEqual } from './runner.js';

suite('Import graph — data layer', () => {

  test('constants.js exports MAP, RANGE_U, WOOD_CAP', async () => {
    const m = await import('../frontend/src/data/constants.js');
    assert(typeof m.MAP === 'number', 'MAP should be a number');
    assert(typeof m.RANGE_U === 'object', 'RANGE_U should be an object');
    assert(typeof m.WOOD_CAP === 'number');
  });

  test('cannons.js exports CANNONS array', async () => {
    const m = await import('../frontend/src/data/cannons.js');
    assert(Array.isArray(m.CANNONS), 'CANNONS should be an array');
    assert(m.CANNONS.length > 0, 'CANNONS should not be empty');
    assert(m.CANNONS[0].id, 'each cannon should have an id');
  });

  test('ships.js exports HULL_SLOTS, PCFG, ECFG', async () => {
    const m = await import('../frontend/src/data/ships.js');
    assert(typeof m.HULL_SLOTS === 'object');
    assert(Array.isArray(m.PCFG));
    assert(Array.isArray(m.ECFG));
  });

  test('buildings.js exports BUILDINGS array', async () => {
    const m = await import('../frontend/src/data/buildings.js');
    assert(Array.isArray(m.BUILDINGS));
    assert(m.BUILDINGS.length > 0);
  });

  test('defenses.js exports DEFENSES + getDefenseStats', async () => {
    const m = await import('../frontend/src/data/defenses.js');
    assert(Array.isArray(m.DEFENSES));
    assert(typeof m.getDefenseStats === 'function');
  });

});

suite('Import graph — Experience core', () => {

  test('EventEmitter.js resolves and exports EventEmitter class', async () => {
    const m = await import('../frontend/src/Experience/EventEmitter.js');
    assert(typeof m.EventEmitter === 'function');
    const ee = new m.EventEmitter();
    assert(typeof ee.on === 'function');
    assert(typeof ee.off === 'function');
    assert(typeof ee.trigger === 'function');
  });

  test('EventBus.js resolves and exports bus singleton', async () => {
    const m = await import('../frontend/src/Experience/EventBus.js');
    assert(m.bus, 'bus singleton should exist');
    assert(typeof m.bus.on === 'function');
    assert(typeof m.bus.emit === 'function');
  });

  test('GameState.js resolves and exports createGameState', async () => {
    const m = await import('../frontend/src/Experience/GameState.js');
    assert(typeof m.createGameState === 'function');
    const st = m.createGameState();
    assert(typeof st.resWood === 'number');
    assert(typeof st.resGold === 'number');
    assert(Array.isArray(st.playerShips));
    assert(Array.isArray(st.allShips));
  });

});

suite('Import graph — Experience/World', () => {

  test('Ocean.js exports getWaveHeight function + Ocean class', async () => {
    const m = await import('../frontend/src/Experience/World/Ocean.js');
    assert(typeof m.getWaveHeight === 'function', 'getWaveHeight should be exported');
    assert(typeof m.Ocean === 'function', 'Ocean class should be exported');
  });

  test('WakeSystem.js resolves and exports WakeSystem', async () => {
    const m = await import('../frontend/src/Experience/World/WakeSystem.js');
    assert(typeof m.WakeSystem === 'function');
  });

  test('ShipEntity.js exports makeShip + buildShipMesh', async () => {
    const m = await import('../frontend/src/Experience/World/ShipEntity.js');
    assert(typeof m.makeShip === 'function');
    assert(typeof m.buildShipMesh === 'function');
  });

});

suite('Import graph — Experience/Systems', () => {

  test('CombatSystem.js exports CombatSystem + canFire + resolveArc', async () => {
    const m = await import('../frontend/src/Experience/Systems/Combat/CombatSystem.js');
    assert(typeof m.CombatSystem === 'function');
    assert(typeof m.canFire === 'function');
    assert(typeof m.resolveArc === 'function');
  });

  test('EconomySystem.js exports EconomySystem', async () => {
    const m = await import('../frontend/src/Experience/Systems/Economy/EconomySystem.js');
    assert(typeof m.EconomySystem === 'function');
  });

  test('ReviveSystem.js exports ReviveSystem', async () => {
    const m = await import('../frontend/src/Experience/Systems/Naval/ReviveSystem.js');
    assert(typeof m.ReviveSystem === 'function');
  });

  test('FleetCommander.js exports FleetCommander + ROLES', async () => {
    const m = await import('../frontend/src/Experience/Systems/Naval/FleetCommander.js');
    assert(typeof m.FleetCommander === 'function');
    assert(typeof m.ROLES === 'object');
  });

  test('StatusEffects.js exports StatusEffects with expected methods', async () => {
    const m = await import('../frontend/src/Experience/Systems/Combat/StatusEffects.js');
    assert(typeof m.StatusEffects.effectiveSpeed  === 'function');
    assert(typeof m.StatusEffects.effectiveROF    === 'function');
    assert(typeof m.StatusEffects.tick            === 'function');
  });

  test('MovementSystem.js exports moveToward + separateFleet functions', async () => {
    const m = await import('../frontend/src/Experience/Systems/Naval/MovementSystem.js');
    assert(typeof m.moveToward    === 'function', 'moveToward should be exported');
    assert(typeof m.separateFleet === 'function', 'separateFleet should be exported');
    assert(typeof m.isBlocked     === 'function', 'isBlocked should be exported');
  });

  test('BuildSystem.js exports BuildSystem', async () => {
    const m = await import('../frontend/src/Experience/Systems/Economy/BuildSystem.js');
    assert(typeof m.BuildSystem === 'function');
  });

  test('AU command layer modules resolve with their exports', async () => {
    const os  = await import('../frontend/src/Experience/Systems/Naval/OrderSystem.js');
    const nav = await import('../frontend/src/Experience/Systems/Naval/Navigation.js');
    const fm  = await import('../frontend/src/Experience/Systems/Naval/Formations.js');
    const cc  = await import('../frontend/src/Experience/Controllers/CommandController.js');
    const mk  = await import('../frontend/src/Experience/World/CommandMarkers.js');
    const cd  = await import('../frontend/src/Experience/UI/CommandCard.js');
    const dat = await import('../frontend/src/data/commands.js');
    assert(typeof os.OrderSystem === 'function' && typeof os.gunProfile === 'function');
    assert(typeof nav.planPath === 'function' && typeof nav.pushOutside === 'function');
    assert(typeof fm.formationSlots === 'function' && typeof fm.assignSlots === 'function');
    assert(typeof cc.CommandController === 'function');
    assert(typeof mk.CommandMarkers === 'function');
    assert(typeof cd.CommandCard === 'function');
    assert(dat.FORMATIONS.column && dat.STANCES.holdfire, 'formation/stance tables');
  });

});

suite('Import graph — i18n', () => {

  test('i18n.js exports T, setLang, getLang, LANGS', async () => {
    const m = await import('../frontend/src/i18n.js');
    assert(m.T, 'T should be defined');
    assert(typeof m.setLang === 'function');
    assert(typeof m.getLang === 'function');
    assert(typeof m.LANGS === 'object');
  });

  test('T has required keys for EN', async () => {
    const { T, setLang } = await import('../frontend/src/i18n.js');
    setLang('en');
    const required = [
      'welcomeMsg','buildCancelled','shipAtCap','shipLaunched',
      'shipLost','allShipsLost','fortLost','islandCaptured',
      'allIslandsCaptured','islandLost','buildPlaced',
    ];
    for (const key of required) {
      assert(T[key] !== undefined, `T.${key} should exist in EN`);
    }
  });

  test('T has required keys for VI', async () => {
    const { T, setLang } = await import('../frontend/src/i18n.js');
    setLang('vi');
    const required = [
      'welcomeMsg','buildCancelled','shipAtCap','shipLaunched',
      'shipLost','allShipsLost','fortLost','islandCaptured',
      'allIslandsCaptured','islandLost','buildPlaced',
    ];
    for (const key of required) {
      assert(T[key] !== undefined, `T.${key} should exist in VI`);
    }
    setLang('en');  // restore
  });

});

suite('Import graph — UI layer', () => {

  test('PanelManager.js exports PanelManager singleton', async () => {
    const m = await import('../frontend/src/Experience/UI/PanelManager.js');
    assert(m.PanelManager, 'PanelManager singleton should exist');
    assert(typeof m.PanelManager.open === 'function');
    assert(typeof m.PanelManager.close === 'function');
    assert(typeof m.PanelManager.toggle === 'function');
    assert(typeof m.PanelManager.isOpen === 'function');
  });

  test('PanelManager.isOpen returns false for nonexistent panel', async () => {
    const { PanelManager } = await import('../frontend/src/Experience/UI/PanelManager.js');
    assertEqual(PanelManager.isOpen('panel-that-does-not-exist'), false);
  });

  test('SpringCamera.js exports SpringCamera class', async () => {
    const m = await import('../frontend/src/Experience/SpringCamera.js');
    assert(typeof m.SpringCamera === 'function');
    const s = new m.SpringCamera();
    assert(typeof s.update === 'function');
    assert(typeof s.warpTo === 'function');
    assert(typeof s.setTarget === 'function');
  });

});
