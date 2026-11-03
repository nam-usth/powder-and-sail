import * as THREE from 'three';

// ── GLSL: Simplex noise + FBM (shared by cone, smoke, sparks) ────
const MFLASH_NOISE = /* glsl */`
vec3 _m3(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 _m4(vec4 x){return x-floor(x*(1./289.))*289.;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;
  vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=_m3(i);
  vec4 p=_m4(_m4(_m4(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 nm=1.79284291-0.85373472*vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3));
  p0*=nm.x;p1*=nm.y;p2*=nm.z;p3*=nm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm2(vec3 p){return snoise(p)*.5+snoise(p*2.1+vec3(1.7,9.2,5.5))*.25;}
`;

// ── GLSL: Cone ────────────────────────────────────────────────────
const MFLASH_CONE_VERT = MFLASH_NOISE + /* glsl */`
uniform vec4 uFlashData;
varying vec2 vUv;
void main(){
  vUv=uv;
  float prog=uFlashData.x,spread=uFlashData.y,t=uFlashData.z;
  vec3 pos=position;
  float axial=uv.x;
  pos.y=(uv.y-.5)*axial*spread*2.;
  pos.y+=snoise(vec3(axial*4.,t*6.,uv.y*3.))*axial*(1.-axial)*.5;
  pos.x+=snoise(vec3(t*8.,axial*2.,0.))*.07*axial;
  pos*=1.-prog*.28;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.);
}`;

const MFLASH_CONE_FRAG = MFLASH_NOISE + /* glsl */`
uniform vec4 uFlashData;
varying vec2 vUv;
void main(){
  float prog=uFlashData.x,t=uFlashData.z;
  float axial=vUv.x,crossN=abs(vUv.y-.5)*2.;
  float cone=1.-smoothstep(.5,1.,crossN/max(axial,.01));
  float tip=1.-smoothstep(.75,1.,axial);
  float f=fbm2(vec3(axial*2.5-t*4.,(vUv.y-.5)*3.,t*1.5))*.5+.5;
  float flame=cone*tip*(f*.7+.3);
  flame*=1.-smoothstep(.3,1.,prog);
  flame*=1.+smoothstep(0.,.08,prog)*(1.-smoothstep(.08,.28,prog))*1.4;
  if(flame<.02) discard;
  float heat=flame*(1.-axial*.4)*(1.-crossN*.6);
  vec3 col=vec3(.28,.015,.0);
  col=mix(col,vec3(.83,.07,.0), smoothstep(.12,.32,heat));
  col=mix(col,vec3(1.,.40,.03), smoothstep(.30,.55,heat));
  col=mix(col,vec3(1.,.84,.14), smoothstep(.52,.74,heat));
  col=mix(col,vec3(1.,.97,.88), smoothstep(.72,.92,heat));
  col=mix(col,vec3(1.,.97,.88), (1.-smoothstep(0.,.18,axial))*.9);
  gl_FragColor=vec4(col,flame*.93);
}`;

// ── GLSL: Smoke particles ─────────────────────────────────────────
const MFLASH_SMOKE_VERT = /* glsl */`
uniform float uProgress[4];
attribute float aRandom;attribute float aOffset;
attribute vec3 aDir;attribute float aSlot;
varying float vLife;varying float vRandom;varying float vWarm;varying float vOffset;
void main(){
  int slot=int(aSlot);
  float prog=uProgress[slot];
  float localT=max(prog-aOffset*.12,0.)/max(1.-aOffset*.12,.001);
  vLife=clamp(localT,0.,1.);vRandom=aRandom;

  // Phase 1 (0→0.40): horizontal blast, fast decel
  float blastEnd=.40;
  float bT=clamp(localT/blastEnd,0.,1.);
  float blastDist=(2.2+aRandom*1.0);
  vec3 perpJitter=vec3(-aDir.z,0.,aDir.x)*(aRandom-.5)*blastDist*.35;
  vec3 blastPos=aDir*blastDist*bT*(1.-.78*bT)+perpJitter*bT*(1.-.78*bT);

  // Phase 2 (0.40→1): puff expands + gentle rise
  float rT=max(localT-blastEnd,0.)/(1.-blastEnd);
  float riseY=rT*rT*0.5*(0.5+aRandom*.4);
  vec3 drift=aDir*(0.15+aRandom*.1)*rT*(1.-rT*.8)+vec3(0.,riseY,0.);

  vec3 pos=position+blastPos+drift;

  vWarm=max(0.,1.-vLife*2.5)*(1.-aOffset);vOffset=aOffset;

  float worldSz=mix(0.04,1.8,smoothstep(0.,.5,localT))*(1.-smoothstep(.72,1.,localT)*.25);
  vec4 mvPos=modelViewMatrix*vec4(pos,1.);
  gl_Position=projectionMatrix*mvPos;
  float projSz=worldSz*(380./-mvPos.z);gl_PointSize=min(projSz,180.);
}`;

const MFLASH_SMOKE_FRAG = MFLASH_NOISE + /* glsl */`
uniform float uGlobalTime;
varying float vLife;varying float vRandom;varying float vWarm;varying float vOffset;
float hash2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise2(vec2 p){
  vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x),
             mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x),f.y);
}
void main(){
  vec2 uv=gl_PointCoord-.5;
  float d=length(uv);
  if(d>.5) discard;
  // Noise dissolve: late-life puffs erode from edges inward
  float dissolveNoise=noise2(uv*5.5+vLife*2.2+vRandom*3.);
  float dissolveThr=vLife*(1.3+vOffset*3.5);
  if(dissolveNoise<dissolveThr) discard;
  // Fresnel-style rim on billboard
  float rim=smoothstep(.1,.48,d);
  // FBM cloud texture → cauliflower silhouette
  float n=fbm2(vec3(uv*3.5,uGlobalTime*.25+vRandom*6.))*.5+.5;
  float nEdge=1.-smoothstep(.15+n*.15,.5,d);
  float alpha=nEdge*(1.-vLife*.78)*0.30;
  alpha*=(1.-rim*0.55);
  // Fire-to-smoke colour transition
  float fireIntensity=smoothstep(0.,.22,1.-vLife)*vWarm;
  float bright=mix(.52,.90,n);
  vec3 cloudCol=vec3(bright*.90,bright*.88,bright*.85);
  vec3 fireCol=mix(vec3(.85,.40,.08),vec3(1.,.90,.60),n);
  vec3 col=mix(cloudCol,fireCol,fireIntensity);
  float lighting=mix(0.55,1.0,1.-rim)+n*.15;
  col*=lighting;
  // Emissive boost for fire phase — makes hot smoke glow
  col*=(1.+fireIntensity*2.2);
  alpha*=(1.+fireIntensity*1.4);
  gl_FragColor=vec4(col,alpha);
}`;

// ── GLSL: Spark particles ─────────────────────────────────────────
const MFLASH_SPARK_VERT = /* glsl */`
uniform float uProgress[4];
attribute float aRandom;attribute vec3 aVel;attribute float aSlot;
varying float vLife;
void main(){
  int slot=int(aSlot);
  float prog=uProgress[slot];
  vLife=clamp(prog/(.32+aRandom*.18),0.,1.);
  vec3 pos=position+aVel*prog*(1.-.4*prog);
  pos.y-=prog*prog*1.8;
  vec4 mvPos=modelViewMatrix*vec4(pos,1.);
  gl_Position=projectionMatrix*mvPos;
  gl_PointSize=mix(4.,1.,vLife)*(320./-mvPos.z);
}`;

const MFLASH_SPARK_FRAG = /* glsl */`
varying float vLife;
void main(){
  if(length(gl_PointCoord-.5)>.5) discard;
  float a=(1.-vLife)*(1.-vLife);
  gl_FragColor=vec4(mix(vec3(1.,.96,.80),vec3(1.,.48,.04),vLife*2.),a);
}`;

// ── MuzzleFlashPool — shader cone + smoke + sparks (4 slots) ─────
export class MuzzleFlashPool {
  constructor(scene) {
    const POOL      = 4;
    const SMOKE_N   = 20;
    const SPARK_N   = 50;
    const DUR       = 0.52;
    const SMOKE_DUR = 2.2;

    this._scene     = scene;
    this._DUR       = DUR;
    this._SMOKE_DUR = SMOKE_DUR;
    this._SMOKE_N   = SMOKE_N;
    this._SPARK_N   = SPARK_N;
    this._globalTime  = 0;
    this._slots       = Array.from({ length: POOL }, () => ({ active: false, t: 0, progress: 0 }));
    this._progressArr = new Float32Array(POOL);

    // Cone meshes (one per slot)
    this._coneGeo = new THREE.PlaneGeometry(1, 1, 16, 8);
    this._coneGeo.translate(0.5, 0, 0);
    this._coneUniforms = [];
    this._coneMeshes   = [];
    for (let s = 0; s < POOL; s++) {
      const u = { uFlashData: { value: new THREE.Vector4(0, 0.48, 0, 0) } };
      this._coneUniforms.push(u);
      const mat  = new THREE.ShaderMaterial({
        uniforms:       u,
        vertexShader:   MFLASH_CONE_VERT,
        fragmentShader: MFLASH_CONE_FRAG,
        transparent:    true,
        depthWrite:     false,
        side:           THREE.DoubleSide,
        blending:       THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this._coneGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 999;
      scene.add(mesh);
      this._coneMeshes.push(mesh);
    }

    // Smoke points (all slots combined)
    const totalSmoke = POOL * SMOKE_N;
    this._sGeo  = new THREE.BufferGeometry();
    this._sPos  = new Float32Array(totalSmoke * 3);
    this._sRand = new Float32Array(totalSmoke);
    this._sOff  = new Float32Array(totalSmoke);
    this._sDir  = new Float32Array(totalSmoke * 3);
    this._sSlot = new Float32Array(totalSmoke);
    for (let i = 0; i < totalSmoke; i++) {
      this._sRand[i] = Math.random();
      this._sOff[i]  = Math.random();
      this._sSlot[i] = Math.floor(i / SMOKE_N);
    }
    this._sGeo.setAttribute('position', new THREE.BufferAttribute(this._sPos,  3).setUsage(THREE.DynamicDrawUsage));
    this._sGeo.setAttribute('aRandom',  new THREE.BufferAttribute(this._sRand, 1));
    this._sGeo.setAttribute('aOffset',  new THREE.BufferAttribute(this._sOff,  1));
    this._sGeo.setAttribute('aDir',     new THREE.BufferAttribute(this._sDir,  3).setUsage(THREE.DynamicDrawUsage));
    this._sGeo.setAttribute('aSlot',    new THREE.BufferAttribute(this._sSlot, 1));
    this._smokeMat = new THREE.ShaderMaterial({
      uniforms:       { uProgress: { value: this._progressArr }, uGlobalTime: { value: 0 } },
      vertexShader:   MFLASH_SMOKE_VERT,
      fragmentShader: MFLASH_SMOKE_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.NormalBlending,
    });
    this._smokePts = new THREE.Points(this._sGeo, this._smokeMat);
    this._smokePts.renderOrder   = 997;
    this._smokePts.frustumCulled = false;
    scene.add(this._smokePts);

    // Spark points (all slots combined)
    const totalSpark = POOL * SPARK_N;
    this._spGeo  = new THREE.BufferGeometry();
    this._spPos  = new Float32Array(totalSpark * 3);
    this._spRand = new Float32Array(totalSpark);
    this._spVel  = new Float32Array(totalSpark * 3);
    this._spSlot = new Float32Array(totalSpark);
    for (let i = 0; i < totalSpark; i++) {
      this._spRand[i] = Math.random();
      this._spSlot[i] = Math.floor(i / SPARK_N);
    }
    this._spGeo.setAttribute('position', new THREE.BufferAttribute(this._spPos,  3).setUsage(THREE.DynamicDrawUsage));
    this._spGeo.setAttribute('aRandom',  new THREE.BufferAttribute(this._spRand, 1));
    this._spGeo.setAttribute('aVel',     new THREE.BufferAttribute(this._spVel,  3).setUsage(THREE.DynamicDrawUsage));
    this._spGeo.setAttribute('aSlot',    new THREE.BufferAttribute(this._spSlot, 1));
    this._sparkMat = new THREE.ShaderMaterial({
      uniforms:       { uProgress: { value: this._progressArr } },
      vertexShader:   MFLASH_SPARK_VERT,
      fragmentShader: MFLASH_SPARK_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });
    this._sparkPts = new THREE.Points(this._spGeo, this._sparkMat);
    this._sparkPts.renderOrder   = 1000;
    this._sparkPts.frustumCulled = false;
    scene.add(this._sparkPts);

    // Muzzle flash point lights (one per slot)
    this._flashLights = [];
    for (let s = 0; s < POOL; s++) {
      const light = new THREE.PointLight(0xff7020, 0, 10);
      light.visible = false;
      scene.add(light);
      this._flashLights.push(light);
    }
  }

  fire(opts = {}) {
    let slot = this._slots.findIndex(s => !s.active);
    if (slot === -1) {
      let maxT = -1;
      this._slots.forEach((s, i) => { if (s.t > maxT) { maxT = s.t; slot = i; } });
    }

    const pos    = opts.position  || new THREE.Vector3();
    const rawDir = opts.direction ? opts.direction.clone() : new THREE.Vector3(0, 0, 1);
    rawDir.y = 0;
    if (rawDir.lengthSq() < 0.0001) rawDir.set(0, 0, 1);
    rawDir.normalize();
    const len    = opts.length    || 2.8;
    const spread = opts.spread    || 0.48;
    const quat   = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), rawDir);

    this._slots[slot].active   = true;
    this._slots[slot].t        = 0;
    this._slots[slot].progress = 0;
    this._progressArr[slot]    = 0;

    const cm = this._coneMeshes[slot];
    cm.position.copy(pos);
    cm.quaternion.copy(quat);
    cm.scale.setScalar(len);
    cm.visible = true;
    this._coneUniforms[slot].uFlashData.value.set(0, spread, 0, 0);

    const fl = this._flashLights[slot];
    fl.position.copy(pos);
    fl.intensity = 0;
    fl.visible = true;

    // Smoke: all particles start at muzzle tip, horizontal cone spread
    const sb = slot * this._SMOKE_N;
    for (let i = 0; i < this._SMOKE_N; i++) {
      const idx = sb + i;
      this._sPos[idx * 3]     = pos.x;
      this._sPos[idx * 3 + 1] = pos.y;
      this._sPos[idx * 3 + 2] = pos.z;
      const ang = (Math.random() - 0.5) * spread * 2.2;
      const d = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)).applyQuaternion(quat);
      this._sDir[idx * 3]     = d.x;
      this._sDir[idx * 3 + 1] = d.y;
      this._sDir[idx * 3 + 2] = d.z;
    }
    this._sGeo.attributes.position.needsUpdate = true;
    this._sGeo.attributes.aDir.needsUpdate     = true;

    const spb  = slot * this._SPARK_N;
    const half = spread * 0.6;
    for (let i = 0; i < this._SPARK_N; i++) {
      const idx = spb + i;
      this._spPos[idx * 3] = pos.x; this._spPos[idx * 3 + 1] = pos.y; this._spPos[idx * 3 + 2] = pos.z;
      const ang  = (Math.random() - 0.5) * half * 2;
      const elev = (Math.random() - 0.5) * half * 0.4;
      const spd  = 6.0 + Math.random() * 8.0;
      const v = new THREE.Vector3(
        Math.cos(ang) * Math.cos(elev), Math.sin(elev), Math.sin(ang) * Math.cos(elev)
      ).applyQuaternion(quat).multiplyScalar(spd);
      this._spVel[idx * 3] = v.x; this._spVel[idx * 3 + 1] = v.y; this._spVel[idx * 3 + 2] = v.z;
    }
    this._spGeo.attributes.position.needsUpdate = true;
    this._spGeo.attributes.aVel.needsUpdate     = true;
  }

  update(dt) {
    this._globalTime += dt;
    this._smokeMat.uniforms.uGlobalTime.value = this._globalTime;
    for (let s = 0; s < this._slots.length; s++) {
      const sl = this._slots[s];
      if (!sl.active) continue;
      sl.t        += dt;
      sl.progress  = sl.t / this._DUR;
      this._coneUniforms[s].uFlashData.value.x = sl.progress;
      this._coneUniforms[s].uFlashData.value.z = sl.t;
      this._progressArr[s] = sl.t / this._SMOKE_DUR;
      // Flash light: ramp 0→peak at prog 0.08, fade to 0 at prog 0.55
      const p = sl.progress;
      const ramp = p < 0.08 ? p / 0.08 : Math.max(0, 1 - (p - 0.08) / 0.47);
      this._flashLights[s].intensity = ramp * 8;
      if (sl.progress >= 1.0) { this._coneMeshes[s].visible = false; this._flashLights[s].visible = false; this._flashLights[s].intensity = 0; }
      if (sl.t / this._SMOKE_DUR >= 1.0) { sl.active = false; this._progressArr[s] = 999; }
    }
  }

  destroy() {
    this._coneMeshes.forEach(c => { this._scene.remove(c); c.material.dispose(); });
    this._flashLights.forEach(l => this._scene.remove(l));
    this._scene.remove(this._smokePts);
    this._scene.remove(this._sparkPts);
    this._coneGeo.dispose();
    this._sGeo.dispose();
    this._spGeo.dispose();
    this._smokeMat.dispose();
    this._sparkMat.dispose();
  }
}
