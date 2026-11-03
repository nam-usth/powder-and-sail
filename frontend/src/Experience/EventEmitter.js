// ── EVENT EMITTER ────────────────────────────────────────────────
// Bruno Simon's EventEmitter pattern (folio-2025).
// Supports namespaced events: on('tick.mySystem', fn) → off('tick.mySystem')
// Replaces the simpler EventBus — now with proper cleanup for destroy().
//
// API:
//   emitter.on('event', fn)           // subscribe
//   emitter.on('event.namespace', fn) // namespaced subscribe
//   emitter.off('event.namespace')    // remove by namespace
//   emitter.trigger('event', [args])  // fire

export class EventEmitter {
  constructor() {
    this._callbacks = { base: {} };
  }

  on(names, callback) {
    this._resolveNames(names).forEach(name => {
      const { ns, val } = this._resolveName(name);
      if (!this._callbacks[ns])       this._callbacks[ns] = {};
      if (!this._callbacks[ns][val])  this._callbacks[ns][val] = [];
      this._callbacks[ns][val].push(callback);
    });
    return this;
  }

  off(names) {
    this._resolveNames(names).forEach(name => {
      const { ns, val } = this._resolveName(name);
      if (ns !== 'base' && val === '') {
        delete this._callbacks[ns];
      } else if (ns === 'base') {
        // Bare token: if it names an EXISTING namespace, clear that whole
        // namespace — off('mySystem') ≡ off('.mySystem'). Matches the API
        // doc ("remove by namespace") and test 01. Otherwise treat it as an
        // event name and remove it across all namespaces (original branch).
        if (val !== 'base' && this._callbacks[val]) {
          delete this._callbacks[val];
          return;
        }
        for (const space in this._callbacks) {
          if (this._callbacks[space]?.[val]) {
            delete this._callbacks[space][val];
            if (!Object.keys(this._callbacks[space]).length)
              delete this._callbacks[space];
          }
        }
      } else if (this._callbacks[ns]?.[val]) {
        delete this._callbacks[ns][val];
        if (!Object.keys(this._callbacks[ns]).length)
          delete this._callbacks[ns];
      }
    });
    return this;
  }

  trigger(name, args = []) {
    const { ns, val } = this._resolveName(this._resolveNames(name)[0]);
    const spaces = ns === 'base' ? Object.keys(this._callbacks) : [ns];
    spaces.forEach(space => {
      this._callbacks[space]?.[val]?.forEach(fn => fn(...args));
    });
    return this;
  }

  _resolveNames(raw) {
    return String(raw).replace(/[^a-zA-Z0-9 ,/.]/g, '').replace(/[,/]+/g, ' ').split(' ');
  }

  _resolveName(name) {
    const parts = name.split('.');
    return { val: parts[0], ns: parts[1] || 'base' };
  }
}
