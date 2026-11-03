// ── META UI DOM HELPERS ─────────────────────────────────────────────
// Shared by ShipyardPanel, WorldChart, BattleResult and HarborBar:
// escaping, element creation, a modal stack (Esc + focus trap + game
// hotkey shield), keyed list patching and meta.css injection.

/** HTML-escape anything that came from the profile/user (ship names!). */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** First element of an HTML string (callers escape dynamic parts). */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

let _uid = 0;
/** Unique DOM id with a prefix (for aria-labelledby). */
export const domId = (p) => `${p}-${++_uid}`;

/** User prefers reduced motion? */
export function reducedMotion() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Broadcast that the profile changed (HarborBar and open panels listen). */
export function emitMetaChanged(detail = {}) {
  try { window.dispatchEvent(new CustomEvent('iow:meta-changed', { detail })); } catch { /* no window */ }
}

/** Safe optional ctx call. */
export function call(ctx, name, ...args) {
  try { return typeof ctx?.[name] === 'function' ? ctx[name](...args) : undefined; }
  catch (e) { console.error(`[MetaUI] ctx.${name} failed`, e); return undefined; }
}

/** ctx.now() with a Date.now() fallback. */
export const nowOf = (ctx) => (typeof ctx?.now === 'function' ? ctx.now() : Date.now());

// ── meta.css injection ────────────────────────────────────────────
const CSS_HREF = (() => {
  try {
    const u = new URL('../../styles/meta.css', import.meta.url);
    u.search = new URL(import.meta.url).search;          // inherit ?v= cache-buster
    return u.href;
  } catch { return 'src/styles/meta.css'; }
})();
let _cssPromise = null;

/** Is meta.css applied? (it defines --mx-loaded on :root) */
export function cssReady() {
  try { return getComputedStyle(document.documentElement).getPropertyValue('--mx-loaded').trim() === '1'; }
  catch { return true; }
}

/**
 * Make sure meta.css is linked. Resolves once it is applied (or after a
 * short timeout so a missing file never blocks the UI).
 * @returns {Promise<void>}
 */
export function ensureMetaCss() {
  if (_cssPromise) return _cssPromise;
  _cssPromise = new Promise((resolve) => {
    if (typeof document === 'undefined' || cssReady()) return resolve();
    let link = [...document.querySelectorAll('link[rel="stylesheet"]')].find((l) => /\/meta\.css(\?|$)/.test(l.href));
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CSS_HREF;
      document.head.appendChild(link);
    }
    const done = () => resolve();
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
    setTimeout(done, 1500);
    // already loaded but the sentinel check ran too early
    requestAnimationFrame(() => { if (cssReady()) done(); });
  });
  return _cssPromise;
}

/** Reveal `node` once meta.css is applied (avoids a flash of unstyled UI). */
export function revealWhenStyled(node) {
  if (cssReady()) return;
  node.style.visibility = 'hidden';
  ensureMetaCss().then(() => { node.style.visibility = ''; });
}

// ── modal stack: Esc, focus trap, hotkey shield ───────────────────
const _stack = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((n) => n.getClientRects().length && !n.closest('[hidden],[inert]'));
}

function onKey(e) {
  const top = _stack[_stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') {
    e.preventDefault(); e.stopPropagation();
    top.onEsc?.(e);
    return;
  }
  if (e.key === 'Tab') {
    const list = focusables(top.el);
    e.stopPropagation();
    if (!list.length) { e.preventDefault(); top.el.focus(); return; }
    const first = list[0], last = list[list.length - 1];
    const a = document.activeElement;
    if (e.shiftKey && (a === first || !top.el.contains(a))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (a === last || !top.el.contains(a))) { e.preventDefault(); first.focus(); }
    return;
  }
  top.onKey?.(e);
  // Shield the game's hotkeys (B, R, 1–9 …) while a modal is up.
  if (!e.ctrlKey && !e.metaKey && !e.altKey) e.stopPropagation();
}

/**
 * Register an open modal. The top-most entry receives Esc / Tab / keys.
 * @param {{el:HTMLElement, onEsc?:Function, onKey?:Function}} entry
 * @returns the entry (pass it back to popModal)
 */
export function pushModal(entry) {
  if (!_stack.length) window.addEventListener('keydown', onKey, true);
  entry.returnFocus = document.activeElement;
  _stack.push(entry);
  return entry;
}

/** Unregister a modal and restore focus to whatever opened it. */
export function popModal(entry) {
  const i = _stack.indexOf(entry);
  if (i < 0) return;
  _stack.splice(i, 1);
  if (!_stack.length) window.removeEventListener('keydown', onKey, true);
  const rf = entry.returnFocus;
  if (rf && rf.isConnected && typeof rf.focus === 'function') {
    try { rf.focus({ preventScroll: true }); } catch { /* ignore */ }
  }
}

/** Is any meta modal open? */
export const modalOpen = () => _stack.length > 0;

/** Focus the first focusable element in `root` (or root itself). */
export function focusFirst(root, selector) {
  const target = (selector && root.querySelector(selector)) || focusables(root)[0] || root;
  try { target.focus({ preventScroll: true }); } catch { /* ignore */ }
}

// ── keyed list patching ───────────────────────────────────────────
/**
 * Render `items` into `container` keyed by `key(item)`. An item's element is
 * rebuilt only when `sig(item)` changes; focus inside a rebuilt element is
 * restored by its `data-fk` attribute.
 * @param {HTMLElement} container
 * @param {Array} items
 * @param {{key:Function, sig:Function, html:Function, after?:Function}} o
 *   after(node, item, fresh) runs for every item after placement (live values)
 */
export function patchKeyed(container, items, o) {
  const existing = new Map();
  for (const c of [...container.children]) if (c.dataset.key) existing.set(c.dataset.key, c);
  const active = document.activeElement;
  let refocus = null;
  let prev = null;
  for (const it of items) {
    const k = String(o.key(it));
    const s = o.sig(it);
    let node = existing.get(k);
    let fresh = false;
    if (!node || node._sig !== s) {
      const next = el(o.html(it));
      next.dataset.key = k;
      next._sig = s;
      if (node) {
        if (active && node.contains(active)) refocus = active.dataset?.fk || null;
        node.replaceWith(next);
      }
      node = next; fresh = true;
    }
    existing.delete(k);
    const want = prev ? prev.nextElementSibling : container.firstElementChild;
    if (want !== node) container.insertBefore(node, want);
    o.after?.(node, it, fresh);
    prev = node;
  }
  existing.forEach((n) => n.remove());
  if (refocus) {
    const t = container.querySelector(`[data-fk="${CSS.escape(refocus)}"]`);
    if (t && !t.disabled) t.focus({ preventScroll: true });
  }
}

/** Set textContent only when it changed (cheap live updates). */
export function setText(node, txt) {
  if (node && node.textContent !== txt) node.textContent = txt;
}

/**
 * Animate a number from `from` to `to` into node.textContent.
 * Returns a cancel function. Honors reduced motion.
 */
export function tweenNumber(node, from, to, ms, fmt = (v) => String(Math.round(v)), onDone) {
  if (!node) return () => {};
  if (reducedMotion() || ms <= 0 || from === to) { node.textContent = fmt(to); onDone?.(); return () => {}; }
  const t0 = performance.now();
  let raf = 0, dead = false;
  const step = (t) => {
    if (dead) return;
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    node.textContent = fmt(from + (to - from) * e);
    if (k < 1) raf = requestAnimationFrame(step);
    else onDone?.();
  };
  raf = requestAnimationFrame(step);
  return () => { dead = true; cancelAnimationFrame(raf); node.textContent = fmt(to); };
}
