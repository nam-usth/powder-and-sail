// ── STATUS EFFECTS ───────────────────────────────────────────────
// Manages temporary modifiers on ships.
// Each effect has a type, value, and expiresAt (game-time seconds).
// Tick every frame; expired effects are removed automatically.
//
// Usage:
//   StatusEffects.apply(ship, 'slow',       { multiplier:0.8 }, gameTime, 5);
//   StatusEffects.apply(ship, 'dodgeDebuff',{ value:0.12 },     gameTime, 10);
//   const spd = StatusEffects.effectiveSpeed(ship);

export const StatusEffects = {

  /** Apply or refresh an effect on a ship */
  apply(ship, type, params, gameTimeSec, durationSec) {
    if (!ship.statusEffects) ship.statusEffects = {};
    // Refresh: if same type already active, just extend expiry
    ship.statusEffects[type] = {
      ...params,
      expiresAt: gameTimeSec + durationSec,
    };
  },

  /** Tick all effects — remove expired ones */
  tick(ship, gameTimeSec) {
    if (!ship.statusEffects) return;
    for (const type of Object.keys(ship.statusEffects)) {
      if (ship.statusEffects[type].expiresAt <= gameTimeSec) {
        delete ship.statusEffects[type];
      }
    }
  },

  /** Effective max speed — combines ALL active multiplier effects */
  effectiveSpeed(ship) {
    if (!ship.statusEffects) return ship.maxSpeed;
    let mult = 1;
    for (const effect of Object.values(ship.statusEffects)) {
      if (typeof effect.multiplier === 'number') mult *= effect.multiplier;
    }
    return ship.maxSpeed * mult;
  },

  /** Effective dodge penalty accounting for debuff */
  effectiveDodgePenalty(ship) {
    if (!ship.statusEffects || !ship.statusEffects.dodgeDebuff) return 0;
    return ship.statusEffects.dodgeDebuff.value;
  },

  /** True if a given effect is active */
  has(ship, type) {
    return !!(ship.statusEffects && ship.statusEffects[type] &&
              ship.statusEffects[type].expiresAt > 0);
  },

  /** ROF multiplier from upgrades stored on ship */
  effectiveROF(ship, baseROF) {
    // ship.rofMult is set by ship upgrade system (default 1.0)
    return baseROF * (ship.rofMult != null ? ship.rofMult : 1.0);
  },
};
