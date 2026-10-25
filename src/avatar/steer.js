import * as THREE from 'three';
import { CLEARING } from '../world/terrain.js';

/**
 * Ground-plane steering for the Gardener: damp toward a desired velocity, soft repel (and slide)
 * around mushrooms and rocks, then a hard positional resolve so it never walks through anything.
 * Collision shapes follow the splash (repel = soft force, resolve = push out + kill inward velocity).
 */

export const BOUNDS = CLEARING + 1.5;
const BROAD = 3; // skip anything farther than this on either axis
const SOFT = 0.6; // soft zone beyond the hard radius
const BRUSH = 0.45; // caps sway when passed this close to the hard radius

export const hardRadius = (m) => m.radius * 0.8 + 0.35;
const solid = (m) => m.appear >= 0.3 && m.group.visible;
// for choosing places to sit: count mushrooms that are on their way in, too
const present = (m) => m.appearTarget > 0 || m.appear >= 0.3;

const _b = new THREE.Vector2();

/**
 * One steering step. mover: { x, z, vx, vz } (mutated). (dx, dz): desired velocity.
 * target: a mushroom we're walking up to (no soft push from it). Returns the distance travelled.
 */
export function steer(mover, dx, dz, dt, mushrooms, obstacles, target = null) {
  const x0 = mover.x, z0 = mover.z;
  const want = Math.hypot(dx, dz);
  let fx = 0, fz = 0;
  // soft repel + a sideways nudge when the way ahead is blocked
  for (let i = 0; i < mushrooms.length; i++) {
    const m = mushrooms[i];
    const ox = x0 - m.x, oz = z0 - m.z;
    if (ox > BROAD || ox < -BROAD || oz > BROAD || oz < -BROAD || !solid(m)) continue;
    const r = hardRadius(m);
    const d = Math.hypot(ox, oz) || 1e-3;
    if (d < r + SOFT && m !== target) {
      const f = 1 - (d - r) / SOFT;
      avoid(ox / d, oz / d, Math.min(f, 1.5), dx, dz, want);
      fx += _b.x; fz += _b.y;
    }
    // brush past: the cap sways away
    const sp = Math.hypot(mover.vx, mover.vz);
    if (sp > 0.2 && d < r + BRUSH) {
      m.worldToBend(-ox, -oz, _b);
      const l = _b.length() || 1;
      const k = sp * dt * 1.4 * Math.min(1, 1 - (d - r) / BRUSH) / l;
      m.impulse(_b.x * k, _b.y * k);
    }
  }
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const ox = x0 - o.x, oz = z0 - o.z;
    const r = o.r + 0.3;
    if (Math.abs(ox) > r + SOFT || Math.abs(oz) > r + SOFT) continue;
    const d = Math.hypot(ox, oz) || 1e-3;
    if (d < r + SOFT) {
      avoid(ox / d, oz / d, Math.min(1 - (d - r) / SOFT, 1.5), dx, dz, want);
      fx += _b.x; fz += _b.y;
    }
  }
  const tx = dx + fx, tz = dz + fz;
  const k = 1 - Math.exp(-9 * dt);
  mover.vx += (tx - mover.vx) * k;
  mover.vz += (tz - mover.vz) * k;
  if (want < 0.01 && Math.hypot(mover.vx, mover.vz) < 0.02) { mover.vx = 0; mover.vz = 0; }
  mover.x += mover.vx * dt;
  mover.z += mover.vz * dt;

  // hard resolve
  for (let i = 0; i < mushrooms.length; i++) {
    const m = mushrooms[i];
    const ox = mover.x - m.x, oz = mover.z - m.z;
    if (ox > BROAD || ox < -BROAD || oz > BROAD || oz < -BROAD || !solid(m)) continue;
    resolve(mover, m.x, m.z, hardRadius(m));
  }
  for (let i = 0; i < obstacles.length; i++) resolve(mover, obstacles[i].x, obstacles[i].z, obstacles[i].r + 0.3);
  const rr = Math.hypot(mover.x, mover.z);
  if (rr > BOUNDS) {
    const nx = mover.x / rr, nz = mover.z / rr;
    mover.x = nx * BOUNDS; mover.z = nz * BOUNDS;
    const vn = mover.vx * nx + mover.vz * nz;
    if (vn > 0) { mover.vx -= vn * nx; mover.vz -= vn * nz; }
  }
  return Math.hypot(mover.x - x0, mover.z - z0);
}

// Soft zone: a gentle outward drift, and when heading in, trade some of the inward speed for a
// slide around the side we're already favouring (so goals near things stay reachable).
function avoid(nx, nz, f, dx, dz, want) {
  let bx = nx * f * 0.35, bz = nz * f * 0.35;
  const inward = -(dx * nx + dz * nz);
  if (want > 0.01 && inward > 0) {
    const c = Math.min(f, 1) * 0.75;
    bx += nx * inward * c;
    bz += nz * inward * c;
    let tx = -nz, tz = nx;
    if (tx * dx + tz * dz < 0) { tx = -tx; tz = -tz; }
    bx += tx * inward * c;
    bz += tz * inward * c;
  }
  _b.set(bx, bz);
}

function resolve(mover, cx, cz, minD) {
  const dx = mover.x - cx, dz = mover.z - cz;
  const d = Math.hypot(dx, dz);
  if (d >= minD) return;
  const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
  mover.x = cx + nx * minD;
  mover.z = cz + nz * minD;
  const vn = mover.vx * nx + mover.vz * nz;
  if (vn < 0) { mover.vx -= vn * nx; mover.vz -= vn * nz; }
}

/** Push a goal point out of anything solid so walks can actually arrive. */
export function clearPoint(p, mushrooms, obstacles) {
  for (let pass = 0; pass < 3; pass++) {
    for (const m of mushrooms) {
      if (!present(m)) continue;
      pushOut(p, m.x, m.z, hardRadius(m) + 0.05);
    }
    for (const o of obstacles) pushOut(p, o.x, o.z, o.r + 0.35);
  }
  const r = Math.hypot(p.x, p.y);
  if (r > BOUNDS - 0.3) p.multiplyScalar((BOUNDS - 0.3) / r);
  return p;
}
function pushOut(p, cx, cz, minD) {
  const dx = p.x - cx, dz = p.y - cz;
  const d = Math.hypot(dx, dz);
  if (d >= minD) return;
  if (d < 1e-4) p.set(cx + minD, cz);
  else p.set(cx + (dx / d) * minD, cz + (dz / d) * minD);
}

/** True if a sitting footprint of radius r at (x, z) is clear of mushrooms and obstacles. */
export function spotFree(x, z, r, mushrooms, obstacles) {
  if (Math.hypot(x, z) > BOUNDS - 0.5) return false;
  for (const m of mushrooms) {
    if (!present(m)) continue;
    if (Math.hypot(x - m.x, z - m.z) < m.radius * 0.8 + r) return false;
  }
  for (const o of obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r + r) return false;
  return true;
}

/** Nearest free spot to (x, z), searched on a sunflower spiral. Writes into out (Vector2). */
export function findFreeSpot(x, z, r, mushrooms, obstacles, out) {
  for (let i = 0; i < 600; i++) {
    const a = i * 2.39996, d = 0.3 * Math.sqrt(i);
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if (spotFree(px, pz, r, mushrooms, obstacles)) return out.set(px, pz);
  }
  return out.set(x, z);
}
