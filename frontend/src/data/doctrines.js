// ── FLEET DOCTRINES (design/gdd/campaign-meta.md §Fleet doctrines) ──
// A doctrine is a one-click cannon fit for a whole fleet. Each doctrine lists,
// per gun slot (L port · R starboard · B bow · S stern), the guns it wants,
// best first. `byHull` overrides slots for one hull class (light/standard/heavy)
// — e.g. a light hull has only L/R, so a siege sloop carries its mortar on L.
//
// The resolver (Meta/Doctrine.js fitDoctrine) picks, per slot, the FIRST gun
// the hull may mount (cannon tier ≤ hull tier) that is also researched. When the
// tier-allowed favourite is not researched yet, it walks the gun's research line
// (data/cannons.js fallbackCannon) — that slot "fell back" and the UI names the
// research that would fill it. Every list ends on a tier-I gun, so a fit always
// exists. Data only: no logic here.
//
// Gun tiers (data/cannons.js): I swivel carronade falconet · II long9 demi_culv
// chain_shot grapeshot · III demi_can mortar1 long12 · IV carronade32 culverin
// mortar2 · V long24 cannon_royal.

/** Doctrine order = display order. `icon` is a plain glyph (no emoji fonts needed). */
export const DOCTRINES = [
  {
    id: 'broadside', icon: '⚓',
    nm: 'Line of Battle', desc: 'All-round broadsides with a chaser fore and aft.',
    slots: {
      L: ['culverin', 'demi_can', 'demi_culv', 'falconet'],
      R: ['culverin', 'demi_culv', 'falconet'],
      B: ['long12', 'long9', 'swivel'],
      S: ['long12', 'long9', 'swivel'],
    },
  },
  {
    id: 'longrange', icon: '⌖',
    nm: 'Long Guns', desc: 'Range-40 guns — keep your distance and pound them.',
    slots: {
      L: ['long24', 'culverin', 'long12', 'long9', 'falconet'],
      R: ['long24', 'culverin', 'long12', 'long9', 'falconet'],
      B: ['long24', 'long12', 'long9', 'swivel'],
      S: ['long12', 'long9', 'swivel'],
    },
  },
  {
    id: 'siege', icon: '♜',
    nm: 'Siege Train', desc: 'Mortars and heavy guns to batter forts from beyond their walls.',
    slots: {
      L: ['cannon_royal', 'culverin', 'demi_can', 'demi_culv', 'falconet'],
      R: ['cannon_royal', 'culverin', 'demi_can', 'demi_culv', 'falconet'],
      B: ['mortar2', 'mortar1', 'long12', 'long9', 'swivel'],
      S: ['mortar2', 'mortar1', 'long9', 'swivel'],
    },
    byHull: { light: { L: ['mortar2', 'mortar1', 'demi_culv', 'falconet'] } },
  },
  {
    id: 'antiheavy', icon: '⚒',
    nm: 'Heavy Metal', desc: 'Demi-cannon, Cannon Royal and 32-pounders to break big hulls.',
    slots: {
      L: ['cannon_royal', 'carronade32', 'demi_can', 'demi_culv', 'carronade'],
      R: ['long24', 'carronade32', 'demi_can', 'demi_culv', 'carronade'],
      B: ['long24', 'long12', 'long9', 'swivel'],
      S: ['carronade32', 'demi_can', 'carronade'],
    },
  },
  {
    id: 'antilight', icon: '✶',
    nm: 'Grape & Swivel', desc: 'Carronades, falconets and grapeshot against small, fast ships.',
    slots: {
      L: ['grapeshot', 'carronade'],
      R: ['carronade', 'falconet'],
      B: ['long9', 'falconet', 'swivel'],
      S: ['falconet', 'swivel'],
    },
  },
  {
    id: 'crippler', icon: '⛓',
    nm: 'Dismasting', desc: 'Chain shot cuts their speed; the other broadside finishes them.',
    slots: {
      L: ['chain_shot', 'falconet'],
      R: ['culverin', 'demi_can', 'demi_culv', 'carronade'],
      B: ['chain_shot', 'long9', 'swivel'],
      S: ['long12', 'long9', 'swivel'],
    },
  },
];

/** id → doctrine. */
export const DOCTRINE_BY_ID = new Map(DOCTRINES.map(d => [d.id, d]));

/** Value the pickers use for "leave this ship's guns as they are". */
export const DOCTRINE_KEEP = 'keep';

/**
 * Briefing hint rules (Meta/Doctrine.js suggestDoctrines): thresholds on the
 * mission's enemy roster. Shares are of all enemy ships (waves included).
 */
export const DOCTRINE_HINT = {
  heavyMin: 1,        // ≥ this many heavy hulls → Heavy Metal
  lightShare: 0.6,    // ≥ this share of light hulls → Grape & Swivel
  maxHints: 3,
};
