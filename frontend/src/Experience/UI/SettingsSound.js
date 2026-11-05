// ── SettingsSound.js (UI2) — Settings ▸ Sound rows ────────────────
// Music volume + mute → MusicDirector (music.setVolume / music.mute,
// persisted by it in 'iow_music'). Effects volume and "All sound" →
// Audio.js settings API (audio.setSfxVolume / audio.setMasterMute,
// persisted in 'pas_audio'). No AudioContext is created here.
//
//   initSettingsSound();          // once; window._syncSettingsSound() re-reads values

import { music } from '../Utils/MusicDirector.js';
import { audio } from '../Utils/Audio.js';
import { ms } from '../../Meta/UI/strings.js';

const pct = v => Math.round((Number(v) || 0) * 100);

/** Wire the sound controls in #settings-modal. Safe if any are missing. */
export function initSettingsSound() {
  const mv = document.getElementById('vol-music'), mvv = document.getElementById('vol-music-v');
  const sv = document.getElementById('vol-sfx'),   svv = document.getElementById('vol-sfx-v');
  const mm = document.getElementById('mute-music');
  const all = document.getElementById('tog-allsnd');
  if (!mv && !sv && !all) return;

  const paint = (range, out, v) => { if (!range) return; range.value = String(v); range.style.setProperty('--v', v + '%'); if (out) out.textContent = String(v); };

  function sync() {
    try {
      paint(mv, mvv, pct(music.volume ?? 0.6));
      const mMuted = !!music.muted;
      if (mm) { mm.setAttribute('aria-pressed', String(mMuted)); mm.textContent = mMuted ? '✕' : '♪'; mm.title = ms(mMuted ? 'set_unmute' : 'set_mute'); }
      if (mv) mv.disabled = mMuted;
      paint(sv, svv, pct(audio.getSfxVolume?.() ?? audio.sfxVolume ?? 0.8));
      const off = !!audio.isMasterMuted?.();
      all?.querySelectorAll('.stog-btn').forEach(b => b.classList.toggle('active', b.dataset.val === (off ? 'off' : 'on')));
      if (sv) sv.disabled = off;
    } catch (e) { console.warn('[settings sound]', e); }
  }

  mv?.addEventListener('input', () => {
    const v = +mv.value; paint(mv, mvv, v);
    try { music.setVolume(v / 100); } catch {}
  });
  sv?.addEventListener('input', () => {
    const v = +sv.value; paint(sv, svv, v);
    try { audio.setSfxVolume ? audio.setSfxVolume(v / 100) : (audio.sfxVolume = v / 100); } catch {}
  });
  sv?.addEventListener('change', () => { try { audio.play?.('ui_click'); } catch {} });
  mm?.addEventListener('click', () => { try { music.mute(!music.muted); } catch {} sync(); });
  all?.addEventListener('click', (e) => {
    const b = e.target.closest('.stog-btn'); if (!b) return;
    try { audio.setMasterMute?.(b.dataset.val === 'off'); } catch {}
    sync();
  });

  window._syncSettingsSound = sync;
  sync();
}
