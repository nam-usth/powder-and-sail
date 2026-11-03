import { PanelManager } from './PanelManager.js';
// F1: XSS guard
const _esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

import { REVIVE_TIME } from '../../data/constants.js';
import { getAlivePlayerShipCount, getShipCapacity } from '../Utils/ShipCapacity.js';

export class RevivePanel {
  constructor(state, revive, bus){
    this._state = state; this._revive = revive; this._bus = bus;
    this._refreshInterval = null;
    bus.on('ship:destroyed', () => setTimeout(() => this._render(), 200));
    bus.on('revive:complete', () => this._render());
    bus.on('revive:queued',   () => this._render());
  }

  toggle(){
    const p = document.getElementById('revive-panel'); if(!p) return;
    if(PanelManager.isOpen('revive-panel')){
      PanelManager.close('revive-panel');
      clearInterval(this._refreshInterval); this._refreshInterval = null;
    } else {
      PanelManager.open('revive-panel');
      this._render();
      // Refresh countdown timers every 1s — no self-recursion
      clearInterval(this._refreshInterval);
      this._refreshInterval = setInterval(() => this._render(), 1000);
    }
  }

  _render(){
    const st   = this._state;
    const dead = st.playerShips.filter(s => !s.alive);
    const panel = document.getElementById('revive-panel');
    const list  = document.getElementById('revive-list');
    if(!panel || !list) return;

    if(!dead.length && !st.reviveQueue.length){
      PanelManager.close('revive-panel');
      clearInterval(this._refreshInterval); this._refreshInterval = null;
      return;
    }

    PanelManager.open('revive-panel');
    list.innerHTML = '';

    dead.forEach(ship => {
      const inQ  = st.reviveQueue.find(q => q.ship === ship);
      const row  = document.createElement('div');
      row.className = 'revive-row';
      const cost = ship.reviveCost || { wood:80, gold:60 };
      const cap = getShipCapacity(st, this._revive._islands);
      const reserved = getAlivePlayerShipCount(st) + st.reviveQueue.length;
      const capFull = reserved >= cap;
      const can  = !capFull && st.resWood >= cost.wood && st.resGold >= cost.gold;

      if(inQ){
        const pct = Math.round((1 - inQ.timer / inQ.totalTime) * 100);
        row.innerHTML = `<span class="revive-nm">⚓ ${_esc(ship.nm)}</span><span class="revive-timer">${Math.ceil(inQ.timer)}s (${pct}%)</span><span style="color:#40d8ff;font-size:9px">REBUILDING…</span>`;
      } else {
        row.innerHTML = `<span class="revive-nm">💀 ${_esc(ship.nm)}</span><span class="revive-cost">🪵${cost.wood} 🪙${cost.gold}</span><button class="revive-btn"${can ? '' : ' disabled'}>Revive</button>`;
        const btn = row.querySelector('.revive-btn');
        if(btn && can) btn.onclick = () => { this._revive.queue(ship); this._render(); };
      }
      list.appendChild(row);
    });
  }
}
