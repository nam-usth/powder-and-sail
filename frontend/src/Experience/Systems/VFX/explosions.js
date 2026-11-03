import * as THREE from 'three';

// ── GLSL: Shared noise (fireball + explosion smoke) ───────────────
const EXPL_NOISE = /* glsl */`
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

// ── Fireball sphere shaders ───────────────────────────────────────
const BALL_VERT = EXPL_NOISE + /* glsl */`
uniform float uProgress;
uniform float uTime;
varying vec3 vN;
void main(){
  vN = normalize(position);
  float grow = 1.0 + uProgress * 3.2;
  float disp = fbm2(position * 2.5 + uTime * 2.0) * 0.42 * max(0.0, 1.0 - uProgress * 2.0);
  vec3 pos = position * (grow + disp);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

const BALL_FRAG = EXPL_NOISE + /* glsl */`
uniform float uProgress;
uniform float uTime;
varying vec3 vN;
void main(){
  float n = fbm2(vN * 2.8 - uTime * 1.8) * 0.5 + 0.5;
  float heat = n * max(0.0, 1.0 - uProgress * 1.25);
  vec3 col = vec3(0.18, 0.01, 0.0);
  col = mix(col, vec3(0.85, 0.06, 0.0),  smoothstep(0.10, 0.30, heat));
  col = mix(col, vec3(1.0,  0.38, 0.02), smoothstep(0.28, 0.52, heat));
  col = mix(col, vec3(1.0,  0.82, 0.12), smoothstep(0.50, 0.72, heat));
  col = mix(col, vec3(1.0,  0.97, 0.88), smoothstep(0.68, 0.92, heat));
  // Flash boost at ignition, then fade
  float alpha = (1.0 - smoothstep(0.0, 0.88, uProgress)) * 0.92;
  alpha *= 1.0 + smoothstep(0.0, 0.05, uProgress) * (1.0 - smoothstep(0.05, 0.28, uProgress)) * 2.0;
  gl_FragColor = vec4(col, alpha);
}`;

// ── Radial smoke shaders (billboard points, all-direction blast) ──
const RSMOKE_VERT = /* glsl */`
uniform float uProgress[4];
attribute float aRandom;attribute float aOffset;
attribute vec3 aDir;attribute float aSlot;
varying float vLife;varying float vRandom;varying float vWarm;varying float vOffset;
void main(){
  int slot=int(aSlot);
  float prog=uProgress[slot];
  float localT=max(prog-aOffset*.12,0.)/max(1.-aOffset*.12,.001);
  vLife=clamp(localT,0.,1.);vRandom=aRandom;

  // Phase 1 (0→0.35): radial blast, fast decel
  float blastEnd=.35;
  float bT=clamp(localT/blastEnd,0.,1.);
  float blastDist=2.8+aRandom*2.4;
  vec3 blastPos=aDir*blastDist*bT*(1.-.74*bT);

  // Phase 2 (0.35→1): expand + gentle rise
  float rT=max(localT-blastEnd,0.)/(1.-blastEnd);
  float riseY=rT*rT*0.9*(0.4+aRandom*.7);
  vec3 drift=aDir*(0.16+aRandom*.12)*rT*(1.-rT*.8)+vec3(0.,riseY,0.);

  vec3 pos=position+blastPos+drift;
  vWarm=max(0.,1.-vLife*2.0)*(1.-aOffset);vOffset=aOffset;

  float worldSz=mix(0.08,4.2,smoothstep(0.,.5,localT))*(1.-smoothstep(.66,1.,localT)*.3);
  vec4 mvPos=modelViewMatrix*vec4(pos,1.);
  gl_Position=projectionMatrix*mvPos;
  gl_PointSize=min(worldSz*(380./-mvPos.z),240.);
}`;

const RSMOKE_FRAG = EXPL_NOISE + /* glsl */`
uniform float uGlobalTime;
varying float vLife;varying float vRandom;varying float vWarm;varying float vOffset;
float hash2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise2(vec2 p){
  vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x),
             mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x),f.y);
}
void main(){
  vec2 uv=gl_PointCoord-.5;float d=length(uv);if(d>.5) discard;
  float dissolveNoise=noise2(uv*5.5+vLife*2.2+vRandom*3.);
  float dissolveThr=vLife*(1.3+vOffset*3.5);
  if(dissolveNoise<dissolveThr) discard;
  float rim=smoothstep(.1,.48,d);
  float n=fbm2(vec3(uv*3.5,uGlobalTime*.25+vRandom*6.))*.5+.5;
  float nEdge=1.-smoothstep(.15+n*.15,.5,d);
  float alpha=nEdge*(1.-vLife*.78)*0.32;alpha*=(1.-rim*0.55);
  float fireIntensity=smoothstep(0.,.22,1.-vLife)*vWarm;
  float bright=mix(.52,.90,n);
  vec3 cloudCol=vec3(bright*.90,bright*.88,bright*.85);
  vec3 fireCol=mix(vec3(.85,.40,.08),vec3(1.,.90,.60),n);
  vec3 col=mix(cloudCol,fireCol,fireIntensity);
  col*=mix(.55,1.0,1.-rim)+n*.15;
  col*=(1.+fireIntensity*2.2);alpha*=(1.+fireIntensity*1.4);
  gl_FragColor=vec4(col,alpha);
}`;

// ── Radial spark shaders ──────────────────────────────────────────
const RSPARK_VERT = /* glsl */`
uniform float uProgress[4];
attribute float aRandom;attribute vec3 aVel;attribute float aSlot;
varying float vLife;
void main(){
  int slot=int(aSlot);float prog=uProgress[slot];
  vLife=clamp(prog/(.45+aRandom*.25),0.,1.);
  vec3 pos=position+aVel*prog*(1.-.35*prog);
  pos.y-=prog*prog*2.2;
  vec4 mvPos=modelViewMatrix*vec4(pos,1.);
  gl_Position=projectionMatrix*mvPos;
  gl_PointSize=mix(6.,1.,vLife)*(320./-mvPos.z);
}`;

const RSPARK_FRAG = /* glsl */`
varying float vLife;
void main(){
  if(length(gl_PointCoord-.5)>.5) discard;
  float a=(1.-vLife)*(1.-vLife);
  gl_FragColor=vec4(mix(vec3(1.,.96,.80),vec3(1.,.48,.04),vLife*2.),a);
}`;

// ── ShipExplosionPool ─────────────────────────────────────────────
export class ShipExplosionPool {
  constructor(scene, shockSystem) {
    const POOL      = 4;
    const SMOKE_N   = 28;
    const SPARK_N   = 80;
    const BALL_DUR  = 0.82;
    const SMOKE_DUR = 3.0;

    this._scene     = scene;
    this._shock     = shockSystem;
    this._POOL      = POOL;
    this._SMOKE_N   = SMOKE_N;
    this._SPARK_N   = SPARK_N;
    this._BALL_DUR  = BALL_DUR;
    this._SMOKE_DUR = SMOKE_DUR;
    this._globalTime = 0;
    this._slots      = Array.from({ length: POOL }, () => ({ active: false, t: 0 }));
    this._progressArr = new Float32Array(POOL);
    this._pending    = []; // deferred shockwaves

    // Fireball sphere meshes
    this._ballGeo      = new THREE.SphereGeometry(1, 24, 16);
    this._ballUniforms = [];
    this._ballMeshes   = [];
    for (let s = 0; s < POOL; s++) {
      const u = { uProgress: { value: 0 }, uTime: { value: 0 } };
      this._ballUniforms.push(u);
      const mat = new THREE.ShaderMaterial({
        uniforms: u, vertexShader: BALL_VERT, fragmentShader: BALL_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this._ballGeo, mat);
      mesh.visible = false; mesh.frustumCulled = false;
      scene.add(mesh);
      this._ballMeshes.push(mesh);
    }

    // Flash point lights
    this._lights = [];
    for (let s = 0; s < POOL; s++) {
      const l = new THREE.PointLight(0xff8020, 0, 20);
      l.visible = false; scene.add(l);
      this._lights.push(l);
    }

    // Radial smoke (combined)
    const totalSmoke = POOL * SMOKE_N;
    this._sGeo  = new THREE.BufferGeometry();
    this._sPos  = new Float32Array(totalSmoke * 3);
    this._sDir  = new Float32Array(totalSmoke * 3);
    const sRand = new Float32Array(totalSmoke);
    const sOff  = new Float32Array(totalSmoke);
    const sSlot = new Float32Array(totalSmoke);
    for (let i = 0; i < totalSmoke; i++) {
      sRand[i] = Math.random(); sOff[i] = Math.random();
      sSlot[i] = Math.floor(i / SMOKE_N);
    }
    this._sGeo.setAttribute('position', new THREE.BufferAttribute(this._sPos, 3).setUsage(THREE.DynamicDrawUsage));
    this._sGeo.setAttribute('aRandom',  new THREE.BufferAttribute(sRand, 1));
    this._sGeo.setAttribute('aOffset',  new THREE.BufferAttribute(sOff,  1));
    this._sGeo.setAttribute('aDir',     new THREE.BufferAttribute(this._sDir, 3).setUsage(THREE.DynamicDrawUsage));
    this._sGeo.setAttribute('aSlot',    new THREE.BufferAttribute(sSlot, 1));
    this._smokeMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: this._progressArr }, uGlobalTime: { value: 0 } },
      vertexShader: RSMOKE_VERT, fragmentShader: RSMOKE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    this._smokePts = new THREE.Points(this._sGeo, this._smokeMat);
    this._smokePts.frustumCulled = false; this._smokePts.renderOrder = 997;
    scene.add(this._smokePts);

    // Radial sparks (combined)
    const totalSpark = POOL * SPARK_N;
    this._spGeo  = new THREE.BufferGeometry();
    this._spPos  = new Float32Array(totalSpark * 3);
    this._spVel  = new Float32Array(totalSpark * 3);
    const spRand = new Float32Array(totalSpark);
    const spSlot = new Float32Array(totalSpark);
    for (let i = 0; i < totalSpark; i++) {
      spRand[i] = Math.random(); spSlot[i] = Math.floor(i / SPARK_N);
    }
    this._spGeo.setAttribute('position', new THREE.BufferAttribute(this._spPos, 3).setUsage(THREE.DynamicDrawUsage));
    this._spGeo.setAttribute('aRandom',  new THREE.BufferAttribute(spRand, 1));
    this._spGeo.setAttribute('aVel',     new THREE.BufferAttribute(this._spVel, 3).setUsage(THREE.DynamicDrawUsage));
    this._spGeo.setAttribute('aSlot',    new THREE.BufferAttribute(spSlot, 1));
    this._sparkMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: this._progressArr } },
      vertexShader: RSPARK_VERT, fragmentShader: RSPARK_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this._sparkPts = new THREE.Points(this._spGeo, this._sparkMat);
    this._sparkPts.frustumCulled = false; this._sparkPts.renderOrder = 1000;
    scene.add(this._sparkPts);
  }

  spawn(x, y, z) {
    let slot = this._slots.findIndex(s => !s.active);
    if (slot === -1) {
      let maxT = -1;
      this._slots.forEach((s, i) => { if (s.t > maxT) { maxT = s.t; slot = i; } });
    }

    this._slots[slot].active = true;
    this._slots[slot].t      = 0;
    this._progressArr[slot]  = 0;

    // Fireball
    const bm = this._ballMeshes[slot];
    bm.position.set(x, y, z); bm.visible = true;
    this._ballUniforms[slot].uProgress.value = 0;
    this._ballUniforms[slot].uTime.value     = 0;

    // Flash light
    const fl = this._lights[slot];
    fl.position.set(x, y, z); fl.intensity = 0; fl.visible = true;

    // Smoke — radial hemisphere (biased upward)
    const sb = slot * this._SMOKE_N;
    for (let i = 0; i < this._SMOKE_N; i++) {
      const idx = sb + i;
      this._sPos[idx * 3] = x; this._sPos[idx * 3 + 1] = y; this._sPos[idx * 3 + 2] = z;
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.random() * Math.PI * 0.72; // hemisphere with upward bias
      const d = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.abs(Math.cos(phi)) * 0.5 + 0.1 + Math.random() * 0.4,
        Math.sin(phi) * Math.sin(theta)
      ).normalize();
      this._sDir[idx * 3] = d.x; this._sDir[idx * 3 + 1] = d.y; this._sDir[idx * 3 + 2] = d.z;
    }
    this._sGeo.attributes.position.needsUpdate = true;
    this._sGeo.attributes.aDir.needsUpdate     = true;

    // Sparks — full sphere
    const spb = slot * this._SPARK_N;
    for (let i = 0; i < this._SPARK_N; i++) {
      const idx = spb + i;
      this._spPos[idx * 3] = x; this._spPos[idx * 3 + 1] = y; this._spPos[idx * 3 + 2] = z;
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const spd   = 7.0 + Math.random() * 11.0;
      this._spVel[idx * 3]     = Math.sin(phi) * Math.cos(theta) * spd;
      this._spVel[idx * 3 + 1] = Math.abs(Math.cos(phi)) * spd + 1.5;
      this._spVel[idx * 3 + 2] = Math.sin(phi) * Math.sin(theta) * spd;
    }
    this._spGeo.attributes.position.needsUpdate = true;
    this._spGeo.attributes.aVel.needsUpdate     = true;

    // Staggered shockwaves via pending queue
    this._pending.push({ t: 0.00, x, y: y + 0.2, z, r: 7.0 });
    this._pending.push({ t: 0.08, x, y: y + 0.3, z, r: 4.5 });
    this._pending.push({ t: 0.22, x, y: y + 0.2, z, r: 3.0 });
  }

  update(dt) {
    this._globalTime += dt;
    this._smokeMat.uniforms.uGlobalTime.value = this._globalTime;

    // Deferred shockwaves
    for (let i = this._pending.length - 1; i >= 0; i--) {
      const e = this._pending[i];
      e.t -= dt;
      if (e.t <= 0) { this._shock.spawn(e.x, e.y, e.z, e.r); this._pending.splice(i, 1); }
    }

    for (let s = 0; s < this._POOL; s++) {
      const sl = this._slots[s];
      if (!sl.active) continue;
      sl.t += dt;
      const bp = sl.t / this._BALL_DUR;
      this._ballUniforms[s].uProgress.value = Math.min(bp, 1.0);
      this._ballUniforms[s].uTime.value     = sl.t;
      this._progressArr[s] = sl.t / this._SMOKE_DUR;

      // Light: ramp 0→peak at 5%, fade to 0 at 45%
      const ramp = bp < 0.05 ? bp / 0.05 : Math.max(0, 1 - (bp - 0.05) / 0.40);
      this._lights[s].intensity = ramp * 20;

      if (bp >= 1.0) {
        this._ballMeshes[s].visible = false;
        this._lights[s].visible = false; this._lights[s].intensity = 0;
      }
      if (sl.t / this._SMOKE_DUR >= 1.0) { sl.active = false; this._progressArr[s] = 999; }
    }
  }

  destroy() {
    this._ballMeshes.forEach(m => { this._scene.remove(m); m.material.dispose(); });
    this._lights.forEach(l => this._scene.remove(l));
    this._scene.remove(this._smokePts); this._scene.remove(this._sparkPts);
    this._ballGeo.dispose(); this._sGeo.dispose(); this._spGeo.dispose();
    this._smokeMat.dispose(); this._sparkMat.dispose();
  }
}

// ── GLSL: Shockwave ring ──────────────────────────────────────────
const SHOCK_VERT = /* glsl */`
  uniform float uProgress;
  uniform float uRadius;

  void main() {
    vec3 pos = position;
    float scale = uProgress * uRadius;
    pos.xz *= scale;
    pos.y   = 0.3 * (1.0 - uProgress);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const SHOCK_FRAG = /* glsl */`
  uniform float uProgress;

  void main() {
    float alpha = (1.0 - uProgress) * 0.60;
    vec3  col   = mix(vec3(1.0, 0.7, 0.3), vec3(0.9, 0.9, 1.0), uProgress);
    gl_FragColor = vec4(col, alpha);
  }
`;

// ── ShockwaveSystem — expanding ring burst on explosion ───────────
export class ShockwaveSystem {
  constructor(scene) {
    this._scene  = scene;
    this._active = [];
    this._geo    = new THREE.TorusGeometry(1, 0.04, 6, 32);
    this._geo.rotateX(Math.PI / 2);
  }

  spawn(x, y, z, radius = 5.0) {
    const mat = new THREE.ShaderMaterial({
      vertexShader:   SHOCK_VERT,
      fragmentShader: SHOCK_FRAG,
      uniforms: {
        uProgress: { value: 0 },
        uRadius:   { value: radius },
      },
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
      side:        THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this._geo, mat);
    mesh.position.set(x, y, z);
    this._scene.add(mesh);
    this._active.push({ mesh, mat, timer: 0, duration: 0.55 });
  }

  update(dt) {
    for (let i = this._active.length - 1; i >= 0; i--) {
      const s = this._active[i];
      s.timer += dt;
      const p = Math.min(s.timer / s.duration, 1.0);
      s.mat.uniforms.uProgress.value = p;
      if (p >= 1.0) {
        this._scene.remove(s.mesh);
        s.mat.dispose();
        this._active.splice(i, 1);
      }
    }
  }

  destroy() {
    this._geo.dispose();
    for (const s of this._active) {
      this._scene.remove(s.mesh);
      s.mat.dispose();
    }
  }
}

// ── WaterRippleSystem — flat expanding rings on water surface ─────
export class WaterRippleSystem {
  constructor(scene) {
    this._scene  = scene;
    this._active = [];
    this._geo    = new THREE.RingGeometry(0.88, 1.0, 36);
    this._geo.rotateX(-Math.PI / 2);
  }

  spawn(x, z, count = 2) {
    for (let i = 0; i < count; i++) {
      const delay    = i * 0.18;
      const maxScale = 2.8 + Math.random() * 2.0 + i * 1.2;
      const duration = 0.70 + Math.random() * 0.25;
      const mat = new THREE.MeshBasicMaterial({
        color:       0xaaddff,
        transparent: true,
        depthWrite:  false,
        depthTest:   false,
        fog:         false,
        blending:    THREE.AdditiveBlending,
        side:        THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this._geo, mat);
      mesh.position.set(x, 0.05, z);
      mesh.scale.setScalar(0.1);
      mesh.renderOrder = 11;
      mesh.visible = false;
      this._scene.add(mesh);
      this._active.push({ mesh, mat, timer: -delay, duration, maxScale });
    }
  }

  update(dt) {
    for (let i = this._active.length - 1; i >= 0; i--) {
      const r = this._active[i];
      r.timer += dt;
      if (r.timer < 0) continue;
      r.mesh.visible = true;
      const p = Math.min(r.timer / r.duration, 1.0);
      if (p >= 1.0) {
        this._scene.remove(r.mesh);
        r.mat.dispose();
        this._active.splice(i, 1);
        continue;
      }
      const scale = r.maxScale * (1 - Math.pow(1 - p, 2.5));
      r.mesh.scale.setScalar(Math.max(0.1, scale));
      r.mat.opacity = (1 - p) * (1 - p) * 0.55;
    }
  }

  destroy() {
    this._geo.dispose();
    this._active.forEach(r => { this._scene.remove(r.mesh); r.mat.dispose(); });
  }
}
