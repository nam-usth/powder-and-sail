# Art & rendering reference — Defense of the Dominion (the user's previous game)

Source: https://github.com/nam-usth/defense-of-the-dominion (screenshots copied here). The user wants Isles of War to reach this level of polish, with the same two-tier **GFX HIGH / LOW** model.

## Graphics

The field, its light and its weather are the desktop game's, with the same shaders and the same textures.

- **The ground** is drawn by a shader from three tiling 512² maps in `assets/textures/`: a noise for the broad patches of grass and dirt, single grass blades and pebbles on crumbly earth for the close-up detail (R height, G tone, BA slope). No part of the field repeats visibly and no mesh or quad is involved. The maps come from the desktop game, so both editions draw the same field: `dotd --dump-ground assets/textures` writes them again. They are data, not pictures: all four channels are read straight, with no colour conversion and no premultiplied alpha (in Chrome they read back from the GPU identical to the PNGs, texel for texel). Until they load the field is a flat colour.
- **3D grass**: 7 500 tufts of four blades out to r 30 (one mesh, 90 000 triangles), each taking the colour of the ground at its root and swaying in slow gusts. There are none on bare earth, in water or where a nuke has scorched the field.
- **The light**: a lower sun, soft cloud shadows drifting with the wind, ambient by which way a surface faces, the sky mirrored on polished surfaces. At night the field fades to its own moonlit value instead of going black.
- **Boulders**: three shapes chiselled from a sphere by 16 random planes, with creased ridges, shaded as stone on HIGH (the ground's maps projected on three axes, lichen on the faces turned up), each on a soft contact shadow.
- **Rain on the ground**: the field darkens as it soaks and water stands where the ground is low, mirroring the sky, with the rain's rings on it. It dries slowly once the rain stops.
- **HDR**: the scene renders into a float target (R11G11B10F, RGBA16F if refused) with 4x MSAA on HIGH; a bloom chain and a hue-preserving tone curve composite it before the HUD, and the nuke's heat haze bends the scene there. Without float targets (WebGL 1) it draws straight to the canvas.
- **Battlefield dust** (Menu → Settings, stored, on by default) is the dust and smoke from gunfire, charred Zerg and the nuke's rolling dust ring. Off, none of it is spawned or drawn. On an Iris Xe the frame rate does not change measurably, even in a nuke's first seconds. Blood, flames, the mushroom cloud, the rockets' trails and a burning bunker's smoke stay.
- **GFX LOW** turns off shadows, MSAA, the grass and the cloud shadows, draws the field from its broad layers alone in the same tones, and drops HiDPI.
- **Frame rate**: on an Iris Xe at 1280×720 in a swarm, vsync off, in alternating runs against the build before it (that chip's speed swings with its heat, so only paired runs mean anything), HIGH went from 87 to 158 FPS with the 4x MSAA kept, the scene pass from 9.5 to 3.8 ms; LOW stays near 250 FPS (6% down: more Zerg, the crowding). What did it:
  - three r128 resolves a multisampled target's depth and stencil as well as its colour, and nothing reads them: ANGLE on Direct3D 11 does that with a draw per sample. Colour only (`_gl.blitFramebuffer` wrapped) took most of it: 14.5 → 5.7 ms in one page, the rest unchanged.
  - The ground's cache: its dry colour and slope are kept per pixel once the camera has held still for two frames (two RGBA16F passes), and its shader reads those; the rain's part stays live. The same frozen frame with and without it differs by 0.1 levels on average, by more than 8 only over the animated HUD portrait.
  - The grass is coloured and culled in the vertex shader; deep in the night's dark the ground skips its lights; at night there is no shadow map and no shadow read; the soft shadow filter reads six points first and stops if they agree.
  - **Auto resolution** (Menu → Settings, stored, on by default): under 50 FPS for two windows of 3 s the 3D scene drops to 85%, then 70% of the resolution, then gives up 4x MSAA, for the session; the HUD stays sharp. The renderer asks the browser for the discrete GPU on a hybrid laptop.

## Project structure

---

# Harbor mood reference — `harbor-mood-reference.webp`

Provided by the user (a screenshot of a commercial mobile game, © Disney).
**Reference for mood and composition only — never trace, copy, or reuse any of
its art, characters, logos or UI.** What we take from it:

- **One big home island wrapped around a natural harbor bay** — the sea comes
  *into* the island; the town sits on terraces around the water.
- **Many wooden piers/jetties** reaching into the bay, ships moored at berths.
- **Stone sea walls, bastions and watchtowers** along the coastline; a fortified
  gate/lighthouse on the outer point; a battery on a rocky islet at the mouth.
- Paved stone plazas, stairs and ramps between terraces; buildings in clusters
  with crates, barrels, carts as clutter; a parade ground of sand.
- **Satellite rocky islets** and reefs around the mouth of the bay.
- Water: bright turquoise shallows over sand → teal → deep blue, foam lines at
  every shore, visible wave texture; drifting cloud wisps in the foreground.
- High oblique camera (~50°), warm saturated painterly grading, soft shadows.
- Small level badges/plaques next to buildings; round icon bubbles over things
  that need attention (ship ready, upgrade done).

# Battle HUD reference — `battle-hud-reference.png`
User-provided screenshot of the original browser game's sea battle (reference
only). Our combat core already covers it; adopted ideas: a top **versus bar**
(player fleet name + total hull bar · battle clock · enemy fleet name + bar,
with level/strength badges), broadside firing cones on the selected ship, open
calm sea with long white wakes.

# Island concepts — `island-concept-cliffs.webp`, `island-concept-wreck-town.webp`
User-provided concept art of a commercial game (© its owners) — **reference
only, never copy**. The user's notes: smooth the sharp points of the island
outline or put big rock masses there; much more timber; pirates reinforce the
island edges. Taken ideas: grey rock cliffs ring the grass plateau; timber
palisades, plank revetments on piles and boardwalks run along the cliff edges;
wooden stairs/ramps down to stone quays; lanterns on posts; stone towers on the
points; a beached wreck reused as a building; big boulder groups at the corners.

# Pirate island map — `pirate-island-map-reference.webp`
User-provided painted map (reference only, never copy). Ideas for the home
island: a big irregular island with a mountain ridge of rocky peaks, jungle
valleys and palms, wide sand beaches with sea-carved rock arches, the town on
a peninsula with its own piers and ships, a zig-zag timber boardwalk/stair
climbing the mountain to huts and a lookout, a wreck on the shore, small
sister islets around, deep blue water with soft cloud shadows.
