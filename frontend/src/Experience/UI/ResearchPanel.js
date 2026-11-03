import { TECH_TREE } from '../../data/upgrades.js';

import { PanelManager } from './PanelManager.js';
export class ResearchPanel {
  constructor(state,research,bus){ this._state=state; this._research=research; this._bus=bus; const rp=document.getElementById('rp'); const closeBtn=rp ? rp.querySelector('.px') : null; if(closeBtn) closeBtn.addEventListener('click',()=>this.close()); }
  toggle(){ PanelManager.isOpen('rp') ? this.close() : this.open(); }
  open(){ PanelManager.open('rp'); this._render && this._render(); }
  close(){ PanelManager.close('rp'); }
  _render(){
    const el=document.getElementById('rp-content'); if(!el)return; el.innerHTML='';
    const st=this._state, branches=[...new Set(TECH_TREE.map(t=>t.br))];
    branches.forEach(br=>{
      const div=document.createElement('div');div.className='tech-branch';div.innerHTML=`<div class="tbr-title">${br.toUpperCase()}</div>`;
      TECH_TREE.filter(t=>t.br===br).forEach(tech=>{
        const done=st.researched.has(tech.id),reqs=tech.req.every(r=>st.researched.has(r));
        const cW=tech.cost.wood||0,cG=tech.cost.gold||0,afford=st.resWood>=cW&&st.resGold>=cG;
        // L3: check lab level requirement
        const labOk=!tech.requiredLabLevel||(st.labLevel>=tech.requiredLabLevel);
        const avail=reqs&&!done&&afford&&labOk;
        const nd=document.createElement('div');nd.className=`tnode ${done?'done':avail?'avail':'locked'}`;
        const labLockMsg=(!labOk&&tech.requiredLabLevel)?`🔒 Lab Lv${tech.requiredLabLevel}`:''
      nd.innerHTML=`<span class="tico">${tech.icon}</span><div><div class="tnm">${tech.nm}</div><div class="tdsc">${labLockMsg||tech.desc}</div></div><span class="tcost">${done?'✓':labLockMsg||[cW?`🪵${cW}`:'',cG?`🪙${cG}`:''].filter(Boolean).join(' ')}</span>`;
        if(avail)nd.onclick=()=>{if(this._research.research(tech)){this._render();}};
        div.appendChild(nd);
      });
      el.appendChild(div);
    });
  }
}
