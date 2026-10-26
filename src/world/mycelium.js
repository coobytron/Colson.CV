import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { mulberry32, noise2 } from '../lib/math.js';

/**
 * Glowing mycelium threads lying on the ground between mushrooms, with light
 * pulses travelling along them. All links are merged into one ribbon mesh.
 */
export class MyceliumNet {
  constructor(shared) {
    this.uniforms = {
      uTime: shared.uTime,
      uNight: shared.uNight,
      uOpacity: { value: 1 },
      uFogColor: { value: new THREE.Color() },
      uFogDensity: { value: 0.02 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aAlong; attribute float aLen; attribute float aSide; attribute float aSeed; attribute vec3 aColor; attribute float aStrength;
        varying float vAlong; varying float vLen; varying float vSide; varying float vSeed; varying vec3 vColor; varying float vStrength; varying float vDepth;
        void main() {
          vAlong = aAlong; vLen = aLen; vSide = aSide; vSeed = aSeed; vColor = aColor; vStrength = aStrength;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uNight, uOpacity, uFogDensity;
        varying float vAlong; varying float vLen; varying float vSide; varying float vSeed; varying vec3 vColor; varying float vStrength; varying float vDepth;
        void main() {
          float across = 1.0 - abs(vSide);
          across = across * across;
          float speed = 1.6 + vSeed * 1.2;
          float period = max(vLen, 3.0) + 4.0;
          float head = mod(uTime * speed + vSeed * 40.0, period);
          float d = vAlong - head;
          float pulse = exp(-d * d * 1.6) + exp(-(d + period * 0.5) * (d + period * 0.5) * 1.6) * 0.5;
          float flicker = 0.75 + 0.25 * sin(vAlong * 3.0 + uTime * 2.0 + vSeed * 20.0);
          float endFade = smoothstep(0.0, 0.4, vAlong) * smoothstep(0.0, 0.6, vLen - vAlong);
          float night = mix(0.35, 1.0, uNight);
          float a = across * endFade * (0.22 * flicker + pulse * 1.3) * vStrength * night * uOpacity;
          float fog = exp(-uFogDensity * uFogDensity * vDepth * vDepth);
          gl_FragColor = vec4(vColor * a * fog, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.opacity = 1;
    this.target = 1;
  }

  /**
   * links: [{ a: {x,z}, b: {x,z}, color: THREE.Color|string, strength?: number, width?: number, seed?: number }]
   */
  setLinks(links) {
    const P = [], along = [], lens = [], side = [], seeds = [], cols = [], str = [], idx = [];
    const col = new THREE.Color();
    const pushRibbon = (pts, width, color, strength, seed) => {
      // cumulative length
      const L = [0];
      for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
      const total = L[L.length - 1];
      const base = P.length / 3;
      for (let i = 0; i < pts.length; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)];
        let dx = p1.x - p0.x, dz = p1.z - p0.z;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        const taper = 0.55 + 0.45 * Math.sin(Math.PI * (L[i] / (total || 1)));
        const w = width * taper;
        for (const s of [-1, 1]) {
          const x = pts[i].x - dz * w * s, z = pts[i].z + dx * w * s;
          P.push(x, heightAt(x, z) + 0.035, z);
          along.push(L[i]); lens.push(total); side.push(s); seeds.push(seed);
          cols.push(color.r, color.g, color.b); str.push(strength);
        }
        if (i < pts.length - 1) {
          const a = base + i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    };

    links.forEach((ln, li) => {
      const rng = mulberry32((ln.seed ?? li * 7919) + 11);
      col.set(ln.color ?? '#5ff2e2');
      const color = col.clone();
      const strength = ln.strength ?? 1;
      const width = ln.width ?? 0.04;
      const dx = ln.b.x - ln.a.x, dz = ln.b.z - ln.a.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.05) return;
      const nx = -dz / dist, nz = dx / dist;
      const n = Math.max(6, Math.ceil(dist / 0.18));
      const amp = Math.min(1.4, dist * 0.14);
      const off = rng() * 100;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const wob = (noise2(t * dist * 0.35 + off, off) * amp + noise2(t * dist * 1.4 + off, 3.7) * 0.12) * Math.sin(Math.PI * t);
        pts.push({ x: ln.a.x + dx * t + nx * wob, z: ln.a.z + dz * t + nz * wob });
      }
      pushRibbon(pts, width, color, strength, rng());
      // a few side twigs for an organic look
      const twigs = Math.floor(dist / 1.6);
      for (let k = 0; k < twigs; k++) {
        const i0 = 1 + Math.floor(rng() * (pts.length - 2));
        const start = pts[i0];
        let ang = Math.atan2(nz, nx) * (rng() < 0.5 ? 1 : -1) + (rng() - 0.5) * 1.2;
        if (rng() < 0.5) ang += Math.PI;
        const len = 0.35 + rng() * 1.1;
        const tw = [{ x: start.x, z: start.z }];
        for (let s = 1; s <= 6; s++) {
          ang += (rng() - 0.5) * 0.7;
          const prev = tw[tw.length - 1];
          tw.push({ x: prev.x + Math.cos(ang) * len / 6, z: prev.z + Math.sin(ang) * len / 6 });
        }
        pushRibbon(tw, width * 0.55, color, strength * 0.7, rng());
      }
    });

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
    g.setAttribute('aLen', new THREE.Float32BufferAttribute(lens, 1));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(cols, 3));
    g.setAttribute('aStrength', new THREE.Float32BufferAttribute(str, 1));
    g.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }

  update(dt, scene) {
    this.opacity += (this.target - this.opacity) * (1 - Math.exp(-5 * dt));
    this.uniforms.uOpacity.value = this.opacity;
    this.mesh.visible = this.opacity > 0.01;
    if (scene.fog) {
      this.uniforms.uFogDensity.value = scene.fog.density;
    }
  }
}

/** Connects each point to its nearest neighbours (a light-weight organic network). */
export function nearestLinks(items, { k = 2, maxDist = 5 } = {}) {
  const links = [];
  const seen = new Set();
  items.forEach((a, i) => {
    const near = items
      .map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.z - b.z) }))
      .filter((o) => o.j !== i && o.d < maxDist)
      .sort((p, q) => p.d - q.d)
      .slice(0, k);
    for (const { j } of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ a: items[i], b: items[j], i, j });
    }
  });
  return links;
}
