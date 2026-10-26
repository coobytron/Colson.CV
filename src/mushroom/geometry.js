import * as THREE from 'three';
import { mulberry32, makeRingNoise, smoothstep, lerp, noise2 } from '../lib/math.js';

/**
 * Surfaces of revolution with per-vertex angular perturbation, merged into one
 * indexed geometry (one draw call per mushroom). The angular seam is shared, so
 * computeVertexNormals() gives smooth normals all the way round.
 *
 * Custom attributes consumed by the mushroom shader:
 *   aPart  0 stem, 1 cap top, 2 gills/underside, 3 ring
 *   aH     0..1 height along the stem (for bending), cap parts = 1
 *   aGlow  bioluminescence mask
 */
class Builder {
  constructor() {
    this.pos = []; this.col = []; this.glow = []; this.part = []; this.h = []; this.idx = [];
  }

  revolve(profile, segs, vertexFn) {
    const base = this.pos.length / 3;
    const v = { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, glow: 0 };
    for (let i = 0; i < profile.length; i++) {
      const p = profile[i];
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        v.x = p.cx + Math.cos(a) * p.r;
        v.z = p.cz + Math.sin(a) * p.r;
        v.y = p.y;
        v.r = p.col.r; v.g = p.col.g; v.b = p.col.b;
        v.glow = p.glow;
        vertexFn?.(v, p, a, i, j);
        this.pos.push(v.x, v.y, v.z);
        this.col.push(v.r, v.g, v.b);
        this.glow.push(v.glow);
        this.part.push(p.part);
        this.h.push(p.h);
      }
    }
    for (let i = 0; i < profile.length - 1; i++) {
      for (let j = 0; j < segs; j++) {
        const a = base + i * segs + j;
        const b = base + i * segs + ((j + 1) % segs);
        const c = base + (i + 1) * segs + j;
        const d = base + (i + 1) * segs + ((j + 1) % segs);
        this.idx.push(a, c, b, b, c, d);
      }
    }
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glow, 1));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.setAttribute('aH', new THREE.Float32BufferAttribute(this.h, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const tmpA = new THREE.Color(), tmpB = new THREE.Color();

/** detail (0.4–1) thins the mesh for small or distant mushrooms; 1 is full resolution. */
export function buildMushroomGeometry(genome, seed = 1, detail = 1) {
  const g = genome;
  const rng = mulberry32(seed);
  const b = new Builder();

  const capColor = new THREE.Color(g.capColor);
  const rimColor = new THREE.Color(g.rimColor);
  const gillColor = new THREE.Color(g.gillColor);
  const stemColor = new THREE.Color(g.stemColor);
  const spotColor = new THREE.Color(g.spotColor);
  const soil = new THREE.Color('#3a2a1e');

  // ---- stem ---------------------------------------------------------------
  const curveA = rng() * Math.PI * 2;
  const curveAmt = g.stemCurve * g.stemH;
  const center = (h) => {
    const k = curveAmt * Math.sin(h * Math.PI * 0.5) ** 2;
    return { x: Math.cos(curveA) * k, z: Math.sin(curveA) * k };
  };
  const stemRadius = (h) => {
    const flare = 1 + g.stemFlare * 1.9 * (1 - smoothstep(0, 0.32, h)) ** 2;
    return g.stemR * flare * (1 - 0.22 * h);
  };
  const stemTopR = stemRadius(1);
  const M = Math.max(10, Math.round(20 * detail));
  const stemProfile = [];
  for (let i = 0; i <= M; i++) {
    const h = i / M;
    const c = center(h);
    const y = lerp(-0.1, g.stemH, h);
    const col = tmpA.copy(soil).lerp(stemColor, smoothstep(0, 0.22, h)).clone();
    stemProfile.push({ r: stemRadius(h), y, cx: c.x, cz: c.z, col, glow: 0.05 + 0.3 * smoothstep(0.6, 1, h), part: 0, h: Math.max(0, h) });
  }
  const stemNoise = makeRingNoise(rng, 3);
  b.revolve(stemProfile, Math.max(12, Math.round(20 * detail)), (v, p, a) => {
    const n = stemNoise(a + p.h * 3) * 0.06 + noise2(a * 3, p.h * 12) * 0.04;
    v.x = p.cx + (v.x - p.cx) * (1 + n);
    v.z = p.cz + (v.z - p.cz) * (1 + n);
    const fib = 0.92 + 0.08 * Math.sin(a * 23 + p.h * 5);
    v.r *= fib; v.g *= fib; v.b *= fib;
  });

  // ---- ring / annulus -----------------------------------------------------
  if (g.ring) {
    const h0 = 0.8;
    const c = center(h0);
    const y0 = lerp(-0.1, g.stemH, h0);
    const rs = stemRadius(h0) * 0.95;
    const skirt = [
      [1.0, 0.02], [1.7, -0.03], [2.5, -0.13], [2.55, -0.16], [2.0, -0.11], [1.0, -0.05],
    ];
    const ringNoise = makeRingNoise(rng, 3);
    b.revolve(
      skirt.map(([rr, dy]) => ({ r: rs * rr, y: y0 + dy * g.stemH * 0.6, cx: c.x, cz: c.z, col: stemColor.clone().multiplyScalar(0.95), glow: 0.15, part: 3, h: h0, rr })),
      28,
      (v, p, a) => {
        const k = 1 + ringNoise(a) * 0.12 * (p.rr - 1);
        v.x = p.cx + (v.x - p.cx) * k;
        v.z = p.cz + (v.z - p.cz) * k;
        v.y += ringNoise(a * 2 + 1) * 0.02 * (p.rr - 1);
      },
    );
  }

  // ---- cap ----------------------------------------------------------------
  const top = center(1);
  const O = new THREE.Vector3(top.x, g.stemH, top.z);
  const R = g.capR, H = g.capH;
  const yBase = -H * 0.18;
  const thick = 0.03 + H * 0.04;
  const capProfile = [];
  const NT = Math.max(12, Math.round(26 * detail));
  let rimR = R, rimY = yBase;
  for (let i = 0; i <= NT; i++) {
    const t = lerp(0.015, 1, i / NT);
    const dome = Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.2)));
    const cone = 1 - Math.pow(t, 1.15);
    let y = yBase + H * lerp(dome, cone, g.capShape);
    y -= g.capDip * H * 0.75 * (1 - smoothstep(0, 0.6, t));
    y += g.umbo * H * 0.55 * Math.exp(-((t / 0.2) ** 2));
    y -= g.capCurl * H * 0.65 * smoothstep(0.62, 1, t) ** 2;
    const r = R * t * (1 - g.capCurl * 0.12 * smoothstep(0.8, 1, t));
    const col = tmpA.copy(capColor).lerp(rimColor, Math.pow(t, 1.5)).clone();
    capProfile.push({ r, y: O.y + y, cx: O.x, cz: O.z, col, glow: g.capGlow * (0.2 + 0.8 * t * t), part: 1, h: 1, rw: t * t, t, top: true });
    rimR = r; rimY = y;
  }
  // rounded lip
  capProfile.push({ r: rimR + thick * 0.35, y: O.y + rimY - thick * 0.45, cx: O.x, cz: O.z, col: rimColor.clone(), glow: 0.5 + g.capGlow * 0.5, part: 1, h: 1, rw: 1 });
  capProfile.push({ r: rimR - thick * 0.15, y: O.y + rimY - thick, cx: O.x, cz: O.z, col: tmpB.copy(rimColor).lerp(gillColor, 0.6).clone(), glow: 0.8, part: 2, h: 1, rw: 1 });
  // gill underside, rim → stem
  const NU = Math.max(6, Math.round(16 * detail));
  const underTop = yBase + H * 0.08 * (1 + g.capShape * 2);
  for (let i = 1; i <= NU; i++) {
    const s = i / NU;
    const r = lerp(rimR * 0.95, stemTopR * 1.15, s);
    const y = lerp(rimY - thick, underTop, Math.pow(s, 0.75));
    const col = tmpA.copy(gillColor).multiplyScalar(lerp(1, 0.55, s)).clone();
    capProfile.push({ r, y: O.y + y, cx: O.x, cz: O.z, col, glow: lerp(1, 0.45, s), part: 2, h: 1, rw: Math.pow(1 - s, 1.5), s, gill: true });
  }

  // spots (positions on the top surface in local xz)
  const spots = [];
  const spotCount = Math.round(g.spots * 16);
  for (let i = 0; i < spotCount; i++) {
    const t = lerp(0.12, 0.85, Math.sqrt(rng()));
    const a = rng() * Math.PI * 2;
    spots.push({ x: Math.cos(a) * t * R, z: Math.sin(a) * t * R, rad: R * lerp(0.05, 0.13, rng()) });
  }

  const segs = Math.round(Math.max(72, Math.min(160, Math.round(g.gills) * 4)) * Math.max(0.5, detail));
  const rimNoise = makeRingNoise(rng, 5);
  const rimNoise2 = makeRingNoise(rng, 4);
  const gillDepth = R * 0.075;
  const mott = rng() * 100;
  b.revolve(capProfile, segs, (v, p, a) => {
    const lx = v.x - p.cx, lz = v.z - p.cz;
    // mottling on the top
    if (p.top) {
      const m = 0.9 + 0.18 * noise2(lx * 7 + mott, lz * 7) + 0.06 * Math.sin(a * 40 + p.t * 20) * p.t;
      v.r *= m; v.g *= m; v.b *= m;
      for (const s of spots) {
        const d = Math.hypot(lx - s.x, lz - s.z);
        if (d < s.rad) {
          const k = smoothstep(s.rad, s.rad * 0.55, d);
          v.r = lerp(v.r, spotColor.r, k); v.g = lerp(v.g, spotColor.g, k); v.b = lerp(v.b, spotColor.b, k);
          v.y += k * R * 0.02;
          v.glow = lerp(v.glow, 0.25, k);
        }
      }
    }
    if (p.gill) {
      const ridge = Math.pow(0.5 + 0.5 * Math.cos(a * g.gills), 3);
      v.y -= gillDepth * ridge * Math.sin(Math.PI * Math.min(1, p.s * 1.15));
      const k = 0.7 + 0.45 * ridge;
      v.r *= k; v.g *= k; v.b *= k;
      v.glow *= 0.6 + 0.6 * ridge;
    }
    const w = 1 + g.capWave * 0.4 * rimNoise(a) * p.rw;
    v.x = p.cx + lx * w;
    v.z = p.cz + lz * w;
    v.y += g.capWave * 0.3 * H * rimNoise2(a) * p.rw;
  });

  const geometry = b.toGeometry();
  return {
    geometry,
    capOrigin: O,
    capTop: O.y + yBase + H + g.umbo * H * 0.5,
    capR: R * (1 + g.capWave * 0.4),
  };
}
