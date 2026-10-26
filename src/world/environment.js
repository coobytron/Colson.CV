import * as THREE from 'three';
import { damp, clamp, smoothstep, noise2, lerp } from '../lib/math.js';

// Time-of-day palettes. t: 0 = midnight, .25 = dawn, .5 = noon, .75 = dusk.
const P = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? new THREE.Color(v) : v]));
const NIGHT = P({ top: '#01050b', horizon: '#0c2c36', bottom: '#020607', fog: '#071c22', hemiSky: '#3a6f80', hemiGround: '#0a120e', hemi: 1.05, key: '#9cc0ff', keyI: 0.9, sun: '#9fc3ff', exposure: 1.15 });
const DAWN = P({ top: '#1b2a4a', horizon: '#c9876a', bottom: '#150f10', fog: '#3c3a44', hemiSky: '#8aa0c0', hemiGround: '#1a1410', hemi: 0.8, key: '#ffb488', keyI: 1.4, sun: '#ffb070', exposure: 0.95 });
const DAY = P({ top: '#2f6a86', horizon: '#9ec4c0', bottom: '#1e2a26', fog: '#6f9795', hemiSky: '#cfe8ff', hemiGround: '#2a3322', hemi: 1.1, key: '#fff0d8', keyI: 2.6, sun: '#fff2d0', exposure: 0.85 });
const DUSK = P({ top: '#15163a', horizon: '#d8704a', bottom: '#120a0c', fog: '#3a2632', hemiSky: '#8a7aa8', hemiGround: '#150c0c', hemi: 0.75, key: '#ff8a5a', keyI: 1.2, sun: '#ff7a40', exposure: 0.95 });
// Golden hour: a low amber sun raking through warm haze, the sky still blue overhead (the CV's setting)
const GOLDEN = P({ top: '#35507e', horizon: '#ffb25a', bottom: '#2a1a0e', fog: '#b9844f', hemiSky: '#ffd8a0', hemiGround: '#3a2614', hemi: 1.05, key: '#ffb15a', keyI: 2.3, sun: '#ffb040', exposure: 0.95 });
export const GOLDEN_HOUR = 0.7;
const KEYS = [
  [0.0, NIGHT], [0.2, NIGHT], [0.27, DAWN], [0.36, DAY], [0.62, DAY], [GOLDEN_HOUR, GOLDEN], [0.76, DUSK], [0.82, NIGHT], [1.0, NIGHT],
];
const STORM_TINT = new THREE.Color('#1c2428');

function samplePalette(t, out) {
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [t0, a] = KEYS[i], [t1, b] = KEYS[i + 1];
    if (t >= t0 && t <= t1) {
      const k = smoothstep(0, 1, (t - t0) / (t1 - t0 || 1));
      for (const key of Object.keys(a)) {
        if (a[key].isColor) (out[key] ||= new THREE.Color()).copy(a[key]).lerp(b[key], k);
        else out[key] = lerp(a[key], b[key], k);
      }
      return out;
    }
  }
  return out;
}

const SHADOW_EXTENT = 22;
const SHADOW_TEXEL = (SHADOW_EXTENT * 2) / 2048;
const _lx = new THREE.Vector3(), _ly = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export class Environment {
  constructor({ scene, renderer, sky, terrainUniforms }) {
    this.scene = scene;
    this.renderer = renderer;
    this.sky = sky;
    this.terrainUniforms = terrainUniforms;

    this.time = 0; // seconds since start (for shaders)
    this.timeOfDay = 0.02;
    this.targetTimeOfDay = 0.02;
    this.cycle = false; // advance time automatically
    this.dayLength = 150; // seconds per full day at 1x
    this.speed = 1;

    this.rain = 0; this.targetRain = 0;
    this.wind = 0.15; this.targetWind = 0.15;
    this.mist = 0.25; this.targetMist = 0.25;
    this.storm = 0; this.targetStorm = 0;
    this.flash = 0;
    this.nextFlash = 3;
    this.windAngle = 0.6;
    this.windVec = new THREE.Vector2(1, 0);
    this.gust = 0;
    this.wetness = 0;
    this.night = 1;
    this.day = 0;
    this.minNight = 0; // keeps the bioluminescence glowing in daylight (golden hour); 0 = only at night
    this.onLightning = null;

    this.pal = {};
    scene.fog = new THREE.FogExp2(0x061a20, 0.03);

    this.hemi = new THREE.HemisphereLight(0x2a5566, 0x050807, 0.5);
    scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0x8fb8ff, 0.5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const s = SHADOW_EXTENT;
    Object.assign(this.key.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 120 });
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.03;
    this.key.shadow.radius = 4;
    scene.add(this.key, this.key.target);

    // Soft uplight from the glowing clearing, keeps the scene readable at night.
    this.fill = new THREE.PointLight(0x35e0d8, 0, 26, 1.6);
    this.fill.position.set(0, 2.2, 0);
    scene.add(this.fill);

    this.shared = {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector3(1, 0, 0.15) }, // xy = dir, z = strength (with gusts)
      uNight: { value: 1 },
      uRain: { value: 0 },
    };
  }

  /** Blend all weather targets at once. */
  setWeather({ rain, wind, mist, storm } = {}) {
    if (rain !== undefined) this.targetRain = rain;
    if (wind !== undefined) this.targetWind = wind;
    if (mist !== undefined) this.targetMist = mist;
    if (storm !== undefined) this.targetStorm = storm;
  }

  update(dt) {
    this.time += dt;
    const simDt = dt * this.speed;
    if (this.cycle) {
      this.timeOfDay = (this.timeOfDay + simDt / this.dayLength) % 1;
      this.targetTimeOfDay = this.timeOfDay;
    } else {
      // shortest way around the clock
      let d = this.targetTimeOfDay - this.timeOfDay;
      if (d > 0.5) d -= 1; if (d < -0.5) d += 1;
      this.timeOfDay = (this.timeOfDay + d * (1 - Math.exp(-1.5 * dt)) + 1) % 1;
    }

    this.rain = damp(this.rain, this.targetRain, 0.8, dt);
    this.wind = damp(this.wind, this.targetWind, 0.8, dt);
    this.mist = damp(this.mist, this.targetMist, 0.6, dt);
    this.storm = damp(this.storm, this.targetStorm, 0.8, dt);
    this.wetness = clamp(this.wetness + (this.rain * 0.25 - (0.02 + this.day * 0.05) * (1 - this.rain)) * simDt, 0, 1);

    // wind direction drifts; gusts from noise
    this.windAngle += (noise2(this.time * 0.03, 3.3)) * 0.004;
    this.gust = Math.max(0, noise2(this.time * 0.35, 7.1)) * (0.6 + this.storm);
    const strength = this.wind * (0.75 + this.gust * 0.9);
    this.windVec.set(Math.cos(this.windAngle), Math.sin(this.windAngle));
    this.windStrength = strength;

    // lightning
    this.flash = Math.max(0, this.flash - dt * 3.2);
    if (this.storm > 0.5) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.flash = 1;
        this.nextFlash = 2.5 + Math.random() * 7;
        this.onLightning?.();
      }
    }
    const flicker = this.flash > 0 ? this.flash * (0.6 + 0.4 * Math.sin(this.time * 60)) : 0;

    // palette
    const pal = samplePalette(this.timeOfDay, this.pal);
    const sunA = (this.timeOfDay - 0.25) * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(sunA) * 0.75, Math.sin(sunA), 0.45).normalize();
    this.day = smoothstep(-0.05, 0.25, sunDir.y);
    this.night = Math.max(1 - this.day, this.minNight);
    const lightDir = sunDir.y > -0.02 ? sunDir : sunDir.clone().negate().setY(Math.abs(sunDir.y) * 0.8 + 0.35).normalize();

    const gloom = clamp(this.rain * 0.6 + this.storm * 0.4);
    const dim = 1 - gloom * 0.55;
    const tint = (c) => c.clone().lerp(STORM_TINT, gloom * 0.55);

    this.sky.uniforms.uTop.value.copy(tint(pal.top)).multiplyScalar(dim);
    this.sky.uniforms.uHorizon.value.copy(tint(pal.horizon)).multiplyScalar(dim);
    this.sky.uniforms.uBottom.value.copy(pal.bottom);
    this.sky.uniforms.uSunDir.value.copy(sunDir.y > -0.1 ? sunDir : lightDir);
    this.sky.uniforms.uSunColor.value.copy(pal.sun).multiplyScalar((1 - gloom) * (sunDir.y > -0.1 ? 1 : 0.35));
    this.sky.uniforms.uStars.value = this.night * (1 - gloom);
    this.sky.uniforms.uFlash.value = flicker * 0.9;
    this.sky.uniforms.uTime.value = this.time;
    this.sky.uniforms.uCloud.value = clamp(0.25 + gloom * 0.9 + this.mist * 0.2);

    const fogCol = tint(pal.fog).multiplyScalar(dim);
    fogCol.lerp(new THREE.Color(0x9ab0c0), flicker * 0.25);
    this.scene.fog.color.copy(fogCol);
    this.scene.fog.density = 0.012 + this.mist * 0.045 + this.rain * 0.012;
    this.sky.uniforms.uHorizon.value.lerp(fogCol, 0.5 + this.mist * 0.4);

    this.hemi.color.copy(pal.hemiSky);
    this.hemi.groundColor.copy(pal.hemiGround);
    this.hemi.intensity = pal.hemi * dim + flicker * 1.5;
    this.key.color.copy(pal.key).lerp(new THREE.Color(0xcfe0ff), flicker);
    this.key.intensity = pal.keyI * (1 - gloom * 0.75) + flicker * 5;
    if (this.focus) {
      // Centre the shadow frustum on the focus, snapped to whole shadow texels in light space so
      // the shadow edges don't shimmer as the camera glides.
      const f = this.focus, tgt = this.key.target.position;
      _lx.crossVectors(_up, lightDir);
      if (_lx.lengthSq() < 1e-6) _lx.set(1, 0, 0);
      _lx.normalize();
      _ly.crossVectors(lightDir, _lx);
      const fx = Math.round(f.dot(_lx) / SHADOW_TEXEL) * SHADOW_TEXEL;
      const fy = Math.round(f.dot(_ly) / SHADOW_TEXEL) * SHADOW_TEXEL;
      tgt.copy(lightDir).multiplyScalar(f.dot(lightDir)).addScaledVector(_lx, fx).addScaledVector(_ly, fy);
      this.key.target.updateMatrixWorld();
      this.key.position.copy(tgt).addScaledVector(lightDir, 50);
    } else {
      this.key.position.copy(lightDir).multiplyScalar(50);
    }
    this.fill.intensity = this.night * 2.2 + 0.2;
    this.renderer.toneMappingExposure = pal.exposure;

    this.terrainUniforms.uWet.value = Math.max(this.wetness, this.rain * 0.8);
    this.terrainUniforms.uTime.value = this.time;

    this.shared.uTime.value = this.time;
    this.shared.uWind.value.set(this.windVec.x, this.windVec.y, strength);
    this.shared.uNight.value = this.night;
    this.shared.uRain.value = this.rain;
  }

  /** Wind force at a world position (includes gust waves travelling across the ground). */
  windAt(x, z, out = new THREE.Vector2()) {
    const wave = 0.55 + 0.45 * Math.sin(this.time * 1.7 - (x * this.windVec.x + z * this.windVec.y) * 0.35);
    const local = 0.7 + 0.3 * noise2(x * 0.2 + this.time * 0.5, z * 0.2);
    const s = this.windStrength * wave * local;
    return out.set(this.windVec.x * s, this.windVec.y * s);
  }

  clockLabel() {
    const mins = Math.floor(this.timeOfDay * 24 * 60);
    const h = Math.floor(mins / 60), m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
