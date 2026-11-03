import { MAP } from '../../../data/constants.js';
import { HULL_HANDLING, BRAKE_MULT } from '../../../data/ships.js';
import { StatusEffects } from '../Combat/StatusEffects.js';

// ── MOVEMENT SYSTEM ─────────────────────────────────────────────
// AU: steering is frame-rate independent and hull-aware. Ships turn at most
// HULL_HANDLING.turnRate rad/s, accelerate/brake over time, and slow down
// while turning hard so they carve arcs instead of pivoting on the spot.
// `ship.speed` keeps its old unit (world units per 1/60 s) so combat dodge
// checks and the HUD are unchanged.

const TURN_GAIN = 4.2;   // 1/s — matches the old 0.07-per-frame feel at 60 fps

export function isBlocked(x, z, islands, mg=1.8){
  return islands.some(i => {
    const dx=x-i.x, dz=z-i.z;
    return dx*dx + dz*dz < (i.r+mg)**2;
  });
}

export function steerAvoid(ship, islands){
  let ax=0, az=0;
  for(const i of islands){
    const dx=ship.x-i.x, dz=ship.z-i.z;
    const d=Math.sqrt(dx*dx+dz*dz), cl=i.r+7;
    if(d<cl && d>.1){
      const f=((cl-d)/cl)**2;
      ax+=(dx/d)*f*.55; az+=(dz/d)*f*.55;
    }
  }
  return {ax, az};
}

export function handlingOf(ship){
  return HULL_HANDLING[ship.hull] || HULL_HANDLING.standard;
}

/**
 * Steer `ship` toward (tx,tz).
 *   opts.speed   — desired speed (per-frame units); defaults to full sail
 *   opts.arrive  — brake so the ship stops on the point (default true)
 * Returns the remaining distance.
 */
export function steerTo(ship, tx, tz, dt, islands, opts = {}){
  const arrive = opts.arrive !== false;
  const dx = tx - ship.x, dz = tz - ship.z;
  const dist = Math.sqrt(dx*dx + dz*dz);
  const h = handlingOf(ship);

  // Heading: exponential approach, capped by the hull's turn rate
  let diff = 0;
  if (dist > 0.05) {
    diff = Math.atan2(dx, dz) - ship.angle;
    while (diff >  Math.PI) diff -= 2*Math.PI;
    while (diff < -Math.PI) diff += 2*Math.PI;
    const maxTurn = h.turnRate * dt;
    const step = diff * (1 - Math.exp(-TURN_GAIN * dt));
    ship.angle += Math.max(-maxTurn, Math.min(maxTurn, step));
    if (ship.angle > Math.PI) ship.angle -= 2*Math.PI;
    else if (ship.angle < -Math.PI) ship.angle += 2*Math.PI;
  }

  // Desired speed: requested cruise, cut while turning hard, braked on arrival
  const effMax = StatusEffects.effectiveSpeed(ship);
  let want = Math.min(effMax, opts.speed != null ? opts.speed : effMax);
  want *= Math.max(0.25, 0.5 + 0.5 * Math.cos(diff));
  if (arrive) {
    const brake60 = h.accel * BRAKE_MULT * 60;                 // world u/s²
    const stopV = Math.sqrt(2 * brake60 * Math.max(0, dist - 0.4)) / 60;
    want = Math.min(want, stopV);
    // A point inside the turning circle would be orbited forever: while the
    // bow is off-line, slow until the turn radius (v/ω) is under half the gap.
    if (Math.abs(diff) > 0.35) want = Math.min(want, h.turnRate * Math.max(dist, 0.6) * 0.45 / 60);
  }
  approachSpeed(ship, want, dt);
  advance(ship, dt, islands);
  return dist;
}

/** Accelerate / brake toward `want` (per-frame units) at hull rates. */
export function approachSpeed(ship, want, dt){
  const h = handlingOf(ship);
  const rate = (want > ship.speed ? h.accel : h.accel * BRAKE_MULT) * dt;
  ship.speed += Math.max(-rate, Math.min(rate, want - ship.speed));
  if (ship.speed < 1e-4) ship.speed = 0;
}

/** Brake to a stop in place (idle / hold position). */
export function holdStill(ship, dt, islands){
  approachSpeed(ship, 0, dt);
  if (ship.speed > 0) advance(ship, dt, islands);
}

/** Move along the current heading by ship.speed, sliding off island shores. */
export function advance(ship, dt, islands){
  const k = 60 * dt;
  const av = steerAvoid(ship, islands);
  let nx = ship.x + Math.sin(ship.angle)*ship.speed*k + av.ax*k;
  let nz = ship.z + Math.cos(ship.angle)*ship.speed*k + av.az*k;
  nx = Math.max(-MAP/2+4, Math.min(MAP/2-4, nx));
  nz = Math.max(-MAP/2+4, Math.min(MAP/2-4, nz));

  if(!isBlocked(nx,nz,islands)){
    ship.x=nx; ship.z=nz; ship._stuckFrames=0;
  } else if(!isBlocked(nx,ship.z,islands)){
    ship.x=nx; ship._stuckFrames=0;
  } else if(!isBlocked(ship.x,nz,islands)){
    ship.z=nz; ship._stuckFrames=0;
  } else {
    ship._stuckFrames=(ship._stuckFrames||0)+1;
    if(ship._stuckFrames>30){
      let near=null, nearD=Infinity;
      islands.forEach(i=>{ const d=Math.hypot(ship.x-i.x,ship.z-i.z); if(d<nearD){nearD=d;near=i;} });
      if(near){
        const ex=ship.x-near.x, ez=ship.z-near.z, ed=Math.sqrt(ex*ex+ez*ez)||1;
        ship.x+=(ex/ed)*(near.r+2.5-nearD+.5);
        ship.z+=(ez/ed)*(near.r+2.5-nearD+.5);
      }
      ship._stuckFrames=0;
    }
  }
}

/**
 * Legacy entry point (EnemyAI, sea events): steer to a point and stop on it.
 * Returns false once arrived, true while still travelling.
 */
export function moveToward(ship, tx, tz, dt, islands){
  const dist = steerTo(ship, tx, tz, dt, islands, { arrive: true });
  if (dist < .8) { ship.speed = Math.min(ship.speed, 0.02); return false; }
  return true;
}

export function separateFleet(fleet){
  const alive=fleet.filter(s=>s.alive);
  for(let a=0;a<alive.length;a++) for(let b=a+1;b<alive.length;b++){
    const sa=alive[a], sb=alive[b];
    const dx=sa.x-sb.x, dz=sa.z-sb.z, d=Math.sqrt(dx*dx+dz*dz);
    const mn=(sa.sc+sb.sc)*.7;
    if(d<mn && d>.01){ const p=(mn-d)*.2/d; sa.x+=dx*p; sa.z+=dz*p; sb.x-=dx*p; sb.z-=dz*p; }
  }
}
