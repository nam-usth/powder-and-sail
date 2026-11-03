// ── EVENT BUS ───────────────────────────────────────────────────
// Decouples systems. Usage:
//   bus.on('ship:destroyed', ({ship}) => ...)
//   bus.emit('ship:destroyed', {ship})
export class EventBus {
  constructor(){ this._handlers = {}; }

  on(event, fn){
    if(!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
    return ()=>this.off(event, fn); // returns unsubscribe fn
  }

  off(event, fn){
    if(!this._handlers[event]) return;
    this._handlers[event] = this._handlers[event].filter(h=>h!==fn);
  }

  emit(event, data={}){
    (this._handlers[event]||[]).forEach(fn=>fn(data));
  }
}

export const bus = new EventBus();
