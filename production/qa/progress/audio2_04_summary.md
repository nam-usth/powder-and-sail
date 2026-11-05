# audio2_04 — soundscape pass summary

- Cannons: 15 guns + fort/defense each with a distinct procedural recipe (data/cannonSounds.js),
  per-gun impacts, in-flight chain whirr / mortar shell whistle. Comparison grid:
  audio2_02_cannons.png. WAVs: tools/out/audio/cannons/ (cannon_reel.wav = all guns back to back),
  tools/out/audio/impacts/.
- Broadside 8 ships × 4 heavy guns: peak −1.4 dBFS, 0 clipped samples.
- Regions: battle RMS −19.3…−20.6 dBFS (±0.7 dB); chart −23.6…−24.7 dBFS after trims (audio2_03_regions.png).
- Open War music: ModeAudio.startModeAudio(game) (hooked in main.js 'ready'); battle + sea ambience,
  intensity from enemies within 45 u of our ships.
- Settings API: audio2_01_api.md. Verified persistence via reload.
- Smoke: harbor / battle (straits_1, atlantic) / skirmish — 0 console errors, one music player each.
  Tests: 167 pass / 3 known fails.
