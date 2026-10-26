// Career gardens (#15): each chapter's grove is grown from its data profile (see `garden` in src/data/cv.js),
// so the walk reads as skills compounding, from one small mushroom at CBU to the Experiments garden.
// Pure and deterministic (no three.js, no DOM): the same data always grows the same garden, and the tests
// can check the layout leaves every path, stand point and project clear.
import { hashString, mulberry32, lerp, clamp } from '../lib/math.js';

/** Rough ground footprint of a companion mushroom at this scale (most strains have a cap radius ≤ 0.85). */
export const footprint = (scale) => 0.72 * scale + 0.08;

/** Scale of a skill mushroom: one per skill the chapter added, grown in beside its marker as it's gained. */
export const SKILL_SCALE = 0.5;

/** Shortest distance from (x, z) to the segment a→b. */
export function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2);
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

/**
 * Lay out a chapter's companion mushrooms.
 *   stop      { id, x, z, dir: { x, z } }   dir points from the marker toward the middle of the grove
 *   profile   the stop's `garden` profile
 *   keep      { discs: [{ x, z, r }], paths: [{ a, b, r }] }   ground that has to stay clear
 *   around    optional { x, z, r0, r1 }: grow in this annulus instead of fanning out behind the marker
 *             (the Experiments garden rings the project clearing)
 *   skills    optional string[]: one skill mushroom each, placed first, flanking the marker where the stop's
 *             camera sees them (they grow in as the chapter is reached; see CVMode.growSkills)
 * Returns [{ x, z, scale, strain, seed, skill? }]: the skill mushrooms first, then the companions.
 */
export function layoutGarden(stop, profile, { keep = { discs: [], paths: [] }, around = null, skills = [] } = {}) {
  const out = [];
  const n = profile.count ?? 0;
  if (!n && !skills.length) return out;
  const rng = mulberry32(hashString(`garden:${stop.id}`));
  const back = Math.atan2(-stop.dir.z, -stop.dir.x);
  const [r0, r1] = profile.ring;
  const [s0, s1] = profile.scale;
  const strains = profile.strains.length ? profile.strains : ['ghost'];
  // every strain of the chapter shows up before any repeats, so variety is guaranteed, not left to chance
  const order = strains.map((s) => ({ s, k: rng() })).sort((p, q) => p.k - q.k).map((o) => o.s);

  const clear = (x, z, r) => {
    // the marker's own cap: nothing grows under it, so no two caps cut through each other as they sway
    if (Math.hypot(x - stop.x, z - stop.z) < r + footprint(profile.marker)) return false;
    for (const d of keep.discs) if (d.marker !== stop.id && Math.hypot(x - d.x, z - d.z) < d.r + r) return false;
    for (const p of keep.paths) if (segmentDistance(x, z, p.a, p.b) < p.r + r) return false;
    for (const m of out) if (Math.hypot(x - m.x, z - m.z) < (footprint(m.scale) + r) * 0.82) return false;
    return true;
  };

  // candidate i: where it would like to grow (t = 0 near the marker / inner edge, 1 at the far edge)
  const candidate = (i, tries) => {
    const jitter = Math.min(1, tries / 12);
    const reach = 1.5 * clamp((tries - 60) / 240); // a crowded garden may spill a little further out
    if (around) {
      const a = rng() * Math.PI * 2;
      const t = Math.sqrt(rng());
      return { x: around.x + Math.cos(a) * lerp(around.r0, around.r1, t), z: around.z + Math.sin(a) * lerp(around.r0, around.r1, t), t };
    }
    if (profile.rows) {
      // ordered rows, evenly spaced and symmetric about the marker: a structured, intentional garden.
      // Outer rows are longer, so they take proportionally more of the mushrooms.
      const { row, col, inRow, rows } = rowSlot(i, n, profile.rows, r0, r1);
      const t = rows > 1 ? row / (rows - 1) : 0;
      const u = inRow > 1 ? col / (inRow - 1) - 0.5 : 0;
      const a = back + u * profile.spread * (0.75 + 0.25 * t) + (rng() - 0.5) * 0.25 * jitter;
      const r = lerp(r0, r1, t) + (rng() - 0.5) * 0.3 * jitter + reach * rng();
      return { x: stop.x + Math.cos(a) * r, z: stop.z + Math.sin(a) * r, t, u };
    }
    const a = back + (rng() - 0.5) * profile.spread * (1 + reach * 0.3);
    const t = Math.sqrt(rng());
    const r = lerp(r0, r1 + reach, t);
    return { x: stop.x + Math.cos(a) * r, z: stop.z + Math.sin(a) * r, t };
  };

  // the skills: alternating either side of the marker, working back from the side nearest the Gardener
  const front = Math.atan2(stop.dir.z, stop.dir.x);
  const inner = footprint(profile.marker) + footprint(SKILL_SCALE) + 0.15;
  skills.forEach((skill, i) => {
    const prefer = i % 2 ? -1 : 1, j = Math.floor(i / 2);
    for (let tries = 0; tries < 200; tries++) {
      const jitter = Math.min(1, tries / 16);
      let x, z;
      if (tries < 100) {
        const wide = clamp((tries - 40) / 60); // a crowded marker lets them wander further round and out,
        const side = tries > 60 && rng() < 0.5 ? -prefer : prefer; // or to its other side
        const a = front + side * (1.75 + 0.42 * j + (rng() - 0.3) * (0.9 + 1.2 * wide) * jitter);
        const r = inner + 0.1 * j + rng() * (1.1 + 1.6 * wide) * jitter;
        x = stop.x + Math.cos(a) * r; z = stop.z + Math.sin(a) * r;
      } else ({ x, z } = candidate(i, tries - 100)); // no room beside the marker: join the garden behind it
      if (!clear(x, z, footprint(SKILL_SCALE))) continue;
      out.push({ x, z, scale: SKILL_SCALE, strain: stop.strain, seed: hashString(`${stop.id}:skill:${i}`), skill });
      break;
    }
  });

  for (let i = 0; i < n; i++) {
    for (let tries = 0; tries < 360; tries++) {
      const c = candidate(i, tries);
      // farther out grows larger, so the garden rises from its marker; ordered rows peak at their middle
      const lift = profile.rows ? 1 - Math.abs(c.u ?? 0) * 0.5 : 0.75 + c.t * 0.5;
      const scale = clamp(lerp(s0, s1, profile.rows ? 0.55 + (rng() - 0.5) * 0.15 : rng()) * lift, s0 * 0.8, s1 * 1.05);
      if (!clear(c.x, c.z, footprint(scale))) continue;
      out.push({ x: c.x, z: c.z, scale, strain: order[i % order.length], seed: hashString(`${stop.id}:${i}`) });
      break;
    }
  }
  return out;
}

/** Slot i of n in rows from r0 to r1, each row holding a share proportional to its radius. */
function rowSlot(i, n, rows, r0, r1) {
  const radii = Array.from({ length: rows }, (_, k) => lerp(r0, r1, rows > 1 ? k / (rows - 1) : 0));
  const total = radii.reduce((a, b) => a + b, 0);
  let left = n;
  const counts = radii.map((r, k) => {
    const c = k === rows - 1 ? left : Math.max(1, Math.round((n * r) / total));
    left -= c;
    return c;
  });
  let row = 0;
  while (row < rows - 1 && i >= counts[row]) i -= counts[row++];
  return { row, col: i, inRow: counts[row], rows };
}

/**
 * Do two caps cut through each other? Each is { x, z, r, y0, y1 }: the cap's centre on the ground, its radius
 * and its height band. `margin` leaves room for both to sway in the wind without touching.
 */
export function capsOverlap(a, b, margin = 0.12) {
  if (Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) < -margin) return false; // one cap is clear above the other
  return Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r + margin;
}

/** Where a chapter's date hangs: over the middle of its grove (marker plus companions, weighted by size). */
export function gardenCentre(stop, plants, markerScale) {
  let x = stop.x * markerScale, z = stop.z * markerScale, w = markerScale;
  for (const p of plants) { x += p.x * p.scale; z += p.z * p.scale; w += p.scale; }
  return { x: x / w, z: z / w };
}

export const STAND_OFF = 1.75; // how far in front of a marker (toward the middle of the grove) the Gardener stands

/** Sets s.dir (marker → middle of the grove), s.standOff and s.stand. A big marker needs a step more room. */
export function placeStand(s) {
  const len = Math.hypot(s.x, s.z) || 1;
  s.dir = { x: -s.x / len, z: -s.z / len };
  s.standOff ??= Math.max(STAND_OFF, s.garden.marker * 0.62 + 0.75);
  s.stand = { x: s.x + s.dir.x * s.standOff, z: s.z + s.dir.z * s.standOff };
  return s;
}

/**
 * Ground the gardens must leave open: every stand point (the Local Lab's desk too), the walks between
 * every pair of stops, from the project clearing to each stop and from the Gardener's start, the project clearing and the way into it, other markers.
 * stops must be in walk order, with stands placed.
 */
export function keepClear(stops, clearing, { home, wideStand = null }) {
  const exp = stops.find((s) => s.id === clearing.stop);
  const discs = [{ x: clearing.x, z: clearing.z, r: clearing.r + 0.85 }, { ...home, r: 1.2 }];
  const paths = [{ a: home, b: stops[0].stand, r: 0.8 }, { a: exp.stand, b: clearing, r: 0.9 }];
  stops.forEach((s, i) => {
    discs.push({ x: s.stand.x, z: s.stand.z, r: s.id === wideStand ? 2.2 : 1.3 });
    discs.push({ x: s.x, z: s.z, r: 0.9 + s.garden.marker * 0.5, marker: s.id }); // other gardens keep off it
    // the number keys, N / B and the L jump walk between any two stops (from a project too), not only neighbours
    for (let j = 0; j < i; j++) paths.push({ a: stops[j].stand, b: s.stand, r: 0.9 });
  });
  for (const s of stops) paths.push({ a: clearing, b: s.stand, r: 0.9 }); // and from a project in the clearing
  return { discs, paths };
}

/** All of a chapter's mushrooms (its skills, then its companions); the Experiments garden rings the project clearing behind its marker. */
export function growGarden(s, clearing, keep) {
  const g = s.garden;
  const around = s.id === clearing.stop ? { x: clearing.x, z: clearing.z, r0: clearing.r + g.ring[0], r1: clearing.r + g.ring[1] } : null;
  return layoutGarden(s, g, { keep, around, skills: s.skills ?? [] });
}
