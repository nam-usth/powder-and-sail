import * as THREE from 'three';

// ── GLSL: Simplex noise shared by fire + smoke shaders ────────────
const P_NOISE = /* glsl */`
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

// ── GLSL: Flame shaders ───────────────────────────────────────────
const FIRE_VERT = /* glsl */`
  attribute float aLifeFrac;
  attribute float aSize;
  attribute float aRand;

  varying float vLifeFrac;
  varying float vRand;

  void main() {
    vLifeFrac = aLifeFrac;
    vRand     = aRand;

    float rise    = aLifeFrac * 2.8;
    float flicker = sin(aRand * 6.28318 + aLifeFrac * 14.0) * (1.0 - aLifeFrac) * 0.38;
    float drift   = cos(aRand * 3.14159 + aLifeFrac *  7.0) * 0.14;

    vec3 pos = position;
    pos.y += rise;
    pos.x += flicker + drift;
    pos.z += drift * 0.6;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    float sz = aSize * (1.0 - aLifeFrac * 0.55) * (280.0 / -mvPos.z);
    gl_PointSize = sz;
    gl_Position  = projectionMatrix * mvPos;
  }
`;

const FIRE_FRAG = P_NOISE + /* glsl */`
  varying float vLifeFrac;
  varying float vRand;

  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;

    float taper  = clamp(uv.y * 0.5 + 0.5, 0.0, 1.0);
    float wScale = mix(0.28, 1.0, taper);
    float nx     = uv.x / wScale;
    float wobble = sin(uv.y * 5.0 + vRand * 6.28318 + vLifeFrac * 11.0) * 0.16;

    // Noise warps the flame edge organically (1 octave, cheap)
    float n = snoise(vec3(uv * 2.0, vRand * 4.5 + vLifeFrac * 2.5)) * 0.5 + 0.5;
    float r = nx * nx + uv.y * uv.y * 0.28 + wobble * wobble;
    float rEdge = 0.80 + n * 0.22;
    if (r > rEdge) discard;

    float soft = 1.0 - smoothstep(0.36 + n * 0.14, rEdge, r);

    float t = vLifeFrac;
    vec3 col;
    if (t < 0.15)
      col = mix(vec3(1.00, 1.00, 0.95), vec3(1.00, 0.90, 0.20), t / 0.15);
    else if (t < 0.40)
      col = mix(vec3(1.00, 0.82, 0.08), vec3(1.00, 0.35, 0.02), (t - 0.15) / 0.25);
    else if (t < 0.70)
      col = mix(vec3(0.95, 0.28, 0.01), vec3(0.50, 0.06, 0.01), (t - 0.40) / 0.30);
    else
      col = mix(vec3(0.42, 0.05, 0.01), vec3(0.10, 0.04, 0.03), (t - 0.70) / 0.30);

    col = mix(col * 1.38, col, smoothstep(0.0, 0.55, length(uv)));
    col *= (0.78 + n * 0.44); // noise-modulated brightness variation
    float alpha = soft * (1.0 - t * t) * 0.88;
    gl_FragColor = vec4(col, alpha);
  }
`;

// ── GLSL: Smoke shaders ───────────────────────────────────────────
const SMOKE_VERT = /* glsl */`
  attribute float aLifeFrac;
  attribute float aSize;
  attribute float aRand;

  varying float vLifeFrac;
  varying float vRand;

  void main() {
    vLifeFrac = aLifeFrac;
    vRand     = aRand;

    vec3 pos = position;
    float wind = aRand * 0.8 - 0.4;
    pos.y += aLifeFrac * 3.5;
    pos.x += wind * aLifeFrac * 1.5;
    pos.z += (aRand - 0.5) * aLifeFrac * 0.8;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    float sz = aSize * (0.4 + aLifeFrac * 1.6);
    gl_PointSize = sz * (280.0 / -mvPos.z);
    gl_Position  = projectionMatrix * mvPos;
  }
`;

const SMOKE_FRAG = P_NOISE + /* glsl */`
  varying float vLifeFrac;
  varying float vRand;

  float hash2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise2(vec2 p){
    vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x),
               mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x),f.y);
  }

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    // Noise dissolve — puff erodes from edges as it ages
    float dNoise = noise2(uv * 5.2 + vLifeFrac * 1.8 + vRand * 3.5);
    float dThr   = vLifeFrac * (1.15 + vRand * 3.2);
    if (dNoise < dThr) discard;

    float rim  = smoothstep(0.10, 0.47, d);
    float n    = fbm2(vec3(uv * 3.2, vRand * 6.0)) * 0.5 + 0.5;
    float nEdge = 1.0 - smoothstep(0.14 + n * 0.16, 0.50, d);
    float alpha = nEdge * (1.0 - vLifeFrac * 0.82) * 0.34;
    alpha *= (1.0 - rim * 0.52);

    // Warm tint when freshly spawned (born near fire), greying as it rises
    float warm = max(0.0, 1.0 - vLifeFrac * 3.5);
    float bright = mix(0.50, 0.88, n);
    vec3 cloudCol = vec3(bright * 0.90, bright * 0.88, bright * 0.84);
    vec3 fireCol  = mix(vec3(0.80, 0.36, 0.08), vec3(1.0, 0.88, 0.55), n);
    vec3 col = mix(cloudCol, fireCol, warm * 0.65);
    col *= mix(0.52, 1.0, 1.0 - rim) + n * 0.15;

    gl_FragColor = vec4(col, alpha);
  }
`;

// ── Pool sizes ────────────────────────────────────────────────────
export const POOL_FIRE  = 1200;
export const POOL_SMOKE = 800;
const        POOL_MISC  = 1200;
const        GRAVITY_P  = 9.0;

// ── ShaderParticlePool — GPU point sprites (fire + smoke) ─────────
export class ShaderParticlePool {
  constructor(scene, vertShader, fragShader, poolSize, label) {
    this._size  = poolSize;
    this._free  = Array.from({ length: poolSize }, (_, i) => i);

    this._alive   = new Uint8Array(poolSize);
    this._px      = new Float32Array(poolSize);
    this._py      = new Float32Array(poolSize);
    this._pz      = new Float32Array(poolSize);
    this._vx      = new Float32Array(poolSize);
    this._vy      = new Float32Array(poolSize);
    this._vz      = new Float32Array(poolSize);
    this._life    = new Float32Array(poolSize);
    this._maxLife = new Float32Array(poolSize);
    this._sizeArr = new Float32Array(poolSize);
    this._randArr = new Float32Array(poolSize);

    this._geo       = new THREE.BufferGeometry();
    this._positions = new Float32Array(poolSize * 3);
    this._lifeFracs = new Float32Array(poolSize);
    this._sizes     = new Float32Array(poolSize);
    this._rands     = new Float32Array(poolSize);

    this._geo.setAttribute('position',  new THREE.BufferAttribute(this._positions, 3).setUsage(THREE.DynamicDrawUsage));
    this._geo.setAttribute('aLifeFrac', new THREE.BufferAttribute(this._lifeFracs, 1).setUsage(THREE.DynamicDrawUsage));
    this._geo.setAttribute('aSize',     new THREE.BufferAttribute(this._sizes,     1).setUsage(THREE.DynamicDrawUsage));
    this._geo.setAttribute('aRand',     new THREE.BufferAttribute(this._rands,     1).setUsage(THREE.DynamicDrawUsage));
    this._geo.setDrawRange(0, 0);

    this._mat = new THREE.ShaderMaterial({
      vertexShader:   vertShader,
      fragmentShader: fragShader,
      transparent:    true,
      depthWrite:     false,
      blending:       label === 'fire' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this._points = new THREE.Points(this._geo, this._mat);
    this._points.frustumCulled = false;
    scene.add(this._points);
  }

  spawn(x, y, z, opts = {}) {
    const n      = opts.n      || 6;
    const speed  = opts.speed  || 2.5;
    const life   = opts.life   || 1.2;
    const size   = opts.size   || 18;
    const spread = opts.spread || 0.5;

    for (let i = 0; i < n; i++) {
      if (!this._free.length) break;
      const id = this._free.pop();
      this._alive[id]   = 1;
      this._px[id]      = x + (Math.random() - 0.5) * spread;
      this._py[id]      = y + Math.random() * 0.2;
      this._pz[id]      = z + (Math.random() - 0.5) * spread;
      this._vx[id]      = (Math.random() - 0.5) * speed * 0.4;
      this._vy[id]      = speed * (0.4 + Math.random() * 0.6);
      this._vz[id]      = (Math.random() - 0.5) * speed * 0.4;
      this._life[id]    = life * (0.7 + Math.random() * 0.6);
      this._maxLife[id] = this._life[id];
      this._sizeArr[id] = size * (0.6 + Math.random() * 0.8);
      this._randArr[id] = Math.random();
    }
  }

  update(dt) {
    for (let id = 0; id < this._size; id++) {
      if (!this._alive[id]) {
        this._positions[id * 3 + 1] = -9999;
        this._lifeFracs[id]          = 1.0;
        continue;
      }

      this._life[id] -= dt;
      if (this._life[id] <= 0) {
        this._alive[id] = 0;
        this._free.push(id);
        this._positions[id * 3 + 1] = -9999;
        this._lifeFracs[id]          = 1.0;
        continue;
      }

      this._px[id] += this._vx[id] * dt;
      this._py[id] += this._vy[id] * dt;
      this._pz[id] += this._vz[id] * dt;
      this._vx[id] *= 1.0 - dt * 1.2;
      this._vz[id] *= 1.0 - dt * 1.2;

      const lifeFrac = 1.0 - this._life[id] / this._maxLife[id];
      this._positions[id * 3]     = this._px[id];
      this._positions[id * 3 + 1] = this._py[id];
      this._positions[id * 3 + 2] = this._pz[id];
      this._lifeFracs[id]          = lifeFrac;
      this._sizes[id]              = this._sizeArr[id];
      this._rands[id]              = this._randArr[id];
    }

    this._geo.drawRange.count = this._size;
    this._geo.attributes.position.needsUpdate  = true;
    this._geo.attributes.aLifeFrac.needsUpdate = true;
    this._geo.attributes.aSize.needsUpdate     = true;
    this._geo.attributes.aRand.needsUpdate     = true;
  }

  destroy(scene) {
    scene.remove(this._points);
    this._geo.dispose();
    this._mat.dispose();
  }
}

// ── MiscParticlePool — instanced spheres (water, wood chips) ──────
export class MiscParticlePool {
  constructor(scene) {
    this._geo  = new THREE.SphereGeometry(0.13, 4, 4);
    this._mat  = new THREE.MeshBasicMaterial({ vertexColors: true });
    this._mesh = new THREE.InstancedMesh(this._geo, this._mat, POOL_MISC);
    this._mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._mesh.count = 0;
    scene.add(this._mesh);

    this._colors = new Float32Array(POOL_MISC * 3);
    this._mesh.instanceColor = new THREE.InstancedBufferAttribute(this._colors, 3);

    this._alive = new Uint8Array(POOL_MISC);
    this._px = new Float32Array(POOL_MISC); this._py = new Float32Array(POOL_MISC); this._pz = new Float32Array(POOL_MISC);
    this._vx = new Float32Array(POOL_MISC); this._vy = new Float32Array(POOL_MISC); this._vz = new Float32Array(POOL_MISC);
    this._life = new Float32Array(POOL_MISC); this._maxL = new Float32Array(POOL_MISC);
    this._cr = new Float32Array(POOL_MISC); this._cg = new Float32Array(POOL_MISC); this._cb = new Float32Array(POOL_MISC);
    this._free  = Array.from({ length: POOL_MISC }, (_, i) => i);
    this._dummy = new THREE.Object3D();
  }

  spawn(x, y, z, hexCol, n = 8, opts = {}) {
    const r = ((hexCol >> 16) & 0xff) / 255;
    const g = ((hexCol >>  8) & 0xff) / 255;
    const b = ( hexCol        & 0xff) / 255;
    const speed    = opts.speed  || 4.5;
    const lifetime = opts.life   || 0.85;
    const phiMax   = opts.upward ? Math.PI * 0.42 : Math.PI;

    for (let i = 0; i < n; i++) {
      if (!this._free.length) break;
      const id = this._free.pop();
      this._alive[id] = 1;
      this._px[id] = x; this._py[id] = y; this._pz[id] = z;
      this._cr[id] = r; this._cg[id] = g; this._cb[id] = b;
      this._life[id] = lifetime; this._maxL[id] = lifetime;

      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.random() * phiMax;
      const spd   = speed * (0.5 + Math.random() * 0.5);
      this._vx[id] = Math.sin(phi) * Math.cos(theta) * spd;
      this._vy[id] = Math.abs(Math.cos(phi)) * spd + 1.5;
      this._vz[id] = Math.sin(phi) * Math.sin(theta) * spd;
    }
  }

  update(dt) {
    const dummy = this._dummy;
    for (let id = 0; id < POOL_MISC; id++) {
      if (!this._alive[id]) continue;
      this._life[id] -= dt * 1.3;
      if (this._life[id] <= 0) {
        this._alive[id] = 0; this._free.push(id);
        dummy.scale.setScalar(0); dummy.updateMatrix();
        this._mesh.setMatrixAt(id, dummy.matrix);
        continue;
      }
      this._px[id] += this._vx[id] * dt;
      this._py[id] += this._vy[id] * dt;
      this._pz[id] += this._vz[id] * dt;
      this._vy[id] -= GRAVITY_P * dt;

      const lifeFrac = this._life[id] / this._maxL[id];
      dummy.position.set(this._px[id], this._py[id], this._pz[id]);
      dummy.scale.setScalar(lifeFrac * 0.9 + 0.1); dummy.updateMatrix();
      this._mesh.setMatrixAt(id, dummy.matrix);

      const alpha = lifeFrac;
      this._colors[id * 3]     = this._cr[id] * alpha;
      this._colors[id * 3 + 1] = this._cg[id] * alpha;
      this._colors[id * 3 + 2] = this._cb[id] * alpha;
    }
    this._mesh.count = POOL_MISC;
    this._mesh.instanceMatrix.needsUpdate = true;
    this._mesh.instanceColor.needsUpdate  = true;
  }

  destroy(scene) {
    scene.remove(this._mesh);
    this._geo.dispose(); this._mat.dispose();
  }
}

// ── Factory: create the standard fire + smoke pools ───────────────
export function createParticlePools(scene) {
  return {
    fire:  new ShaderParticlePool(scene, FIRE_VERT,  FIRE_FRAG,  POOL_FIRE,  'fire'),
    smoke: new ShaderParticlePool(scene, SMOKE_VERT, SMOKE_FRAG, POOL_SMOKE, 'smoke'),
    misc:  new MiscParticlePool(scene),
  };
}
