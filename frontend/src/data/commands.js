// ── RTS COMMAND DATA (AU) ───────────────────────────────────────
// Formations, stances and order tuning for player fleet control.
// Formation slots are expressed in a local frame: +z = forward (bow of the
// formation), +x = starboard. The formation CENTRE sits on the anchor.

export const FORMATIONS = {
  column: { key: 'column', icon: '⋮', name: 'Line Ahead',   desc: 'Single file — both broadsides clear',  spacing: 6.5 },
  line:   { key: 'line',   icon: '⋯', name: 'Line Abreast', desc: 'Side by side — wide front, bows out',   spacing: 6.0 },
  wedge:  { key: 'wedge',  icon: '⋀', name: 'Wedge',        desc: 'V-shape — lead ship at the point',      spacing: 6.0 },
};
export const FORMATION_ORDER = ['column', 'line', 'wedge'];
export const DEFAULT_FORMATION = 'column';

// Engagement rules. `acquire` = auto-engage enemies that come close;
// `fire` = guns may fire at all.
export const STANCES = {
  aggressive: { key: 'aggressive', icon: '⚔', name: 'Aggressive', desc: 'Chase and engage enemies in sight', acquire: true,  fire: true  },
  defensive:  { key: 'defensive',  icon: '🛡', name: 'Defensive',  desc: 'Fire at will, hold course',         acquire: false, fire: true  },
  holdfire:   { key: 'holdfire',   icon: '✋', name: 'Hold Fire',  desc: 'Never fire — slip past forts',      acquire: false, fire: false },
};
export const STANCE_ORDER = ['aggressive', 'defensive', 'holdfire'];
export const DEFAULT_STANCE = 'defensive';

export const ORDER_TUNING = {
  shoreClearance:  4,     // path keeps this far from island shore (world units)
  acquireBonus:    6,     // aggressive / attack-move acquisition = best gun range + this
  acquireMin:      24,    // …but never less: answer anything that can shoot us (enemy guns reach 20)
  leash:           32,    // auto-engaged ships give up beyond this from their post
  gatherDist:      4,     // mean slot error above which a formation slows to regroup
  arriveDist:      1.4,   // ship counts as arrived within this of its slot
  broadsideFrac:   0.62,  // preferred engagement range = gun range × this
  kiteFrac:        0.85,  // skirmisher automation keeps further out
  approachSlack:   18,    // beyond preferred range + this, ships path-find instead of orbit
  captureOrbit:    8,     // ships hold this far outside the shore while capturing
};
