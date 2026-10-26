import * as THREE from 'three';
import { buildMushroomGeometry } from './geometry.js';
import { createMushroomMaterial } from './material.js';
import { heightAt, normalAt } from '../world/terrain.js';
import { clamp, damp, easeOutBack, easeOutCubic, smoothstep } from '../lib/math.js';

let poolTexture = null;
function getPoolTexture() {
  if (poolTexture) return poolTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  poolTexture = new THREE.CanvasTexture(c);
  poolTexture.colorSpace = THREE.SRGBColorSpace;
  return poolTexture;
}
const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

const _v = new THREE.Vector3();
const _w = new THREE.Vector2();
const _up = new THREE.Vector3(0, 1, 0);

export class Mushroom {
  /**
   * @param {object} genome
   * @param {object} opts { x, z, scale, seed, grow, data, ghost, rotation, detail }
   */
  constructor(genome, opts = {}) {
    this.genome = genome;
    this.seed = opts.seed ?? Math.floor(Math.random() * 1e9);
    this.scale = opts.scale ?? 1;
    this.data = opts.data ?? null;
    this.ghost = !!opts.ghost;
    this.detail = opts.detail ?? 1;

    this.group = new THREE.Group();
    this.rotY = opts.rotation ?? ((this.seed % 628) / 100);
    this.group.userData.mushroom = this;

    const { material, depthMaterial, uniforms } = createMushroomMaterial(genome, { transparent: this.ghost });
    this.uniforms = uniforms;
    this.material = material;
    this.depthMaterial = depthMaterial;
    uniforms.uSeed.value = (this.seed % 1000) / 1000;

    this.mesh = new THREE.Mesh(undefined, material);
    this.mesh.customDepthMaterial = depthMaterial;
    this.mesh.castShadow = !this.ghost;
    this.mesh.receiveShadow = !this.ghost;
    this.group.add(this.mesh);

    this.poolMat = new THREE.MeshBasicMaterial({
      map: getPoolTexture(), color: new THREE.Color(genome.glowColor), transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
    });
    this.pool = new THREE.Mesh(poolGeo, this.poolMat);
    this.pool.renderOrder = 1;
    this.group.add(this.pool);

    this.buildGeometry();

    // life / animation state
    this.grow = opts.grow ?? 0;
    this.autoGrow = opts.autoGrow ?? true;
    this.growSpeed = opts.growSpeed ?? 0.45;
    this.growT = this.grow;
    this.open = 1;
    this.wilt = 0;
    this.appear = opts.appear ?? 1;
    this.appearTarget = 1;
    this.appearDelay = 0;
    this.highlight = 0;
    this.highlightTarget = 0;
    this.dim = 0;
    this.dimTarget = 0;

    // spring physics for the stem
    this.bend = new THREE.Vector2();
    this.bendVel = new THREE.Vector2();
    this.grabTarget = null;
    this.extraBend = new THREE.Vector2(); // steady offset (e.g. wilting droop)

    this.setPosition(opts.x ?? 0, opts.z ?? 0);
  }

  buildGeometry() {
    const info = buildMushroomGeometry(this.genome, this.seed, this.detail);
    this.mesh.geometry?.dispose();
    this.mesh.geometry = info.geometry;
    info.geometry.boundingSphere.radius *= 1.4;
    this.info = info;
    this.uniforms.uStemTop.value.copy(info.capOrigin);
    this.uniforms.uGlow.value = this.genome.glow;
    this.uniforms.uGlowColor.value.set(this.genome.glowColor);
    this.poolMat.color.set(this.genome.glowColor);
    const s = info.capR * 5;
    this.pool.scale.set(s, 1, s);
    this.pool.position.set(info.capOrigin.x * 0.6, 0.04, info.capOrigin.z * 0.6);
  }

  setGenome(genome) {
    this.genome = genome;
    this.buildGeometry();
  }

  setPosition(x, z) {
    this.x = x; this.z = z;
    this.group.position.set(x, heightAt(x, z), z);
    // lean slightly with the slope for a natural look
    const n = normalAt(x, z, _v);
    const q = new THREE.Quaternion().setFromUnitVectors(_up, n);
    q.slerp(new THREE.Quaternion(), 0.6);
    this.group.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(_up, this.rotY));
    this.group.updateMatrixWorld();
  }

  /** Height of the cap top above the ground, world units. */
  get height() { return this.info.capTop * this.scale; }
  get radius() { return this.info.capR * this.scale; }

  impulse(x, z) { this.bendVel.x += x; this.bendVel.y += z; }

  update(dt, env) {
    // growth
    if (this.autoGrow && this.growT < 1) {
      this.growT = Math.min(1, this.growT + dt * this.growSpeed);
      this.grow = easeOutCubic(this.growT);
    }
    this.open = smoothstep(0.3, 1, this.grow);

    // appear / disappear (mode transitions)
    if (this.appearDelay > 0) this.appearDelay -= dt;
    else this.appear = damp(this.appear, this.appearTarget, this.appearTarget > this.appear ? 5 : 9, dt);
    const ap = this.appearTarget > 0 ? easeOutBack(clamp(this.appear)) : clamp(this.appear);
    this.group.scale.setScalar(Math.max(0.0001, this.scale * ap));
    this.group.visible = this.appear > 0.01;

    // spring physics — world wind converted into the mushroom's local frame
    env.windAt(this.x, this.z, _w);
    const tall = clamp(this.height / 1.6, 0.3, 1.6);
    const k = 26, c = 3.4;
    const cs = Math.cos(this.rotY), sn = Math.sin(this.rotY);
    const wx = _w.x * cs - _w.y * sn, wz = _w.x * sn + _w.y * cs;
    let ax = -k * (this.bend.x - this.extraBend.x) - c * this.bendVel.x + wx * 0.16 * k * tall;
    let az = -k * (this.bend.y - this.extraBend.y) - c * this.bendVel.y + wz * 0.16 * k * tall;
    if (this.grabTarget) {
      ax += (this.grabTarget.x - this.bend.x) * 90;
      az += (this.grabTarget.y - this.bend.y) * 90;
    }
    this.bendVel.x += ax * dt;
    this.bendVel.y += az * dt;
    this.bend.x += this.bendVel.x * dt;
    this.bend.y += this.bendVel.y * dt;
    const len = this.bend.length();
    if (len > 0.85) this.bend.multiplyScalar(0.85 / len);

    this.highlight = damp(this.highlight, this.highlightTarget, 8, dt);
    this.dim = damp(this.dim, this.dimTarget, 5, dt);

    const u = this.uniforms;
    u.uTime.value = env.time;
    u.uGrow.value = Math.max(0.02, this.grow);
    u.uOpen.value = this.open;
    u.uWilt.value = this.wilt;
    u.uBend.value.copy(this.bend);
    u.uHighlight.value = this.highlight;
    u.uNight.value = env.night;
    u.uDim.value = this.dim;
    this.poolMat.opacity = this.ghost ? 0 : this.genome.glow * (0.08 + env.night * 0.16) * this.grow * (1 - this.wilt) * (1 - this.dim * 0.8) * (1 + this.highlight * 0.6);
  }

  /** Converts a world-space horizontal offset into local bend space (for grabbing). */
  worldToBend(dx, dz, out = new THREE.Vector2()) {
    const cs = Math.cos(this.rotY), sn = Math.sin(this.rotY);
    const h = Math.max(0.2, this.height);
    return out.set((dx * cs - dz * sn) / h, (dx * sn + dz * cs) / h);
  }

  capWorldPosition(out = new THREE.Vector3()) {
    const o = this.info.capOrigin;
    const g = Math.max(0.05, this.grow);
    out.set(o.x + this.bend.x * o.y * g, this.info.capTop * g, o.z + this.bend.y * o.y * g);
    return this.group.localToWorld(out);
  }

  /** Ray vs. capsule (base → cap) hit test. Returns distance along the ray or null. */
  hit(ray) {
    if (!this.group.visible || this.appear < 0.5) return null;
    const a = this.group.position;
    const b = this.capWorldPosition(_v);
    const r = Math.max(this.radius * 0.95 * Math.max(0.35, this.grow), 0.18);
    const res = raySegment(ray, a, b);
    if (res.dist < r) return res.t;
    return null;
  }

  dispose() {
    this.mesh.geometry?.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.poolMat.dispose();
    this.group.removeFromParent();
  }
}

const _d = new THREE.Vector3(), _r = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3();
function raySegment(ray, a, b) {
  const u = ray.direction;
  const v = _d.subVectors(b, a);
  const w = _r.subVectors(ray.origin, a);
  const aa = u.dot(u), bb = u.dot(v), cc = v.dot(v), dd = u.dot(w), ee = v.dot(w);
  const D = aa * cc - bb * bb;
  let sc, tc;
  if (D < 1e-6) { sc = 0; tc = bb > cc ? dd / bb : ee / cc; }
  else { sc = (bb * ee - cc * dd) / D; tc = (aa * ee - bb * dd) / D; }
  tc = clamp(tc, 0, 1);
  sc = Math.max(0, (bb * tc - dd) / aa);
  _p1.copy(ray.origin).addScaledVector(u, sc);
  _p2.copy(a).addScaledVector(v, tc);
  return { dist: _p1.distanceTo(_p2), t: sc };
}
