import { bus } from '../EventBus.js';
import { FORMATIONS, FORMATION_ORDER, STANCES, STANCE_ORDER } from '../../data/commands.js';

// ── COMMAND CARD (AU) ───────────────────────────────────────────
// Bottom-right RTS command grid for the current selection:
//   row 1  orders     Move · Attack-move · Stop · Hold · Patrol
//   row 2  formation  Line Ahead · Line Abreast · Wedge        (F cycles)
//   row 3  stance     Aggressive · Defensive · Hold Fire       (T cycles)
// Buttons call the CommandController; hotkeys are shown on each button.

const ORDERS = [
  { id: 'move',   icon: '➤', key: 'RMB', name: 'Move',        desc: 'Right-click the sea, or click here then the sea' },
  { id: 'amove',  icon: '⚔', key: 'A',   name: 'Attack-move', desc: 'Sail there, fighting anything met on the way' },
  { id: 'stop',   icon: '■', key: 'S',   name: 'Stop',        desc: 'Cancel all orders' },
  { id: 'hold',   icon: '⚓', key: 'H',   name: 'Hold',        desc: 'Drop anchor; guns still fire' },
  { id: 'patrol', icon: '↻', key: 'P',   name: 'Patrol',      desc: 'Sail back and forth, engaging enemies' },
];

export class CommandCard {
  constructor(state, command) {
    this._st = state;
    this._cmd = command;
    this._el = this._build();
    this._sig = '';
    bus.on('selection:changed', () => this.refresh());
    bus.on('cmd:mode',          () => this.refresh());
    bus.on('cmd:formation',     () => this.refresh());
    bus.on('cmd:stance',        () => this.refresh());
    this.refresh();
  }

  _build() {
    let el = document.getElementById('cmd-card');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'cmd-card';
    const btn = (grp, it, key) =>
      `<button class="cc-btn" data-grp="${grp}" data-id="${it.key || it.id}" title="${it.name} — ${it.desc}${key ? ` [${key}]` : ''}">
         <span class="cc-ic">${it.icon}</span><span class="cc-k">${key || ''}</span></button>`;
    el.innerHTML = `
      <div class="cc-head"><span id="cc-title">NO SHIPS SELECTED</span><span id="cc-sub"></span></div>
      <div class="cc-row" data-row="orders">${ORDERS.map(o => btn('order', o, o.key)).join('')}</div>
      <div class="cc-row" data-row="formation">${FORMATION_ORDER.map((k, i) => btn('formation', FORMATIONS[k], i === 0 ? 'F' : '')).join('')}<span class="cc-lbl" id="cc-form"></span></div>
      <div class="cc-row" data-row="stance">${STANCE_ORDER.map((k, i) => btn('stance', STANCES[k], i === 0 ? 'T' : '')).join('')}<span class="cc-lbl" id="cc-stance"></span></div>
      <div class="cc-row cc-abil" id="cc-abil"></div>`;
    (document.getElementById('con-cmd') || document.getElementById('ui') || document.body).appendChild(el);
    // AV: commander abilities (Z/X/C) live in the same panel as the orders
    const abil = document.getElementById('cmd-bar');
    if (abil) el.querySelector('#cc-abil').appendChild(abil);
    el.addEventListener('click', e => {
      const b = e.target.closest('.cc-btn');
      if (!b || b.disabled) return;
      const id = b.dataset.id;
      if (b.dataset.grp === 'order') {
        if (id === 'stop') this._cmd.stop();
        else if (id === 'hold') this._cmd.hold();
        else this._cmd.setMode(this._cmd.mode === id ? null : id);
      } else if (b.dataset.grp === 'formation') this._cmd.setFormation(id);
      else if (b.dataset.grp === 'stance') this._cmd.setStance(id);
      this.refresh();
    });
    // keep clicks on the card from reaching the canvas
    el.addEventListener('mousedown', e => e.stopPropagation());
    return el;
  }

  refresh() {
    const sel = this._st.selection.filter(s => s.alive);
    const stances = new Set(sel.map(s => s.stance || 'defensive'));
    const formation = this._st.cmd?.formation;
    const hp = sel.reduce((a, s) => a + s.hp, 0), mx = sel.reduce((a, s) => a + s.maxHp, 0);
    const hull = mx ? Math.round(hp / mx * 100) : 0;
    const sig = [sel.length, [...stances].join(), formation, this._cmd.mode, hull].join('|');
    if (sig === this._sig) return;
    this._sig = sig;

    const none = !sel.length;
    this._el.classList.toggle('empty', none);
    this._el.querySelector('#cc-title').textContent = none ? 'NO SHIPS SELECTED'
      : sel.length === 1 ? sel[0].nm.toUpperCase() : `${sel.length} SHIPS`;
    this._el.querySelector('#cc-sub').textContent = none ? 'drag to select' : `${hull}% hull`;
    this._el.querySelectorAll('.cc-btn').forEach(b => {
      b.disabled = none;
      const id = b.dataset.id, grp = b.dataset.grp;
      b.classList.toggle('on',
        (grp === 'order' && this._cmd.mode === id) ||
        (grp === 'formation' && formation === id) ||
        (grp === 'stance' && stances.size === 1 && stances.has(id)));
    });
    this._el.querySelector('#cc-form').textContent = FORMATIONS[formation]?.name || '';
    this._el.querySelector('#cc-stance').textContent = none ? ''
      : stances.size === 1 ? STANCES[[...stances][0]]?.name : 'Mixed';
  }
}
