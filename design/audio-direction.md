# Audio Direction — Powder & Sail

Setting 1570–1720: pirates, European crowns, Asian seas. Period instruments
and period sources only (no synth pads, no modern weapons). Everything is
procedural Web Audio except five recordings in `frontend/Assets/Sounds/`
(cannon body, three blasts, water splash, fire loop).

## Signal flow

```
gun / impact / UI / event SFX ─► spatial gain ─► SFX bus ─► SFX compressor ─┐
ambience beds (MusicDirector) ─────────────────► SFX bus                     ├─► master (volume · mute) ─► soft clip ─► out
MusicDirector tracks ─► region trim ─► music comp ─► music bus ─► duck ──────┘
```

- **Listener**: the camera's ground focus (CameraController rig), distance =
  horizontal distance + ¼ zoom distance. Gain = (1 − (d − 12)/(max − 12))².
- **Settings**: `audio.setSfxVolume / setMasterVolume / setMasterMute`
  (localStorage `pas_audio`); music `music.setVolume / mute` (`iow_music`).

## Cannons (data/cannonSounds.js)

Every cannon id in `data/cannons.js` has its own recipe built from shared
layers (report, calibre boom, bark, powder blast, chest thud, rolling tail,
shore slaps, ball whistle, tackle rattle, mortar tube, grape scatter) plus an
in-flight sound and an impact profile.

| gun | character | impact profile |
|---|---|---|
| swivel | sharp small crack, short | light (knock / plop) |
| falconet | double pop ("pap-pap"), light | light |
| carronade | short fat low thump, no long tail | medium |
| carronade32 | heavier/lower thump, chest thud, rattle | heavy |
| long9 / long12 / long24 | sharp report + long rolling echo; pitch drops and tail lengthens with calibre | medium / medium / heavy |
| demi_culv / culverin | mid boom + roundshot whistle | medium |
| demi_can / cannon_royal | massive low boom, chest thud, tackle + debris rattle, recorded body layered low | heavy (explosion + wood + sub thud) |
| mortar1 / mortar2 | hollow tube "thoomp", shell whistle falling onto the target, burst on landing | mortar / mortar_heavy |
| chain_shot | boom + whirring chain in flight | chain (rigging tears, chain clank) |
| grapeshot | boom + hiss and spray of balls | grape (peppering knocks / fizz of plops) |
| fort / defense | shore battery / tower guns | medium |

Mix rules: per-gun ±2–5 % pitch and ±15 % layer jitter per shot; at most 2
starts of one gun and 5 of all guns per 90 ms; density compensation
`gain = min(1, √(3 / shots in last 0.5 s))`; SFX compressor (−9 dB, 6:1,
3 ms) ahead of the master soft clip. An 8-ship × 4-gun heavy broadside
renders at −1.4 dBFS peak, 0 clipped samples.

## Levels (offline renders, master 0.75, listener at source)

| cue | peak dBFS | loudest 400 ms dBFS |
|---|---|---|
| swivel / falconet | −6 / −7 | −29 / −26 |
| long9 → long24 | −7 → −3 | −22 → −18 |
| culverin / demi_can / cannon_royal | −6 / −3 / −3 | −19 / −16 / −14.5 |
| mortar1 / mortar2 | −5 / −4 | −19 / −17 |
| 8-ship broadside | −1.4 | −12 |
| hit: light / medium / heavy (ship) | −11 / −10 / −7 | −34 / −18 / −16 |
| mortar burst | −5 | −16 |
| UI click | ≈ −19 | — |

Music: battle (all five regions, i = 0.75) RMS −19.3…−20.6 dBFS; chart
−23.6…−24.7 dBFS after the per-region trims in `data/music.js REGIONS.trim`.

## Verification

`node tools/smoke.mjs --port 8194 --secs 1 --script tools/audio_check.mjs --path "/tools/audio-lab.html?auto=cannons"`
(also `impacts`, `sfx`, `music`, `regions`; `AUDIO_WAV=dir` exports WAVs,
`AUDIO_SHOT=png AUDIO_SHOT_SEL=#compare` saves the cannon comparison grid).
