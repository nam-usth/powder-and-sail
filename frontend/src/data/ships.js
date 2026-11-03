// ── SHIP CONFIGS & HULL SLOTS ───────────────────────────────────
// Hull slots — GDD Section 27.2
export const HULL_SLOTS = {
  light:    ['L', 'R'],
  standard: ['L', 'R', 'B'],
  heavy:    ['L', 'R', 'B', 'S'],
};

// Slot arc centers (deg from bow=0, CW: R=90, stern=180, L=270)
export const SLOT_CTR = { L: 270, R: 90, B: 0, S: 180 };

// AU: ship handling per hull. turnRate = max rad/s; accel = speed gained per
// second (ship speed is world units per 1/60 s, so a light hull at 0.16
// reaches full sail in ~1.3 s and a heavy one at 0.13 in ~2.6 s).
// Braking is BRAKE_MULT × accel. Light hulls turn in ~5 u, heavy in ~9 u.
export const HULL_HANDLING = {
  light:    { turnRate: 1.9, accel: 0.12 },
  standard: { turnRate: 1.3, accel: 0.08 },
  heavy:    { turnRate: 0.9, accel: 0.05 },
};
export const BRAKE_MULT = 2.5;

// Player fleet configs
export const PCFG = [
  { nm:'Flagship',   col:0xe8c040, spd:.13, sc:1.25, hull:'heavy',    disp:900 },
  { nm:'Brigantine', col:0xd49030, spd:.14, sc:1.00, hull:'standard', disp:450 },
  { nm:'Sloop I',    col:0xb87040, spd:.16, sc:.85,  hull:'light',    disp:200 },
  { nm:'Sloop II',   col:0xa05840, spd:.16, sc:.85,  hull:'light',    disp:200 },
  { nm:'Scout',      col:0x886050, spd:.17, sc:.78,  hull:'light',    disp:200 },
];

// Milestone AK: two additional player hulls (not in starting fleet — purchaseable)
export const EXTRA_SHIPS = [
  { nm:'Man-o-War',   col:0xd4a020, spd:.09, sc:1.50, hull:'heavy',    disp:1400, extra:true, cost:{wood:300,gold:200} },
  { nm:'Schooner',    col:0x80c060, spd:.20, sc:.70,  hull:'light',    disp:150,  extra:true, cost:{wood:80, gold:60}  },
];

// Enemy fleet configs
export const ECFG = [
  { nm:'War Galleon', col:0xcc3030, spd:.11, sc:1.2,  hull:'heavy',    disp:900 },
  { nm:'Red Frigate', col:0xb02020, spd:.13, sc:.95,  hull:'standard', disp:450 },
  { nm:'Corsair',     col:0x902020, spd:.15, sc:.82,  hull:'light',    disp:200 },
];
