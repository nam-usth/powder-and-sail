# audio2_01 — Volume API for the Settings UI (audio-director)

Status: API frozen (names below will not change). Implementation lands in
`frontend/src/Experience/Utils/Audio.js` in this pass.

```js
import { audio } from '../../Experience/Utils/Audio.js';        // adjust relative path
import { music } from '../../Experience/Utils/MusicDirector.js';

// SFX (everything that is not music: gunfire, UI clicks, ambience beds)
audio.setSfxVolume(v)      // v: 0..1, persisted
audio.getSfxVolume()       // → 0..1

// Master (affects music + sfx)
audio.setMasterVolume(v)   // v: 0..1, persisted
audio.getMasterVolume()    // → 0..1
audio.setMasterMute(b)     // true = everything silent, persisted
audio.isMasterMuted()      // → boolean

audio.getSettings()        // → { master, sfx, muted } snapshot (for initialising sliders)

// Music (already existed — unchanged)
music.setVolume(v)         // 0..1, persisted in localStorage 'iow_music'
music.volume               // getter
music.mute(b)              // music only
music.muted                // getter
```

- Persistence: `localStorage['pas_audio'] = {"master":0.75,"sfx":1,"muted":0}` (all
  access wrapped in try/catch; private mode just doesn't persist).
- Defaults: master 0.75, sfx 1.0, muted false. Music default from `data/music.js`.
- Calls are safe before the first user gesture (no AudioContext is created by the
  setters; the value is applied when audio starts).
- Preview click for the SFX slider: `audio.play('ui_click')` (2D, no position).
- Audio.js no longer imports three.js, so it is safe to import from Meta/UI code.

## Update — implemented + verified (audio2)

Implemented exactly as above; persistence verified in a headless reload
(`{"master":0.6,"sfx":0.4,"muted":1}` survives). Master mute silences music too
(music runs through the master bus).

New SFX names usable from Meta/UI `ctx.sfx(name)` (all procedural, period-plausible):

| name | use for |
|---|---|
| `ui_click` | any button (existing) |
| `ui_hover` | hover (existing, very faint) |
| `ui_confirm` | confirm / accept / buy |
| `ui_back` | close / back / cancel |
| `ui_error` | can't afford / not allowed |
| `ui_open` | open a panel / chart page (parchment rustle) |
| `coin` | gold gained (existing) |
| `bell` / `ship_ready` | single ship's bell / "two bells" ship ready (existing) |
| `launch` | shipyard launch: yard bell ×3, hull down the ways, splash |
| `set_sail` | bosun's pipe + horn call (existing) |
| `place` | building placed (timber + mallet) |
| `build` | construction complete flourish (existing) |
| `reinforce` | reinforcements / wave incoming (signal gun + horn) |
| `warning` | attack warning, drum roll + horns (existing) |
