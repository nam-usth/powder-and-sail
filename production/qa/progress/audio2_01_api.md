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
