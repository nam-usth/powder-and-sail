// ── FireSource — persistent looping fire emitter ──────────────────
export class FireSource {
  constructor(x, y, z, intensity = 1.0, sounds = null) {
    this.x = x; this.y = y; this.z = z;
    this.intensity = intensity;
    this._sounds = Array.isArray(sounds) ? sounds.filter(Boolean) : sounds ? [sounds] : [];
    this._emitTimer = 0;
    // AN: per-source flicker — desynced phase so multiple fires don't pulse together
    this._t     = 0;
    this._phase = Math.random() * Math.PI * 2;
  }

  // AN: callers raise intensity as damage worsens (never auto-lowers — a fire
  // that "calmed down" without repair would read as a bug to the player).
  setIntensity(i) { this.intensity = Math.max(this.intensity, i); }

  update(dt, firePool, smokePool) {
    this._t += dt;
    // Flicker: ±22 % twin-sine — fixes "fire intensity static after ignition"
    const flick = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(this._t * 6.3 + this._phase))
                       * (0.6 + 0.4 * Math.sin(this._t * 17.0 + this._phase * 2.7));
    const eff = this.intensity * flick;
    this._emitTimer += dt;
    const rate = 0.045 / eff;
    while (this._emitTimer > rate) {
      this._emitTimer -= rate;
      firePool.spawn(this.x, this.y, this.z, {
        n:      Math.ceil(5 * eff),
        speed:  1.8 + eff * 0.9,
        life:   0.65 + Math.random() * 0.45,
        size:   10 + eff * 5,
        spread: 0.40 + 0.18 * eff,
      });
      if (Math.random() < 0.35) {
        firePool.spawn(this.x, this.y + 0.8 * eff, this.z, {
          n: 1, speed: 2.8, life: 0.35, size: 5, spread: 0.15,
        });
      }
      if (Math.random() < 0.22) {
        smokePool.spawn(this.x, this.y + 0.5, this.z, {
          n: 1, speed: 1.0, life: 1.0, size: 16, spread: 0.3,
        });
      }
    }
  }

  stop() {
    this._sounds.forEach(sound => sound?.stop?.());
    this._sounds = [];
  }
}

// ── SinkSequence — ship tilt → sink → fade phases ─────────────────
export class SinkSequence {
  constructor(scene, firePool, smokePool, miscPool) {
    this._scene   = scene;
    this._fire    = firePool;
    this._smoke   = smokePool;
    this._misc    = miscPool;
    this._active  = [];
    this._sources = [];
  }

  start(ship, onDone) {
    const src = new FireSource(ship.x, 2.0, ship.z, 1.5);
    this._sources.push({ src, ship });

    this._active.push({
      ship, onDone,
      phase:   'tilt',
      timer:   0,
      startY:  ship.mesh.position.y,
      startRZ: ship.mesh.rotation.z,
      src,
    });

    this._fire.spawn(ship.x, 1.5, ship.z, { n: 18, speed: 4.0, life: 1.0, size: 28, spread: 0.8 });
    this._smoke.spawn(ship.x, 2.0, ship.z, { n: 6, speed: 2.0, life: 1.4, size: 24, spread: 1.0 });
    this._misc.spawn(ship.x, 1.5, ship.z, 0x8b5a2b, 12);
  }

  update(dt) {
    for (const { src } of this._sources) {
      src.update(dt, this._fire, this._smoke);
    }

    for (let i = this._active.length - 1; i >= 0; i--) {
      const s = this._active[i];
      s.timer += dt;

      switch (s.phase) {
        case 'tilt': {
          const p    = Math.min(s.timer / 1.2, 1);
          const ease = p * p * (3 - 2 * p);
          s.ship.mesh.rotation.z = s.startRZ + ease * (Math.PI * 0.28);
          s.ship.mesh.rotation.x = ease * 0.12;
          if (s.timer >= 1.2) { s.phase = 'sink'; s.timer = 0; }
          break;
        }
        case 'sink': {
          const p    = Math.min(s.timer / 1.8, 1);
          const ease = p * p;
          s.ship.mesh.position.y = s.startY - ease * 3.5;
          if (Math.random() < dt * 6) {
            this._misc.spawn(
              s.ship.x + (Math.random() - 0.5) * 1.5,
              s.ship.mesh.position.y + 0.5,
              s.ship.z + (Math.random() - 0.5) * 1.5,
              0x88ccff, 2, { speed: 1.5, life: 0.6 }
            );
          }
          if (s.timer >= 1.8) { s.phase = 'fade'; s.timer = 0; }
          break;
        }
        case 'fade': {
          const p = Math.min(s.timer / 0.6, 1);
          s.ship.mesh.traverse(child => {
            if (child.isMesh && child.material) {
              child.material.transparent = true;
              child.material.opacity = Math.max(0, 1 - p);
            }
          });
          if (s.timer >= 0.6) {
            s.phase = 'done';
            this._scene.remove(s.ship.mesh);
            const si = this._sources.findIndex(x => x.src === s.src);
            if (si !== -1) this._sources.splice(si, 1);
            if (s.onDone) s.onDone();
            this._active.splice(i, 1);
          }
          break;
        }
      }
    }
  }
}
