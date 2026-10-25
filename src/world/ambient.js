import * as THREE from 'three';
import { heightAt, CLEARING } from './terrain.js';
import { mulberry32, clamp, smoothstep, noise2 } from '../lib/math.js';

/**
 * Ambient life shared by every mode: moths that drift toward glowing caps and the laptop at night,
 * and leaves that fall from the tree line and ride the wind. Two instanced draw calls; the CPU only
 * integrates positions into preallocated attribute arrays (no per-frame allocations).
 * Returns an actor: { object, update(dt, app) }.
 */
export function createAmbient(app) {
  const low = !!app.lowQuality;
  const object = new THREE.Group();
  object.name = 'ambient';
  const moths = createMoths(app, low ? 20 : 40);
  const leaves = createLeaves(app, low ? 60 : 120);
  object.add(moths.mesh, leaves.mesh);
  return {
    object,
    moths,
    leaves,
    update(dt, a = app) {
      moths.update(dt, a);
      leaves.update(dt, a);
    },
  };
}

// ---- moths ------------------------------------------------------------------------------------

const MAX_LAMPS = 16;
const SCAN_PER_FRAME = 40;
const RESCAN = 2;
const LAMP_KEYS = ['x', 'y', 'z', 'r', 'w', 'cr', 'cg', 'cb'];
const _screen = new THREE.Vector3();

function mothGeometry() {
  // One triangle per wing: body front, body back, wing tip. aWing = (span 0..1, chord 0..1).
  const pos = [], wing = [];
  for (const s of [-1, 1]) {
    pos.push(0, 0, 0.03, 0, 0, -0.038, s * 0.068, 0, 0.01);
    wing.push(0, 0, 0, 1, 1, 0.35);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 2));
  return g;
}

function createMoths(app, count) {
  const rng = mulberry32(4242);
  const geo = mothGeometry();
  const aPos = new Float32Array(count * 4); // xyz, yaw
  const aMisc = new Float32Array(count * 4); // seed, glow, pitch, size
  const aTint = new Float32Array(count * 3);
  const posAttr = new THREE.InstancedBufferAttribute(aPos, 4).setUsage(THREE.DynamicDrawUsage);
  const miscAttr = new THREE.InstancedBufferAttribute(aMisc, 4).setUsage(THREE.DynamicDrawUsage);
  const tintAttr = new THREE.InstancedBufferAttribute(aTint, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPos', posAttr);
  geo.setAttribute('aMisc', miscAttr);
  geo.setAttribute('aTint', tintAttr);

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uVis: { value: 0 } }]);
  uniforms.uTime = app.shared.uTime;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform float uTime, uVis;
      attribute vec4 aPos, aMisc; attribute vec3 aTint; attribute vec2 aWing;
      varying vec2 vW; varying vec3 vTint; varying float vGlow;
      void main() {
        vec3 p = position;
        float span = abs(p.x), side = sign(p.x);
        float beat = uTime * (44.0 + aMisc.x * 22.0) + aMisc.x * 40.0;
        float flap = mix(-0.4, 1.2, 0.5 + 0.5 * sin(beat));
        p.x = side * span * cos(flap);
        p.y = span * sin(flap);
        p *= aMisc.w * uVis;
        float cp = cos(aMisc.z), sp = sin(aMisc.z);
        p = vec3(p.x, p.y * cp + p.z * sp, -p.y * sp + p.z * cp);
        float cy = cos(aPos.w), sy = sin(aPos.w);
        p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
        vec4 mvPosition = modelViewMatrix * vec4(p + aPos.xyz, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vW = aWing; vTint = aTint; vGlow = aMisc.y;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      varying vec2 vW; varying vec3 vTint; varying float vGlow;
      void main() {
        // soft, rounded wing inside the triangle: fade toward the leading and trailing edges and the tip
        float lead = vW.y - 0.35 * vW.x, trail = 1.0 - vW.y - 0.65 * vW.x;
        float edge = smoothstep(0.0, 0.3, min(lead, trail) + 0.03) * (1.0 - smoothstep(0.35, 0.9, vW.x));
        vec3 dusty = vec3(0.7, 0.64, 0.55);
        vec3 col = mix(dusty, vTint, 0.35 + vGlow * 0.3);
        col *= 0.06 + vGlow * 0.5;
        col *= 0.75 + 0.25 * smoothstep(0.15, 0.45, abs(vW.y - 0.45)); // faint darker band
        col += vTint * vGlow * vGlow * 0.65 * (1.0 - vW.x); // lamp light catching the wing roots
        gl_FragColor = vec4(col, edge * (0.35 + vGlow * 0.4));
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = 'moths';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  // per-moth state
  const P = new Float32Array(count * 3), V = new Float32Array(count * 3), A = new Float32Array(count * 3);
  const home = new Float32Array(count * 3);
  const ang = new Float32Array(count), angSpeed = new Float32Array(count), orbit = new Float32Array(count);
  const lift = new Float32Array(count), seed = new Float32Array(count), glow = new Float32Array(count);
  const lampOf = new Int8Array(count).fill(-1);
  const T = new Float32Array(count * 2).fill(1e6); // xz of the lamp each moth was sent to
  const load = new Float32Array(MAX_LAMPS + 1);
  for (let i = 0; i < count; i++) {
    const r = 3 + Math.sqrt(rng()) * (CLEARING - 5), a = rng() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = heightAt(x, z) + 0.8 + rng() * 1.6;
    home[i * 3] = x; home[i * 3 + 1] = y; home[i * 3 + 2] = z;
    P.set([x, y, z], i * 3); A.set([x, y, z], i * 3);
    ang[i] = rng() * Math.PI * 2;
    angSpeed[i] = (1.6 + rng() * 2.4) * (rng() < 0.5 ? -1 : 1);
    orbit[i] = 0.18 + rng() * 0.5;
    lift[i] = 0.05 + rng() * 0.45;
    seed[i] = rng();
    aMisc[i * 4] = seed[i];
    aMisc[i * 4 + 3] = 0.85 + rng() * 0.45;
    aTint.set([0.95, 0.9, 0.8], i * 3);
  }

  // lamps: the brightest caps (+ the laptop), gathered a few mushrooms per frame
  const mk = () => new Float32Array(MAX_LAMPS + 1);
  const lamp = { n: 0, x: mk(), y: mk(), z: mk(), r: mk(), w: mk(), cr: mk(), cg: mk(), cb: mk() };
  const stage = { n: 0, x: mk(), y: mk(), z: mk(), r: mk(), w: mk(), cr: mk(), cg: mk(), cb: mk() };
  let scanIdx = -1, scanTimer = 0;

  function stageInsert(w, x, y, z, r, c) {
    if (stage.n === MAX_LAMPS && w <= stage.w[MAX_LAMPS - 1]) return;
    let k = Math.min(stage.n, MAX_LAMPS - 1);
    while (k > 0 && stage.w[k - 1] < w) {
      for (let q = 0; q < LAMP_KEYS.length; q++) { const f = stage[LAMP_KEYS[q]]; f[k] = f[k - 1]; }
      k--;
    }
    stage.x[k] = x; stage.y[k] = y; stage.z[k] = z; stage.r[k] = r; stage.w[k] = w;
    stage.cr[k] = c.r; stage.cg[k] = c.g; stage.cb[k] = c.b;
    if (stage.n < MAX_LAMPS) stage.n++;
  }

  // weighted by brightness, but crowded lamps count for less so the moths spread out
  function pickLamp() {
    let total = 0;
    for (let j = 0; j < lamp.n; j++) total += lamp.w[j] / (1 + load[j] * 0.8);
    let r = Math.random() * total;
    for (let j = 0; j < lamp.n; j++) if ((r -= lamp.w[j] / (1 + load[j] * 0.8)) <= 0) return j;
    return lamp.n - 1;
  }

  const LAPTOP = { r: 0.75, g: 0.85, b: 1 };
  function scan(a) {
    const list = a.mode?.mushrooms ?? [];
    if (scanIdx < 0) { scanIdx = 0; stage.n = 0; }
    const end = Math.min(list.length, scanIdx + SCAN_PER_FRAME);
    for (; scanIdx < end; scanIdx++) {
      const m = list[scanIdx];
      if (!m || m.ghost || !m.group?.visible || !(m.appear >= 0.5)) continue;
      const grow = Math.max(0.05, m.grow ?? 1);
      const w = (m.genome?.glow ?? 1) * grow * (1 - (m.dim ?? 0) * 0.8) * (1 - (m.wilt ?? 0)) * (0.4 + (m.radius ?? 0.3));
      if (w <= 0.02) continue;
      const g = m.group.position;
      const c = m.uniforms?.uGlowColor?.value ?? LAPTOP;
      stageInsert(w, g.x, g.y + (m.height ?? 0.6) * grow * Math.min(1, m.appear), g.z, (m.radius ?? 0.3) * grow, c);
    }
    if (scanIdx < list.length) return;
    // commit
    scanIdx = -1;
    scanTimer = RESCAN;
    let n = stage.n;
    for (let q = 0; q < LAMP_KEYS.length; q++) lamp[LAMP_KEYS[q]].set(stage[LAMP_KEYS[q]]);
    const av = a.avatar;
    if (av?.screenOn && av.screenWorldPosition) {
      av.screenWorldPosition(_screen);
      lamp.x[n] = _screen.x; lamp.y[n] = _screen.y; lamp.z[n] = _screen.z; lamp.r[n] = 0.25;
      lamp.w[n] = 1.4 + (n ? lamp.w[0] * 0.6 : 0);
      lamp.cr[n] = LAPTOP.r; lamp.cg[n] = LAPTOP.g; lamp.cb[n] = LAPTOP.b;
      n++;
    }
    lamp.n = n;
    // keep each moth at its lamp if that lamp is still there; otherwise (or now and then) move on
    load.fill(0);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < count; i++) {
        if (pass === 0) {
          let keep = -1, best = 0.6;
          for (let j = 0; j < n; j++) {
            const d = Math.abs(lamp.x[j] - T[i * 2]) + Math.abs(lamp.z[j] - T[i * 2 + 1]);
            if (d < best) { best = d; keep = j; }
          }
          lampOf[i] = keep >= 0 && Math.random() > 0.06 ? keep : -1;
        } else if (lampOf[i] < 0 && n) lampOf[i] = pickLamp();
        else continue;
        const c = lampOf[i];
        if (c < 0) continue;
        load[c]++;
        T[i * 2] = lamp.x[c]; T[i * 2 + 1] = lamp.z[c];
        aTint[i * 3] = lamp.cr[c]; aTint[i * 3 + 1] = lamp.cg[c]; aTint[i * 3 + 2] = lamp.cb[c];
      }
    }
    tintAttr.needsUpdate = true;
  }

  function update(dt, a) {
    const env = a.env;
    const vis = smoothstep(0.3, 0.8, env.night) * (1 - env.rain * 0.7);
    uniforms.uVis.value = vis;
    mesh.visible = vis > 0.01;
    if (!mesh.visible) return;
    if (scanIdx >= 0 || (scanTimer -= dt) <= 0) scan(a);
    const t = env.time;
    const ka = 1 - Math.exp(-1.4 * dt);
    for (let i = 0; i < count; i++) {
      const i3 = i * 3, s = seed[i], li = lampOf[i];
      let tx, ty, tz, lr = 0;
      if (li >= 0) { tx = lamp.x[li]; ty = lamp.y[li]; tz = lamp.z[li]; lr = lamp.r[li]; }
      else { tx = home[i3]; ty = home[i3 + 1]; tz = home[i3 + 2]; }
      A[i3] += (tx - A[i3]) * ka; A[i3 + 1] += (ty - A[i3 + 1]) * ka; A[i3 + 2] += (tz - A[i3 + 2]) * ka;
      // loose, wobbling loops around the lamp that now and then dart in close
      ang[i] += angSpeed[i] * dt;
      const wob = noise2(t * 0.55 + s * 13.1, s * 7.3);
      const R = (orbit[i] + lr * 0.8) * clamp(0.75 + wob * 0.9, 0.08, 1.6) + (li < 0 ? 1.2 : 0);
      const ox = A[i3] + Math.cos(ang[i]) * R;
      const oz = A[i3 + 2] + Math.sin(ang[i]) * R;
      const oy = A[i3 + 1] + lift[i] + noise2(t * 0.8, s * 3.7 + 1) * 0.28 + Math.sin(ang[i] * 1.7 + s * 5) * 0.1;
      const jx = noise2(t * 2.9 + s * 31, 0.5) * 5, jy = noise2(t * 3.3 + s * 17, 2.5) * 4, jz = noise2(t * 2.7 + s * 23, 4.5) * 5;
      let vx = V[i3], vy = V[i3 + 1], vz = V[i3 + 2];
      vx += ((ox - P[i3]) * 10 - vx * 3.4 + jx) * dt;
      vy += ((oy - P[i3 + 1]) * 10 - vy * 3.4 + jy) * dt;
      vz += ((oz - P[i3 + 2]) * 10 - vz * 3.4 + jz) * dt;
      const sp = Math.hypot(vx, vy, vz);
      if (sp > 3) { const k = 3 / sp; vx *= k; vy *= k; vz *= k; }
      V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;
      P[i3] += vx * dt; P[i3 + 1] = Math.max(P[i3 + 1] + vy * dt, A[i3 + 1] - 0.25); P[i3 + 2] += vz * dt;
      const dx = P[i3] - A[i3], dy = P[i3 + 1] - A[i3 + 1], dz = P[i3 + 2] - A[i3 + 2];
      const near = li >= 0 ? clamp(1 - Math.sqrt(dx * dx + dy * dy + dz * dz) / (1.8 + lr * 2)) : 0;
      glow[i] += ((li >= 0 ? 0.25 + near * near * 0.75 : 0.15) - glow[i]) * ka;
      const i4 = i * 4;
      aPos[i4] = P[i3]; aPos[i4 + 1] = P[i3 + 1]; aPos[i4 + 2] = P[i3 + 2];
      aPos[i4 + 3] = Math.atan2(vx, vz);
      aMisc[i4 + 1] = glow[i];
      aMisc[i4 + 2] = clamp(vy * 0.35, -0.7, 0.7);
    }
    posAttr.needsUpdate = true;
    miscAttr.needsUpdate = true;
  }

  return { mesh, update, uniforms, lamps: lamp };
}

// ---- falling leaves ---------------------------------------------------------------------------

const LEAF_TINTS = ['#8a5a2b', '#a0652c', '#6f7a2e', '#4d6a2c', '#b08238', '#7a3f22', '#5c4a24'].map((c) => new THREE.Color(c));
const _w = new THREE.Vector2();
const _c = new THREE.Color();

function leafGeometry() {
  // A small pointed leaf along z, folded along the midrib and curled lengthwise.
  const rows = 5, verts = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, z = t - 0.5;
    const w = 0.34 * Math.pow(Math.sin(Math.PI * t), 0.8);
    const curl = z * z * 0.3;
    verts.push(-w, curl + w * 0.35, z, 0, curl, z, w, curl + w * 0.35, z);
    if (i < rows) {
      const a = i * 3;
      idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function createLeaves(app, count) {
  const rng = mulberry32(777);
  const geo = leafGeometry();
  const aLeaf = new Float32Array(count * 4); // xyz, size (0 = hidden)
  const aSpin = new Float32Array(count * 4); // seed, rest, yaw, flutter freq
  const leafAttr = new THREE.InstancedBufferAttribute(aLeaf, 4).setUsage(THREE.DynamicDrawUsage);
  const spinAttr = new THREE.InstancedBufferAttribute(aSpin, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aLeaf', leafAttr);
  geo.setAttribute('aSpin', spinAttr);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = app.shared.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; attribute vec4 aLeaf, aSpin;
        mat3 leafRot(float yaw, float rx, float rz) {
          float cy = cos(yaw), sy = sin(yaw), cx = cos(rx), sx = sin(rx), cz = cos(rz), sz = sin(rz);
          mat3 Y = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
          mat3 X = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
          mat3 Z = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0);
          return Y * X * Z;
        }`)
      .replace('#include <beginnormal_vertex>', `
        float lph = uTime * aSpin.w + aSpin.x * 40.0;
        float tumble = 1.0 - aSpin.y;
        float rx = sin(lph) * 0.85 * tumble + (aSpin.x - 0.5) * 0.2 * aSpin.y;
        float rz = (cos(lph * 0.73) * 0.6 + sin(lph * 0.31 + aSpin.x * 9.0) * 1.3) * tumble + (fract(aSpin.x * 7.0) - 0.5) * 0.3 * aSpin.y;
        mat3 lR = leafRot(aSpin.z, rx, rz);
        vec3 objectNormal = lR * normal;`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = aLeaf.xyz + lR * position * aLeaf.w;`);
  };
  mat.customProgramCacheKey = () => 'leaves-v1';
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = 'leaves';
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;

  // per-leaf state: 0 free, 1 falling, 2 resting, 3 fading
  const P = new Float32Array(count * 3), V = new Float32Array(count * 3);
  const state = new Uint8Array(count), timer = new Float32Array(count), ground = new Float32Array(count);
  const size = new Float32Array(count), yawSpeed = new Float32Array(count);
  const free = [];
  for (let i = count - 1; i >= 0; i--) {
    free.push(i);
    aSpin[i * 4] = rng();
    aSpin[i * 4 + 3] = 1.3 + rng() * 1.6;
    aLeaf[i * 4 + 1] = -999;
    mesh.setColorAt(i, _c.copy(LEAF_TINTS[i % LEAF_TINTS.length]));
  }
  let acc = 0, frame = 0;

  function spawn(env, y01 = -1) {
    const i = free.pop();
    if (i === undefined) return;
    const edge = Math.random() < 0.45;
    // half of them start upwind, so the wind carries them over the clearing
    const a = Math.random() < 0.5 ? env.windAngle + Math.PI + (Math.random() - 0.5) * 2.4 : Math.random() * Math.PI * 2;
    const r = edge ? 11 + Math.random() * 9 : 20 + Math.random() * 12;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const g = heightAt(x, z);
    let h = edge ? 4 + Math.random() * 4 : 8 + Math.random() * 6;
    if (y01 >= 0) h = 0.4 + (h - 0.4) * y01;
    const i3 = i * 3;
    P[i3] = x; P[i3 + 1] = g + h; P[i3 + 2] = z;
    V[i3] = 0; V[i3 + 1] = -0.6; V[i3 + 2] = 0;
    ground[i] = g;
    state[i] = 1;
    timer[i] = 0;
    size[i] = 0.16 + Math.random() * 0.1;
    yawSpeed[i] = (Math.random() - 0.5) * 2.4;
    aSpin[i * 4 + 1] = 0;
    aSpin[i * 4 + 2] = Math.random() * Math.PI * 2;
    const base = LEAF_TINTS[Math.floor(Math.random() * LEAF_TINTS.length)];
    mesh.setColorAt(i, _c.copy(base).multiplyScalar(0.7 + Math.random() * 0.45));
    mesh.instanceColor.needsUpdate = true;
  }

  // a few already on the way down when the page opens
  const warm = { windAngle: 0.6 };
  for (let k = 0; k < Math.round(count * 0.3); k++) spawn(warm, Math.random());

  function update(dt, a) {
    const env = a.env;
    const t = env.time;
    frame++;
    const rate = (0.9 + env.windStrength * 5 + env.gust * 2.5 * env.wind) * (0.4 + 0.6 * env.day) * (count / 120);
    acc += dt * rate;
    while (acc >= 1) { acc -= 1; if (free.length) spawn(env); else acc = 0; }
    const kv = 1 - Math.exp(-1.6 * dt);
    const fall = 0.55 + env.rain * 1.4;
    for (let i = 0; i < count; i++) {
      const st = state[i];
      if (!st) continue;
      const i3 = i * 3, i4 = i * 4;
      if (st === 1) {
        env.windAt(P[i3], P[i3 + 2], _w);
        const yaw = aSpin[i4 + 2];
        const lph = t * aSpin[i4 + 3] + aSpin[i4] * 40;
        const sway = Math.cos(lph) * 0.5; // pendulum glide, in step with the shader's rocking
        V[i3] += (_w.x * 2 + Math.sin(yaw) * sway - V[i3]) * kv;
        V[i3 + 2] += (_w.y * 2 + Math.cos(yaw) * sway - V[i3 + 2]) * kv;
        V[i3 + 1] += (-fall * (0.7 + Math.abs(Math.sin(lph)) * 0.6) - V[i3 + 1]) * kv;
        aSpin[i4 + 2] = yaw + yawSpeed[i] * dt * (1 + env.windStrength);
        P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
        // refresh the ground below every few frames, every frame once close
        if ((i + frame) % 8 === 0 || P[i3 + 1] < ground[i] + 0.8) ground[i] = heightAt(P[i3], P[i3 + 2]);
        if (P[i3 + 1] <= ground[i] + 0.03) {
          P[i3 + 1] = ground[i] + 0.03;
          state[i] = 2;
          timer[i] = 3 + Math.random() * 4;
        }
      } else if (st === 2) {
        aSpin[i4 + 1] = Math.min(1, aSpin[i4 + 1] + dt * 5);
        if ((timer[i] -= dt) <= 0) { state[i] = 3; timer[i] = 1.4; }
      } else if ((timer[i] -= dt) <= 0) {
        state[i] = 0;
        aLeaf[i4 + 1] = -999;
        aLeaf[i4 + 3] = 0;
        free.push(i);
        continue;
      }
      aLeaf[i4] = P[i3]; aLeaf[i4 + 1] = P[i3 + 1]; aLeaf[i4 + 2] = P[i3 + 2];
      aLeaf[i4 + 3] = size[i] * (st === 3 ? smoothstep(0, 1.4, timer[i]) : 1);
      if (st === 3) aLeaf[i4 + 1] -= (1.4 - timer[i]) * 0.02;
    }
    leafAttr.needsUpdate = true;
    spinAttr.needsUpdate = true;
  }

  return { mesh, update, get active() { return count - free.length; } };
}
