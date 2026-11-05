import { GameApp }                  from './Experience/GameApp.js';
import { AURA_LEVELS }              from './data/constants.js';
import { setLang, getLang, LANGS }  from './i18n.js';
import { toasts }                   from './Experience/UI/ToastQueue.js';
window._toast = (m, d, t) => toasts.show(m, d, t);

// ─────────────────────────────────────────────────────────────
// main.js — bootstrap only.
// Responsibilities:
//   1. DOM-ready gate
//   2. Global window helpers (aura, lang, panels, shortcuts)
//   3. Graphics settings persistence
//   4. Resource preload → loading screen → GameApp()
//
// Game logic lives in Experience/. UI wiring in GameApp._registerGlobals().
// ─────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {

  { const l = getLang(); if (l !== 'en') document.body.classList.add('lang-' + l); }

  // ── Aura / regen upgrade callbacks (called from HTML onclick) ─
  window.setRange = (r) => {
    if (!window._game) return;
    window._game._state.visRange = r;
    const lv = document.getElementById('rng-lvl');
    if (lv) lv.textContent = '×' + r;
    window._game._vision.rebuild();
    // Notify FogSystem so VisionLayer re-stamps all ship/island circles
    const g = window._game;
    g._fog.onVisionRadiusChanged(g._state.getVisionR(), g._islands);
  };

  window.upgradeAura = () => {
    if (!window._game) return;
    const st = window._game._state;
    if (st.auraLevel >= 4) return;
    const cost = AURA_LEVELS[st.auraLevel].auraUpgCost;
    if (st.resWood < cost) return;
    st.resWood -= cost; st.auraLevel++;
    window._game._aura.rebuild();
    _syncAuraUI();
  };

  window.upgradeRegen = () => {
    if (!window._game) return;
    const st = window._game._state;
    if (st.regenLevel >= 4) return;
    const cost = AURA_LEVELS[st.regenLevel].regenUpgCost;
    if (st.resGold < cost) return;
    st.resGold -= cost; st.regenLevel++;
    _syncAuraUI();
  };

  window.refreshAuraPanel = () => {
    if (!window._game) return;
    const st      = window._game._state;
    const auraBtn  = document.getElementById('upg-aura-btn');
    const regenBtn = document.getElementById('upg-regen-btn');
    const auraLv   = document.getElementById('upg-aura-lv');
    const regenLv  = document.getElementById('upg-regen-lv');
    const info     = document.getElementById('aura-info');
    if (auraLv)  auraLv.textContent  = `Lv${st.auraLevel  + 1}`;
    if (regenLv) regenLv.textContent = `Lv${st.regenLevel + 1}`;
    if (auraBtn) {
      if (st.auraLevel >= 4) { auraBtn.textContent = 'MAX'; auraBtn.disabled = true; }
      else {
        const c = AURA_LEVELS[st.auraLevel].auraUpgCost;
        auraBtn.textContent = `${c}🪵`;
        auraBtn.disabled = st.resWood < c;
        auraBtn.classList.toggle('afford', st.resWood >= c);
      }
    }
    if (regenBtn) {
      if (st.regenLevel >= 4) { regenBtn.textContent = 'MAX'; regenBtn.disabled = true; }
      else {
        const c = AURA_LEVELS[st.regenLevel].regenUpgCost;
        regenBtn.textContent = `${c}🪙`;
        regenBtn.disabled = st.resGold < c;
        regenBtn.classList.toggle('afford', st.resGold >= c);
      }
    }
    if (info) info.textContent = `Range: ${st.getAuraRange()}u · ${st.getRegenRate()} HP/s`;
    // Recruit affordability
    const costs = { light: { wood: 100, gold: 60 }, standard: { wood: 180, gold: 120 }, heavy: { wood: 300, gold: 200 } };
    document.querySelectorAll('[onclick^="buyShip"]').forEach(btn => {
      const m = (btn.getAttribute('onclick') || '').match(/buyShip\('(\w+)'\)/);
      if (!m) return;
      const c = costs[m[1]]; if (!c) return;
      btn.classList.toggle('afford', st.resWood >= c.wood && st.resGold >= c.gold);
    });
  };

  function _syncAuraUI() {
    const st  = window._game._state;
    const lv  = document.getElementById('upg-aura-lv');
    const btn = document.getElementById('upg-aura-btn');
    const info = document.getElementById('aura-info');
    if (lv)  lv.textContent = `Lv${st.auraLevel + 1}`;
    if (btn) {
      if (st.auraLevel >= 4) { btn.textContent = 'MAX'; btn.disabled = true; }
      else btn.textContent = `${AURA_LEVELS[st.auraLevel].auraUpgCost}🪵`;
    }
    if (info) info.textContent = `Range: ${st.getAuraRange()}u · ${st.getRegenRate()} HP/s`;
  }

  // ── Panel helpers ────────────────────────────────────────────
  const PANEL_MAP = {
    'bp':            () => window._game?._openBuildDock?.(),
    'rp':            () => window._game?._researchUI?.toggle(),
    'lp':            () => window._game?._loadout?.toggle(),
    'revive-panel':  () => window._game?._reviveUI?.toggle(),
    'empire-panel':  () => window._game?._empire?.toggle(),
    // 'upgrade-panel' retired in AR — building upgrades are inline in the dock
  };

  window.togglePanel = (id) => {
    if (document.activeElement?.blur) document.activeElement.blur();
    PANEL_MAP[id]?.() ?? document.getElementById(id)?.classList.toggle('open');
  };

  if (!window.closePanel)
    window.closePanel = (id) => document.getElementById(id)?.classList.remove('open');

  document.querySelectorAll('.actbtn').forEach(b =>
    b.addEventListener('click', () => {
      PANEL_MAP[b.dataset.panel]?.();
      setTimeout(_syncActionBar, 30);
    })
  );

  function _syncActionBar() {
    document.querySelectorAll('.actbtn').forEach(b => {
      const el = document.getElementById(b.dataset.panel);
      const open = el && ['pm-open','open','visible'].some(c => el.classList.contains(c));
      b.classList.toggle('active', !!open);
    });
  }
  setInterval(_syncActionBar, 350);

  // ── Camera view-bar ──────────────────────────────────────────
  document.querySelectorAll('#view-bar .cam-mode-btn').forEach(b =>
    b.addEventListener('click', () => {
      const mode = b.dataset.cam;
      if (mode === 'island') {
        const islId = window._game?._state?.selectedIslandId || window._game?._islands[0]?.def.id;
        window._game?._cam.setMode('island', islId);
      } else {
        // Leaving island focus: clear build grid + cancel build mode
        window._game?.exitIslandFocus();
        window._game?._cam.setMode(mode);
      }
    })
  );

  document.getElementById('rng-btn')?.addEventListener('click', () => {
    const cur = window._game?._state?.visRange || 1;
    const nxt = cur >= 3 ? 1 : cur + 1;
    window.setRange?.(nxt);
  });

  // ── Graphics settings ────────────────────────────────────────
  const GFX_KEY = 'iow_gfx';
  // AT: auto-quality — first run (no saved prefs) picks defaults from the
  // device: touch/mobile or ≤4 cores ⇒ low quality + shadows off. Saved
  // user choices always win (loadGfx merges saved over defaults).
  const _isMobile = matchMedia('(pointer: coarse)').matches
                 || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const _lowEnd   = _isMobile || (navigator.hardwareConcurrency || 8) <= 4;
  const GFX_DEFAULTS = {
    rangeFill: 'filled',
    quality:   _lowEnd ? 'low' : 'high',
    shadows:   _lowEnd ? 'off' : 'on',
    theme:     'parchment',
  };

  function loadGfx()  { try { return { ...GFX_DEFAULTS, ...JSON.parse(localStorage.getItem(GFX_KEY)) }; } catch { return { ...GFX_DEFAULTS }; } }
  function saveGfx(p) { try { localStorage.setItem(GFX_KEY, JSON.stringify({ ...loadGfx(), ...p })); } catch {} }

  function applyGfx(key, val) {
    const rd = window._game?._renderer;       // Renderer wrapper (owns composer)
    const r  = rd?.instance;
    if (key === 'rangeFill') { if (window._game?._state) window._game._state.rangeFill = val === 'filled'; window._game?._overlay?.setFillVisible(val === 'filled'); }
    if (key === 'quality'  && rd) {
      const high = val === 'high';
      rd.setPixelRatio(high ? Math.min(devicePixelRatio, 2) : 1);
      rd.setPostFX(high);                     // AN: bloom + grade + FXAA chain
      window.setGraphicsHigh?.(high);         // AN: planar ocean reflection follows quality
    }
    if (key === 'shadows'  && r) r.shadowMap.enabled = val === 'on';
    if (key === 'theme') {
      // AQ: dual theme — one body class flips the whole variable palette.
      // No _game needed: applies instantly even before the engine boots.
      document.body.classList.toggle('theme-parchment', val === 'parchment');
      document.body.classList.toggle('theme-admiralty', val !== 'parchment');
    }
  }

  function initGfxToggles() {
    const state = loadGfx();
    Object.entries(state).forEach(([k, v]) => applyGfx(k, v));
    [['tog-range-style','rangeFill'], ['tog-quality','quality'], ['tog-shadows','shadows'], ['tog-theme','theme']].forEach(([gid, key]) => {
      const grp = document.getElementById(gid); if (!grp) return;
      grp.querySelectorAll('.stog-btn').forEach(b => b.classList.toggle('active', b.dataset.val === state[key]));
      grp.addEventListener('click', e => {
        const b = e.target.closest('.stog-btn'); if (!b) return;
        grp.querySelectorAll('.stog-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        saveGfx({ [key]: b.dataset.val });
        applyGfx(key, b.dataset.val);
      });
    });
  }
  initGfxToggles();

  // AW: GFX HIGH / LOW chip + Q hotkey (two-tier model, design/art-reference)
  function setQuality(q) {
    saveGfx({ quality: q, shadows: q === 'high' ? 'on' : 'off' });
    applyGfx('quality', q);
    applyGfx('shadows', q === 'high' ? 'on' : 'off');
    window._gfxQuality = q;
    const v = document.getElementById('gfx-chip-val');
    if (v) { v.textContent = q.toUpperCase(); v.style.color = q === 'high' ? 'var(--verd, #7eb150)' : 'var(--brass, #e8b840)'; }
    ['tog-quality', 'tog-shadows'].forEach(gid => document.getElementById(gid)?.querySelectorAll('.stog-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.val === (gid === 'tog-quality' ? q : (q === 'high' ? 'on' : 'off')))));
  }
  window.setGfxQuality = setQuality;
  window._gfxQuality = loadGfx().quality;
  document.getElementById('gfx-chip')?.addEventListener('click', () => setQuality(loadGfx().quality === 'high' ? 'low' : 'high'));
  window.addEventListener('keydown', e => {
    if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
    const bst = window._game?._state;
    if (bst?.buildMode && bst?.selectedDefense) return;   // Q/E rotate a defense while placing it
    if (e.key === 'q' || e.key === 'Q') setQuality(loadGfx().quality === 'high' ? 'low' : 'high');
  });
  setTimeout(() => { const v = document.getElementById('gfx-chip-val'); if (v) { const q = loadGfx().quality; v.textContent = q.toUpperCase(); v.style.color = q === 'high' ? 'var(--verd, #7eb150)' : 'var(--brass, #e8b840)'; } }, 0);

  // ── Settings modal ───────────────────────────────────────────
  function buildLangButtons() {
    const host = document.getElementById('lang-btns'); if (!host) return;
    host.innerHTML = '';
    const cur = getLang();
    Object.entries(LANGS).forEach(([code, label]) => {
      const b = document.createElement('button');
      const active = code === cur;
      b.style.cssText = `padding:6px 18px;font-family:var(--display);font-size:10px;letter-spacing:.16em;border-radius:2px;cursor:pointer;transition:all .12s;border:1px solid ${active ? 'var(--brass-deep)' : 'var(--ink-3)'};background:${active ? 'linear-gradient(180deg,var(--brass-shine),var(--brass))' : 'var(--p1)'};color:${active ? 'var(--ink-0)' : 'var(--ink-2)'}`;
      b.textContent = label;
      b.addEventListener('click', () => { setLang(code); buildLangButtons(); });
      host.appendChild(b);
    });
  }

  const settingsModal = document.getElementById('settings-modal');
  // UI2: settings labels follow the language; sound section (music + effects)
  function localiseSettings() {
    import('./Meta/UI/strings.js').then(({ ms }) => {
      const set = (id, k) => { const el = document.getElementById(id); if (el) el.textContent = ms(k); };
      [['settings-title','set_title'], ['settings-lang-label','set_lang'], ['settings-gfx-label','set_gfx'], ['settings-snd-label','set_sound'],
       ['lbl-range-style','set_range'], ['lbl-filled','set_filled'], ['lbl-edge','set_edge'], ['lbl-quality','set_quality'],
       ['lbl-high','set_high'], ['lbl-low','set_low'], ['lbl-shadows','set_shadows'], ['lbl-shon','set_on'], ['lbl-shoff','set_off'],
       ['lbl-theme','set_theme'], ['lbl-th-adm','set_adm'], ['lbl-th-par','set_par'], ['lbl-music','set_music'], ['lbl-sfx','set_sfx'],
       ['lbl-allsnd','set_all'], ['lbl-snd-on','set_on'], ['lbl-snd-off','set_off']].forEach(([id, k]) => set(id, k));
      const mb = document.getElementById('mute-music');
      if (mb) mb.title = mb.getAttribute('aria-pressed') === 'true' ? ms('set_unmute') : ms('set_mute');
    }).catch(() => {});
  }
  localiseSettings();
  window.addEventListener('iow:langchange', localiseSettings);
  import('./Experience/UI/SettingsSound.js').then(m => m.initSettingsSound()).catch(e => console.warn('[settings sound]', e));

  document.getElementById('settings-btn')?.addEventListener('click', () => {
    buildLangButtons();
    window._syncSettingsSound?.();
    window._game?._panels ? window._game._panels.toggle('settings-modal') : settingsModal?.classList.toggle('open');
  });
  settingsModal?.addEventListener('click', e => {
    if (e.target === settingsModal)
      window._game?._panels ? window._game._panels.close('settings-modal') : settingsModal.classList.remove('open');
  });

  window.addEventListener('iow:langchange', () => {
    if (!window._game) return;
    window._game._buildUI?._render();
    window._game._hud?.rebuild();
    if (['lp'].some(id => document.getElementById(id)?.classList.contains('pm-open'))) {
      const ship = window._game._state.selectedShip || window._game._state.playerShips.find(s => s.alive);
      if (ship) window._game._loadout?.open(ship);
    }
  });

  // ── Help modal ───────────────────────────────────────────────
  const helpModal = document.getElementById('help-modal');
  function toggleHelp() {
    if (!helpModal?.classList.contains('open')) import('./Experience/UI/HelpCard.js').then(m => m.renderHelp()).catch(() => {});
    window._game?._panels ? window._game._panels.toggle('help-modal') : helpModal?.classList.toggle('open');
  }
  document.getElementById('help-btn')?.addEventListener('click', toggleHelp);
  helpModal?.addEventListener('click', e => { if (e.target === helpModal) toggleHelp(); });

  document.getElementById('pause-btn')?.addEventListener('click', () => window._game?._togglePause());
  document.getElementById('fog-btn')?.addEventListener('click', () => {
    const g = window._game; if (!g) return;
    g._fog.toggle(g._state);
  });
  document.getElementById('trade-btn')?.addEventListener('click', () => window._game?._toggleMarket());
  document.getElementById('market-close')?.addEventListener('click', () => {
    const p = document.getElementById('market-panel'); if (p) p.style.display = 'none';
  });
  document.getElementById('sell-wood-btn')?.addEventListener('click', () => {
    const g = window._game; if (!g) return;
    const gold = g._trade.sellWood(50);
    g._showMsg(gold > 0 ? `Sold 50 🪵 → +${gold} 🪙` : 'Not enough wood', 1400);
    window._refreshMarket?.();
  });
  document.getElementById('buy-wood-btn')?.addEventListener('click', () => {
    const g = window._game; if (!g) return;
    const got = g._trade.buyWood(50);
    g._showMsg(got > 0 ? `Bought 50 🪵` : 'Not enough gold', 1400);
    window._refreshMarket?.();
  });

  // ── First-session onboarding (UI2) ──────────────────────────
  // The old 5-card tutorial overlay is replaced by Experience/UI/Onboarding.js
  // (spotlight tour per mode + one-time notes; progress in 'pas_onboard').
  // Started below once the GameApp exists.

  // ── Keyboard shortcut: ? = help ──────────────────────────────
  // AU: number keys now recall fleets (control groups); panels use letters
  // (B build · R research · L loadout · V revive · O empire).
  window.addEventListener('keydown', e => {
    if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
    if (e.key === '?') { e.preventDefault(); toggleHelp(); }
  });

  // ── Resource preload → game start ────────────────────────────
  import('./Experience/Resources.js').then(({ Resources }) => {
    const resources = new Resources([
      // Add asset entries here as the game grows:
      // { name: 'ocean_normal', type: 'texture', url: 'textures/ocean_normal.jpg' }
    ]);

    const bar    = document.getElementById('loading-bar');
    const label  = document.getElementById('loading-label');
    const screen = document.getElementById('loading-screen');

    resources.on('progress', ([loaded, total]) => {
      const pct = total > 0 ? (loaded / total * 100).toFixed(0) : 100;
      if (bar)   bar.style.width = pct + '%';
      if (label) label.textContent = `${loaded} / ${total}`;
    });

    resources.on('ready', async () => {
      // AW / ADR-001: one mode per page load — harbor (default), battle, skirmish
      let opts = { mode: 'skirmish' };
      try {
        const { buildModeOptions } = await import('./Experience/Modes/boot.js');
        opts = buildModeOptions(location);
      } catch (e) { console.error('[boot] mode setup failed, falling back to Open War', e); }
      window._game = new GameApp(opts);
      // Re-apply GFX settings now that renderer + overlay exist
      Object.entries(loadGfx()).forEach(([k, v]) => applyGfx(k, v));
      if (screen) { screen.style.opacity = '0'; setTimeout(() => screen.style.display = 'none', 520); }
      // audio-director: per-mode music (Open War) + bus-driven cues (fort down, building placed)
      import('./Experience/UI/Onboarding.js').then(m => m.startOnboarding(window._game)).catch(e => console.warn('[onboarding]', e));
      import('./Experience/Utils/ModeAudio.js').then(m => m.startModeAudio(window._game)).catch(e => console.warn('[audio]', e));
    });
  });

});
