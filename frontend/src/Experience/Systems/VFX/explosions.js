import * as THREE from 'three';

// ── Explosions ─────────────────────────────────────────────────────
// FireballPool keeps the noise-displaced fireball sphere (4 recycled slots,
// materials created once). Everything around it — smoke column, sparks,
// debris, shock ring, light — now lives in the shared fields (recipes.js),
// so an explosion no longer allocates meshes/materials or toggles lights.
//
// ShockwaveSystem / WaterRippleSystem survive as thin adapters over the
// instanced WaterDecalField (same spawn signatures as before).

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

const BALL_VERT = EXPL_NOISE + /* glsl */`
uniform float uProgress;
uniform float uTime;
uniform float uScale;
varying vec3 vN;
void main(){
  vN = normalize(position);
  float grow = 1.0 + uProgress * 3.0;
  float disp = fbm2(position * 2.5 + uTime * 2.0) * 0.42 * max(0.0, 1.0 - uProgress * 2.0);
  vec3 pos = position * (grow + disp) * uScale;
  pos.y += uProgress * uProgress * 1.6 * uScale;   // the ball lifts as it burns out
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
  float alpha = (1.0 - smoothstep(0.0, 0.88, uProgress)) * 0.92;
  alpha *= 1.0 + smoothstep(0.0, 0.05, uProgress) * (1.0 - smoothstep(0.05, 0.28, uProgress)) * 2.0;
  gl_FragColor = vec4(col, alpha);
}`;

/** Recycled fireball spheres (ship explosions, magazine blasts). */
export class FireballPool {
  constructor(scene, slots = 4) {
    this._scene = scene;
    this._geo = new THREE.SphereGeometry(1, 24, 16);
    this._slots = [];
    for (let s = 0; s < slots; s++) {
      const u = { uProgress: { value: 0 }, uTime: { value: 0 }, uScale: { value: 1 } };
      const mat = new THREE.ShaderMaterial({
        uniforms: u, vertexShader: BALL_VERT, fragmentShader: BALL_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this._geo, mat);
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 25;
      scene.add(mesh);
      this._slots.push({ mesh, u, t: 0, dur: 0.82, delay: 0, active: false });
    }
  }

  /** @param {number} delay seconds before ignition */
  spawn(x, y, z, scale = 1, delay = 0, dur = 0.82) {
    let slot = this._slots.find(s => !s.active);
    if (!slot) slot = this._slots.reduce((a, b) => (b.t > a.t ? b : a));
    slot.active = true; slot.t = -delay; slot.dur = dur;
    slot.mesh.position.set(x, y, z);
    slot.u.uScale.value = scale;
    slot.u.uProgress.value = 0;
    slot.mesh.visible = false;
  }

  update(dt) {
    for (const s of this._slots) {
      if (!s.active) continue;
      s.t += dt;
      if (s.t < 0) continue;
      const p = s.t / s.dur;
      s.mesh.visible = p < 1;
      s.u.uProgress.value = Math.min(p, 1);
      s.u.uTime.value = s.t;
      if (p >= 1) s.active = false;
    }
  }

  destroy() {
    this._slots.forEach(s => { this._scene.remove(s.mesh); s.mesh.material.dispose(); });
    this._geo.dispose();
  }
}

/** @deprecated compatibility name; explosions are composed in recipes.js. */
export const ShipExplosionPool = FireballPool;

/** Adapter: expanding hot shock ring on the water (instanced decal). */
export class ShockwaveSystem {
  constructor(_scene, decals) { this._decals = decals; }
  spawn(x, y, z, radius = 5.0) { this._decals?.emit(x, Math.min(y, 0.3), z, 2, 0.3, radius, 0.55, 0.9); }
  update() {}
  destroy() {}
}

/** Adapter: flat expanding ripple rings on the water (instanced decal). */
export class WaterRippleSystem {
  constructor(_scene, decals) { this._decals = decals; }
  spawn(x, z, count = 2) {
    for (let i = 0; i < count; i++) {
      this._decals?.emit(x, 0.06, z, 0, 0.2, 2.8 + Math.random() * 2 + i * 1.2, 0.8 + Math.random() * 0.3, 0.8, 0.07, i * 0.18);
    }
  }
  update() {}
  destroy() {}
}
