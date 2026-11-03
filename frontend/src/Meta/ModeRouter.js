// ── MODE ROUTER (ADR-001) — one mode per page load ──────────────────
// Pure-ish: reads/writes location only through injected objects so it can
// be unit-tested. In the browser pass `window.location`.

import { MODES, DEFAULT_MODE } from '../data/modes.js';

/** Parse the mode + params from a URL search string. */
export function parseMode(search = '') {
  const q = new URLSearchParams(search);
  const id = q.get('mode');
  return {
    mode: MODES[id] ? id : DEFAULT_MODE,
    mission: q.get('mission') || null,
    params: Object.fromEntries(q.entries()),
  };
}

/** Build the URL for a mode. */
export function modeUrl(mode, params = {}, base = '') {
  const q = new URLSearchParams({ mode, ...params });
  return `${base}?${q.toString()}`;
}

/**
 * Navigate to another mode. `beforeLeave` lets the current session flush
 * its save first. A short fade is played by the caller via the loading screen.
 */
export function gotoMode(loc, mode, params = {}, beforeLeave = null) {
  try { beforeLeave?.(); } catch (e) { console.error('[ModeRouter] beforeLeave failed', e); }
  loc.assign(modeUrl(mode, params, loc.pathname));
}
