// ── ModeAudio.js ────────────────────────────────────────────────────
// Per-mode music/ambience + the gameplay sound cues that are driven by
// bus events rather than by a system calling audio.play().
//
//   import { startModeAudio } from './Experience/Utils/ModeAudio.js';
//   startModeAudio(game);   // once, after new GameApp(...) — idempotent
//
// • skirmish (Open War): battle theme + sea ambience; music intensity follows
//   how many enemy ships are close to ours (same rule as BattleSession).
//   The end-game stinger is already triggered by GameApp._endGame →
//   audio.play('victory'|'defeat') → MusicDirector stinger.
// • harbor / battle: HarborSession / BattleSession already start their music
//   and ambience — nothing is (re)started here.
// • every mode: fort destroyed → magazine blast + collapsing masonry,
//   building placed → timber + mallet.
// Design: design/audio-direction.md

import { audio } from './Audio.js';
import { music } from './MusicDirector.js';
import { bus }   from '../EventBus.js';

/** Music intensity: an enemy within this many world units of one of our ships counts as "close". */
const CLOSE_R2 = 45 * 45;
/** Number of close enemies that means full intensity. */
const FULL_AT = 3;
const TICK_MS = 500;

/**
 * Start the mode's soundscape. Safe to call more than once (later calls are no-ops)
 * and before the first user gesture (the MusicDirector queues until unlocked).
 * @param {object} game  the GameApp (reads game._mode, game._state)
 * @returns {{stop():void}|null}
 */
export function startModeAudio(game) {
  if (!game || game._modeAudio) return game?._modeAudio ?? null;
  const mode = game._mode || game._state?.mode || 'skirmish';
  const offs = [];
  let timer = null;

  try {
    if (mode === 'skirmish') {
      music.setRegion('caribbean');
      music.play('battle');
      music.ambience('sea');
      music.setIntensity(0.25, true);
      timer = setInterval(() => {
        const st = game._state;
        if (!st || st.gameOver) { clearInterval(timer); timer = null; return; }
        music.setIntensity(intensityOf(st));
      }, TICK_MS);
    }

    offs.push(on('island:fort_destroyed', ({ island } = {}) => {
      if (island) audio.play('fort_down', { x: island.x, y: 2, z: island.z }, { maxDistance: 260 });
    }));
    offs.push(on('building:placed', () => audio.play('place')));
  } catch (e) { console.warn('[ModeAudio]', e); }

  const handle = {
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      for (const off of offs) off();
      offs.length = 0;
    },
  };
  game._modeAudio = handle;
  return handle;
}

/** 0..1 — share of living enemies close to any of our ships (saturates at FULL_AT). */
export function intensityOf(st) {
  const foes = (st.enemyShips || []).filter((s) => s.alive), ours = (st.playerShips || []).filter((s) => s.alive);
  if (!foes.length || !ours.length) return 0.15;
  const close = foes.filter((e) => ours.some((p) => (p.x - e.x) ** 2 + (p.z - e.z) ** 2 < CLOSE_R2)).length;
  return Math.min(1, 0.15 + 0.85 * close / Math.max(1, Math.min(foes.length, FULL_AT)));
}

function on(evt, fn) {
  bus.on(evt, fn);
  return () => { try { bus.off?.(evt, fn); } catch (e) { /* bus without off */ } };
}
