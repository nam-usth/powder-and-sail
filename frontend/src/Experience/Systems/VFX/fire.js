import * as THREE from 'three';
import { getWaveHeight } from '../../World/Ocean.js';
import { vfxBudget } from './quality.js';
import { sinkBubbles } from './recipes.js';

const R = Math.random;

// ── FireSource — persistent looping fire emitter ──────────────────
// Public contract unchanged (IslandEntity forts, VFX.startBurning):
//   new FireSource(x, y, z, intensity, sounds)
//   .setIntensity(i)            escalate only
//   .update(dt, firePool, smokePool)
//   .stop()
// When the pools are the new GPU fields (they expose emit()) the source draws
// licking flame tongues, a dark smoke column lit orange from below, and
// rising embers; with legacy pools it falls back to their spawn().
export class FireSource {
  constructor(x, y, z, intensity = 1.0, sounds = null, extras = null) {
    this.x = x; this.y = y; this.z = z;
    this.intensity = intensity;
    this._sounds = Array.isArray(sounds) ? sounds.filter(Boolean) : sounds ? [sounds] : [];
    this._spark = extras?.spark || null;
    this._emitTimer = 0;
    this._smokeT = 0;
    this._emberT = 0;
    this._t     = 0;
    this._phase = Math.random() * Math.PI * 2;   // desync flicker between fires
  }

  /** Raise intensity as damage worsens (never auto-lowers). */
  setIntensity(i) { this.intensity = Math.max(this.intensity, i); }

  update(dt, firePool, smokePool) {
    this._t += dt;
    const flick = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(this._t * 6.3 + this._phase))
                       * (0.6 + 0.4 * Math.sin(this._t * 17.0 + this._phase * 2.7));
    const eff = this.intensity * flick;
    if (!firePool?.emit || !smokePool?.emit) return this._legacy(dt, eff, firePool, smokePool);
    const B = vfxBudget(), sq = Math.sqrt(Math.max(eff, 0.2));
    this._emitTimer += dt;
    const rate = 0.05 / Math.max(eff, 0.25) / B.emit;
    while (this._emitTimer > rate) {
      this._emitTimer -= rate;
      const sp = 0.35 + 0.22 * eff;
      firePool.emit(this.x + (R() - 0.5) * sp, this.y + R() * 0.15, this.z + (R() - 0.5) * sp,
        (R() - 0.5) * 0.6, 1.6 + R() * 1.2 * sq, (R() - 0.5) * 0.6,
        0.55 + R() * 0.4, 0.45 * sq, (1.0 + R() * 0.5) * sq, 2.2, 2.0, 0.92, 0.85, 1.0);
    }
    this._smokeT += dt;
    const srate = 0.13 / Math.max(eff, 0.25) / B.emit;
    while (this._smokeT > srate) {
      this._smokeT -= srate;
      smokePool.emit(this.x + (R() - 0.5) * 0.4, this.y + 0.7 * sq, this.z + (R() - 0.5) * 0.4,
        (R() - 0.5) * 0.4, 1.2 + R() * 0.8, (R() - 0.5) * 0.4,
        (4.0 + R() * 2.5) * B.smokeLife, 0.6 * sq, (3.0 + R() * 1.4) * sq, 1.1, 0.9, 0.17 + R() * 0.12, 0.5, 0.9);
    }
    if (this._spark) {
      this._emberT += dt;
      const erate = 0.22 / Math.max(eff, 0.25) / B.emit;
      while (this._emberT > erate) {
        this._emberT -= erate;
        this._spark.emit(this.x + (R() - 0.5) * 0.6, this.y + 0.5, this.z + (R() - 0.5) * 0.6,
          (R() - 0.5) * 1.2, 2.0 + R() * 2.0, (R() - 0.5) * 1.2,
          1.2 + R() * 1.2, 0.035, 0.05, 0.8, 0.6, 1.0, 0.55, 0.18, 1.4);
      }
    }
  }

  _legacy(dt, eff, firePool, smokePool) {
    this._emitTimer += dt;
    const rate = 0.045 / eff;
    while (this._emitTimer > rate) {
      this._emitTimer -= rate;
      firePool?.spawn?.(this.x, this.y, this.z, { n: Math.ceil(5 * eff), speed: 1.8 + eff * 0.9, life: 0.65 + R() * 0.45, size: 10 + eff * 5, spread: 0.40 + 0.18 * eff });
      if (R() < 0.22) smokePool?.spawn?.(this.x, this.y + 0.5, this.z, { n: 1, speed: 1.0, life: 1.0, size: 16, spread: 0.3 });
    }
  }

  stop() {
    this._sounds.forEach(sound => sound?.stop?.());
    this._sounds = [];
  }
}

// ── WreckSystem — a destroyed ship rolls over and goes down ───────
// GameApp removes a destroyed ship's mesh at once (and disposes enemy
// materials, keeps player meshes for revive), so the wreck is a CLONE:
// geometry shared, materials cloned + charred (owned and disposed here).
// The clone lists, settles, then sinks bow- or stern-first with fires on deck
// that hiss to steam as they go under, bubbles and foam boiling around the
// hull, and finally an ash/oil slick. Capped (oldest wreck finishes early).
const MAX_WRECKS = 6;
const _v = new THREE.Vector3();

export class WreckSystem {
  /** @param {object} fx shared fields { smoke, flame, spark, spray, debris, decals, lights } */
  constructor(scene, fx) {
    this._scene = scene;
    this._fx = fx;
    this._list = [];
  }

  get count() { return this._list.length; }

  /**
   * @param {THREE.Object3D} src   the ship's mesh (left untouched)
   * @param {{x:number,z:number,angle:number,sc:number,hl?:number,hb?:number,deckY?:number,y?:number,
   *          roll?:number,pitch?:number}} info
   * @param {Function} [onDone]   called once the wreck is gone
   */
  spawn(src, info, onDone = null) {
    if (!src || typeof src.clone !== 'function') { onDone?.(); return null; }
    if (this._list.length >= MAX_WRECKS) this._finish(0);
    const mats = [];
    const obj = src.clone(true);
    obj.traverse(c => {
      if (c.userData?.role === 'lantern') { c.visible = false; return; }
      if (!c.material) return;
      const char = m => {
        const k = m.clone();
        if (k.color && !k.isShaderMaterial) k.color.multiplyScalar(0.45);
        if (k.uniforms?.uDamage) k.uniforms.uDamage.value = 0.92;
        if ('roughness' in k) k.roughness = Math.min(1, (k.roughness ?? 0.8) + 0.15);
        mats.push(k);
        return k;
      };
      c.material = Array.isArray(c.material) ? c.material.map(char) : char(c.material);
      c.castShadow = false;
    });
    const sc = info.sc || 1;
    obj.rotation.order = 'YXZ';
    obj.rotation.set(info.pitch || 0, info.angle || 0, info.roll || 0);
    obj.position.set(info.x, info.y ?? 0.35, info.z);
    obj.visible = true;
    this._scene.add(obj);
    const B = vfxBudget();
    const w = {
      obj, mats, onDone, sc,
      x: info.x, z: info.z, angle: info.angle || 0,
      hl: info.hl || 2.3 * sc, hb: info.hb || 0.75 * sc, deckY: info.deckY ?? 0.45 * sc,
      t: 0, T: (B.name === 'low' ? 6.5 : 9.0) + R() * 1.5,
      side: R() < 0.5 ? -1 : 1, pitchDir: R() < 0.5 ? -1 : 1,
      roll0: info.roll || 0, pitch0: info.pitch || 0,
      depth: 2.5 + 5.5 * sc,
      fireT: 0, smokeT: 0, bubT: 0, foamDone: false, endDone: false,
      hot: [ [ (R() - 0.5) * 0.6, 0.3 + R() * 0.3 ], [ (R() - 0.5) * 0.6, -0.2 - R() * 0.4 ], [ 0, R() - 0.5 ] ],
      steamed: [false, false, false],
    };
    this._list.push(w);
    return w;
  }

  update(dt, oceanT) {
    for (let i = this._list.length - 1; i >= 0; i--) {
      const w = this._list[i];
      w.t += dt;
      const t = w.t, T = w.T;
      const wy = getWaveHeight(w.x, w.z, oceanT);
      let roll, pitch, sink;
      if (t < 1.4) {
        const e = t / 1.4, s = e * e * (3 - 2 * e);
        roll = w.roll0 + (w.side * 0.38 - w.roll0) * s;
        pitch = w.pitch0 * (1 - s);
        sink = 0.3 * s;
      } else {
        const u = Math.min(1, (t - 1.4) / (T - 1.4));
        roll = w.side * (0.38 + 0.7 * Math.pow(u, 1.3));
        pitch = w.pitchDir * 0.6 * Math.pow(u, 1.5);
        sink = 0.3 + w.depth * Math.pow(u, 1.75);
      }
      const o = w.obj;
      o.rotation.x = pitch; o.rotation.z = roll;
      o.position.y = wy + 0.35 - sink;
      o.updateMatrixWorld(true);
      this._emit(w, dt, wy, sink);
      if (t >= T) this._finish(i);
    }
  }

  _emit(w, dt, wy, sink) {
    const fx = this._fx, B = vfxBudget();
    const sinkFrac = sink / (w.depth + 0.3);
    // deck fires — hiss to steam once their hotspot goes under
    w.fireT += dt;
    const fireRate = 0.06 / B.emit;
    const burnFires = w.fireT > fireRate;
    if (burnFires) w.fireT = 0;
    for (let k = 0; k < 3; k++) {
      const h = w.hot[k];
      _v.set(h[0] * w.hb, w.deckY + 0.1, h[1] * w.hl);
      w.obj.localToWorld(_v);
      if (_v.y > wy + 0.15) {
        if (burnFires && (k < 2 || w.sc > 1.1)) {
          const fade = 1 - Math.min(1, w.t / (w.T * 0.8));
          fx.flame.emit(_v.x + (R() - 0.5) * 0.4, _v.y, _v.z + (R() - 0.5) * 0.4, (R() - 0.5) * 0.6, 1.8 + R(), (R() - 0.5) * 0.6,
            0.5 + R() * 0.4, 0.55 * w.sc, (1.2 + R() * 0.6) * w.sc * (0.5 + 0.5 * fade), 2.2, 2.2, 0.95, 0.9, 1.0);
        }
      } else if (!w.steamed[k]) {
        w.steamed[k] = true;
        for (let s = 0; s < 4; s++) {
          fx.smoke.emit(_v.x, wy + 0.2, _v.z, (R() - 0.5) * 1.5, 1.5 + R() * 1.5, (R() - 0.5) * 1.5,
            2.5 + R() * 1.5, 0.6, 2.8 + R(), 1.4, 0.8, 0.95, 0.45, 0, s * 0.08);
        }
      }
    }
    // smoke column from the wreck while the deck is still above water
    w.smokeT += dt;
    const srate = 0.14 / B.emit;
    if (w.smokeT > srate && sinkFrac < 0.75) {
      w.smokeT = 0;
      _v.set(0, w.deckY + 0.4, 0); w.obj.localToWorld(_v);
      const y = Math.max(_v.y, wy + 0.3);
      fx.smoke.emit(_v.x, y, _v.z, (R() - 0.5) * 0.6, 1.4 + R(), (R() - 0.5) * 0.6,
        (5.0 + R() * 2.5) * B.smokeLife, 0.9 * w.sc, (3.8 + R() * 1.6) * w.sc, 1.0, 1.0, 0.13 + R() * 0.1, 0.55, 0.8);
    }
    // bubbles + foam around the hull while it goes down
    if (w.t > 0.8) {
      w.bubT += dt;
      const brate = (0.09 - 0.05 * sinkFrac) / B.emit;
      if (w.bubT > brate) {
        w.bubT = 0;
        sinkBubbles(fx, w.x, wy, w.z, w.angle, w.hl, w.hb, 2 + ((sinkFrac * 3) | 0));
      }
    }
    if (!w.foamDone && w.t > 1.6) {
      w.foamDone = true;
      fx.decals.emit(w.x, wy + 0.05, w.z, 1, w.hl * 0.8, w.hl * 1.6, 7.5, 0.8);
    }
    if (!w.endDone && w.t > w.T - 0.7) {
      w.endDone = true;
      // last breath: a gout of bubbles + spray, a ring, then the slick
      for (let k = 0; k < 6; k++) sinkBubbles(fx, w.x, wy, w.z, w.angle, w.hl * 0.6, w.hb, 4);
      for (let k = 0; k < 6; k++) fx.spray.puff(w.x + (R() - 0.5) * w.hb * 2, wy + 0.1, w.z + (R() - 0.5) * w.hb * 2,
        (R() - 0.5) * 1.5, 3 + R() * 2.5, (R() - 0.5) * 1.5, 0.9 + R() * 0.3, 0.4, 1.4, 0.6, -13, 0.7);
      fx.decals.emit(w.x, wy + 0.05, w.z, 0, 0.5, w.hl * 2.4, 1.6, 0.8, 0.06);
      fx.decals.emit(w.x, wy + 0.04, w.z, 3, w.hl * 0.6, w.hl * 1.5, B.name === 'low' ? 8 : 18, 0.9);
    }
  }

  _finish(i) {
    const w = this._list[i];
    if (!w) return;
    this._scene.remove(w.obj);
    w.mats.forEach(m => m.dispose());
    this._list.splice(i, 1);
    try { w.onDone?.(); } catch (e) { console.warn('[VFX] wreck onDone', e); }
  }

  destroy() {
    while (this._list.length) this._finish(this._list.length - 1);
  }
}

// ── SinkSequence — legacy startSink() contract on top of WreckSystem ─
// start(ship, onDone): the ship's own mesh leaves the scene immediately and a
// charred clone goes down in its place (the original mesh and its materials
// are never mutated, so a later revive still finds an intact ship).
export class SinkSequence {
  constructor(scene, wrecks) {
    this._scene = scene;
    this._wrecks = wrecks;
  }

  start(ship, onDone) {
    const m = ship?.mesh;
    if (!m) { onDone?.(); return; }
    const hi = m.userData?.hullInfo;
    const sc = ship.sc || 1;
    this._wrecks.spawn(m, {
      x: ship.x, z: ship.z, angle: ship.angle || 0, sc, y: m.position.y,
      roll: m.rotation.z, pitch: m.rotation.x,
      hl: hi?.hl ?? 2.3 * sc, hb: hi?.hb ?? 0.75 * sc, deckY: hi?.deckY ?? 0.45 * sc,
    }, onDone);
    this._scene.remove(m);
  }

  update() { /* driven by WreckSystem.update */ }
}
