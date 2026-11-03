// ── MODE BOOT (ADR-001) — decide what this page load runs ──────────
import { parseMode, modeUrl, gotoMode } from '../../Meta/ModeRouter.js';
import { makeStore, loadProfile }      from '../../Meta/Profile.js';
import { HarborSession }               from './HarborSession.js';
import { BattleSession }               from './BattleSession.js';

function safeLocalStorage() {
  try { const k = '__iow_probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; }
  catch { return null; }
}

/**
 * @returns {object} GameApp options for the mode in the URL. Falls back to
 * the harbor when a battle cannot start (no pending battle, reloaded mid-fight).
 */
export function buildModeOptions(loc = location) {
  const { mode, mission } = parseMode(loc.search);
  document.body.dataset.mode = mode;
  if (mode === 'skirmish') return { mode: 'skirmish', onHarbor: () => gotoMode(loc, 'harbor') };

  const store = makeStore(safeLocalStorage());
  const profile = loadProfile(store);
  if (!store.persistent) setTimeout(() => window._toast?.('⚠ Storage is blocked — progress will not be saved.', 5000, 'bad'), 1500);

  if (mode === 'battle') {
    const s = new BattleSession(profile, store);
    const o = s.prepare(mission);
    if (o) return o;
    history.replaceState(null, '', modeUrl('harbor', {}, loc.pathname));
    document.body.dataset.mode = 'harbor';
  }
  return new HarborSession(profile, store).prepare();
}
