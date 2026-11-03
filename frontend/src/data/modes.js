// ── MODE FEATURE TABLE (ADR-001) ─────────────────────────────────
// Which systems tick and which HUD parts show in each mode. GameApp reads
// `features` once at boot; CSS hides HUD via body.mode-<id>.

export const MODES = {
  /** The original full RTS match (islands + war front). Default when no mode given to GameApp. */
  skirmish: {
    id: 'skirmish',
    features: {
      build: true, research: true, economy: true, trade: true, revive: true,
      waves: true, warFront: true, ai: true, capture: true, seaEvents: true,
      commander: true, fog: true, enemies: true, buyShips: true,
    },
  },
  /** Persistent home island. No enemies, no war. */
  harbor: {
    id: 'harbor',
    features: {
      build: true, research: true, economy: true, trade: true, revive: false,
      waves: false, warFront: false, ai: false, capture: false, seaEvents: false,
      commander: false, fog: false, enemies: false, buyShips: false,
    },
  },
  /** A single mission from data/campaign.js. */
  battle: {
    id: 'battle',
    features: {
      build: false, research: false, economy: false, trade: false, revive: false,
      waves: false, warFront: false, ai: true, capture: true, seaEvents: false,
      commander: true, fog: false, enemies: true, buyShips: false,
    },
  },
};

export const DEFAULT_MODE = 'harbor';
