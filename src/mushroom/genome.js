import * as THREE from 'three';
import { clamp, mulberry32 } from '../lib/math.js';

/**
 * A genome fully describes a mushroom's shape and colour. All lengths are in
 * "mushroom units" (a typical cap radius is ~0.6); the instance scale sizes it in the world.
 */
export const DEFAULT_GENOME = {
  capR: 0.6,       // cap radius
  capH: 0.42,      // cap height
  capShape: 0.2,   // 0 = rounded dome, 1 = cone
  capCurl: 0.3,    // rim rolls under
  capDip: 0,       // funnel / depressed centre
  capWave: 0.12,   // rim irregularity
  umbo: 0,         // central bump
  stemH: 1.0,
  stemR: 0.085,
  stemFlare: 0.35, // bulbous base
  stemCurve: 0.15,
  ring: 0,         // annulus skirt 0/1
  gills: 34,
  spots: 0,        // 0..1 density of cap spots
  capColor: '#d8f6ff',
  rimColor: '#7fe9ff',
  gillColor: '#8ff8ff',
  stemColor: '#e6f2ee',
  spotColor: '#ffffff',
  glowColor: '#40f0ff',
  glow: 1.0,       // overall bioluminescence
  capGlow: 0.35,   // how much of the cap top glows (gills always glow)
};

export const STRAINS = {
  ghost: {
    label: 'Ghost Lantern',
    genome: { capR: 0.5, capH: 0.55, capShape: 0.55, capCurl: 0.15, capWave: 0.1, stemH: 1.35, stemR: 0.06, stemFlare: 0.2, stemCurve: 0.25,
      capColor: '#c9fbff', rimColor: '#5fe6f0', gillColor: '#aefcff', stemColor: '#d6f5f2', glowColor: '#35f0e0', glow: 1.1, capGlow: 0.55 },
  },
  ember: {
    label: 'Ember Cap',
    genome: { capR: 0.62, capH: 0.3, capShape: 0.05, capCurl: 0.05, capDip: 0.55, capWave: 0.28, stemH: 0.95, stemR: 0.09, stemFlare: 0.15, stemCurve: 0.3,
      capColor: '#ff9a3c', rimColor: '#e5571b', gillColor: '#ffb347', stemColor: '#f3a25a', glowColor: '#ff7a1a', glow: 0.95, capGlow: 0.2 },
  },
  agaric: {
    label: 'Fly Agaric',
    genome: { capR: 0.72, capH: 0.36, capShape: 0.0, capCurl: 0.35, capWave: 0.06, stemH: 1.15, stemR: 0.11, stemFlare: 0.55, stemCurve: 0.1, ring: 1, spots: 0.75,
      capColor: '#ff3b3b', rimColor: '#ff7a4a', gillColor: '#fff1e0', stemColor: '#f6efe6', spotColor: '#fff6ea', glowColor: '#ff4d8a', glow: 0.55, capGlow: 0.15 },
  },
  violet: {
    label: 'Violet Veil',
    genome: { capR: 0.78, capH: 0.26, capShape: 0.0, capCurl: 0.5, capWave: 0.18, umbo: 0.35, stemH: 0.9, stemR: 0.1, stemFlare: 0.4, stemCurve: 0.12,
      capColor: '#8b6cff', rimColor: '#c7b4ff', gillColor: '#cdb8ff', stemColor: '#b9a8e8', glowColor: '#9a7bff', glow: 1.0, capGlow: 0.3 },
  },
  moss: {
    label: 'Moss Button',
    genome: { capR: 0.42, capH: 0.4, capShape: 0.1, capCurl: 0.45, capWave: 0.05, stemH: 0.7, stemR: 0.07, stemFlare: 0.3, stemCurve: 0.2,
      capColor: '#c8ff6a', rimColor: '#7ee04a', gillColor: '#e6ff9a', stemColor: '#dff5b5', glowColor: '#9dff3a', glow: 1.0, capGlow: 0.5 },
  },
  porcelain: {
    label: 'Porcelain',
    genome: { capR: 0.85, capH: 0.48, capShape: 0.0, capCurl: 0.2, capWave: 0.08, stemH: 1.2, stemR: 0.13, stemFlare: 0.6, stemCurve: 0.06, ring: 1,
      capColor: '#f4f1ea', rimColor: '#e6e2d8', gillColor: '#cfe6ff', stemColor: '#f1ede4', glowColor: '#8fc8ff', glow: 0.55, capGlow: 0.1 },
  },
  inkcap: {
    label: 'Inkcap',
    genome: { capR: 0.36, capH: 0.95, capShape: 0.85, capCurl: 0.0, capWave: 0.14, stemH: 1.25, stemR: 0.07, stemFlare: 0.1, stemCurve: 0.18,
      capColor: '#cfd3dc', rimColor: '#2a2e45', gillColor: '#1b1f3a', stemColor: '#e8e9ef', glowColor: '#5a7dff', glow: 0.85, capGlow: 0.45 },
  },
};

export const STRAIN_IDS = Object.keys(STRAINS);

export function strainGenome(id) {
  return { ...DEFAULT_GENOME, ...(STRAINS[id]?.genome || {}) };
}

const NUM_RANGES = {
  capR: [0.25, 1.1], capH: [0.15, 1.1], capShape: [0, 1], capCurl: [0, 0.8], capDip: [0, 0.8], capWave: [0, 0.4], umbo: [0, 0.6],
  stemH: [0.4, 1.8], stemR: [0.04, 0.18], stemFlare: [0, 0.9], stemCurve: [0, 0.45], spots: [0, 1], glow: [0.2, 1.5], capGlow: [0, 0.9],
};
const COLOR_KEYS = ['capColor', 'rimColor', 'gillColor', 'stemColor', 'spotColor', 'glowColor'];

function shiftColor(hex, rng, amount) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  hsl.h = (hsl.h + (rng() - 0.5) * amount + 1) % 1;
  hsl.s = clamp(hsl.s + (rng() - 0.5) * amount);
  hsl.l = clamp(hsl.l + (rng() - 0.5) * amount * 0.6, 0.05, 0.95);
  return '#' + c.setHSL(hsl.h, hsl.s, hsl.l).getHexString();
}

/** Returns a new genome with small random variations. */
export function mutate(g, rate = 0.15, rng = Math.random) {
  const out = { ...g };
  for (const [k, [lo, hi]] of Object.entries(NUM_RANGES)) {
    if (typeof out[k] !== 'number') continue;
    out[k] = clamp(out[k] + (rng() - 0.5) * (hi - lo) * rate, lo, hi);
  }
  if (rng() < rate * 0.3) out.ring = out.ring ? 0 : 1;
  out.gills = Math.round(clamp(out.gills + (rng() - 0.5) * 10 * rate, 18, 48));
  const hueShift = (rng() - 0.5) * rate * 0.5;
  for (const k of COLOR_KEYS) {
    const c = new THREE.Color(out[k]);
    const hsl = {};
    c.getHSL(hsl);
    c.setHSL((hsl.h + hueShift + 1) % 1, hsl.s, hsl.l);
    out[k] = shiftColor('#' + c.getHexString(), rng, rate * 0.25);
  }
  return out;
}

export function randomGenome(rng = Math.random) {
  const base = strainGenome(STRAIN_IDS[Math.floor(rng() * STRAIN_IDS.length)]);
  return mutate(base, 0.6, rng);
}

/** Genome tinted to an arbitrary hue (used by the garden "Tune" colour dial). */
export function withHue(g, hue) {
  const out = { ...g };
  const ref = new THREE.Color(g.glowColor).getHSL({});
  for (const k of COLOR_KEYS) {
    if (k === 'spotColor' || k === 'stemColor') continue;
    const c = new THREE.Color(out[k]);
    const hsl = c.getHSL({});
    const shifted = (hsl.h - ref.h + hue + 1) % 1;
    out[k] = '#' + c.setHSL(shifted, hsl.s, hsl.l).getHexString();
  }
  return out;
}

export function genomeHue(g) {
  return new THREE.Color(g.glowColor).getHSL({}).h;
}

export function seededGenome(strainId, seed, rate = 0.18) {
  return mutate(strainGenome(strainId), rate, mulberry32(seed));
}
