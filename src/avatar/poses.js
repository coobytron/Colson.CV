import * as THREE from 'three';
import { HIP_Y } from './rig.js';
import { clamp, smoothstep } from '../lib/math.js';

/**
 * Pose tables and the animation layer for the Gardener rig.
 * Rotations are Euler [x, y, z] in each joint's own order (thighs are YZX). +x tilts an upright
 * segment forward and swings a hanging one back.
 */

const HALF_PI = Math.PI / 2;
export const LID_OPEN = 1.9;

// cross-legged typing, laptop open on the lap (the splash pose)
export const SIT_TYPE = {
  hips: [0, 0, 0], hipsPos: [0, 0.08, -0.06],
  spine: [0.2, 0, 0], neck: [0.1, 0, 0], head: [0.3, 0, 0],
  thighL: [-HALF_PI + 0.08, 0.62, -HALF_PI], shinL: [2.32, 0, 0],
  thighR: [-HALF_PI + 0.02, -0.62, HALF_PI], shinR: [2.32, 0, 0],
  upperArmL: [-0.28, 0, 0.2], forearmL: [-1.64, 0, -0.6],
  upperArmR: [-0.28, 0, -0.2], forearmR: [-1.64, 0, 0.6],
  // laptop in root space; lid angle
  laptopPos: [0, 0.17, 0.25], laptopRot: [-0.06, 0, 0], lid: LID_OPEN,
};

export const STAND = {
  hips: [0, 0, 0], hipsPos: [0, HIP_Y, 0],
  spine: [0.03, 0, 0], neck: [0.02, 0, 0], head: [0.06, 0, 0],
  thighL: [-0.02, 0.04, 0], shinL: [0.05, 0, 0],
  thighR: [-0.02, -0.04, 0], shinR: [0.05, 0, 0],
  upperArmL: [0.04, 0, 0.1], forearmL: [-0.22, 0, 0],
  upperArmR: [0.04, 0, -0.1], forearmR: [-0.22, 0, 0],
  lid: 0,
};

// laptop tucked under the right arm, lid closed (overrides STAND / KNEEL)
export const CARRY = {
  upperArmR: [-0.08, 0, -0.4], forearmR: [-1.25, 0, 0.35],
  // laptop in *spine* space: on edge against the right ribs, long side forward
  laptopPos: [-0.143, 0.19, 0.03], laptopRot: [-HALF_PI, 0, -HALF_PI],
};

// one knee down, leaning in, head down, left hand reaching toward the mushroom
export const KNEEL = {
  hips: [0, 0, 0], hipsPos: [0, 0.43, -0.08],
  spine: [0.42, 0, 0], neck: [0.15, 0, 0], head: [0.32, 0, 0],
  thighL: [-1.42, 0.12, 0], shinL: [1.38, 0, 0],
  thighR: [0.22, -0.06, 0], shinR: [1.3, 0, 0],
  upperArmL: [-1.05, 0, 0.12], forearmL: [-0.25, 0, 0],
  upperArmR: [-0.08, 0, -0.4], forearmR: [-1.25, 0, 0.35],
  lid: 0,
};

export const JOINTS = ['hips', 'spine', 'neck', 'head', 'upperArmL', 'forearmL', 'upperArmR', 'forearmR', 'thighL', 'shinL', 'thighR', 'shinR'];
const POSE_LIST = [SIT_TYPE, { ...STAND, ...CARRY }, { ...KNEEL }];
export const SIT = 0, STANDING = 1, KNEELING = 2;

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

/** Drives a rig from pose weights + walk / idle layers. No allocations per frame. */
export class Poser {
  constructor(rig) {
    this.rig = rig;
    const J = rig.joints;
    this.joints = JOINTS.map((name) => J[name]);
    // per pose, per joint: rest quaternion
    this.quats = POSE_LIST.map((pose) => JOINTS.map((name, i) => {
      const r = pose[name] ?? [0, 0, 0];
      return new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], this.joints[i].rotation.order));
    }));
    this.pitch = POSE_LIST.map((pose) => pose.spine[0] + pose.neck[0] + pose.head[0]);
    this.hipsPos = POSE_LIST.map((pose) => new THREE.Vector3(...pose.hipsPos));
    this.sitLapPos = new THREE.Vector3(...SIT_TYPE.laptopPos);
    this.sitLapQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...SIT_TYPE.laptopRot));
    this.carryLocal = new THREE.Matrix4().compose(new THREE.Vector3(...CARRY.laptopPos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...CARRY.laptopRot)), _one);
    this.add = JOINTS.map(() => new Float32Array(3)); // additive euler per joint
    this.idx = Object.fromEntries(JOINTS.map((n, i) => [n, i]));
    this.braid = rig.joints.braids.map(() => ({ x: 0, z: 0, vx: 0, vz: 0 }));
    this.lid = LID_OPEN;
    this.lidOpen = 1;
  }

  /**
   * w: [sit, stand, kneel] weights (sum 1). o: { t, dt, walk, phase, run, idle, accX, accZ }
   * idle = standing-still weight (breathing + looking around).
   */
  apply(w, o) {
    const add = this.add, I = this.idx;
    for (const a of add) a.fill(0);
    const t = o.t;

    // ---- idle layers ----
    const sitW = w[SIT];
    const breath = Math.sin(t * 1.6);
    // splash typing: breathing torso, head bobbing over the screen, fingers tapping
    add[I.spine][0] += 0.03 * breath * sitW;
    add[I.head][0] += 0.02 * Math.sin(t * 1.6 + 0.6) * sitW;
    add[I.forearmL][0] += 0.03 * Math.sin(t * 17) * sitW;
    add[I.forearmR][0] += 0.03 * Math.sin(t * 17 + 2.1) * sitW;
    // standing / kneeling: gentle breathing, the odd look around
    const up = 1 - sitW;
    add[I.spine][0] += 0.015 * breath * up;
    add[I.upperArmL][2] += 0.02 * breath * up;
    const look = Math.sin(t * 0.31) * smoothstep(0.35, 0.85, Math.abs(Math.sin(t * 0.13 + 1.3)));
    add[I.head][1] += 0.5 * look * o.idle;
    add[I.neck][1] += 0.2 * look * o.idle;
    add[I.head][0] += 0.08 * Math.sin(t * 0.21) * o.idle;

    // ---- walk / run cycle (driven by distance) ----
    const wk = o.walk;
    if (wk > 0.001) {
      const ph = o.phase, sn = Math.sin(ph), r = o.run;
      const amp = 0.55 * (1 + 0.3 * r) * wk;
      add[I.thighL][0] -= amp * sn;
      add[I.thighR][0] += amp * sn;
      const kb = (0.85 + 0.45 * r) * wk;
      add[I.shinL][0] += 0.12 * wk + kb * Math.max(0, Math.cos(ph + 0.3));
      add[I.shinR][0] += 0.12 * wk + kb * Math.max(0, -Math.cos(ph + 0.3));
      const arm = (0.42 + 0.25 * r) * wk;
      add[I.upperArmL][0] += arm * sn;
      add[I.upperArmR][0] -= arm * sn * 0.2; // that arm has the laptop
      add[I.forearmL][0] -= (0.2 + 0.8 * r) * wk;
      add[I.hips][1] += 0.1 * sn * wk;
      add[I.spine][1] -= 0.13 * sn * wk;
      add[I.spine][0] += (0.04 + 0.16 * r) * wk;
      add[I.head][0] -= (0.02 + 0.12 * r) * wk;
    }

    // ---- blend poses per joint (normalised lerp of quaternions), then layer the additives ----
    for (let j = 0; j < JOINTS.length; j++) {
      const q = this.joints[j].quaternion.set(0, 0, 0, 0);
      for (let p = 0; p < 3; p++) {
        if (w[p] <= 0) continue;
        const src = this.quats[p][j];
        const s = q.x * src.x + q.y * src.y + q.z * src.z + q.w * src.w < 0 ? -w[p] : w[p];
        q.x += src.x * s; q.y += src.y * s; q.z += src.z * s; q.w += src.w * s;
      }
      q.normalize();
      const a = add[j];
      if (a[0] || a[1] || a[2]) q.multiply(_q.setFromEuler(_e.set(a[0], a[1], a[2], this.joints[j].rotation.order)));
    }

    // hips height: blended, plus the walk bob
    const hp = this.rig.joints.hips.position.set(0, 0, 0);
    for (let p = 0; p < 3; p++) hp.addScaledVector(this.hipsPos[p], w[p]);
    if (wk > 0.001) {
      const sn = Math.sin(o.phase);
      hp.y += (0.012 - 0.035 * sn * sn * (1 + 0.6 * o.run)) * wk;
    }

    // ---- braids: a damped spring that keeps them hanging, lagging behind the body ----
    let pitch = 0;
    for (let p = 0; p < 3; p++) pitch += this.pitch[p] * w[p];
    pitch += add[I.spine][0] + add[I.neck][0] + add[I.head][0];
    const dt = Math.min(o.dt, 0.05);
    const braids = this.rig.joints.braids;
    for (let i = 0; i < braids.length; i++) {
      const s = this.braid[i];
      const side = i === 0 ? -1 : 1;
      const tx = -pitch - 0.2 + 0.05 * Math.sin(o.phase * 2) * wk;
      const tz = side * 0.06;
      s.vx += ((tx - s.x) * 70 - s.vx * 7 + o.accZ * 0.9) * dt;
      s.vz += ((tz - s.z) * 70 - s.vz * 7 - o.accX * 0.9) * dt;
      s.x = clamp(s.x + s.vx * dt, tx - 0.9, tx + 0.9);
      s.z = clamp(s.z + s.vz * dt, tz - 0.8, tz + 0.8);
      braids[i][0].rotation.set(s.x, 0, s.z);
      braids[i][1].rotation.set(0.1 + (s.x - tx) * 0.45, 0, (s.z - tz) * 0.45);
    }

    // ---- laptop: lap (root space) ↔ under the arm (spine space); lid closes first ----
    const J = this.rig.joints;
    this.lidOpen = smoothstep(0.62, 0.95, sitW);
    J.lid.rotation.x = LID_OPEN * this.lidOpen;
    const onLap = smoothstep(0.15, 0.7, sitW);
    J.hips.updateMatrix();
    J.spine.updateMatrix();
    _m.multiplyMatrices(J.hips.matrix, J.spine.matrix).multiply(this.carryLocal);
    _m.decompose(_p, _q2, _s);
    J.laptop.position.copy(_p).lerp(_p2.copy(this.sitLapPos), onLap);
    J.laptop.quaternion.copy(_q2).slerp(this.sitLapQuat, onLap);
  }
}
