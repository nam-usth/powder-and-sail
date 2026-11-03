import * as THREE from 'three';
export class VisionSystem {
  constructor(scene,state){ this._scene=scene; this._state=state; this._grp=null; }
  rebuild(){
    if(this._grp){this._scene.remove(this._grp);this._grp=null;}
    const st=this._state, R=st.getVisionR(), grp=new THREE.Group();
    const STEPS=80,DASH=5,GAP=2; let pts=[];
    for(let i=0;i<=STEPS;i++){
      const seg=i%(DASH+GAP),a=(i/STEPS)*Math.PI*2;
      if(seg<DASH){pts.push(new THREE.Vector3(Math.sin(a)*R,.42,Math.cos(a)*R));}
      else if(pts.length>1){grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([...pts]),new THREE.LineBasicMaterial({color:0x00aacc,opacity:.5,transparent:true})));pts=[];}
    }
    if(pts.length>1)grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([...pts]),new THREE.LineBasicMaterial({color:0x00aacc,opacity:.5,transparent:true})));
    this._scene.add(grp); this._grp=grp;
  }
  follow(leader){ if(this._grp&&leader)this._grp.position.set(leader.x,0,leader.z); }
}
