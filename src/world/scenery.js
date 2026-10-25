import * as THREE from 'three';
import { heightAt, CLEARING } from './terrain.js';
import { mulberry32, fbm2, noise2, smoothstep } from '../lib/math.js';

/** Instanced grass/moss blades with a wind vertex shader. */
function createGrass(shared, rng) {
  // A single tapered blade, 4 segments, pivot at base.
  const segs = 4;
  const verts = [], uvs = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = 0.045 * (1 - t * 0.92);
    verts.push(-w, t, 0, w, t, 0);
    uvs.push(0, t, 1, t);
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  blade.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  blade.setIndex(idx);
  blade.computeVertexNormals();

  const count = 14000;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide, vertexColors: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uWind = shared.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform vec3 uWind; varying float vT;`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = position;
        vT = uv.y;
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float ph = ip.x * 0.35 + ip.z * 0.35;
        float sway = sin(uTime * 1.8 - dot(ip.xz, uWind.xy) * 0.35 + ph) * 0.5 + 0.5;
        float bend = (0.08 + uWind.z * (0.35 + 0.65 * sway)) * uv.y * uv.y;
        // bend in world wind direction: convert to instance-local by inverse rotation (approx: instance only rotates about Y)
        vec2 wd = uWind.xy;
        mat2 invR = mat2(instanceMatrix[0][0], instanceMatrix[2][0], instanceMatrix[0][2], instanceMatrix[2][2]);
        vec2 lw = invR * wd;
        transformed.x += lw.x * bend;
        transformed.z += lw.y * bend;
        transformed.y -= bend * bend * 0.35;
        transformed.x += sin(uTime * 2.3 + ph * 3.0) * 0.02 * uv.y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vT;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(0.25, 1.15, vT);`);
  };
  mat.customProgramCacheKey = () => 'grass-v1';

  const mesh = new THREE.InstancedMesh(blade, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  const tones = ['#2e5c32', '#3f6e3a', '#26503a', '#5b7a3a', '#1f4a3e'].map((c) => new THREE.Color(c));
  let n = 0;
  for (let tries = 0; n < count && tries < count * 6; tries++) {
    const r = Math.sqrt(rng()) * 58;
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const density = fbm2(x * 0.08 + 9, z * 0.08 - 2, 3) * 0.5 + 0.5;
    const inClearing = 1 - smoothstep(CLEARING * 0.55, CLEARING + 2, r);
    const keep = density * (1 - inClearing * 0.85);
    if (rng() > keep * 1.4) continue;
    const h = (0.25 + rng() * 0.55) * (1 - inClearing * 0.55) * (0.7 + density * 0.6);
    p.set(x, heightAt(x, z) - 0.02, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (rng() - 0.5) * 0.5);
    q.multiply(tilt);
    s.set(0.8 + rng() * 0.6, h, 1);
    m.compose(p, q, s);
    mesh.setMatrixAt(n, m);
    col.copy(tones[Math.floor(rng() * tones.length)]).multiplyScalar(0.7 + rng() * 0.5);
    mesh.setColorAt(n, col);
    n++;
  }
  mesh.count = n;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

function displacedRock(rng, radius) {
  const geo = new THREE.IcosahedronGeometry(radius, 3);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const off = rng() * 100;
  const colors = new Float32Array(pos.count * 3);
  const stone = new THREE.Color('#3a3d3c'), moss = new THREE.Color('#2f5a30');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const d = 1 + fbm2(n.x * 1.6 + off, n.z * 1.6 + n.y * 1.3, 4) * 0.35;
    v.multiplyScalar(d);
    v.y *= 0.62;
    pos.setXYZ(i, v.x, v.y, v.z);
    const top = smoothstep(-0.1, 0.7, n.y) * (0.6 + 0.4 * noise2(n.x * 5 + off, n.z * 5));
    c.copy(stone).multiplyScalar(0.75 + noise2(n.x * 9, n.y * 9 + off) * 0.25).lerp(moss, top);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function createRocks(rng, obstacles) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: false });
  const spots = 18;
  for (let i = 0; i < spots; i++) {
    const a = rng() * Math.PI * 2;
    const r = CLEARING * 0.75 + rng() * 22;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const rad = 0.5 + rng() * 1.6 * (r > CLEARING + 4 ? 1.6 : 1);
    const rock = new THREE.Mesh(displacedRock(rng, rad), mat);
    rock.position.set(x, heightAt(x, z) - rad * 0.12, z);
    rock.rotation.y = rng() * Math.PI * 2;
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
    obstacles.push({ x, z, r: rad * 0.9, kind: 'rock' });
  }
  return group;
}

function createLogs(obstacles) {
  const group = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ color: 0x2a1f19, roughness: 0.95 });
  const inner = new THREE.MeshStandardMaterial({ color: 0x6b5238, roughness: 0.9 });
  const defs = [
    { x: -12.5, z: 7, len: 7, r: 0.55, rot: 0.9 },
    { x: 11, z: -10, len: 5.5, r: 0.45, rot: -0.4 },
  ];
  for (const d of defs) {
    const geo = new THREE.CylinderGeometry(d.r * 0.9, d.r, d.len, 20, 12, false);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const ang = Math.atan2(v.z, v.x);
      const k = 1 + noise2(ang * 3, v.y * 2) * 0.08 + Math.sin(ang * 18 + v.y) * 0.02;
      pos.setXYZ(i, v.x * k, v.y, v.z * k);
    }
    geo.computeVertexNormals();
    const log = new THREE.Mesh(geo, [bark, inner, inner]);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = d.rot;
    log.position.set(d.x, heightAt(d.x, d.z) + d.r * 0.55, d.z);
    log.castShadow = log.receiveShadow = true;
    group.add(log);
    // three circles along the axis (the cylinder's Y, turned onto X, then yawed by rot)
    const ax = Math.cos(d.rot), az = -Math.sin(d.rot);
    const r = Math.max(d.r * 1.15, d.len / 6);
    for (const t of [-d.len / 3, 0, d.len / 3]) obstacles.push({ x: d.x + ax * t, z: d.z + az * t, r, kind: 'log' });
  }
  return group;
}

/**
 * Slow wind sway for the instanced trunks: the whole trunk leans with the wind and rocks gently,
 * growing with height (geometry y runs 0..1 before the instance's height scale). Offsets are applied
 * in world units after instancing, so thick and thin trunks sway alike.
 */
function swayTrunks(mat, shared, key) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uWind = shared.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform vec3 uWind;`)
      .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 ip = vec2(0.0);
        #endif
        float hy = clamp(position.y, 0.0, 1.0);
        float prof = hy * 0.3 + hy * hy * 0.7;
        float ph = fract(sin(dot(ip, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
        float w = uWind.z;
        float rock = sin(uTime * (0.45 + w * 0.35) + ph - dot(ip, uWind.xy) * 0.08) * 0.7
          + sin(uTime * 1.13 + ph * 1.7) * 0.3;
        vec2 perp = vec2(-uWind.y, uWind.x);
        vec2 sway = uWind.xy * (w * 0.9 + rock * (0.12 + w * 0.55)) + perp * sin(uTime * 0.37 + ph * 2.3) * (0.08 + w * 0.2);
        mvPosition.xz += sway * prof;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  mat.customProgramCacheKey = () => key;
}

/** Tall dark trunks around the clearing, dissolving into fog. */
function createTrees(shared, rng) {
  const count = 90;
  const geo = new THREE.CylinderGeometry(0.55, 0.9, 1, 12, 8);
  geo.translate(0, 0.5, 0);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ang = Math.atan2(v.z, v.x);
    const flare = 1 + Math.pow(1 - v.y, 6) * 0.9 * (0.7 + 0.3 * Math.sin(ang * 5));
    const ridge = 1 + Math.sin(ang * 14 + v.y * 3) * 0.04;
    pos.setXYZ(i, v.x * flare * ridge, v.y, v.z * flare * ridge);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 1 });
  swayTrunks(mat, shared, 'trees-sway-v1');
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  swayTrunks(depth, shared, 'trees-sway-depth-v1');
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.customDepthMaterial = depth;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = 24 + Math.pow(rng(), 0.7) * 45;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const thick = 0.7 + rng() * 1.1;
    p.set(x, heightAt(x, z) - 0.3, z);
    q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.08, rng() * 6.28, (rng() - 0.5) * 0.08));
    s.set(thick, 40 + rng() * 20, thick);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, col.setHSL(0.07 + rng() * 0.04, 0.2, 0.06 + rng() * 0.05));
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createScenery(shared) {
  const rng = mulberry32(1337);
  const group = new THREE.Group();
  // Circles ({ x, z, r, kind }) the avatar and ecosystem layout keep clear of.
  const obstacles = [];
  group.add(createGrass(shared, rng));
  group.add(createRocks(rng, obstacles));
  group.add(createLogs(obstacles));
  group.add(createTrees(shared, rng));
  group.userData.obstacles = obstacles;
  return group;
}
