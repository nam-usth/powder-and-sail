import { TECH_TREE } from '../../data/upgrades.js';
import { CANNON_BY_ID, ROMAN_TIER } from '../../data/cannons.js';
import { T } from '../../i18n.js';

import { PanelManager } from './PanelManager.js';

/** Localised tech name / description / branch title (EN source in data/upgrades.js). */
export const techName = t => T.techNames?.[t.id] || t.nm;
const techDesc = t => t.cannon
  ? (T.techGunDesc ? T.techGunDesc(CANNON_BY_ID.get(t.cannon)?.nm || t.cannon, ROMAN_TIER[t.tier] || t.tier) : t.desc)
  : (T.techDescs?.[t.id] || t.desc);
const branchName = br => T.techBranches?.[br] || br;

export class ResearchPanel {
  constructor(state,research,bus){
    this._state=state; this._research=research; this._bus=bus;
    const rp=document.getElementById('rp'); const closeBtn=rp ? rp.querySelector('.px') : null;
    if(closeBtn) closeBtn.addEventListener('click',()=>this.close());
    if(typeof window!=='undefined') window.addEventListener('iow:langchange',()=>{ if(PanelManager.isOpen('rp')) this._render(); });
  }
  toggle(){ PanelManager.isOpen('rp') ? this.close() : this.open(); }
  open(){ PanelManager.open('rp'); this._render && this._render(); }
  close(){ PanelManager.close('rp'); }
  _render(){
    const el=document.getElementById('rp-content'); if(!el)return; el.innerHTML='';
    const st=this._state;
    // Cannon research applies in the harbor / Sea Battle only — Open War guns are unrestricted.
    const gunnery = st.mode==='harbor' || st.mode==='battle';
    const tree = TECH_TREE.filter(t => gunnery || t.br !== 'Gunnery');
    const branches=[...new Set(tree.map(t=>t.br))];
    branches.forEach(br=>{
      const div=document.createElement('div');div.className=`tech-branch br-${br.toLowerCase()}`;
      const note=T.techBranchNote?.[br];
      div.innerHTML=`<div class="tbr-title">${branchName(br).toUpperCase()}</div>${note?`<div class="tbr-note">${note}</div>`:''}`;
      tree.filter(t=>t.br===br).forEach(tech=>{
        const done=st.researched.has(tech.id),reqs=tech.req.every(r=>st.researched.has(r));
        const cW=tech.cost.wood||0,cG=tech.cost.gold||0,afford=st.resWood>=cW&&st.resGold>=cG;
        // L3: check lab level requirement
        const labOk=!tech.requiredLabLevel||(st.labLevel>=tech.requiredLabLevel);
        const avail=reqs&&!done&&afford&&labOk;
        const nd=document.createElement('div');nd.className=`tnode ${done?'done':avail?'avail':'locked'}${tech.cannon?' tgun':''}`;
        nd.dataset.tech=tech.id;
        const labLockMsg=(!done&&!labOk&&tech.requiredLabLevel)?(T.techLab?T.techLab(tech.requiredLabLevel):`🔒 Lab Lv${tech.requiredLabLevel}`):'';
        const missing=tech.req.filter(r=>!st.researched.has(r)).map(r=>TECH_TREE.find(x=>x.id===r)).filter(Boolean);
        const reqMsg=(!done&&missing.length&&T.techNeeds)?T.techNeeds(missing.map(techName).join(', ')):'';
        const tier=tech.cannon?`<span class="ttier">${ROMAN_TIER[tech.tier]||''}</span>`:'';
        const dsc=[techDesc(tech), reqMsg].filter(Boolean).join(' · ');
        nd.innerHTML=`<span class="tico">${tech.icon}</span><div><div class="tnm">${techName(tech)}${tier}</div><div class="tdsc">${dsc}</div></div><span class="tcost">${done?'✓':labLockMsg||[cW?`🪵${cW}`:'',cG?`🪙${cG}`:''].filter(Boolean).join(' ')}</span>`;
        if(avail)nd.onclick=()=>{if(this._research.research(tech)){this._render();}};
        div.appendChild(nd);
      });
      el.appendChild(div);
    });
  }
}
