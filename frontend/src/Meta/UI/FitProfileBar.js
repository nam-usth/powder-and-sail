// ── FIT PROFILE BAR — compact "Fit profiles: [I ▸ Load] [I ⤓ Save] …" ──
// Shared by the Loadout panel doctrine bar (harbor) and the Shipyard roster
// header. Pure view: the host passes handlers that do the work through
// Meta/FitProfiles.js (and refit the moored ships).
//
//   const bar = new FitProfileBar(hostEl, { list, save, load, rename }, 'lp');
//   bar.render();
//
// list() → profile.fitProfiles ([{name, savedAt, fits}] × FIT_PROFILE_SLOTS)
// save(slot) · load(slot) · rename(slot, name) — the bar re-renders after each.
// Saving over a non-empty slot needs a second click within CONFIRM_MS.

import { ms, fitProfileName } from './strings.js';
import { FIT_PROFILE_NAME_MAX } from '../../data/harbor.js';

const CONFIRM_MS = 3500;
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class FitProfileBar {
  /**
   * @param {HTMLElement} host
   * @param {{list:Function, save:Function, load:Function, rename:Function}} h
   * @param {string} [variant] extra class suffix ('lp' Loadout | 'sy' Shipyard)
   */
  constructor(host, h, variant = 'lp') {
    this.host = host; this.h = h; this.variant = variant;
    this._confirm = -1; this._confirmT = 0; this._editing = -1; this._sig = '';
    host.classList.add('fp-bar', 'fp-' + variant);
    host.addEventListener('click', (e) => this._onClick(e));
    host.addEventListener('keydown', (e) => this._onKey(e));
    host.addEventListener('keyup', (e) => { if (e.target.matches?.('.fp-name-in')) e.stopPropagation(); });
    host.addEventListener('focusout', (e) => { if (e.target.matches?.('.fp-name-in')) this._commitName(e.target); });
  }

  /** Re-render (cheap: skipped when nothing visible changed). */
  render(force = false) {
    const list = this.h.list() || [];
    const sig = [this._confirm, this._editing, ms('fp_bar'),
      ...list.map((fp) => `${fp.name}|${Object.keys(fp.fits || {}).length}|${fp.savedAt}`)].join('#');
    if (!force && sig === this._sig) return;
    if (!force && this.host.contains(document.activeElement) && document.activeElement.matches?.('.fp-name-in')) return;
    this._sig = sig;
    this.host.innerHTML = `<span class="fp-lbl">${esc(ms('fp_bar'))}</span>` + list.map((fp, i) => {
      const nm = fitProfileName(fp, i), n = Object.keys(fp.fits || {}).length, r = ROMAN[i] || i + 1;
      const confirm = this._confirm === i;
      const name = this._editing === i
        ? `<input class="fp-name-in" data-slot="${i}" maxlength="${FIT_PROFILE_NAME_MAX}" value="${esc(fp.name)}" aria-label="${esc(ms('fp_rename'))}">`
        : `<button type="button" class="fp-name" data-fp="rename" data-slot="${i}" title="${esc(ms('fp_renameTip'))}">${esc(nm)} <i aria-hidden="true">✎</i></button>`;
      return `<span class="fp-slot${n ? '' : ' is-empty'}" data-slot="${i}">${name}
  <span class="fp-btn-wrap" title="${esc(n ? ms('fp_loadTip', nm, n) : ms('fp_emptyTip'))}"><button type="button" class="fp-btn fp-load" data-fp="load" data-slot="${i}" ${n ? '' : 'disabled'} aria-label="${esc(ms('fp_load') + ' ' + nm)}">${r} ▸ ${esc(ms('fp_load'))}</button></span>
  <button type="button" class="fp-btn fp-save${confirm ? ' is-confirm' : ''}" data-fp="save" data-slot="${i}" title="${esc(confirm ? ms('fp_overwriteTip', nm) : ms('fp_saveTip', nm))}" aria-label="${esc(ms('fp_save') + ' ' + nm)}">${confirm ? esc(ms('fp_overwrite')) : `${r} ⤓ ${esc(ms('fp_save'))}`}</button>
</span>`;
    }).join('');
    if (this._editing >= 0) { const inp = this.host.querySelector('.fp-name-in'); inp?.focus(); inp?.select(); }
  }

  _onClick(e) {
    const b = e.target.closest?.('[data-fp]');
    if (!b || b.disabled) return;
    e.stopPropagation();
    const slot = Number(b.dataset.slot), list = this.h.list() || [];
    if (b.dataset.fp === 'rename') { this._editing = slot; this.render(true); return; }
    if (b.dataset.fp === 'load') { this._confirm = -1; this.h.load(slot); this.render(true); return; }
    if (b.dataset.fp === 'save') {
      const full = Object.keys(list[slot]?.fits || {}).length > 0;
      if (full && this._confirm !== slot) {
        this._confirm = slot;
        clearTimeout(this._confirmT);
        this._confirmT = setTimeout(() => { this._confirm = -1; this.render(true); }, CONFIRM_MS);
        this.render(true);
        return;
      }
      this._confirm = -1; clearTimeout(this._confirmT);
      this.h.save(slot);
      this.render(true);
    }
  }

  _onKey(e) {
    if (!e.target.matches?.('.fp-name-in')) return;
    e.stopPropagation();                      // keep game hotkeys out of the text box
    if (e.key === 'Enter') { e.preventDefault(); this._commitName(e.target); }
    else if (e.key === 'Escape') { e.preventDefault(); this._editing = -1; this.render(true); }
  }

  _commitName(inp) {
    if (this._editing < 0) return;
    const slot = Number(inp.dataset.slot);
    this._editing = -1;
    this.h.rename(slot, inp.value);
    this.render(true);
  }
}
