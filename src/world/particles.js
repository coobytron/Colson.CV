import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { mulberry32 } from '../lib/math.js';


/** Fireflies + floating motes, fully animated on the GPU. */
export function createFireflies(shared, count = 220) {
  const rng = mulberry32(99);
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(rng()) * 24;
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    pos.set([x, heightAt(x, z) + 0.3 + rng() * 2.6, z], i * 3);
    seed[i] = rng();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = { ...shared, uAlpha: { value: 1 }, uPixel: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime, uPixel, uNight; uniform vec3 uWind;
      attribute float aSeed;
      varying float vA; varying float vSeed;
      void main() {
        vec3 p = position;
        float t = uTime * (0.25 + aSeed * 0.25) + aSeed * 50.0;
        p += vec3(sin(t * 1.3) * 0.9, sin(t * 0.9 + 1.7) * 0.45, cos(t * 1.1) * 0.9);
        p.xz += uWind.xy * uWind.z * sin(uTime * 0.4 + aSeed * 9.0) * 1.2;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float blink = smoothstep(0.35, 1.0, sin(uTime * (1.2 + aSeed * 2.0) + aSeed * 30.0) * 0.5 + 0.5);
        vA = blink * uNight;
        vSeed = aSeed;
        gl_PointSize = (0.22 + aSeed * 0.14) * uPixel / -mv.z;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      varying float vA; varying float vSeed;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float halo = 1.0 - smoothstep(0.0, 0.5, d);
        float core = 1.0 - smoothstep(0.0, 0.12, d);
        vec3 col = mix(vec3(0.75, 1.0, 0.45), vec3(1.0, 0.8, 0.35), vSeed);
        gl_FragColor = vec4(col * (core * 3.0 + halo * halo * 0.6), (core + halo * halo * 0.5) * vA * uAlpha);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, uniforms };
}

/** GPU rain streaks that follow the camera target. */
export function createRain(shared, count = 2600) {
  const pos = new Float32Array(count * 2 * 3);
  const seed = new Float32Array(count * 2);
  const end = new Float32Array(count * 2);
  const rng = mulberry32(7);
  for (let i = 0; i < count; i++) {
    const x = (rng() - 0.5) * 50, z = (rng() - 0.5) * 50, s = rng();
    for (let k = 0; k < 2; k++) {
      pos.set([x, 0, z], (i * 2 + k) * 3);
      seed[i * 2 + k] = s;
      end[i * 2 + k] = k;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const uniforms = { ...shared, uCenter: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(0.55, 0.7, 0.8) } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime, uRain; uniform vec3 uWind, uCenter;
      attribute float aSeed, aEnd;
      varying float vA;
      void main() {
        float H = 18.0;
        float fall = 14.0 + aSeed * 6.0;
        float y = H - mod(uTime * fall + aSeed * H * 7.0, H);
        vec3 p = vec3(position.x + uCenter.x, y + uCenter.y - 2.0, position.z + uCenter.z);
        vec2 slant = uWind.xy * uWind.z * 0.45;
        p.xz += slant * (H - y) * 0.35;
        float len = 0.35 + uRain * 0.25;
        p.y += aEnd * len;
        p.xz -= slant * aEnd * len;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        vA = step(aSeed, uRain) * (0.18 + aEnd * 0.32);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying float vA;
      void main() { gl_FragColor = vec4(uColor, vA); }`,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return { lines, uniforms };
}

/** Ripple rings where raindrops hit the ground. CPU-recycled instances. */
export class Ripples {
  constructor(count = 160) {
    this.count = count;
    const geo = new THREE.RingGeometry(0.8, 1, 32, 1);
    geo.rotateX(-Math.PI / 2);
    this.age = new Float32Array(count).fill(1);
    this.ageAttr = new THREE.InstancedBufferAttribute(this.age, 1);
    geo.setAttribute('aAge', this.ageAttr);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aAge; varying float vA;
        void main() {
          vA = (1.0 - aAge) * step(aAge, 0.999);
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() { gl_FragColor = vec4(vec3(0.5, 0.7, 0.8) * 0.35, vA * vA); }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.pos = Array.from({ length: count }, () => new THREE.Vector3());
    this.next = 0;
    this.m = new THREE.Matrix4();
    this.acc = 0;
  }

  spawn(x, z) {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.pos[i].set(x, heightAt(x, z) + 0.03, z);
    this.age[i] = 0;
  }

  update(dt, rain, center) {
    this.acc += dt * rain * 90;
    while (this.acc > 1) {
      this.acc -= 1;
      this.spawn(center.x + (Math.random() - 0.5) * 30, center.z + (Math.random() - 0.5) * 30);
    }
    for (let i = 0; i < this.count; i++) {
      if (this.age[i] < 1) this.age[i] = Math.min(1, this.age[i] + dt * 1.6);
      const s = 0.05 + this.age[i] * 0.45;
      this.m.makeScale(s, 1, s).setPosition(this.pos[i]);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.ageAttr.needsUpdate = true;
  }
}

/**
 * CPU spore particles with simple physics (gravity, drag, wind, ground contact).
 * Used by the simulator and for bursts when poking mushrooms.
 */
export class Spores {
  constructor(max = 3000) {
    this.max = max;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.c = new Float32Array(max * 3);
    this.life = new Float32Array(max); // remaining seconds
    this.landed = new Uint8Array(max);
    this.owner = new Array(max).fill(null);
    this.alpha = new Float32Array(max);
    this.free = [];
    for (let i = max - 1; i >= 0; i--) this.free.push(i);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage);
    this.aAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setAttribute('aAlpha', this.aAttr);
    this.uniforms = { uPixel: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      vertexShader: /* glsl */ `
        uniform float uPixel; attribute float aAlpha; varying vec3 vC; varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          vC = color; vA = aAlpha;
          gl_PointSize = 0.075 * uPixel / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vC * 1.8, (1.0 - smoothstep(0.0, 0.5, d)) * vA);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < max; i++) this.p[i * 3 + 1] = -999;
    this.onLand = null;
  }

  emit(x, y, z, vx, vy, vz, color, owner = null, life = 6) {
    const i = this.free.pop();
    if (i === undefined) return;
    this.p.set([x, y, z], i * 3);
    this.v.set([vx, vy, vz], i * 3);
    this.c.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life;
    this.landed[i] = 0;
    this.owner[i] = owner;
  }

  get active() { return this.max - this.free.length; }

  update(dt, env) {
    const w = new THREE.Vector2();
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) {
        this.p[k + 1] = -999;
        this.alpha[i] = 0;
        this.owner[i] = null;
        this.free.push(i);
        continue;
      }
      if (!this.landed[i]) {
        env.windAt(this.p[k], this.p[k + 2], w);
        const drag = 1.6;
        this.v[k] += ((w.x * 2.2 - this.v[k]) * drag) * dt;
        this.v[k + 2] += ((w.y * 2.2 - this.v[k + 2]) * drag) * dt;
        this.v[k + 1] += (-0.55 - this.v[k + 1] * drag - env.rain * 2.5) * dt;
        // turbulence
        this.v[k] += (Math.random() - 0.5) * 1.2 * dt;
        this.v[k + 2] += (Math.random() - 0.5) * 1.2 * dt;
        this.p[k] += this.v[k] * dt;
        this.p[k + 1] += this.v[k + 1] * dt;
        this.p[k + 2] += this.v[k + 2] * dt;
        const g = heightAt(this.p[k], this.p[k + 2]);
        if (this.p[k + 1] <= g + 0.02) {
          this.p[k + 1] = g + 0.02;
          this.landed[i] = 1;
          this.life[i] = Math.min(this.life[i], 2.5);
          this.onLand?.(this.p[k], this.p[k + 2], this.owner[i]);
        }
      }
      this.alpha[i] = Math.min(1, this.life[i] * 0.8) * (this.landed[i] ? 0.5 : 0.9);
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.aAttr.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] > 0) { this.life[i] = 0; this.p[i * 3 + 1] = -999; this.alpha[i] = 0; this.free.push(i); }
      this.owner[i] = null;
    }
    this.posAttr.needsUpdate = true;
  }
}

