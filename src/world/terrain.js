import * as THREE from 'three';
import { fbm2, noise2, smoothstep, lerp } from '../lib/math.js';
import { GLSL_NOISE } from './glsl.js';

export const WORLD_SIZE = 150;
export const CLEARING = 17; // radius of the mostly-flat clearing where mushrooms live

/** Ground height at world (x, z). Pure function so everything can sample it. */
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  const soft = fbm2(x * 0.055 + 3.1, z * 0.055 - 7.2, 4) * 1.1 + noise2(x * 0.22, z * 0.22) * 0.12;
  const inside = lerp(0.35, 1, smoothstep(5, 20, r));
  const rim = smoothstep(CLEARING - 2, 60, r);
  const hills = rim * (3.2 + fbm2(x * 0.03 + 11, z * 0.03 + 5, 3) * 5);
  return soft * inside + hills;
}

const _n = new THREE.Vector3();
export function normalAt(x, z, out = _n) {
  const e = 0.12;
  const hL = heightAt(x - e, z), hR = heightAt(x + e, z);
  const hD = heightAt(x, z - e), hU = heightAt(x, z + e);
  return out.set(hL - hR, 2 * e, hD - hU).normalize();
}

/**
 * Ray → ground intersection by marching the height field (cheap, no triangle raycast).
 * Returns a Vector3 or null.
 */
export function raycastGround(ray, maxDist = 160, out = new THREE.Vector3()) {
  const p = new THREE.Vector3();
  let prevT = 0;
  let step = 0.35;
  for (let t = 0; t < maxDist; t += step) {
    ray.at(t, p);
    if (p.y < heightAt(p.x, p.z)) {
      let lo = prevT, hi = t;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        ray.at(mid, p);
        if (p.y < heightAt(p.x, p.z)) hi = mid; else lo = mid;
      }
      return ray.at(hi, out);
    }
    prevT = t;
    step = Math.min(1.2, step * 1.04);
  }
  return null;
}

export function createTerrain() {
  const seg = 240;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const soil = new THREE.Color('#231b15');
  const mossDark = new THREE.Color('#15342a');
  const moss = new THREE.Color('#3a6b3c');
  const lichen = new THREE.Color('#5d7f58');
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    const r = Math.hypot(x, z);
    const patch = fbm2(x * 0.09 + 40, z * 0.09 - 12, 4) * 0.5 + 0.5;
    const fine = noise2(x * 0.7, z * 0.7) * 0.5 + 0.5;
    const mossAmt = smoothstep(0.35, 0.75, patch) * lerp(0.55, 1, smoothstep(4, 18, r));
    c.copy(soil).lerp(mossDark, 0.35 + fine * 0.25).lerp(moss, mossAmt * 0.85);
    c.lerp(lichen, smoothstep(0.78, 0.95, patch) * 0.5);
    c.multiplyScalar(0.8 + fine * 0.35);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const uniforms = {
    uWet: { value: 0 },
    uTime: { value: 0 },
  };

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        uniform float uWet;
        uniform float uTime;
        ${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float grain = vnoise(vWPos.xz * 6.0) * 0.5 + vnoise(vWPos.xz * 17.0) * 0.3;
        diffuseColor.rgb *= 0.82 + grain * 0.32;
        float puddle = smoothstep(0.15, 0.55, vnoise(vWPos.xz * 0.35 + 4.0) * 0.5 + 0.5);
        float wetMask = uWet * mix(0.55, 1.0, puddle);
        diffuseColor.rgb *= 1.0 - wetMask * 0.45;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.18, wetMask * puddle);`);
  };
  mat.customProgramCacheKey = () => 'terrain-v1';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return { mesh, uniforms };
}
