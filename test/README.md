# IOW Test Suite

Zero-dependency browser test runner. No Jest, no bundler.

## Run

From the repository root:

```bash
node tools/serve.mjs 8080
# open http://localhost:8080/test/
```

(`python -m http.server 8080` from the repo root works as well.) Tests import modules from `../frontend/src/...`, so the server must serve the repository root.

## Structure

```text
test/
|-- index.html                    # Browser test runner
|-- runner.js                     # Mini test runner (suite/test/assert API)
|-- harness.js                    # Play harness for the LIVE game (see below)
|-- 01_EventEmitter.test.js       # EventEmitter: on/off/trigger/namespace
|-- 02_Ocean.test.js              # getWaveHeight: Gerstner CPU math
|-- 03_CombatSystem.test.js       # Accuracy falloff + arc resolution
|-- 04_EconomySystem.test.js      # Resource tick, cap, building production
|-- 05_ReviveSystem.test.js       # Queue, cost deduction, timer, revive
|-- 06_ImportGraph.test.js        # Every module resolves at its current path
|-- 07_GameState.test.js          # createGameState() shape + isolation
|-- 08_BallisticPhysics.test.js   # Cannonball trajectory math (AA.1)
|-- 09_VFX_AD.test.js             # CameraShake math + VFX method surface
|-- 10_SpringCamera.test.js       # Critically damped spring convergence
`-- 11_NavalCommand.test.js       # AU: pathing, formations, steering, gun profile, fleets, headless orders
```

Status at AV: **126 passed, 4 failed**. The four failures predate AU (Ocean zero-mean sample, ReviveSystem stub without a mesh, two SpringCamera settling checks) and are tracked in `../TODO.md`.

## Play harness

`harness.js` drives the running game deterministically — it advances frames itself, so it also works in a hidden tab where `requestAnimationFrame` is paused. Synthetic mouse and key events go through the real `InputManager` listeners.

```js
// in the browser console on http://localhost:8080/frontend/
const h = await import('/test/harness.js');
h.step(600);                         // 10 s of game time at 60 fps
h.drag(-80, 6, -70, 16);             // box-select between two world points
h.key('2', { ctrlKey: true }, 'Digit2');
h.rightClick(-40, 5);                // order the selection
h.rightClick(-20, -30, { shiftKey: true });   // queue a waypoint
h.ships();                           // table: position, hp, speed, fleet, stance, order
```

Rendering every stepped frame is slow; step in chunks of a few hundred frames.

## Test philosophy

Each file targets one system and uses stub state objects where possible, avoiding Three.js, the DOM and the game loop unless the test needs them. `11_NavalCommand` runs `OrderSystem` headless with plain ship objects.

## Adding tests

```js
// myFeature.test.js
import { suite, test, assert, assertEqual } from './runner.js';
import { MySystem } from '../frontend/src/Experience/Systems/<Domain>/MySystem.js';

suite('MySystem', () => {
  test('does the thing', () => {
    assertEqual(MySystem.doThing(), 'expected');
  });
});
```

Then add `import './myFeature.test.js'` to `test/index.html`.
