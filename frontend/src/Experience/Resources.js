import * as THREE from 'three';
// ── RESOURCES ────────────────────────────────────────────────────
// Queue-based asset preloader. Emits 'ready' when everything is loaded.
// Systems wait for ready before spawning meshes that need textures.
//
// Usage:
//   resources.queue({ name:'ocean_normal', type:'texture', url:'...' })
//   resources.on('ready', () => startGame())
//   resources.on('progress', ([loaded, total]) => updateBar(loaded/total))
//
// AA milestone: textures only. AC milestone will add WASM (Rapier) here.

import { EventEmitter } from './EventEmitter.js';

export class Resources extends EventEmitter {
  constructor(items = []) {
    super();
    this._items    = items;
    this._loaded   = 0;
    this._total    = items.length;
    this.items     = {};   // keyed by name after load

    if (this._total === 0) {
      // Nothing to load — fire ready on next tick so listeners can attach first
      setTimeout(() => this.trigger('ready'), 0);
      return;
    }

    this._loader = new THREE.TextureLoader();
    items.forEach(item => this._loadItem(item));
  }

  _loadItem({ name, type, url }) {
    if (type === 'texture') {
      this._loader.load(
        url,
        texture => { this.items[name] = texture; this._itemLoaded(); },
        undefined,
        ()       => { this.items[name] = null;    this._itemLoaded(); }  // fail gracefully
      );
    } else {
      // Unknown type — skip but count as loaded so we don't hang
      this._itemLoaded();
    }
  }

  _itemLoaded() {
    this._loaded++;
    this.trigger('progress', [this._loaded, this._total]);
    if (this._loaded >= this._total) this.trigger('ready');
  }
}
