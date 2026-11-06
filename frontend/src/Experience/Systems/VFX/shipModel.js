import * as THREE from 'three';
import { ENV } from './env.js';
import { FACTIONS, factionOf } from '../../../data/factions.js';
import { gfx } from '../../Render/GfxQuality.js';

// ── Procedural sailing ships ───────────────────────────────────────
// Technical-art module behind ShipEntity.buildShipMesh(). A ship is built
// from a BLUEPRINT (visual data only — gameplay numbers stay in data/):
//   • lofted hull: keel → bilge → tumblehome, sheer, raked stem, transom,
//     stepped quarterdeck/poop/forecastle, copper + boot-top + tarred sides,
//     a painted strake per gun deck (hull colour = cfg.col) with gunports and
//     red port lids, planked deck, red inner bulwarks, gilding by tier
//   • spars: tapered masts with tops, yards, gaffs, booms, bowsprit
//   • sails: square / gaff / lateen / jib / flag / pennant in ONE mesh with a
//     billow + flutter shader (wind envelope per sail type, analytic normals,
//     translucent back-lighting, team trim, torn + sooted by damage)
//   • rigging as one LineSegments, stern lantern glow billboards
//
// Silhouette comes from hullId (cutter · sloop · schooner · corvette ·
// brigantine · brig · frigate · xebec · galleon · heavy_frigate ·
// war_galleon · man_o_war · ship_of_the_line); TIER (I..V) adds gilding,
// lanterns, flag size and pennants. Classic Open War configs (no hullId)
// resolve by name hint, then by combat class.
//
// Cost model: geometry is cached per (hullId, tier, paint colour) and SHARED
// by every ship using it (flagged userData.shared → never disposed per ship).
// Per ship: 1 hull material + 1 sail material (cheap clones of one program),
// rigging + lantern materials shared. ≈ 4 draw calls per ship.

/** Symbol key linking a ship root Object3D → its gameplay ship object.
 *  Symbol keys are skipped by Object3D.clone()'s JSON copy of userData, so
 *  clones (wrecks) never carry the link. */
export const SHIP_REF = Symbol.for('iow.shipRef');

/** Shared sail clock (ShipEntity.updateSailTime writes it once per frame). */
export const SAIL_TIME = { value: 0 };

export const WATERLINE = -0.35;   // ship-root local y of the waterline (root sits at wave + 0.35)

// ── Faction liveries (data/factions.js) ──────────────────────────
// Colours, ensign pattern and hull/rig family come from FACTIONS; this table
// only maps the ensign pattern names onto the sail shader's pattern ids and
// adds per-faction painting rules:
//   pirates (european) → patched, sun-rotted canvas
//   crown navies       → gilded sterns / rails
//   spain / portugal   → red cross painted on the courses (Burgundy saltire /
//                        Cross of the Order of Christ)
const FLAG_PATTERN = { anchor: 0, skull: 1, saltire: 2, plain: 3, stripes: 4, tricolour: 5, quinas: 6, banner: 7 };
const SAIL_EMBLEM  = { spain: 1, portugal: 2 };
const FACTION_ALIAS = { pirate: 'buccaneers', pirates: 'buccaneers', enemy: 'buccaneers', armada: 'spain',
                        company: 'england', navy: 'spain', dutch: 'netherlands', voc: 'netherlands' };

/**
 * Livery for a ship: explicit cfg.faction wins (ids from data/factions.js,
 * a few legacy aliases accepted), the player keeps its own ensign, every
 * other team defaults to pirates (factionOf's fallback).
 * @param {string} team      makeShip team ('player' | 'enemy' | 'pirate')
 * @param {string} [faction] cfg.faction id
 * @returns {{id:string, cloth:number, trim:number, flagA:number, flagB:number, pattern:number,
 *            style:string, gild:boolean, patched:number, emblem:number, paint:number}}
 */
export function resolveLivery(team, faction) {
  let id = FACTIONS[faction] ? faction : FACTION_ALIAS[faction];
  if (!id || !FACTIONS[id]) id = team === 'player' ? 'player' : 'buccaneers';
  const f = factionOf(id);
  const style = f.style || 'european';
  return {
    id, style,
    cloth: f.sail ?? 0xf1eadb, trim: f.trim ?? 0x2b5c9e,
    flagA: f.flag?.field ?? 0xffffff, flagB: f.flag?.charge ?? 0x222222,
    pattern: FLAG_PATTERN[f.flag?.pattern] ?? 3,
    gild: f.kind === 'crown',
    patched: f.kind === 'pirates' && style === 'european' ? 1 : 0,
    emblem: SAIL_EMBLEM[id] || 0,
    paint: f.trim ?? 0x6b4a2a,
  };
}

// ships2: warm honey/brown planking + dark tarred wales (art reference: chunky,
// readable hulls with warm wood tones and dark wales)
const PAL0 = {
  copper: 0x8c5b3e, boot: 0xcdbf9f, hull: 0x8a5530, wale: 0x1b120b,
  bulwarkIn: 0x8a3a26, rail: 0x3a2617, deckA: 0xc89c62, deckB: 0xb88d56, hatch: 0x5a3f27,
  mast: 0x6f5135, yard: 0x584029, top: 0x4b3726, gold: 0xc79a3c, port: 0x0b0806,
  window: 0xffc06a, lanternBody: 0x2a2018, gun: 0x18181a, carriage: 0x5a3e26,
};

// ── Blueprints (sc = 1 units, waterline y = 0, +z = bow) ──────────
// L deck length · B beam · F freeboard (midship gunwale above WL) · D draft
// sheerB/S sheer rise at bow/stern · trans transom width ratio
// bowRake/sternRake overhangs · full bilge fullness (lower = fuller)
// tumble tumblehome · qd/poop/fc castles {t: edge station 0..1, h}
// decks: gun decks [{ports per side}] · deckGuns: open-deck guns per side
// masts: z (fraction of L from midship), h above deck, rig:
//   'square' {tiers, w (course yard × B), spanker}
//   'gaff'   {boom, gaff (× L), topsail, squareTop}
//   'lateen' {fwd, aft (× L)}
// jibs: headsails on the forestay · bowsprit length · bsAngle (rad)
export const BLUEPRINTS = {
  cutter: { tier: 1, L: 4.3, B: 1.20, F: 0.40, D: 0.46, sheerB: 0.16, sheerS: 0.07, trans: 0.42, bowRake: 0.25, sternRake: 0.12, full: 0.6, tumble: 0.04,
    decks: [], deckGuns: 2, bowsprit: 1.9, bsAngle: 0.10, jibs: 2,
    masts: [{ z: 0.07, h: 5.0, rig: 'gaff', boom: 0.62, gaff: 0.36, topsail: true, rake: 0.05 }] },
  sloop: { tier: 1, L: 4.6, B: 1.32, F: 0.42, D: 0.48, sheerB: 0.18, sheerS: 0.10, trans: 0.50, bowRake: 0.28, sternRake: 0.12, full: 0.58, tumble: 0.05,
    decks: [], deckGuns: 3, bowsprit: 1.6, bsAngle: 0.14, jibs: 2,
    masts: [{ z: 0.05, h: 5.3, rig: 'gaff', boom: 0.55, gaff: 0.34, squareTop: 1, rake: 0.04 }] },
  schooner: { tier: 1, L: 5.0, B: 1.26, F: 0.40, D: 0.46, sheerB: 0.16, sheerS: 0.06, trans: 0.42, bowRake: 0.36, sternRake: 0.16, full: 0.62, tumble: 0.04,
    decks: [], deckGuns: 3, bowsprit: 1.7, bsAngle: 0.12, jibs: 2,
    masts: [{ z: 0.24, h: 4.6, rig: 'gaff', boom: 0.28, gaff: 0.22, topsail: true, rake: 0.10 },
            { z: -0.10, h: 5.1, rig: 'gaff', boom: 0.50, gaff: 0.30, topsail: true, rake: 0.10 }] },
  corvette: { tier: 2, L: 5.2, B: 1.40, F: 0.50, D: 0.50, sheerB: 0.16, sheerS: 0.10, trans: 0.55, bowRake: 0.28, sternRake: 0.14, full: 0.55, tumble: 0.06,
    decks: [{ ports: 7 }], bowsprit: 1.6, bsAngle: 0.18, jibs: 2,
    masts: [{ z: 0.27, h: 5.0, rig: 'square', tiers: 3, w: 1.85 }, { z: 0.02, h: 5.6, rig: 'square', tiers: 3, w: 2.0 },
            { z: -0.25, h: 4.4, rig: 'square', tiers: 2, w: 1.5, spanker: true }] },
  brigantine: { tier: 2, L: 5.0, B: 1.50, F: 0.52, D: 0.55, sheerB: 0.20, sheerS: 0.12, trans: 0.60, bowRake: 0.28, sternRake: 0.14, full: 0.52, tumble: 0.07,
    qd: { t: 0.22, h: 0.14 }, decks: [{ ports: 5 }], bowsprit: 1.7, bsAngle: 0.18, jibs: 2,
    masts: [{ z: 0.22, h: 5.6, rig: 'square', tiers: 3, w: 1.95 },
            { z: -0.14, h: 5.9, rig: 'gaff', boom: 0.46, gaff: 0.30, squareTop: 2 }] },
  brig: { tier: 2, L: 5.1, B: 1.58, F: 0.55, D: 0.56, sheerB: 0.18, sheerS: 0.12, trans: 0.60, bowRake: 0.26, sternRake: 0.14, full: 0.5, tumble: 0.07,
    qd: { t: 0.20, h: 0.12 }, decks: [{ ports: 6 }], bowsprit: 1.7, bsAngle: 0.18, jibs: 2,
    masts: [{ z: 0.22, h: 5.8, rig: 'square', tiers: 3, w: 2.0 }, { z: -0.12, h: 6.1, rig: 'square', tiers: 3, w: 2.05, spanker: true }] },
  frigate: { tier: 3, L: 5.8, B: 1.62, F: 0.62, D: 0.60, sheerB: 0.20, sheerS: 0.14, trans: 0.62, bowRake: 0.30, sternRake: 0.16, full: 0.5, tumble: 0.08,
    qd: { t: 0.27, h: 0.12 }, fc: { t: 0.84, h: 0.08 }, decks: [{ ports: 9 }], bowsprit: 1.9, bsAngle: 0.2, jibs: 3,
    masts: [{ z: 0.27, h: 6.0, rig: 'square', tiers: 3, w: 1.95 }, { z: 0.02, h: 6.7, rig: 'square', tiers: 3, w: 2.1 },
            { z: -0.24, h: 5.2, rig: 'square', tiers: 2, w: 1.6, spanker: true }] },
  xebec: { tier: 3, L: 5.6, B: 1.30, F: 0.44, D: 0.46, sheerB: 0.36, sheerS: 0.32, trans: 0.38, bowRake: 0.62, sternRake: 0.40, full: 0.6, tumble: 0.05,
    decks: [{ ports: 6 }], bowsprit: 1.3, bsAngle: 0.30, jibs: 0,
    masts: [{ z: 0.31, h: 4.6, rig: 'lateen', fwd: 0.26, aft: 0.28, rake: -0.10 },
            { z: 0.02, h: 5.2, rig: 'lateen', fwd: 0.30, aft: 0.32 },
            { z: -0.28, h: 4.2, rig: 'lateen', fwd: 0.22, aft: 0.26 }] },
  galleon: { tier: 3, L: 5.5, B: 1.85, F: 0.62, D: 0.62, sheerB: 0.30, sheerS: 0.22, trans: 0.70, bowRake: 0.34, sternRake: 0.18, full: 0.45, tumble: 0.14,
    qd: { t: 0.34, h: 0.30 }, poop: { t: 0.15, h: 0.24 }, fc: { t: 0.80, h: 0.30 }, decks: [{ ports: 7 }],
    bowsprit: 2.0, bsAngle: 0.42, jibs: 0, windows: 2,
    masts: [{ z: 0.27, h: 5.6, rig: 'square', tiers: 2, w: 1.9 }, { z: 0.02, h: 6.4, rig: 'square', tiers: 3, w: 2.05 },
            { z: -0.24, h: 5.0, rig: 'lateen', fwd: 0.20, aft: 0.26 }] },
  heavy_frigate: { tier: 4, L: 6.1, B: 1.78, F: 0.78, D: 0.66, sheerB: 0.20, sheerS: 0.14, trans: 0.64, bowRake: 0.30, sternRake: 0.16, full: 0.48, tumble: 0.09,
    qd: { t: 0.27, h: 0.12 }, fc: { t: 0.85, h: 0.08 }, decks: [{ ports: 10 }, { ports: 8 }], bowsprit: 2.0, bsAngle: 0.2, jibs: 3, windows: 2,
    masts: [{ z: 0.27, h: 6.4, rig: 'square', tiers: 3, w: 2.0 }, { z: 0.02, h: 7.1, rig: 'square', tiers: 3, w: 2.15 },
            { z: -0.24, h: 5.6, rig: 'square', tiers: 2, w: 1.65, spanker: true }] },
  war_galleon: { tier: 4, L: 5.9, B: 2.00, F: 0.78, D: 0.70, sheerB: 0.32, sheerS: 0.26, trans: 0.72, bowRake: 0.36, sternRake: 0.18, full: 0.44, tumble: 0.16,
    qd: { t: 0.34, h: 0.32 }, poop: { t: 0.16, h: 0.26 }, fc: { t: 0.80, h: 0.32 }, decks: [{ ports: 8 }, { ports: 7 }],
    bowsprit: 2.1, bsAngle: 0.44, jibs: 0, windows: 2,
    masts: [{ z: 0.30, h: 5.9, rig: 'square', tiers: 3, w: 1.9 }, { z: 0.06, h: 6.8, rig: 'square', tiers: 3, w: 2.05 },
            { z: -0.17, h: 5.4, rig: 'lateen', fwd: 0.20, aft: 0.24 }, { z: -0.36, h: 4.4, rig: 'lateen', fwd: 0.14, aft: 0.20 }] },
  man_o_war: { tier: 5, L: 6.2, B: 2.00, F: 0.88, D: 0.72, sheerB: 0.22, sheerS: 0.16, trans: 0.66, bowRake: 0.32, sternRake: 0.18, full: 0.46, tumble: 0.10,
    qd: { t: 0.30, h: 0.14 }, fc: { t: 0.85, h: 0.10 }, decks: [{ ports: 11 }, { ports: 10 }], bowsprit: 2.2, bsAngle: 0.22, jibs: 3, windows: 2,
    masts: [{ z: 0.27, h: 6.6, rig: 'square', tiers: 3, w: 2.0 }, { z: 0.02, h: 7.5, rig: 'square', tiers: 4, w: 2.2 },
            { z: -0.24, h: 5.9, rig: 'square', tiers: 3, w: 1.7, spanker: true }] },
  ship_of_the_line: { tier: 5, L: 6.4, B: 2.10, F: 1.05, D: 0.78, sheerB: 0.20, sheerS: 0.16, trans: 0.66, bowRake: 0.32, sternRake: 0.18, full: 0.46, tumble: 0.11,
    qd: { t: 0.30, h: 0.12 }, fc: { t: 0.86, h: 0.08 }, decks: [{ ports: 12 }, { ports: 11 }, { ports: 10 }], bowsprit: 2.3, bsAngle: 0.22, jibs: 3, windows: 3,
    masts: [{ z: 0.27, h: 7.0, rig: 'square', tiers: 4, w: 2.0 }, { z: 0.02, h: 7.9, rig: 'square', tiers: 4, w: 2.2 },
            { z: -0.24, h: 6.2, rig: 'square', tiers: 3, w: 1.7, spanker: true }] },

  // ── Asian seas: `${style}_${class}` (picked by faction style / cfg.style) ──
  // junk: flat transom bow (bowTrans), towering overhung square stern, shallow
  //       boxy sections, battened lug sails ('junk' rig), oculus on the bow.
  junk_light: { tier: 1, L: 4.6, B: 1.55, F: 0.50, D: 0.40, sheerB: 0.30, sheerS: 0.45, trans: 0.78, bowTrans: 0.50, bowRake: 0.35, sternRake: 0.45, full: 0.32, tumble: 0.02,
    poop: { t: 0.22, h: 0.22 }, decks: [], deckGuns: 2, bowsprit: 0, jibs: 0, eyes: true,
    masts: [{ z: 0.31, h: 4.2, rig: 'junk', w: 0.40, rake: -0.12 }, { z: -0.02, h: 5.0, rig: 'junk', w: 0.54, rake: 0.0 }] },
  junk_standard: { tier: 2, L: 5.2, B: 1.80, F: 0.58, D: 0.45, sheerB: 0.32, sheerS: 0.55, trans: 0.80, bowTrans: 0.50, bowRake: 0.38, sternRake: 0.50, full: 0.32, tumble: 0.02,
    poop: { t: 0.24, h: 0.30 }, decks: [{ ports: 5 }], bowsprit: 0, jibs: 0, eyes: true,
    masts: [{ z: 0.34, h: 4.4, rig: 'junk', w: 0.38, rake: -0.16 }, { z: 0.02, h: 5.6, rig: 'junk', w: 0.56, rake: 0.0 },
            { z: -0.30, h: 3.8, rig: 'junk', w: 0.30, rake: 0.04 }] },
  junk_heavy: { tier: 3, L: 5.8, B: 2.05, F: 0.66, D: 0.50, sheerB: 0.34, sheerS: 0.62, trans: 0.82, bowTrans: 0.52, bowRake: 0.42, sternRake: 0.55, full: 0.30, tumble: 0.02,
    poop: { t: 0.25, h: 0.38 }, decks: [{ ports: 6 }], bowsprit: 0, jibs: 0, eyes: true, windows: 1,
    masts: [{ z: 0.35, h: 4.8, rig: 'junk', w: 0.38, rake: -0.18 }, { z: 0.03, h: 6.2, rig: 'junk', w: 0.58, rake: 0.0 },
            { z: -0.30, h: 4.2, rig: 'junk', w: 0.32, rake: 0.05 }] },
  // dhow / ghurab: long raking prow, raised stern, lateen sails on masts
  //       raked FORWARD.
  dhow_light: { tier: 1, L: 4.6, B: 1.20, F: 0.42, D: 0.45, sheerB: 0.36, sheerS: 0.22, trans: 0.42, bowRake: 0.85, sternRake: 0.20, full: 0.55, tumble: 0.04,
    decks: [], deckGuns: 2, bowsprit: 0, jibs: 0,
    masts: [{ z: 0.10, h: 5.0, rig: 'lateen', fwd: 0.42, aft: 0.40, rake: -0.16 }] },
  dhow_standard: { tier: 2, L: 5.2, B: 1.35, F: 0.48, D: 0.50, sheerB: 0.38, sheerS: 0.26, trans: 0.50, bowRake: 0.88, sternRake: 0.22, full: 0.52, tumble: 0.05,
    poop: { t: 0.18, h: 0.16 }, decks: [{ ports: 4 }], bowsprit: 0, jibs: 0,
    masts: [{ z: 0.16, h: 5.4, rig: 'lateen', fwd: 0.40, aft: 0.38, rake: -0.16 }, { z: -0.26, h: 3.8, rig: 'lateen', fwd: 0.20, aft: 0.25, rake: -0.12 }] },
  dhow_heavy: { tier: 3, L: 5.8, B: 1.55, F: 0.55, D: 0.55, sheerB: 0.40, sheerS: 0.30, trans: 0.58, bowRake: 0.90, sternRake: 0.24, full: 0.5, tumble: 0.06,
    poop: { t: 0.20, h: 0.24 }, decks: [{ ports: 6 }], bowsprit: 1.2, bsAngle: 0.35, jibs: 0, windows: 1,
    masts: [{ z: 0.22, h: 5.6, rig: 'lateen', fwd: 0.36, aft: 0.34, rake: -0.14 }, { z: -0.06, h: 5.0, rig: 'lateen', fwd: 0.30, aft: 0.30, rake: -0.12 },
            { z: -0.32, h: 3.6, rig: 'lateen', fwd: 0.18, aft: 0.22, rake: -0.10 }] },
  // prau / lanong: long low galley, outrigger galleries, sweeps, canted
  //       rectangular tanja sails.
  prau_light: { tier: 1, L: 5.0, B: 1.00, F: 0.30, D: 0.32, sheerB: 0.30, sheerS: 0.25, trans: 0.30, bowRake: 0.50, sternRake: 0.30, full: 0.6, tumble: 0.0,
    decks: [], deckGuns: 2, bowsprit: 0, jibs: 0, oars: 7, gallery: true,
    masts: [{ z: 0.12, h: 3.8, rig: 'tanja', w: 0.42 }] },
  prau_standard: { tier: 2, L: 5.6, B: 1.10, F: 0.32, D: 0.34, sheerB: 0.32, sheerS: 0.26, trans: 0.32, bowRake: 0.52, sternRake: 0.30, full: 0.6, tumble: 0.0,
    decks: [], deckGuns: 3, bowsprit: 0, jibs: 0, oars: 9, gallery: true,
    masts: [{ z: 0.22, h: 4.0, rig: 'tanja', w: 0.36 }, { z: -0.12, h: 3.6, rig: 'tanja', w: 0.30 }] },
  prau_heavy: { tier: 3, L: 6.3, B: 1.30, F: 0.36, D: 0.38, sheerB: 0.34, sheerS: 0.30, trans: 0.36, bowRake: 0.55, sternRake: 0.32, full: 0.58, tumble: 0.0,
    poop: { t: 0.16, h: 0.18 }, decks: [], deckGuns: 4, bowsprit: 0, jibs: 0, oars: 11, gallery: true,
    masts: [{ z: 0.24, h: 4.4, rig: 'tanja', w: 0.36 }, { z: -0.08, h: 4.0, rig: 'tanja', w: 0.32 }] },
};
const STYLES = { junk: 1, dhow: 1, prau: 1 };

/** Classic (pre-roster) configs name their ships; map names → silhouettes. */
const NAME_HINTS = [
  ['ship of the line', 'ship_of_the_line'], ['man-o-war', 'man_o_war'], ['man o war', 'man_o_war'],
  ['war galleon', 'war_galleon'], ['heavy frigate', 'heavy_frigate'], ['flagship', 'galleon'],
  ['galleon', 'galleon'], ['frigate', 'frigate'], ['corvette', 'corvette'], ['xebec', 'xebec'],
  ['corsair', 'xebec'], ['brigantine', 'brigantine'], ['black pearl', 'brig'], ['brig', 'brig'],
  ['schooner', 'schooner'], ['scout', 'cutter'], ['cutter', 'cutter'], ['sloop', 'sloop'],
];
const CLASS_DEFAULT = { light: 'sloop', standard: 'brigantine', heavy: 'galleon' };

/**
 * Resolve which blueprint + tier a ship config draws with.
 * A non-european `style` ('junk' | 'dhow' | 'prau') picks `${style}_${class}`
 * by combat class; otherwise hullId → name hint → class default.
 * @param {{hullId?:string, hull?:string, tier?:number, nm?:string, style?:string}} cfg
 * @returns {{id:string, bp:object, tier:number}}
 */
export function resolveBlueprint(cfg = {}) {
  let id = null;
  if (STYLES[cfg.style]) {
    const cls = cfg.hull === 'light' || cfg.hull === 'heavy' ? cfg.hull : 'standard';
    id = `${cfg.style}_${cls}`;
  }
  if (!id && cfg.hullId && BLUEPRINTS[cfg.hullId]) id = cfg.hullId;
  if (!id && cfg.nm) {
    const n = String(cfg.nm).toLowerCase();
    for (const [k, v] of NAME_HINTS) if (n.includes(k)) { id = v; break; }
  }
  if (!id) id = CLASS_DEFAULT[cfg.hull] || 'brigantine';
  const bp = BLUEPRINTS[id];
  const t = Number(cfg.tier);
  const tier = Number.isFinite(t) && t >= 1 ? Math.min(5, Math.round(t)) : bp.tier;
  return { id, bp, tier };
}

// ── small helpers ─────────────────────────────────────────────────
const _cc = new Map();
function C(hex) { let c = _cc.get(hex); if (!c) { c = new THREE.Color(hex); _cc.set(hex, c); } return c; }
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Indexed triangle soup with per-vertex colour + glow; quads auto-orient to their normals. */
class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.c = []; this.g = []; this.i = []; this.pk = []; this.plank = 0; }
  /** Vertex; `this.plank` (0 none · 1 hull strakes · 2 deck planks) tags it for the plank shader. */
  v(x, y, z, nx, ny, nz, col, glow = 0) {
    const k = this.p.length / 3;
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(col.r, col.g, col.b); this.g.push(glow); this.pk.push(this.plank);
    return k;
  }
  tri(a, b, c) {
    const P = this.p, N = this.n;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const nx = N[a * 3] + N[b * 3] + N[c * 3], ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (fx * nx + fy * ny + fz * nz < 0) this.i.push(a, c, b); else this.i.push(a, b, c);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  /** Flat quad from 4 positions (any winding) facing normal n. */
  flat(p0, p1, p2, p3, n, col, glow = 0) {
    const a = this.v(p0.x, p0.y, p0.z, n.x, n.y, n.z, col, glow), b = this.v(p1.x, p1.y, p1.z, n.x, n.y, n.z, col, glow);
    const c = this.v(p2.x, p2.y, p2.z, n.x, n.y, n.z, col, glow), d = this.v(p3.x, p3.y, p3.z, n.x, n.y, n.z, col, glow);
    this.quad(a, b, c, d);
  }
  /** Flat disc (fan) centred at c facing n. */
  disc(c, n, r, col, seg = 10, glow = 0) {
    const ref = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(n, ref).normalize(), w = new THREE.Vector3().crossVectors(n, u);
    const ct = this.v(c.x, c.y, c.z, n.x, n.y, n.z, col, glow), base = this.p.length / 3;
    for (let k = 0; k <= seg; k++) {
      const a = k / seg * Math.PI * 2;
      this.v(c.x + (u.x * Math.cos(a) + w.x * Math.sin(a)) * r, c.y + (u.y * Math.cos(a) + w.y * Math.sin(a)) * r,
             c.z + (u.z * Math.cos(a) + w.z * Math.sin(a)) * r, n.x, n.y, n.z, col, glow);
    }
    for (let k = 0; k < seg; k++) this.tri(ct, base + k, base + k + 1);
  }
  /** Axis-aligned box (optionally yawed). */
  box(cx, cy, cz, sx, sy, sz, col, glow = 0, yaw = 0) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const P = (x, y, z) => new THREE.Vector3(cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs);
    const N = (x, y, z) => new THREE.Vector3(x * cs + z * sn, y, -x * sn + z * cs);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    this.flat(P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(hx, -hy, hz), N(1, 0, 0), col, glow);
    this.flat(P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), N(-1, 0, 0), col, glow);
    this.flat(P(-hx, hy, -hz), P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), N(0, 1, 0), col, glow);
    this.flat(P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), N(0, -1, 0), col, glow);
    this.flat(P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), N(0, 0, 1), col, glow);
    this.flat(P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, -hy, -hz), N(0, 0, -1), col, glow);
  }
  /** Tapered cylinder between two points. */
  cyl(a, b, r0, r1, col, sides = 6, caps = false) {
    const ax = new THREE.Vector3().subVectors(b, a); const len = ax.length(); if (len < 1e-5) return;
    ax.divideScalar(len);
    const ref = Math.abs(ax.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(ax, ref).normalize(), w = new THREE.Vector3().crossVectors(ax, u);
    const base = this.p.length / 3;
    for (let k = 0; k <= sides; k++) {
      const an = k / sides * Math.PI * 2, cs = Math.cos(an), sn = Math.sin(an);
      const nx = u.x * cs + w.x * sn, ny = u.y * cs + w.y * sn, nz = u.z * cs + w.z * sn;
      this.v(a.x + nx * r0, a.y + ny * r0, a.z + nz * r0, nx, ny, nz, col);
      this.v(b.x + nx * r1, b.y + ny * r1, b.z + nz * r1, nx, ny, nz, col);
    }
    for (let k = 0; k < sides; k++) { const i0 = base + k * 2; this.quad(i0, i0 + 2, i0 + 3, i0 + 1); }
    if (caps) {
      const ct = this.v(b.x, b.y, b.z, ax.x, ax.y, ax.z, col);
      for (let k = 0; k < sides; k++) this.tri(ct, base + k * 2 + 1, base + k * 2 + 3);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.g, 1));
    g.setAttribute('aPlank', new THREE.Float32BufferAttribute(this.pk, 1));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

// ── Hull frame: parametric surface P(t, s) ────────────────────────
// t: 0 stern → 1 bow · s: 0 keel → 1 gunwale (starboard, x ≥ 0)
const FREEBOARD_PAD = 0.12;   // keeps decks clear of the swell at RTS zoom
const SHEER_K = 1.25;         // ships2: a touch more sheer so the silhouette reads as a ship, not a box
const TUMBLE_ADD = 0.035;     // ships2: extra tumblehome (topsides lean in above the bilge)
function hullFrame(bp) {
  const L = bp.L, B = bp.B, F = bp.F + FREEBOARD_PAD, D = bp.D;
  const tm = 0.48;
  const step = (t, e, up) => { const k = clamp((t - e + 0.004) / 0.008, 0, 1); return up ? k : 1 - k; };
  const castleH = t => (bp.qd ? bp.qd.h * step(t, bp.qd.t, false) : 0)
                     + (bp.poop ? bp.poop.h * step(t, bp.poop.t, false) : 0)
                     + (bp.fc ? bp.fc.h * step(t, bp.fc.t, true) : 0);
  const sheer = t => SHEER_K * bp.sheerB * Math.pow(Math.max(0, (t - 0.5) / 0.5), 1.8) + SHEER_K * bp.sheerS * Math.pow(Math.max(0, (0.5 - t) / 0.5), 1.8);
  const yG = t => F + sheer(t) + castleH(t);
  const yK = t => {
    let k = 1;
    if (t > 0.76) k = 1 - 0.86 * Math.pow((t - 0.76) / 0.24, 1.5);
    if (t < 0.07) k = 0.78 + 0.22 * (t / 0.07);
    return -D * k;
  };
  const plan = t => {
    if (t < tm) { const u = t / tm; return bp.trans + (1 - bp.trans) * (1 - Math.pow(1 - u, 2.2)); }
    const u = (t - tm) / (1 - tm), bt = bp.bowTrans || 0;     // bowTrans > 0 → flat (junk) bow
    return bt + (1 - bt) * Math.pow(Math.max(0, 1 - Math.pow(u, 2.0)), 0.62);
  };
  const sec = (s, t) => {
    const k = yK(t), g = yG(t);
    const sMax = clamp((0.12 - k) / (g - k), 0.25, 0.85);
    let w = Math.pow(Math.sin(Math.min(s / sMax, 1) * Math.PI / 2), bp.full);
    if (s > sMax) { const u = (s - sMax) / (1 - sMax); w *= 1 - (bp.tumble + TUMBLE_ADD) * u * u; }
    return w;
  };
  const P = (t, s, out) => {
    const k = yK(t), g = yG(t);
    const y = k + (g - k) * s;
    let z = -L / 2 + t * L;
    if (t > 0.74) z += bp.bowRake * Math.pow((t - 0.74) / 0.26, 2) * (s - 0.3);
    if (t < 0.10) z -= bp.sternRake * (1 - t / 0.10) * Math.max(0, s - 0.25);
    out.set(B / 2 * plan(t) * sec(s, t), y, z);
    return out;
  };
  const sOf = (t, y) => { const k = yK(t), g = yG(t); return clamp((y - k) / (g - k), 0, 1); };
  return { L, B, F, D, yG, yK, sheer, castleH, plan, P, sOf };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
function surfNormal(H, t, s, out) {
  const e = 1e-3;
  H.P(Math.min(1, t + e), s, _a); H.P(Math.max(0, t - e), s, _b); _a.sub(_b);         // ∂P/∂t
  H.P(t, Math.min(1, s + e), _c); H.P(t, Math.max(0, s - e), _d); _c.sub(_d);         // ∂P/∂s
  out.crossVectors(_c, _a);
  if (out.lengthSq() < 1e-12) out.set(t > 0.5 ? 0.3 : 0, s < 0.2 ? -1 : 0, t > 0.5 ? 1 : -1);
  return out.normalize();
}

// ── Hull + spars geometry ─────────────────────────────────────────
// ships2: planking by hull family — honey oak (european), red-brown junk
// timber, dark teak (dhow), weathered brown (prau)
const HULL_WOOD = { european: 0x8a5530, junk: 0x6e2f1c, dhow: 0x7a4f2c, prau: 0x76522f };

function buildHull(bp, tier, paintHex, forceGild = false, family = 'european') {
  const H = hullFrame(bp);
  const PAL = { ...PAL0, hull: HULL_WOOD[family] ?? PAL0.hull };
  const gb = new GeoBuilder();
  const gild = tier >= 3 || forceGild;
  const paint = C(paintHex);
  const railCol = gild ? C(PAL.gold) : C(PAL.rail);
  const bulw = 0.15, thick = 0.045;
  const decks = bp.decks || [];
  const nd = decks.length;
  // stations (clustered at the ends) + castle edges
  const st = [];
  const NS = 30;
  for (let i = 0; i <= NS; i++) st.push(0.5 - 0.5 * Math.cos(Math.PI * i / NS));
  for (const c of [bp.qd, bp.poop, bp.fc]) if (c) st.push(c.t - 0.004, c.t + 0.004);
  st.sort((a, b) => a - b);
  const T = st.filter((t, i) => i === 0 || t - st[i - 1] > 1e-4);

  // gun-deck strakes follow the sheer partially
  const bh = nd >= 3 ? 0.13 : 0.15;
  const deckYc = i => 0.20 + (H.F - 0.40) * (nd === 1 ? 0.62 : (i + 0.5) / nd);
  const bandAt = (i, t) => deckYc(i) + H.sheer(t) * (0.55 + 0.45 * (nd > 1 ? i / (nd - 1) : 1));
  const levelsAt = t => {
    const out = [];
    out.push([H.yK(t), PAL.copper, 6]);
    out.push([-0.03, PAL.copper, 0]);
    out.push([0.05, PAL.boot, 0]);
    if (nd) {
      // per gun deck: dark tarred wale · painted gun strake (faction colour) · thin wale
      for (let i = 0; i < nd; i++) {
        const yc = bandAt(i, t);
        out.push([yc - bh / 2 - 0.065, PAL.hull, 0]);
        out.push([yc - bh / 2, PAL.wale, 0]);
        out.push([yc + bh / 2, paintHex, 0]);
        out.push([yc + bh / 2 + 0.03, gild && i === nd - 1 ? PAL.gold : PAL.wale, 0]);
      }
    } else {
      const yc = H.F - 0.17 + H.sheer(t);
      out.push([yc - 0.07, PAL.hull, 0]);
      out.push([yc - 0.03, PAL.wale, 0]);
      out.push([yc + 0.06, paintHex, 0]);
    }
    // sheer strake + rail: a painted (faction) band under a gilded or tarred cap
    out.push([H.yG(t) - 0.10, PAL.hull, 0]);
    if (gild) out.push([H.yG(t) - 0.08, PAL.gold, 0]);
    out.push([H.yG(t) - 0.03, paintHex, 0]);
    out.push([H.yG(t), gild ? PAL.gold : PAL.wale, 0]);
    // clamp + monotone
    const k = H.yK(t), g = H.yG(t);
    let prev = k;
    for (const L of out) { L[0] = clamp(L[0], prev, g); prev = L[0]; }
    return out;
  };

  const P = new THREE.Vector3(), N = new THREE.Vector3();
  // outer hull: strips between consecutive levels, both sides
  const lv0 = levelsAt(0.5);
  const nStrips = lv0.length - 1;
  for (const side of [1, -1]) {
    for (let sIdx = 0; sIdx < nStrips; sIdx++) {
      const rows = sIdx === 0 ? 6 : 2;
      const hex = lv0[sIdx + 1][1];
      const col = C(hex);
      gb.plank = (hex === PAL.hull || hex === paintHex) ? 1 : 0;
      const grid = [];
      for (let ti = 0; ti < T.length; ti++) {
        const t = T[ti];
        const lv = levelsAt(t);
        const s0 = H.sOf(t, lv[sIdx][0]), s1 = H.sOf(t, lv[sIdx + 1][0]);
        const row = [];
        for (let r = 0; r < rows; r++) {
          const s = s0 + (s1 - s0) * (r / (rows - 1));
          H.P(t, s, P); surfNormal(H, t, s, N);
          row.push(gb.v(P.x * side, P.y, P.z, N.x * side, N.y, N.z, col));
        }
        grid.push(row);
      }
      for (let ti = 0; ti < T.length - 1; ti++) {
        for (let r = 0; r < rows - 1; r++) gb.quad(grid[ti][r], grid[ti + 1][r], grid[ti + 1][r + 1], grid[ti][r + 1]);
      }
    }
  }

  gb.plank = 0;
  // transom (flat stern face) — rows across port↔starboard; ships2: the upper
  // counter is painted in the faction colour with a gilded (crown) or tarred frame
  {
    const t = 0, lv = levelsAt(t);
    const n = new THREE.Vector3(0, 0.15, -1).normalize();
    const pts = [];
    const ks = 10;
    for (let k = 0; k <= ks; k++) { const s = k / ks; H.P(t, s, P); pts.push([P.x, P.y, P.z, s]); }
    const yDeck0 = H.yG(0) - bulw;
    for (let k = 0; k < ks; k++) {
      const a = pts[k], b = pts[k + 1];
      const yMid = (a[1] + b[1]) / 2;
      const col = C(yMid < -0.03 ? PAL.copper : yMid < 0.05 ? PAL.boot
        : yMid > yDeck0 + 0.02 ? (gild ? PAL.gold : PAL.wale)
        : yMid > yDeck0 - 0.30 ? paintHex
        : yMid > yDeck0 - 0.36 ? (gild ? PAL.gold : PAL.wale) : PAL.hull);
      const i0 = gb.v(a[0], a[1], a[2], n.x, n.y, n.z, col), i1 = gb.v(-a[0], a[1], a[2], n.x, n.y, n.z, col);
      const i2 = gb.v(-b[0], b[1], b[2], n.x, n.y, n.z, col), i3 = gb.v(b[0], b[1], b[2], n.x, n.y, n.z, col);
      gb.quad(i0, i1, i2, i3);
    }
    void lv;
  }
  // flat transom bow (junks)
  if (bp.bowTrans) {
    const n = new THREE.Vector3(0, 0.35, 1).normalize();
    const pts = [];
    for (let k = 0; k <= 10; k++) { H.P(1, k / 10, P); pts.push([P.x, P.y, P.z]); }
    for (let k = 0; k < 10; k++) {
      const a = pts[k], b = pts[k + 1], yMid = (a[1] + b[1]) / 2;
      const col = C(yMid < -0.03 ? PAL.copper : yMid < 0.05 ? PAL.boot : yMid > H.F * 0.7 ? paintHex : PAL.hull);
      const i0 = gb.v(a[0], a[1], a[2], n.x, n.y, n.z, col), i1 = gb.v(-a[0], a[1], a[2], n.x, n.y, n.z, col);
      const i2 = gb.v(-b[0], b[1], b[2], n.x, n.y, n.z, col), i3 = gb.v(b[0], b[1], b[2], n.x, n.y, n.z, col);
      gb.quad(i0, i1, i2, i3);
    }
  }

  // deck, inner bulwarks, rail caps
  const deckY = t => H.yG(t) - bulw;
  const inner = (t, y) => { H.P(t, H.sOf(t, y), P); return Math.max(0, P.x - thick); };
  const LANES = 6;
  gb.plank = 2;
  for (let ti = 0; ti < T.length - 1; ti++) {
    const t0 = T[ti], t1 = T[ti + 1];
    const y0 = deckY(t0), y1 = deckY(t1);
    const x0 = inner(t0, y0), x1 = inner(t1, y1);
    H.P(t0, H.sOf(t0, y0), _a); const z0 = _a.z;
    H.P(t1, H.sOf(t1, y1), _b); const z1 = _b.z;
    const up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(y1 - y0) > 0.05) up.set(0, 0, y1 > y0 ? -1 : 1);   // castle step face
    for (let j = 0; j < LANES; j++) {
      const f0 = -1 + 2 * j / LANES, f1 = -1 + 2 * (j + 1) / LANES;
      const col = C((j & 1) ? PAL.deckA : PAL.deckB);
      gb.flat(new THREE.Vector3(x0 * f0, y0, z0), new THREE.Vector3(x0 * f1, y0, z0),
              new THREE.Vector3(x1 * f1, y1, z1), new THREE.Vector3(x1 * f0, y1, z1), up, col);
    }
  }
  gb.plank = 0;
  for (const side of [1, -1]) {
    const inRows = [], capRows = [];
    for (let ti = 0; ti < T.length; ti++) {
      const t = T[ti], g = H.yG(t), yd = deckY(t);
      H.P(t, 1, P); const xo = P.x, zg = P.z;
      const xi = Math.max(0, xo - thick);
      H.P(t, H.sOf(t, yd), _a);
      const xid = Math.max(0, _a.x - thick);
      surfNormal(H, t, 0.9, N);
      const bc = C(PAL.bulwarkIn);
      inRows.push([gb.v(xid * side, yd, _a.z, -N.x * side, 0, -N.z, bc), gb.v(xi * side, g, zg, -N.x * side, 0, -N.z, bc)]);
      capRows.push([gb.v(xi * side, g, zg, 0, 1, 0, railCol), gb.v(xo * side, g, zg, 0, 1, 0, railCol)]);
    }
    for (let ti = 0; ti < T.length - 1; ti++) {
      gb.quad(inRows[ti][0], inRows[ti + 1][0], inRows[ti + 1][1], inRows[ti][1]);
      gb.quad(capRows[ti][0], capRows[ti + 1][0], capRows[ti + 1][1], capRows[ti][1]);
    }
  }
  // inner stern wall
  {
    const t = 0, g = H.yG(t), yd = deckY(t);
    H.P(t, 1, P); const xo = Math.max(0, P.x - thick), z = P.z + thick;
    gb.flat(new THREE.Vector3(-xo, yd, z), new THREE.Vector3(xo, yd, z), new THREE.Vector3(xo, g, z), new THREE.Vector3(-xo, g, z),
            new THREE.Vector3(0, 0, 1), C(PAL.bulwarkIn));
    if (bp.bowTrans) {
      const gb1 = H.yG(1), yd1 = gb1 - bulw;
      H.P(1, 1, P); const xb = Math.max(0, P.x - thick), zb = P.z - thick;
      gb.flat(new THREE.Vector3(-xb, yd1, zb), new THREE.Vector3(xb, yd1, zb), new THREE.Vector3(xb, gb1, zb), new THREE.Vector3(-xb, gb1, zb),
              new THREE.Vector3(0, 0, -1), C(PAL.bulwarkIn));
    }
  }

  // gunports + red lids
  const portCol = C(PAL.port), lidCol = C(PAL.bulwarkIn);
  for (let i = 0; i < nd; i++) {
    const n = decks[i].ports;
    const t0 = 0.17, t1 = bp.fc ? Math.min(0.8, bp.fc.t - 0.03) : 0.82;
    for (let k = 0; k < n; k++) {
      const t = t0 + (t1 - t0) * (k + 0.5) / n;
      const y = bandAt(i, t);
      const s = H.sOf(t, y);
      H.P(t, s, P); surfNormal(H, t, s, N);
      H.P(Math.min(1, t + 0.01), s, _a); H.P(Math.max(0, t - 0.01), s, _b); const tz = _a.sub(_b).normalize();
      const ty = new THREE.Vector3().crossVectors(N, tz).normalize();
      if (ty.y < 0) ty.negate();
      const hw = Math.min(0.065, (t1 - t0) * bp.L / n * 0.3), hh = bh * 0.33;
      for (const side of [1, -1]) {
        const c = new THREE.Vector3(P.x * side, P.y, P.z).addScaledVector(new THREE.Vector3(N.x * side, N.y, N.z), 0.008);
        const zx = new THREE.Vector3(tz.x * side, tz.y, tz.z), yy = new THREE.Vector3(ty.x * side, ty.y, ty.z);
        const nn = new THREE.Vector3(N.x * side, N.y, N.z);
        const q = (a, b) => c.clone().addScaledVector(zx, a).addScaledVector(yy, b);
        gb.flat(q(-hw, -hh), q(hw, -hh), q(hw, hh), q(-hw, hh), nn, portCol);
        if (tier >= 2) {
          const top0 = q(-hw, hh), top1 = q(hw, hh);
          const lift = yy.clone().multiplyScalar(hh * 1.0).addScaledVector(nn, hh * 1.3);
          const ln = yy.clone().multiplyScalar(-0.6).add(nn).normalize();
          gb.flat(top0, top1, top1.clone().add(lift), top0.clone().add(lift), ln, lidCol);
        }
      }
    }
  }

  // open-deck guns (small craft)
  if (!nd && bp.deckGuns) {
    for (let k = 0; k < bp.deckGuns; k++) {
      const t = 0.28 + 0.44 * (k + 0.5) / bp.deckGuns, yd = deckY(t);
      H.P(t, 1, P);
      for (const side of [1, -1]) {
        gb.box(side * (P.x - 0.16), yd + 0.05, P.z, 0.16, 0.08, 0.13, C(PAL.carriage));
        gb.cyl(new THREE.Vector3(side * (P.x - 0.22), yd + 0.11, P.z), new THREE.Vector3(side * (P.x + 0.09), yd + 0.11, P.z), 0.035, 0.03, C(PAL.gun), 6);
      }
    }
  }

  // deck furniture: hatches, capstan, wheel
  {
    const tH = [0.45, 0.62];
    for (const t of tH) { H.P(t, 1, P); gb.box(0, deckY(t) + 0.03, P.z, Math.min(0.42, P.x * 0.7), 0.06, 0.32, C(PAL.hatch)); }
    H.P(0.36, 1, P); gb.cyl(new THREE.Vector3(0, deckY(0.36), P.z), new THREE.Vector3(0, deckY(0.36) + 0.14, P.z), 0.07, 0.06, C(PAL.carriage), 8, true);
    const tw = bp.qd ? Math.max(0.05, bp.qd.t - 0.07) : 0.12; H.P(tw, 1, P);
    gb.box(0, deckY(tw) + 0.12, P.z, 0.04, 0.22, 0.04, C(PAL.carriage));
    gb.cyl(new THREE.Vector3(0, deckY(tw) + 0.24, P.z - 0.03), new THREE.Vector3(0, deckY(tw) + 0.24, P.z + 0.03), 0.11, 0.11, C(PAL.top), 8);
    if (tier >= 3 && bp.L > 5) {   // ship's boat on the waist
      H.P(0.54, 1, P);
      gb.box(0, deckY(0.54) + 0.09, P.z, 0.34, 0.12, 0.85, C(0x6a4a2e));
    }
  }

  // oculus: the painted eye on a junk's bow
  if (bp.eyes) {
    const t = 0.9, y = H.F * 0.55 + H.sheer(t) * 0.8, s = H.sOf(t, y);
    H.P(t, s, P); surfNormal(H, t, s, N);
    for (const side of [1, -1]) {
      const n = new THREE.Vector3(N.x * side, N.y, N.z);
      const c = new THREE.Vector3(P.x * side, P.y, P.z).addScaledVector(n, 0.012);
      gb.disc(c, n, 0.15, C(0xb0261c), 12);
      gb.disc(c.clone().addScaledVector(n, 0.004), n, 0.115, C(0xf2eee2), 12);
      gb.disc(c.clone().addScaledVector(n, 0.008).add(new THREE.Vector3(0, 0, 0.02)), n, 0.06, C(0x0c0a08), 10);
    }
  }
  // sweeps + outrigger galleries (praus)
  if (bp.oars) {
    const oarC = C(0x8a6a40), poleC = C(0x9c7d4c);
    for (let k = 0; k < bp.oars; k++) {
      const t = 0.24 + 0.52 * (k + 0.5) / bp.oars, g = H.yG(t);
      H.P(t, 1, P);
      for (const side of [1, -1]) {
        gb.cyl(new THREE.Vector3(side * (P.x - 0.05), g + 0.06, P.z), new THREE.Vector3(side * (P.x + 1.15), -0.12, P.z - 0.28), 0.022, 0.018, oarC, 4);
        gb.box(side * (P.x + 1.18), -0.1, P.z - 0.29, 0.03, 0.02, 0.16, oarC, 0, 0);
      }
    }
    if (bp.gallery) {
      for (const side of [1, -1]) {
        H.P(0.5, 1, P); const xo = P.x + 0.38, yg = H.yG(0.5) - 0.04;
        H.P(0.16, 1, _a); H.P(0.84, 1, _b);
        gb.cyl(new THREE.Vector3(side * xo, yg, _a.z), new THREE.Vector3(side * xo, yg, _b.z), 0.03, 0.03, poleC, 5);
        for (const t of [0.2, 0.4, 0.6, 0.8]) {
          H.P(t, 1, P);
          gb.cyl(new THREE.Vector3(side * (P.x - 0.06), H.yG(t) - 0.02, P.z), new THREE.Vector3(side * xo, yg, P.z), 0.022, 0.022, poleC, 4);
        }
      }
    }
  }

  // stern windows + lanterns
  const lanterns = [];
  {
    H.P(0, 1, P);
    const xT = P.x, g0 = H.yG(0), yd = deckY(0);
    const rows = bp.windows || (bp.L >= 5 ? 1 : 0);
    for (let r = 0; r < rows; r++) {
      const y = yd - 0.10 - r * 0.2;
      if (y < 0.12) break;
      const s = H.sOf(0, y); H.P(0, s, P);
      const half = P.x * 0.78;
      const nW = clamp(Math.round(half * 2 / 0.19), 2, 7);
      for (let k = 0; k < nW; k++) {
        const x = -half + (k + 0.5) * (2 * half / nW);
        const z = P.z - 0.012;
        const n = new THREE.Vector3(0, 0, -1);
        if (gild) gb.flat(new THREE.Vector3(x - 0.065, y - 0.075, z + 0.004), new THREE.Vector3(x + 0.065, y - 0.075, z + 0.004),
                          new THREE.Vector3(x + 0.065, y + 0.075, z + 0.004), new THREE.Vector3(x - 0.065, y + 0.075, z + 0.004), n, C(PAL.gold));
        gb.flat(new THREE.Vector3(x - 0.045, y - 0.055, z), new THREE.Vector3(x + 0.045, y - 0.055, z),
                new THREE.Vector3(x + 0.045, y + 0.055, z), new THREE.Vector3(x - 0.045, y + 0.055, z), n, C(PAL.window), 1);
      }
    }
    H.P(0, 1, P);
    const zl = P.z + 0.02;
    const lanternAt = (x) => {
      gb.box(x, g0 + 0.10, zl, 0.04, 0.20, 0.04, C(PAL.lanternBody));
      gb.box(x, g0 + 0.26, zl, 0.12, 0.16, 0.12, C(PAL.window), 1);
      gb.box(x, g0 + 0.36, zl, 0.14, 0.04, 0.14, gild ? C(PAL.gold) : C(PAL.lanternBody));
      gb.box(x, g0 + 0.40, zl, 0.06, 0.04, 0.06, gild ? C(PAL.gold) : C(PAL.lanternBody));
      lanterns.push([x, g0 + 0.26, zl]);
    };
    lanternAt(0);
    if (tier >= 3) { lanternAt(xT * 0.8); lanternAt(-xT * 0.8); }
  }
  // bow trim: headrails + figurehead in the faction paint (gilded on crown
  // ships and from tier IV) — no figurehead on a junk's flat transom bow
  if (!bp.bowTrans && (tier >= 2 || gild)) {
    const trim = C(gild || tier >= 4 ? PAL.gold : paintHex);
    H.P(1, 0.92, P);
    gb.box(0, P.y - 0.05, P.z + 0.07, 0.09, 0.18, 0.20, trim);
    H.P(0.93, 0.85, _a);
    for (const side of [1, -1]) {
      gb.cyl(new THREE.Vector3(side * _a.x * 0.9, _a.y, _a.z), new THREE.Vector3(0, P.y - 0.02, P.z + 0.12), 0.022, 0.018, trim, 4);
    }
  }

  // spars: masts, tops, yards, gaffs, booms, bowsprit
  const sparInfo = buildSpars(gb, bp, H, deckY);

  const geo = gb.build();
  return { geo, H, deckY, bandAt, nd, bh, lanterns, sparInfo };
}

function mastAxis(m) { const r = m.rake ?? 0.05; return new THREE.Vector3(0, Math.cos(r), -Math.sin(r)); }

/** Masts + spars into the hull builder; returns attachment points for sails/rigging. */
function buildSpars(gb, bp, H, deckY) {
  const out = { masts: [], bowsprit: null };
  const wood = C(PAL0.mast), yardC = C(PAL0.yard), topC = C(PAL0.top);
  const P = new THREE.Vector3();
  for (const m of bp.masts) {
    const t = 0.5 + m.z, yd = deckY(t);
    H.P(t, 1, P);
    const base = new THREE.Vector3(0, yd, P.z);
    const ax = mastAxis(m);
    const at = f => base.clone().addScaledVector(ax, m.h * f);
    const r0 = 0.055 + m.h * 0.006;
    const info = { m, base, ax, at, yd, z: P.z, yards: [] };
    if (m.rig === 'square') {
      gb.cyl(at(0), at(0.50), r0, r0 * 0.85, wood, 7);
      gb.cyl(at(0.45), at(0.80), r0 * 0.7, r0 * 0.55, wood, 6);
      gb.cyl(at(0.76), at(1.0), r0 * 0.45, r0 * 0.25, wood, 6);
      const tp = at(0.48); gb.box(tp.x, tp.y, tp.z, 0.36 + m.w * 0.05, 0.035, 0.28, topC);
      const tp2 = at(0.78); gb.box(tp2.x, tp2.y, tp2.z, 0.24, 0.025, 0.16, topC);
      // yard heights (fraction of h) and widths (× B)
      const tiers = m.tiers || 2;
      const Y = [0.44, 0.71, 0.875, 0.965], W = [1.0, 0.80, 0.58, 0.42];
      for (let k = 0; k < tiers; k++) {
        const c = at(Y[k]); const half = bp.B * m.w * W[k] / 2;
        gb.cyl(new THREE.Vector3(-half, c.y, c.z), new THREE.Vector3(half, c.y, c.z), 0.03 * (1 - k * 0.15), 0.03 * (1 - k * 0.15), yardC, 5);
        info.yards.push({ y: c.y, z: c.z, half });
      }
      if (m.spanker) {
        const g0 = at(0.12), g1 = at(0.40);
        const boomEnd = new THREE.Vector3(0, g0.y, g0.z - bp.L * 0.30);
        const gaffEnd = new THREE.Vector3(0, g1.y + 0.4, g1.z - bp.L * 0.22);
        gb.cyl(g0, boomEnd, 0.03, 0.025, yardC, 5);
        gb.cyl(g1, gaffEnd, 0.025, 0.02, yardC, 5);
        info.spanker = { tack: g0, throat: g1, clew: boomEnd, peak: gaffEnd };
      }
    } else if (m.rig === 'gaff') {
      gb.cyl(at(0), at(0.72), r0, r0 * 0.8, wood, 7);
      gb.cyl(at(0.66), at(1.0), r0 * 0.55, r0 * 0.3, wood, 6);
      const cr = at(0.70); gb.box(cr.x, cr.y, cr.z, 0.26, 0.025, 0.12, topC);
      const g0 = at(0.10), g1 = at(m.squareTop ? 0.56 : 0.64);
      const boomEnd = new THREE.Vector3(0, g0.y + 0.05, g0.z - bp.L * m.boom);
      const gaffEnd = new THREE.Vector3(0, g1.y + m.h * 0.17, g1.z - bp.L * m.gaff);
      gb.cyl(g0, boomEnd, 0.035, 0.028, yardC, 5);
      gb.cyl(g1, gaffEnd, 0.03, 0.022, yardC, 5);
      info.gaff = { tack: g0, throat: g1, clew: boomEnd, peak: gaffEnd };
      if (m.squareTop) {
        const Y = [0.62, 0.83, 0.97], W = [1.55, 1.15, 0.8];
        for (let k = 0; k < m.squareTop + 1 && k < 3; k++) {
          const c = at(Y[k]); const half = bp.B * W[k] / 2;
          gb.cyl(new THREE.Vector3(-half, c.y, c.z), new THREE.Vector3(half, c.y, c.z), 0.026, 0.026, yardC, 5);
          info.yards.push({ y: c.y, z: c.z, half });
        }
      }
    } else if (m.rig === 'lateen') {
      gb.cyl(at(0), at(0.92), r0, r0 * 0.5, wood, 7);
      const cross = at(0.62);
      const fwd = new THREE.Vector3(0, cross.y - m.h * 0.42, cross.z + bp.L * m.fwd);
      const aft = new THREE.Vector3(0, cross.y + m.h * 0.42, cross.z - bp.L * m.aft);
      gb.cyl(fwd, aft, 0.032, 0.02, yardC, 5);
      info.lateen = { tack: fwd, peak: aft, clew: new THREE.Vector3(0, at(0.08).y + 0.1, cross.z - bp.L * m.aft * 0.85) };
    } else if (m.rig === 'junk') {
      // battened lug: ~30 % of the sail ahead of the mast, head yard peaking aft
      gb.cyl(at(0), at(1.0), r0 * 1.1, r0 * 0.5, wood, 7);
      const sw = bp.L * m.w, lo = at(0.10), hi = at(0.90);
      const tack = new THREE.Vector3(0, lo.y, lo.z + sw * 0.30), clew = new THREE.Vector3(0, lo.y - 0.04, lo.z - sw * 0.66);
      const throat = new THREE.Vector3(0, hi.y - m.h * 0.10, hi.z + sw * 0.32), peak = new THREE.Vector3(0, hi.y + m.h * 0.10, hi.z - sw * 0.72);
      gb.cyl(throat, peak, 0.03, 0.025, yardC, 5);
      gb.cyl(tack, clew, 0.03, 0.025, yardC, 5);
      info.junk = { tack, clew, throat, peak };
    } else if (m.rig === 'tanja') {
      // canted rectangular sail between two spars, leaning forward
      gb.cyl(at(0), at(1.0), r0, r0 * 0.6, wood, 6);
      const sw = bp.L * m.w, Hs = m.h * 0.78, z0 = at(0.15).z, y0 = at(0.15).y;
      const tack = new THREE.Vector3(0, y0, z0 + sw * 0.40), clew = new THREE.Vector3(0, y0 + 0.30, z0 - sw * 0.60);
      const lean = Hs * 0.55;
      const throat = new THREE.Vector3(0, y0 + Hs, tack.z + lean), peak = new THREE.Vector3(0, y0 + 0.30 + Hs, clew.z + lean);
      gb.cyl(tack, clew, 0.028, 0.024, yardC, 5);
      gb.cyl(throat, peak, 0.028, 0.024, yardC, 5);
      info.tanja = { tack, clew, throat, peak };
    }
    out.masts.push(info);
  }
  // bowsprit + jib-boom
  if (bp.bowsprit > 0) {
    H.P(1, 0.92, P);
    const root = new THREE.Vector3(0, H.yG(1) - 0.06, P.z - 0.25);
    const dir = new THREE.Vector3(0, Math.sin(bp.bsAngle), Math.cos(bp.bsAngle));
    const tip = root.clone().addScaledVector(dir, bp.bowsprit * 0.62);
    const tip2 = root.clone().addScaledVector(dir, bp.bowsprit);
    gb.cyl(root, tip, 0.05, 0.04, wood, 6);
    gb.cyl(tip.clone().addScaledVector(dir, -0.15), tip2, 0.03, 0.018, wood, 5);
    out.bowsprit = { root, tip, tip2, dir };
  }
  return out;
}

// ── Sails ──────────────────────────────────────────────────────────
// kind: 0 square · 1 fore-and-aft (gaff, lateen, jib, spanker) · 2 flag · 3 pennant
class SailBuilder {
  constructor() { this.p = []; this.uv = []; this.dir = []; this.kind = []; this.tu = []; this.tv = []; this.i = []; }
  /** Bilinear patch P00 foot-luff, P10 foot-leech, P01 head-luff, P11 head-leech. */
  patch(P00, P10, P01, P11, dir, kind, amp, trim, U = 7, V = 7) {
    const base = this.p.length / 3, seed = Math.random();
    const tmp = new THREE.Vector3(), du = new THREE.Vector3(), dv = new THREE.Vector3();
    for (let j = 0; j <= V; j++) {
      const v = j / V;
      for (let i = 0; i <= U; i++) {
        const u = i / U;
        tmp.set(0, 0, 0).addScaledVector(P00, (1 - u) * (1 - v)).addScaledVector(P10, u * (1 - v))
          .addScaledVector(P01, (1 - u) * v).addScaledVector(P11, u * v);
        du.subVectors(P10, P00).multiplyScalar(1 - v).addScaledVector(new THREE.Vector3().subVectors(P11, P01), v);
        dv.subVectors(P01, P00).multiplyScalar(1 - u).addScaledVector(new THREE.Vector3().subVectors(P11, P10), u);
        this.p.push(tmp.x, tmp.y, tmp.z); this.uv.push(u, v); this.dir.push(dir.x, dir.y, dir.z);
        this.kind.push(kind, amp, seed, trim); this.tu.push(du.x, du.y, du.z); this.tv.push(dv.x, dv.y, dv.z);
      }
    }
    for (let j = 0; j < V; j++) for (let i = 0; i < U; i++) {
      const a = base + j * (U + 1) + i, b = a + 1, c = a + U + 2, d = a + U + 1;
      this.i.push(a, b, c, a, c, d);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aDir', new THREE.Float32BufferAttribute(this.dir, 3));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kind, 4));
    g.setAttribute('aTanU', new THREE.Float32BufferAttribute(this.tu, 3));
    g.setAttribute('aTanV', new THREE.Float32BufferAttribute(this.tv, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    g.boundingSphere.radius *= 1.15;   // billow head-room
    return g;
  }
}

function buildSails(bp, tier, hullParts) {
  const sb = new SailBuilder();
  const fwd = new THREE.Vector3(0, 0, 1), lee = new THREE.Vector3(1, 0, 0);
  const sp = hullParts.sparInfo;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  for (const mi of sp.masts) {
    const m = mi.m;
    if (m.rig === 'square') {
      // sails hang between consecutive yards; the course down toward the rail
      for (let k = 0; k < mi.yards.length; k++) {
        const top = mi.yards[k];
        const botY = k === 0 ? mi.yd + m.h * 0.13 : mi.yards[k - 1].y + 0.04;
        const botHalf = k === 0 ? top.half * 1.04 : mi.yards[k - 1].half * 0.98;
        const zt = top.z + 0.03, zb = (k === 0 ? mi.at(0.13).z : mi.yards[k - 1].z) + 0.03;
        sb.patch(V3(-botHalf, botY, zb), V3(botHalf, botY, zb), V3(-top.half, top.y - 0.02, zt), V3(top.half, top.y - 0.02, zt),
          fwd, 0, 0.36 * (1 - k * 0.12), k === 0 ? 1 : 0);
      }
      if (mi.spanker) {
        const s = mi.spanker;
        sb.patch(s.tack, s.clew, s.throat, s.peak, lee, 1, 0.20, 1, 6, 5);
      }
    } else if (m.rig === 'gaff') {
      const g = mi.gaff;
      sb.patch(g.tack.clone().add(V3(0, 0.05, -0.04)), g.clew, g.throat.clone().add(V3(0, 0, -0.04)), g.peak, lee, 1, 0.26, 1, 7, 6);
      if (m.topsail) {
        const head = mi.at(0.97);
        sb.patch(g.throat.clone().add(V3(0, 0.05, -0.04)), g.peak, head, head, lee, 1, 0.14, 0, 5, 4);
      }
      for (let k = 0; k + 1 < mi.yards.length; k++) {
        const bot = mi.yards[k], top = mi.yards[k + 1];
        sb.patch(V3(-bot.half, bot.y + 0.03, bot.z + 0.03), V3(bot.half, bot.y + 0.03, bot.z + 0.03),
                 V3(-top.half, top.y - 0.02, top.z + 0.03), V3(top.half, top.y - 0.02, top.z + 0.03), fwd, 0, 0.28, 0);
      }
    } else if (m.rig === 'lateen') {
      const l = mi.lateen;
      sb.patch(l.tack, l.clew, l.peak, l.clew, lee, 1, 0.30, 1, 7, 7);
    } else if (m.rig === 'junk') {
      const j = mi.junk;
      sb.patch(j.tack, j.clew, j.throat, j.peak, lee, 4, 0.12, 0, 6, 12);
    } else if (m.rig === 'tanja') {
      const j = mi.tanja;
      sb.patch(j.tack, j.clew, j.throat, j.peak, lee, 1, 0.20, 1, 6, 6);
    }
  }
  // headsails from the foremast down to the bowsprit
  const fore = sp.masts.reduce((a, b) => (b.m.z > a.m.z ? b : a), sp.masts[0]);
  const bs = sp.bowsprit;
  for (let j = 0; bs && j < (bp.jibs || 0); j++) {
    const f = (j + 1) / (bp.jibs + 0.4);
    const head = fore.at(0.40 + 0.20 * j);
    const tack = bs.root.clone().addScaledVector(bs.dir, bp.bowsprit * (0.35 + 0.6 * f));
    const clew = V3(0, fore.yd + 0.35 + j * 0.12, fore.z + 0.15 + 0.25 * j);
    sb.patch(tack, clew, head, clew, lee, 1, 0.18, 0, 5, 6);
  }
  // flags: masthead pennant/flag on the tallest mast, ensign astern (tier ≥ 2)
  const fs = 0.9 + 0.16 * tier;            // art pass 2: bigger flags/pennants read faction + rank at range
  const main = sp.masts.reduce((a, b) => (b.m.h > a.m.h ? b : a), sp.masts[0]);
  {
    const top = main.at(1.0).add(V3(0, 0.02, 0));
    const w = 0.42 * fs, h = 0.26 * fs;
    sb.patch(V3(0, top.y - h, top.z), V3(0, top.y - h, top.z - w), V3(0, top.y, top.z), V3(0, top.y, top.z - w), lee, 2, 1.0, 0, 6, 2);
  }
  if (tier >= 2) {
    const H = hullParts.H;
    const zS = -bp.L / 2 - bp.sternRake * 0.6, y0 = H.yG(0);
    const w = 0.50 * fs, h = 0.32 * fs;
    sb.patch(V3(0, y0 + 0.62 - h, zS - 0.05), V3(0, y0 + 0.62 - h, zS - 0.05 - w), V3(0, y0 + 0.62, zS - 0.05), V3(0, y0 + 0.62, zS - 0.05 - w),
      lee, 2, 1.0, 0, 6, 2);
  }
  // pennants: main masthead from tier 2, every masthead from tier 4
  for (const mi of sp.masts) {
    if (tier < 2 || (mi !== main && tier < 4)) continue;
    const top = mi.at(1.0);
    const len = (0.9 + 0.38 * tier) * (mi === main ? 1 : 0.7), hw = 0.06 * fs;
    const p0 = V3(0, top.y + 0.30 - hw, top.z), p1 = V3(0, top.y + 0.30 + hw, top.z), tip = V3(0, top.y + 0.26, top.z - len);
    if (mi === main) { p0.y += 0.0; }
    sb.patch(p0, tip, p1, tip, lee, 3, 1.0, 0, 8, 1);
  }
  return sb.build();
}

// rigging: shrouds, stays, backstays as one LineSegments geometry
function buildRigging(bp, hullParts) {
  const H = hullParts.H, sp = hullParts.sparInfo, pts = [];
  const P = new THREE.Vector3();
  const seg = (a, b) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
  for (const mi of sp.masts) {
    const t = 0.5 + mi.m.z;
    const top = mi.at(mi.m.rig === 'square' ? 0.48 : 0.70), head = mi.at(0.98);
    for (const side of [1, -1]) {
      for (const dt of [-0.035, 0, 0.035]) {
        const tt = clamp(t + dt, 0.02, 0.98); H.P(tt, 1, P);
        seg(new THREE.Vector3(side * 0.05, top.y, top.z), new THREE.Vector3(side * P.x, P.y, P.z));
      }
      if (mi.m.rig === 'square') {
        const t2 = mi.at(0.78);
        seg(new THREE.Vector3(side * 0.03, t2.y, t2.z), new THREE.Vector3(side * 0.17, top.y + 0.02, top.z));
      }
      // backstay to the rail aft of the mast
      const tb = clamp(t - 0.12, 0.02, 0.98); H.P(tb, 1, P);
      seg(new THREE.Vector3(side * 0.02, head.y - 0.1, head.z), new THREE.Vector3(side * P.x * 0.95, P.y, P.z));
    }
  }
  // forestays: foremast head → bowsprit; between masts: head → next mast's top
  const ordered = [...sp.masts].sort((a, b) => b.m.z - a.m.z);
  if (ordered.length && sp.bowsprit) {
    seg(ordered[0].at(0.96), sp.bowsprit.tip2);
    seg(ordered[0].at(0.48), sp.bowsprit.tip);
  }
  for (let k = 1; k < ordered.length; k++) seg(ordered[k].at(0.95), ordered[k - 1].at(0.5));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.computeBoundingSphere();
  return g;
}

// ── Materials ──────────────────────────────────────────────────────
const SAIL_VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
uniform float uTime, uBillow, uDamage;
attribute vec2 aUv;
attribute vec3 aDir, aTanU, aTanV;
attribute vec4 aKind;   // kind, amplitude, seed, trim
varying vec2 vUv;
varying vec4 vKind;
varying vec3 vNormalV;
varying vec3 vViewP;
varying float vBelly;
float sailE(float kind, vec2 uv, float seed){
  float t = uTime;
  if (kind < 0.5) {
    float gust = 0.86 + 0.14 * sin(t * 0.9 + seed * 6.0);
    return sin(3.14159 * uv.x) * (1.0 - uv.y * uv.y) * gust
         + 0.04 * sin(t * 3.1 + uv.x * 6.0 + seed * 9.0) * (1.0 - uv.y);
  } else if (kind < 1.5) {
    float gust = 0.86 + 0.14 * sin(t * 0.8 + seed * 5.0);
    return sin(3.14159 * uv.y) * sin(2.5133 * uv.x) * gust
         + 0.05 * sin(t * 4.3 + uv.y * 7.0 + seed * 3.0) * uv.x * uv.x;
  } else if (kind < 2.5) {
    return uv.x * (0.30 * sin(t * 7.5 - uv.x * 6.0 + seed * 4.0) + 0.12 * sin(t * 11.0 - uv.x * 9.0 + uv.y * 2.0));
  } else if (kind < 3.5) {
    return uv.x * 0.6 * sin(t * 6.0 - uv.x * 5.0 + seed * 3.0);
  }
  // battened junk sail: stiff panels that each belly between their battens
  float gust = 0.88 + 0.12 * sin(t * 0.7 + seed * 5.0);
  return sin(2.8 * uv.x + 0.17) * (0.55 + 0.45 * abs(sin(3.14159 * uv.y * 6.0))) * gust;
}
void main(){
  vUv = aUv; vKind = aKind;
  bool isFlag = aKind.x > 1.5 && aKind.x < 3.5;
  float amp = isFlag ? aKind.y * 0.22 : aKind.y * uBillow * (1.0 - uDamage * 0.45);
  float e  = sailE(aKind.x, aUv, aKind.z);
  float eu = sailE(aKind.x, aUv + vec2(0.02, 0.0), aKind.z);
  float ev = sailE(aKind.x, aUv + vec2(0.0, 0.02), aKind.z);
  vec3 pos = position + aDir * (e * amp);
  vec3 du = aTanU + aDir * ((eu - e) / 0.02 * amp);
  vec3 dv = aTanV + aDir * ((ev - e) / 0.02 * amp);
  vec3 N = cross(du, dv);
  N = dot(N, N) > 1e-10 ? normalize(N) : vec3(1.0, 0.0, 0.0);
  vNormalV = normalize(normalMatrix * N);
  vBelly = aKind.x > 1.5 && aKind.x < 3.5 ? 0.0 : clamp(e, 0.0, 1.0);
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  vViewP = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const SAIL_FRAG = /* glsl */`
#include <common>
#include <bsdfs>
#include <lights_pars_begin>
#include <fog_pars_fragment>
uniform vec3 uCloth, uTrim, uFlagA, uFlagB;
uniform float uFlagStyle, uDamage, uPatched, uEmblem;
varying vec2 vUv;
varying vec4 vKind;
varying vec3 vNormalV;
varying vec3 vViewP;
varying float vBelly;
float sHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float sNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), f.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), f.x), f.y); }
float saltire(vec2 uv, float w){
  vec2 q = uv - 0.5;
  float rag = (sNoise(uv * 18.0) - 0.5) * 0.03;                       // ragged staves of the Burgundy cross
  float d = min(abs(q.x - q.y), abs(q.x + q.y)) + rag;
  return 1.0 - smoothstep(w, w + 0.02, d);
}
float crossPattee(vec2 uv){                                           // Cross of the Order of Christ
  vec2 q = abs(uv - 0.5);
  float arm = min(q.x, q.y);
  float flare = 0.07 + 0.10 * max(q.x, q.y);                          // arms widen toward the ends
  return (1.0 - smoothstep(flare, flare + 0.015, arm)) * step(max(q.x, q.y), 0.36);
}
float box(vec2 p, vec2 c, float h){ vec2 d = abs(p - c); return step(max(d.x, d.y), h); }
vec3 ensign(vec2 uv, float pat){
  vec3 A = uFlagA, B = uFlagB;
  if (pat < 0.5) {                                                    // anchor
    vec2 p = uv - vec2(0.45, 0.0);
    float shank = step(abs(p.x), 0.035) * step(0.24, uv.y) * step(uv.y, 0.80);
    float stock = step(abs(uv.y - 0.72), 0.03) * step(abs(p.x), 0.15);
    float ring  = 1.0 - smoothstep(0.012, 0.03, abs(length(uv - vec2(0.45, 0.86)) - 0.06));
    float arms  = (1.0 - smoothstep(0.02, 0.04, abs(length(uv - vec2(0.45, 0.48)) - 0.22))) * step(uv.y, 0.40);
    return mix(A, B, clamp(shank + stock + ring + arms, 0.0, 1.0));
  } else if (pat < 1.5) {                                             // skull + bones
    vec2 q = (uv - vec2(0.45, 0.6)) * vec2(1.6, 1.0);
    float skull = 1.0 - smoothstep(0.17, 0.2, length(q));
    vec2 b = uv - vec2(0.45, 0.28);
    float bones = (1.0 - smoothstep(0.03, 0.05, abs(b.x * 0.62 - b.y))) + (1.0 - smoothstep(0.03, 0.05, abs(b.x * 0.62 + b.y)));
    bones *= step(abs(b.x), 0.22);
    return mix(A, B, clamp(skull + bones, 0.0, 1.0));
  } else if (pat < 2.5) {                                             // saltire (Cross of Burgundy)
    return mix(A, B, saltire(uv, 0.06));
  } else if (pat < 3.5) {                                             // plain field, charge edging
    float e = step(min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)), 0.07);
    return mix(A, B, e);
  } else if (pat < 4.5) {                                             // company stripes
    return mix(A, B, step(0.5, fract(uv.y * 4.5)));
  } else if (pat < 5.5) {                                             // tricolour (field / white / charge)
    return uv.y > 0.667 ? A : uv.y > 0.333 ? vec3(0.95, 0.94, 0.90) : B;
  } else if (pat < 6.5) {                                             // quinas: five shields in a cross
    vec2 c = vec2(0.45, 0.5);
    float q = box(uv, c, 0.055) + box(uv, c + vec2(0.13, 0.0), 0.05) + box(uv, c - vec2(0.13, 0.0), 0.05)
            + box(uv, c + vec2(0.0, 0.16), 0.05) + box(uv, c - vec2(0.0, 0.16), 0.05);
    return mix(A, B, clamp(q, 0.0, 1.0));
  }
  // banner: scalloped charge border on the fly + a charge roundel
  float flame = step(0.82 - 0.05 * sin(uv.y * 31.0), uv.x) + step(uv.y, 0.07) + step(0.93, uv.y);
  float disc = 1.0 - smoothstep(0.15, 0.17, length((uv - vec2(0.38, 0.5)) * vec2(1.4, 1.0)));
  return mix(A, B, clamp(flame + disc, 0.0, 1.0));
}
void main(){
  vec3 base;
  float kind = vKind.x;
  if (kind < 1.5 || kind > 3.5) {
    base = uCloth;
    if (uPatched > 0.5) {                                               // patched, sun-rotted canvas
      vec2 cell = floor(vUv * vec2(4.0, 5.0) + vec2(vKind.z * 3.0, 0.0));
      float r = sHash(cell + vKind.z * 7.0);
      base *= mix(1.0, mix(0.72, 1.45, fract(r * 7.3)), step(0.6, r));
    }
    if (kind > 3.5) {                                                   // junk: dark ribs, mat-weave panels
      float bd = abs(fract(vUv.y * 6.0 + 0.5) - 0.5);
      base *= 0.86 + 0.14 * sNoise(vUv * vec2(40.0, 6.0));
#ifndef SAIL_LOW
      base *= 0.86 + 0.14 * smoothstep(0.0, 0.45, bd);                   // each panel bellies between ribs
#endif
      base = mix(base, vec3(0.16, 0.10, 0.06), 1.0 - smoothstep(0.035, 0.075, bd));
    } else {
      // ships2: plain cream canvas — faction colour only where period-appropriate
      // (pirate black/patched, Spanish saltire / Portuguese cross on the square sails)
      if (kind < 0.5 || vKind.w > 0.5) {
        if (uEmblem > 0.5 && uEmblem < 1.5) base = mix(base, uFlagB, saltire(vUv, 0.075) * 0.92);
        else if (uEmblem > 1.5) base = mix(base, vec3(0.72, 0.10, 0.10), crossPattee(vUv) * 0.95);
      }
#ifndef SAIL_LOW
      float sw = max(fwidth(vUv.x * 7.0), 0.02);
      float seam = abs(fract(vUv.x * 7.0) - 0.5);
      base *= 1.0 - 0.10 * smoothstep(0.5 - sw * 1.5, 0.5, seam) * (1.0 - smoothstep(0.25, 0.5, sw)); // canvas cloths
      if (kind < 0.5) {                                                 // reef bands with their points
        float rb = min(abs(vUv.y - 0.70), abs(vUv.y - 0.80));
        float rw = max(fwidth(vUv.y), 0.006);
        float pts = step(0.5, fract(vUv.x * 14.0)) * 0.5 + 0.5;
        base *= 1.0 - 0.14 * pts * (1.0 - smoothstep(rw * 0.6, rw * 1.6, rb));
      }
      float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
      base *= 0.86 + 0.14 * smoothstep(0.0, 0.05, edge);               // bolt-rope / tabling
      base *= 0.90 + 0.12 * vBelly;                                     // soft shade into the belly folds
#endif
    }
    base *= 0.88 + 0.12 * vUv.y;                                        // weathered foot
    float n = sNoise(vUv * vec2(7.0, 9.0) + vKind.z * 17.0);
    if (uDamage > 0.08 && n < uDamage * 0.42 - 0.06) discard;           // shot holes
    base *= 1.0 - uDamage * 0.6 * smoothstep(0.35, 0.85, sNoise(vUv * 3.0 + 4.0 + vKind.z * 5.0));
  } else if (kind < 2.5) {
    base = ensign(vUv, uFlagStyle);
  } else {
    base = mix(uFlagA, uFlagB, step(0.82, vUv.x));
  }
  vec3 N = normalize(vNormalV) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 irr = ambientLightColor;
  #if NUM_HEMI_LIGHTS > 0
    irr += mix(hemisphereLights[0].groundColor, hemisphereLights[0].skyColor, 0.5 * dot(N, hemisphereLights[0].direction) + 0.5);
  #endif
  #if NUM_DIR_LIGHTS > 0
    float ndl = dot(N, directionalLights[0].direction);
    irr += directionalLights[0].color * (max(ndl, 0.0) * 0.92 + max(-ndl, 0.0) * 0.42);   // light through the cloth
  #ifndef SAIL_LOW
    // translucency: looking toward the sun through the canvas → a warm glow
    float toSun = max(dot(normalize(vViewP), directionalLights[0].direction), 0.0);
    if (kind < 1.5 || kind > 3.5) irr += directionalLights[0].color * vec3(1.0, 0.93, 0.80) * max(-ndl, 0.0) * (0.08 + 0.40 * toSun * toSun);
  #endif
  #endif
  #if NUM_DIR_LIGHTS > 1
    irr += directionalLights[1].color * max(dot(N, directionalLights[1].direction), 0.0) * 0.6;
  #endif
  gl_FragColor = vec4(base * irr, 1.0);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
  #include <fog_fragment>
}`;

function makeSailMaterial(lv) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog, {
    uBillow: { value: 1.0 }, uDamage: { value: 0 },
    uCloth: { value: new THREE.Color(lv.cloth) }, uTrim: { value: new THREE.Color(lv.trim) },
    uFlagA: { value: new THREE.Color(lv.flagA) }, uFlagB: { value: new THREE.Color(lv.flagB) },
    uFlagStyle: { value: lv.pattern }, uPatched: { value: lv.patched }, uEmblem: { value: lv.emblem },
  }]);
  uniforms.uTime = SAIL_TIME;                 // shared clock (merge() would have copied it)
  const m = new THREE.ShaderMaterial({
    uniforms, vertexShader: SAIL_VERT, fragmentShader: SAIL_FRAG,
    side: THREE.DoubleSide, lights: true, fog: true,
    defines: gfx.high ? {} : { SAIL_LOW: '' },
  });
  m.extensions.derivatives = true;
  _sailMats.add(m);
  m.addEventListener('dispose', () => _sailMats.delete(m));
  return m;
}

// ── GFX tier (ships2) ──────────────────────────────────────────────
// HIGH: cloth seams, reef bands, belly shading, sun translucency + rigging.
// LOW : flat-shaded canvas (SAIL_LOW define, one more program variant) and no
//       rigging lines (the shared line material is hidden → no draw call).
const _sailMats = new Set();
function applyShipGfx() {
  if (_rigMat) _rigMat.visible = gfx.high;
  for (const m of _sailMats) {
    const low = 'SAIL_LOW' in m.defines;
    if (low === !gfx.high) continue;
    if (gfx.high) delete m.defines.SAIL_LOW; else m.defines.SAIL_LOW = '';
    m.needsUpdate = true;
  }
}
gfx?.on?.('change.shipModel', applyShipGfx);

const HULL_GLOW_FRAG = /* glsl */`#include <emissivemap_fragment>
  #if NUM_DIR_LIGHTS > 0
    float _sunL = dot(directionalLights[0].color, vec3(0.3333));
  #else
    float _sunL = 1.0;
  #endif
  float _night = 1.0 - clamp((_sunL - 0.35) / 0.9, 0.0, 1.0);
  totalEmissiveRadiance += vGlow * vec3(1.0, 0.62, 0.26) * (0.30 + 1.7 * _night);`;

// ships2: planking. Hull strakes (aPlank 1) run fore-and-aft in rows of
// ~0.1 units with staggered butt joints; deck planks (aPlank 2) run along the
// ship. Seams and per-plank tone fade out by screen-space derivative, so the
// default zoom sees a calm warm tone and the close-up sees the wood. A soft
// waterline AO darkens the lowest topsides.
const HULL_PLANK_FRAG = /* glsl */`#include <color_fragment>
  {
    float _aaFade = 1.0;
    if (vPlank > 0.5) {
      float _deck = step(1.5, vPlank);
      float _c = mix(vHullP.y * 10.0, vHullP.x * 9.0 + 0.5, _deck);
      float _row = floor(_c);
      float _f = fract(_c);
      float _w = fwidth(_c);
      _aaFade = 1.0 - smoothstep(0.18, 0.45, _w);
      float _seam = 1.0 - smoothstep(0.0, max(_w, 0.04) * 1.2, min(_f, 1.0 - _f));
      float _along = vHullP.z * 0.55 + fract(_row * 0.618) * 3.0;
      float _plankId = _row * 7.31 + floor(_along);
      float _butt = 1.0 - smoothstep(0.0, max(fwidth(_along), 0.01) * 1.5, min(fract(_along), 1.0 - fract(_along)));
      float _tone = fract(sin(_plankId * 12.9898) * 43758.5453);
      diffuseColor.rgb *= 1.0 - _aaFade * (0.30 * max(_seam, _butt * 0.7) + 0.12 * (_tone - 0.5));
    }
    diffuseColor.rgb *= 0.80 + 0.20 * smoothstep(-0.05, 0.45, vHullP.y);
  }`;

function makeHullMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.0 });
  m.extensions = { derivatives: true };
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nattribute float aPlank;\nvarying float vGlow;\nvarying float vPlank;\nvarying vec3 vHullP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;\nvPlank = aPlank;\nvHullP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nvarying float vPlank;\nvarying vec3 vHullP;')
      .replace('#include <color_fragment>', HULL_PLANK_FRAG)
      .replace('#include <emissivemap_fragment>', HULL_GLOW_FRAG);
  };
  m.customProgramCacheKey = () => 'iow_hull_glow_v2';
  m.userData.baseHex = 0xffffff;
  return m;
}

// shared, never disposed per ship
let _rigMat = null, _glowGeo = null, _glowMat = null;
function rigMaterial() {
  if (!_rigMat) {
    _rigMat = new THREE.LineBasicMaterial({ color: 0x2a2119, transparent: true, opacity: 0.8 });
    _rigMat.userData.shared = true;
    _rigMat.visible = gfx.high;
  }
  return _rigMat;
}
function lanternGlow() {
  if (!_glowGeo) {
    _glowGeo = new THREE.PlaneGeometry(2, 2);
    _glowGeo.userData.shared = true;
    _glowMat = new THREE.ShaderMaterial({
      uniforms: { uSunCol: ENV.uSunCol },
      vertexShader: /* glsl */`
        uniform vec3 uSunCol;
        varying vec2 vUv; varying float vNight;
        void main(){
          float lum = (uSunCol.r + uSunCol.g + uSunCol.b) / 3.0;
          vNight = 1.0 - clamp((lum - 0.35) / 0.9, 0.0, 1.0);
          vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          c.xy += position.xy * mix(0.22, 0.95, vNight);
          vUv = position.xy;
          gl_Position = projectionMatrix * c;
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying float vNight;
        void main(){
          float r = length(vUv);
          if (r > 1.0) discard;
          float halo = 1.0 - smoothstep(0.0, 1.0, r);
          float core = 1.0 - smoothstep(0.0, 0.22, r);
          vec3 col = vec3(1.0, 0.70, 0.32) * (core * 1.4 + halo * halo * 0.9 * vNight);
          gl_FragColor = vec4(col, (core + halo * halo * vNight) * (0.35 + 0.65 * vNight));
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    _glowMat.userData.shared = true;
  }
  return { geo: _glowGeo, mat: _glowMat };
}

// ── Cache + public builder ─────────────────────────────────────────
const _cache = new Map();
const TIER_SCALE = [0.92, 0.97, 1.0, 1.05, 1.10];

function partsFor(id, bp, tier, col, gild) {
  const key = `${id}|${tier}|${col}|${gild ? 1 : 0}`;
  let parts = _cache.get(key);
  if (parts) return parts;
  const hp = buildHull(bp, tier, col, gild, id.split('_')[0] in HULL_WOOD ? id.split('_')[0] : 'european');
  const sails = buildSails(bp, tier, hp);
  const rig = buildRigging(bp, hp);
  [hp.geo, sails, rig].forEach(g => { g.userData.shared = true; });
  const mid = 0.5;
  const nd = hp.nd;
  const gunY = nd ? hp.bandAt(nd - 1, mid) : hp.deckY(mid) + 0.11;
  parts = {
    hull: hp.geo, sails, rig, lanterns: hp.lanterns,
    info: {
      L: bp.L, B: bp.B, deckY: hp.deckY(mid), gunY, lowGunY: nd ? hp.bandAt(0, mid) : gunY,
      guns: nd ? Math.min(4, Math.max(2, Math.round(bp.decks[nd - 1].ports / 3))) : 2,
      decks: nd, mastH: Math.max(...bp.masts.map(m => m.h)) + bp.F,
    },
  };
  _cache.set(key, parts);
  return parts;
}

/**
 * Build a procedural ship root. Root origin sits 0.35 above the waterline
 * (the game loop places it at wave height + 0.35), +z is the bow.
 * Livery (sail/trim/ensign colours + rig family) comes from data/factions.js
 * via cfg.faction; cfg.style overrides the faction's rig family.
 * @param {{col?:number, sc?:number, hull?:string, hullId?:string, tier?:number,
 *          team?:string, faction?:string, style?:string, nm?:string}} o
 * @returns {THREE.Group}
 */
export function buildProceduralShip(o = {}) {
  const lv = resolveLivery(o.team, o.faction);
  const style = o.style || lv.style;
  // hull strake: the faction's livery colour; the player keeps its hull's own paint
  const col = lv.id === 'player' && o.col != null ? o.col : lv.paint;
  const { id, bp, tier } = resolveBlueprint({ ...o, style });
  // ships2: visual size step per hull class (rate I cutter … V ship of the line)
  // on top of cfg.sc, so a sloop and a two-decker no longer look the same size
  const sc = (o.sc || 1) * (TIER_SCALE[bp.tier - 1] ?? 1);
  const parts = partsFor(id, bp, tier, col, lv.gild);
  const g = new THREE.Group();
  g.name = `ship:${id}`;
  g.userData.proc = true;
  g.userData.hullId = id;
  g.userData.tier = tier;
  g.userData.faction = lv.id;
  // muzzle / wreck metrics in ROOT-local units (plain numbers → clone-safe)
  g.userData.hullInfo = {
    hl: parts.info.L / 2 * sc, hb: parts.info.B / 2 * sc,
    deckY: WATERLINE + parts.info.deckY * sc, gunY: WATERLINE + parts.info.gunY * sc,
    lowGunY: WATERLINE + parts.info.lowGunY * sc, guns: parts.info.guns, decks: parts.info.decks,
    mastH: parts.info.mastH * sc,
  };
  const body = new THREE.Group();
  body.position.y = WATERLINE;
  body.scale.setScalar(sc);
  g.add(body);

  const hull = new THREE.Mesh(parts.hull, makeHullMaterial());
  hull.castShadow = true; hull.receiveShadow = true;
  hull.userData.role = 'hull';
  body.add(hull);

  const sails = new THREE.Mesh(parts.sails, makeSailMaterial(lv));
  sails.castShadow = true;
  sails.userData.role = 'sails';
  body.add(sails);

  const rig = new THREE.LineSegments(parts.rig, rigMaterial());
  rig.userData.role = 'rigging';
  body.add(rig);

  const lg = lanternGlow();
  for (const [x, y, z] of parts.lanterns) {
    const m = new THREE.Mesh(lg.geo, lg.mat);
    m.position.set(x, y, z);
    m.renderOrder = 30;
    m.frustumCulled = false;
    m.userData.role = 'lantern';
    body.add(m);
  }
  g.position.y = 0.35;
  return g;
}

/** True when a geometry/material is shared by many ships (never dispose per ship). */
export function isShared(res) { return !!res?.userData?.shared; }

// ── Damage look (driven by VFX ShipTracker) ───────────────────────
const _looks = new WeakMap();
/**
 * Soot the hull and tear/blacken the sails as a ship loses HP.
 * Works for procedural ships and GLB clones (material colour darkening).
 * @param {THREE.Object3D} root ship root
 * @param {number} d damage 0 (pristine) … 1 (wrecked)
 */
export function setShipDamageLook(root, d) {
  if (!root) return;
  let look = _looks.get(root);
  if (!look) {
    look = { dmg: -1, hull: [], sails: [] };
    root.traverse(c => {
      if (!c.material || c.userData?.role === 'lantern' || c.isLine) return;
      (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => {
        if (m.userData?.shared) return;
        if (m.uniforms?.uDamage) look.sails.push(m);
        else if (m.color && !m.isShaderMaterial) {
          if (m.userData.baseHex === undefined) m.userData.baseHex = m.color.getHex();
          look.hull.push(m);
        }
      });
    });
    _looks.set(root, look);
  }
  if (Math.abs(look.dmg - d) < 0.015) return;
  look.dmg = d;
  for (const m of look.hull) m.color.setHex(m.userData.baseHex).multiplyScalar(1 - 0.45 * d);
  for (const m of look.sails) m.uniforms.uDamage.value = d;
}
