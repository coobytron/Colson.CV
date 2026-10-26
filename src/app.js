import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { createTerrain, heightAt, raycastGround, CLEARING } from './world/terrain.js';
import { createSky } from './world/sky.js';
import { Environment } from './world/environment.js';
import { createScenery } from './world/scenery.js';
import { createFireflies, createRain, Ripples, Spores } from './world/particles.js';
import { clamp, damp, easeInOutCubic } from './lib/math.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.9 },
    uGrain: { value: 0.028 },
    uAberration: { value: 0.0005 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uAberration;
    varying vec2 vUv;
    float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * uAberration * 40.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col *= mix(1.0, 1.0 - smoothstep(0.15, 0.95, r2 * 1.9), uVignette);
      col += (rand(vUv * 1000.0 + fract(uTime)) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const _focus = new THREE.Vector3();
const _delta = new THREE.Vector3();

export class App {
  constructor(canvas) {
    this.canvas = canvas;
    const params = new URLSearchParams(location.search);
    this.lowQuality = params.get('quality') === 'low' || matchMedia('(max-width: 700px)').matches;
    // Test/dev only: run the simulation N steps per rendered frame (slow software-GL QA runs).
    this.timeScale = Math.max(1, Math.min(16, Math.round(Number(params.get('timescale')) || 1)));

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.maxDpr = this.lowQuality ? 1.25 : 1.75;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    renderer.setPixelRatio(this.dpr);
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 900);
    this.camera.position.set(0, 7.5, 19);

    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.07, minDistance: 3, maxDistance: 36,
      maxPolarAngle: 1.44, minPolarAngle: 0.12, rotateSpeed: 0.55, zoomSpeed: 0.9, panSpeed: 0.8,
      screenSpacePanning: false, autoRotateSpeed: 0.35,
    });
    this.controls.target.set(0, 0.9, 0);
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    // world
    const sky = createSky();
    this.scene.add(sky.mesh);
    const terrain = createTerrain();
    this.scene.add(terrain.mesh);
    this.env = new Environment({ scene: this.scene, renderer, sky, terrainUniforms: terrain.uniforms });
    this.shared = this.env.shared;
    this.scenery = createScenery(this.shared);
    this.scene.add(this.scenery);
    // Circles ({x, z, r}) the avatar and ecosystem layout keep clear of (rocks, logs).
    this.obstacles = this.scenery.userData.obstacles ?? [];
    // Where the shadow camera should centre (follows the orbit target).
    this.env.focus = this.controls.target;
    this.fireflies = createFireflies(this.shared);
    this.scene.add(this.fireflies.points);
    this.rain = createRain(this.shared);
    this.scene.add(this.rain.lines);
    this.ripples = new Ripples();
    this.scene.add(this.ripples.mesh);
    this.spores = new Spores(3000);
    this.scene.add(this.spores.points);

    // post
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.lowQuality || params.has('nomsaa') ? 0 : 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.65, 0.82);
    if (!params.has('nobloom')) this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finalPass = new ShaderPass(FinalShader);
    this.composer.addPass(this.finalPass);

    // interaction
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.modes = {};
    this.mode = null;
    // Things that live across modes (the Gardener avatar, ambient life): { object?, update(dt, app) }.
    this.actors = [];
    this.avatar = null;
    // When set ({ focus(outVec3) }), the camera glides after it while no tween is running.
    this.follow = null;
    this.lastTap = null;
    this.cameraTween = null;
    // Shifts the rendered frame (fraction of the viewport) so UI panels don't cover the subject.
    this.viewShift = new THREE.Vector2();
    this.viewShiftTarget = new THREE.Vector2();
    this.frameTimes = [];
    this.lastInteraction = performance.now();
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  registerMode(id, mode) { this.modes[id] = mode; this.scene.add(mode.group); }

  addActor(a) {
    this.actors.push(a);
    if (a.object) this.scene.add(a.object);
    return a;
  }

  setMode(id) {
    const next = this.modes[id];
    if (!next || next === this.mode) return;
    const prev = this.mode;
    prev?.exit();
    this.mode = next;
    this.modeId = id;
    next.enter(prev);
    this.avatar?.onModeChange?.(next, prev);
    document.body.dataset.mode = id;
    this.onModeChange?.(id);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    // pixels per world unit at distance 1 — lets point sprites be sized in world units
    const px = (h * this.dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    this.fireflies.uniforms.uPixel.value = px;
    this.spores.uniforms.uPixel.value = px;
  }

  // ---- input ----------------------------------------------------------------
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const ray = this.raycaster.ray;
    let best = null, bestT = Infinity;
    for (const m of this.mode?.pickable() ?? []) {
      const t = m.hit(ray);
      if (t !== null && t < bestT) { bestT = t; best = m; }
    }
    const ground = raycastGround(ray);
    return { ray, mushroom: best, point: ground, clientX, clientY };
  }

  bindInput() {
    const c = this.canvas;
    let down = null;
    let captured = false;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      this.markInteraction();
      this.cameraTween = null;
      down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      const hit = this.pick(e.clientX, e.clientY);
      captured = !!this.mode?.onPointerDown?.(hit, e);
      if (captured) {
        this.controls.enabled = false;
        c.setPointerCapture(e.pointerId);
      }
    });
    c.addEventListener('pointermove', (e) => {
      this.pendingMove = e;
      if (down && captured) {
        const hit = this.pick(e.clientX, e.clientY);
        this.mode?.onDrag?.(hit, e);
      }
    });
    const up = (e) => {
      if (!down || e.pointerId !== down.id) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const isClick = moved < 7 && performance.now() - down.t < 500;
      const hit = this.pick(e.clientX, e.clientY);
      if (captured) {
        this.mode?.onPointerUp?.(hit, isClick, e);
        this.controls.enabled = true;
        try { c.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      } else if (isClick) {
        // Modes with tapToWalk send the Gardener to a tapped patch of ground; elsewhere a
        // plain tap keeps its meaning (plant, scatter spores) and a double-tap walks.
        const walk = this.mode?.tapToWalk ? !hit.mushroom : this.isDoubleTap(e);
        if (!(walk && hit.point && this.avatar?.walkTo?.(hit.point))) this.mode?.onClick?.(hit, e);
      }
      down = null;
      captured = false;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { this.pendingMove = null; this.mode?.onHover?.(null); });
    c.addEventListener('wheel', () => { this.markInteraction(); this.cameraTween = null; }, { passive: true });
    this.controls.addEventListener('start', () => { this.markInteraction(); });
  }

  isDoubleTap(e) {
    const now = performance.now();
    const last = this.lastTap;
    this.lastTap = { x: e.clientX, y: e.clientY, t: now };
    if (!last || now - last.t > 350 || Math.hypot(e.clientX - last.x, e.clientY - last.y) > 24) return false;
    this.lastTap = null;
    return true;
  }

  markInteraction() {
    this.lastInteraction = performance.now();
    this.onInteraction?.();
  }

  // ---- camera ---------------------------------------------------------------
  /** Glide the orbit target (and optionally distance/azimuth) somewhere new. */
  flyTo(target, { distance, polar, azimuth, duration = 1.4 } = {}) {
    const fromT = this.controls.target.clone();
    const fromP = this.camera.position.clone();
    const offset = fromP.clone().sub(fromT);
    const sph = new THREE.Spherical().setFromVector3(offset);
    const toSph = sph.clone();
    if (distance !== undefined) toSph.radius = distance;
    if (polar !== undefined) toSph.phi = polar;
    if (azimuth !== undefined) {
      let d = azimuth - sph.theta;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      toSph.theta = sph.theta + d;
    }
    this.cameraTween = { t: 0, duration, fromT, toT: target.clone(), from: sph, to: toSph };
  }

  updateCamera(dt) {
    const tw = this.cameraTween;
    if (tw) {
      tw.t = Math.min(1, tw.t + dt / tw.duration);
      const k = easeInOutCubic(tw.t);
      this.controls.target.lerpVectors(tw.fromT, tw.toT, k);
      const s = new THREE.Spherical(
        tw.from.radius + (tw.to.radius - tw.from.radius) * k,
        tw.from.phi + (tw.to.phi - tw.from.phi) * k,
        tw.from.theta + (tw.to.theta - tw.from.theta) * k,
      );
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(s));
      if (tw.t >= 1) this.cameraTween = null;
    }
    else if (this.follow) {
      // glide the target (and the camera with it) after whatever we're following
      this.follow.focus(_focus);
      const k = 1 - Math.exp(-4 * dt);
      _delta.subVectors(_focus, this.controls.target).multiplyScalar(k);
      this.controls.target.add(_delta);
      this.camera.position.add(_delta);
    }
    this.controls.update(dt);
    const vs = this.viewShift;
    vs.x = damp(vs.x, this.viewShiftTarget.x, 3, dt);
    vs.y = damp(vs.y, this.viewShiftTarget.y, 3, dt);
    if (Math.abs(vs.x) > 1e-4 || Math.abs(vs.y) > 1e-4) {
      const w = innerWidth, h = innerHeight;
      this.camera.setViewOffset(w, h, -vs.x * w, vs.y * h, w, h);
    } else if (this.camera.view?.enabled) {
      this.camera.clearViewOffset();
    }
    // keep the target inside the clearing and the camera above ground
    const t = this.controls.target;
    const r = Math.hypot(t.x, t.z);
    const maxR = this.mode?.cameraRadius ?? CLEARING + 2;
    if (r > maxR) { t.x *= maxR / r; t.z *= maxR / r; }
    t.y = clamp(t.y, heightAt(t.x, t.z) + 0.3, 6);
    const cp = this.camera.position;
    const minY = heightAt(cp.x, cp.z) + 0.5;
    if (cp.y < minY) cp.y = minY;
  }

  // ---- loop -----------------------------------------------------------------
  start() {
    this.clock = new THREE.Clock();
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta());
      // one bad frame must not end the show: report it once and keep drawing
      try { this.frame(dt); } catch (err) { if (!this.frameFailed) { this.frameFailed = true; console.error('frame error', err); } }
    };
    loop();
  }

  frame(dt) {
    if (this.pendingMove) {
      const e = this.pendingMove;
      this.pendingMove = null;
      this.mode?.onHover?.(this.pick(e.clientX, e.clientY), e);
    }
    for (let i = 0; i < this.timeScale; i++) this.step(dt);
    this.rain.uniforms.uCenter.value.copy(this.controls.target);
    this.fireflies.uniforms.uAlpha.value = clamp(1 - this.env.rain * 1.5);
    this.updateCamera(dt * this.timeScale);
    this.finalPass.uniforms.uTime.value = this.env.time;
    this.composer.render(dt);
    this.adaptQuality(dt);
    this.onFrame?.(dt);
  }

  step(dt) {
    this.env.update(dt);
    for (const m of Object.values(this.modes)) m.update(dt, m === this.mode);
    for (const a of this.actors) a.update(dt, this);
    this.spores.update(dt * this.env.speed, this.env);
    this.ripples.update(dt, this.env.rain, this.controls.target);
  }

  adaptQuality(dt) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    // Only ever step down: stepping back up tends to oscillate.
    if (avg > 1 / 38 && this.dpr > 0.8) {
      this.dpr = Math.max(0.75, this.dpr - 0.25);
      this.resize();
    }
  }

  screenshot() {
    this.composer.render(0);
    this.canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mycelia-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  /** Projects a world position to CSS pixels. Returns null if behind the camera. */
  toScreen(v, out = { x: 0, y: 0, z: 0 }) {
    const p = v.clone().project(this.camera);
    if (p.z > 1) return null;
    out.x = (p.x * 0.5 + 0.5) * innerWidth;
    out.y = (-p.y * 0.5 + 0.5) * innerHeight;
    out.z = p.z;
    return out;
  }
}
