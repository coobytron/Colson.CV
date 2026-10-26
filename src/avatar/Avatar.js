import * as THREE from 'three';
import { buildGardener } from './rig.js';
import { Poser, SIT, STANDING, KNEELING } from './poses.js';
import { steer, clearPoint, spotFree, findFreeSpot, hardRadius } from './steer.js';
import { heightAt } from '../world/terrain.js';
import { clamp, damp, smoothstep } from '../lib/math.js';

const WALK = 1.6, RUN = 3.0;
const SIT_R = 0.55; // sitting footprint (crossed legs + laptop)
const STAND_R = 0.3;
const GLOW = 0.9; // screen light intensity (see rig.js)
const DUR = { sit: 0.8, stand: 0.8, kneel: 0.6 };
const POSE_OF = { sit: SIT, stand: STANDING, kneel: KNEELING };
const MOVE = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

const MOVE_CODES = Object.keys(MOVE);

const _v = new THREE.Vector3();
const _spot = new THREE.Vector2();
const _goal = new THREE.Vector2();

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * The Gardener — Colson, sitting cross-legged with a laptop, who can stand up and walk the clearing.
 *
 * App contract:
 *   app.addActor(avatar)            → object added to the scene, update(dt, app) called every frame
 *   app.follow = avatar             → camera glides after focus(out) while walking
 *   app.avatar.walkTo(point, opts)  → from tap / double-tap routing in App.bindInput
 *   app.avatar.onModeChange(next, prev) → from App.setMode
 * Optional mode hooks (duck-typed): avatarHome() → {x, z, yaw}, holdAvatar() → true suspends
 *   the idle sit / walk-home behaviour, onAvatarEvent(type, data)
 *   with type 'sit' | 'stand' | 'arrive' | 'kneel'. 'sit' / 'stand' fire as the move starts,
 *   'arrive' when a walk ends ({ x, z, auto }), 'kneel' once down beside the mushroom ({ mushroom }).
 *
 * States: sit ⇄ stand ⇄ walk, stand → kneel. Keys: WASD / arrows (camera-relative), Shift runs, C sits / stands.
 */
export class Avatar {
  constructor(app) {
    this.app = app;
    this.rig = buildGardener();
    this.object = this.rig.root;
    this.position = this.object.position;
    this.poser = new Poser(this.rig);
    this.state = 'sit'; // 'sit' | 'stand' | 'walk' | 'kneel'
    this.screenOn = true; // laptop open and glowing (moths are drawn to it)

    this.pose = 'sit'; // pose target
    this.w = [1, 0, 0]; // linear pose weights
    this.we = [1, 0, 0]; // eased
    this.mover = { x: 0, z: 0, vx: 0, vz: 0 };
    this.yaw = 0;
    this.yawTarget = 0;
    this.keys = Object.fromEntries(MOVE_CODES.map((k) => [k, false]));
    this.shift = false;
    this.path = null;
    this.phase = 0;
    this.walkAmt = 0;
    this.run = 0;
    this.idle = 0;
    this.still = 0; // seconds standing without moving
    this.idleTimer = 0; // seconds since movement input / arrival
    this.sitCheck = 3;
    this.homeCheck = 1;
    this.homeCooldown = 0;
    this.followOff = -1;
    this.markT = 0;
    this.kneeling = null;
    this.placed = false;
    this.t = 0;
    this.acc = { x: 0, z: 0 };
    this.pv = { x: 0, z: 0 };
    this.anim = { t: 0, dt: 0, walk: 0, phase: 0, run: 0, idle: 0, accX: 0, accZ: 0, bored: 0, boredT: 0, calm: false };
    // bored-at-a-stop: the mode sets boredTarget; the weight eases in slowly and out quickly
    this.boredTarget = false;
    this.bored = 0;
    this.boredT = 0;
    this.reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  }

  /** Mode hook: the presenter has left the Gardener waiting long enough to get bored (or not). */
  setBored(on) {
    this.boredTarget = on;
    if (on && this.pose === 'kneel') this.stand(); // bored at a project: he gets up from the mushroom
  }

  // ---- per frame --------------------------------------------------------------
  update(dt, app) {
    if (!this.placed) this.goHome(true);
    this.t += dt;
    const mode = app.mode;
    const mushrooms = mode?.mushrooms ?? [];
    const obstacles = app.obstacles ?? [];
    const mv = this.mover;

    // keyboard, relative to the camera's azimuth
    let ix = 0, iz = 0;
    for (let i = 0; i < MOVE_CODES.length; i++) {
      const k = MOVE_CODES[i];
      if (this.keys[k]) { ix += MOVE[k][0]; iz += MOVE[k][1]; }
    }
    const input = ix !== 0 || iz !== 0;
    if (input) {
      this.path = null;
      this.idleTimer = 0;
      if (this.pose !== 'stand') this.stand();
      this.userMoving();
    }

    this.blendPoses(dt);
    const canMove = this.pose === 'stand' && this.we[SIT] < 0.2 && this.we[KNEELING] < 0.35;

    let dx = 0, dz = 0;
    if (canMove && input) {
      const cam = app.camera.position, tg = app.controls.target;
      let fx = tg.x - cam.x, fz = tg.z - cam.z;
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl; fz /= fl;
      let wx = fx * iz - fz * ix, wz = fz * iz + fx * ix;
      const s = (this.shift ? RUN : WALK) / (Math.hypot(wx, wz) || 1);
      dx = wx * s; dz = wz * s;
    } else if (canMove && this.path) {
      const p = this.path;
      const gx = p.x - mv.x, gz = p.z - mv.z;
      const d = Math.hypot(gx, gz);
      const km = p.kneelAt;
      const near = km ? Math.hypot(km.x - mv.x, km.z - mv.z) < p.stop + 0.08 : false;
      if (d < 0.12 || near) this.arrive();
      else {
        const s = (p.run ? RUN : WALK) * clamp(d / 0.7, 0.35, 1);
        dx = (gx / d) * s; dz = (gz / d) * s;
        if (p.user) this.userMoving();
        // stuck: under 5 cm of progress in 1.5 s → give up
        p.checkT += dt;
        if (p.checkT > 1.5) {
          if (p.lastD - d < 0.05) { this.path = null; this.idleTimer = 0; }
          p.checkT = 0; p.lastD = d;
        }
      }
    }

    let moved = 0;
    if (canMove) moved = steer(mv, dx, dz, dt, mushrooms, obstacles, this.path?.kneelAt);
    else { mv.vx = 0; mv.vz = 0; }
    this.position.set(mv.x, heightAt(mv.x, mv.z), mv.z);

    // gait
    const speed = moved / Math.max(dt, 1e-4);
    this.run = damp(this.run, clamp((speed - 1.9) / 0.9), 5, dt);
    this.walkAmt = damp(this.walkAmt, clamp(speed / 0.9), 9, dt);
    this.phase = (this.phase + (Math.PI * moved) / (0.42 + 0.3 * this.run)) % (Math.PI * 2);
    // local acceleration for the braids
    const ax = (mv.vx - this.pv.x) / Math.max(dt, 1e-3), az = (mv.vz - this.pv.z) / Math.max(dt, 1e-3);
    this.pv.x = mv.vx; this.pv.z = mv.vz;
    this.acc.x = damp(this.acc.x, ax, 12, dt);
    this.acc.z = damp(this.acc.z, az, 12, dt);

    // facing
    if (speed > 0.15 && Math.hypot(mv.vx, mv.vz) > 0.1) this.yawTarget = Math.atan2(mv.vx, mv.vz);
    this.yaw += wrap(this.yawTarget - this.yaw) * (1 - Math.exp(-(this.pose === 'stand' ? 9 : 5) * dt));
    this.object.rotation.y = this.yaw;

    // state + idle behaviour
    const moving = speed > 0.2;
    this.state = this.pose === 'stand' ? (moving || this.path || input ? 'walk' : 'stand') : this.pose;
    this.still = this.state === 'stand' ? this.still + dt : 0;
    this.idle = damp(this.idle, this.still > 1.5 ? 1 : 0, 2, dt);
    this.idleBehaviour(dt, input, mushrooms, obstacles);

    // kneel settles → tell the mode, touch the cap
    const kn = this.kneeling;
    if (kn && this.pose === 'kneel' && this.we[KNEELING] > 0.95) {
      this.kneeling = null;
      const m = kn.mushroom;
      if (m.worldToBend) {
        m.worldToBend(m.x - mv.x, m.z - mv.z, _spot);
        const l = _spot.length() || 1;
        m.impulse((_spot.x / l) * 1.2, (_spot.y / l) * 1.2);
      }
      this.emit('kneel', { mushroom: m });
      kn.then?.();
    }

    // camera: stop following a while after sitting down
    if (this.followOff > 0) {
      this.followOff -= dt;
      if (this.followOff <= 0 && app.follow === this) app.follow = null;
    }

    // animate
    const a = this.anim;
    a.t = this.t; a.dt = dt; a.walk = this.walkAmt; a.phase = this.phase; a.run = this.run; a.idle = this.idle;
    const calm = !!this.reducedMotion?.matches;
    const wantBored = this.boredTarget && this.pose === 'stand';
    this.bored = damp(this.bored, wantBored ? 1 : 0, wantBored ? 1.2 : 6, dt);
    if (this.bored < 0.005 && !wantBored) { this.bored = 0; this.boredT = 0; } else if (!calm) this.boredT += dt;
    a.bored = this.bored; a.boredT = this.boredT; a.calm = calm;
    const cs = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    a.accZ = clamp(this.acc.x * sn + this.acc.z * cs, -12, 12);
    a.accX = clamp(this.acc.x * cs - this.acc.z * sn, -12, 12);
    this.poser.apply(this.we, a);

    // screen: the splash typing flicker; the light fades with the lid
    const now = performance.now();
    const flick = 0.85 + 0.15 * Math.sin(now * 0.019) + 0.06 * Math.sin(now * 0.13);
    const open = this.poser.lidOpen;
    this.rig.screenMat.emissiveIntensity = 2.2 * flick * smoothstep(0, 0.25, open);
    this.rig.glow.intensity = GLOW * flick * open;
    this.screenOn = open > 0.3;
  }

  blendPoses(dt) {
    const T = POSE_OF[this.pose];
    const w = this.w;
    const rate = dt / (this.w[SIT] > 0.01 || T === SIT ? DUR.sit : DUR.kneel);
    w[T] = Math.min(1, w[T] + rate);
    let rest = 0;
    for (let i = 0; i < 3; i++) if (i !== T) rest += w[i];
    const scale = rest > 1e-6 ? (1 - w[T]) / rest : 0;
    for (let i = 0; i < 3; i++) if (i !== T) w[i] *= scale;
    // ease: the target's share follows a smoothstep, the others split what's left
    const e = this.we;
    const eT = smoothstep(0, 1, w[T]);
    const k = rest > 1e-6 && w[T] < 1 ? (1 - eT) / (1 - w[T]) : 0;
    for (let i = 0; i < 3; i++) e[i] = i === T ? eT : w[i] * k;
  }

  idleBehaviour(dt, input, mushrooms, obstacles) {
    const app = this.app, mv = this.mover;
    // presenting at a stop: stay put and standing (no auto-sit, no wandering home)
    if (app.mode?.holdAvatar?.()) { this.idleTimer = 0; return; }
    if (!input && !this.path && (this.pose === 'stand' || this.pose === 'kneel')) {
      this.idleTimer += dt;
      // after 6 s without input: sit down on the spot, or step somewhere free first
      if (this.idleTimer > 6 && this.state !== 'walk') {
        this.idleTimer = 0;
        if (spotFree(mv.x, mv.z, SIT_R, mushrooms, obstacles)) this.sit();
        else {
          findFreeSpot(mv.x, mv.z, SIT_R + 0.1, mushrooms, obstacles, _spot);
          this.go(_spot.x, _spot.y, { sitAfter: true, sitYaw: this.yaw });
        }
      }
    }
    // every ~3 s while sitting: did something sprout underneath us?
    if (this.pose === 'sit' && this.we[SIT] > 0.99) {
      this.sitCheck -= dt;
      if (this.sitCheck <= 0) {
        this.sitCheck = 3;
        if (!spotFree(mv.x, mv.z, SIT_R * 0.85, mushrooms, obstacles)) {
          findFreeSpot(mv.x, mv.z, SIT_R + 0.1, mushrooms, obstacles, _spot);
          this.go(_spot.x, _spot.y, { sitAfter: true, sitYaw: this.yaw });
        }
      }
    }
    // left alone for 40 s, away from home → wander back and sit
    this.homeCooldown -= dt;
    this.homeCheck -= dt;
    if (this.homeCheck <= 0) {
      this.homeCheck = 1;
      const quiet = performance.now() - app.lastInteraction > 40000;
      if (quiet && !this.path && this.homeCooldown <= 0 && this.pose !== 'kneel') {
        const h = this.homeFor(app.mode);
        if (Math.hypot(h.x - mv.x, h.z - mv.z) > 1) {
          this.homeCooldown = 12;
          this.go(h.x, h.z, { sitAfter: true, sitYaw: h.yaw });
        }
      }
    }
  }

  arrive() {
    const p = this.path;
    this.path = null;
    this.idleTimer = 0;
    const mv = this.mover;
    if (p.kneelAt) {
      const m = p.kneelAt;
      this.yawTarget = Math.atan2(m.x - mv.x, m.z - mv.z);
      this.pose = 'kneel';
      this.kneeling = { mushroom: m, then: p.then };
      if (p.user) this.follow();
      return;
    }
    this.emit('arrive', { x: mv.x, z: mv.z, auto: !p.user });
    if (p.sitAfter) {
      if (p.sitYaw !== undefined) this.yawTarget = p.sitYaw;
      this.sit();
    }
    p.then?.();
  }

  // ---- actions --------------------------------------------------------------------
  /** Walk to a ground point. opts: { kneelAt: Mushroom, then: fn }. Returns false if it can't. */
  walkTo(point, { kneelAt, then } = {}) {
    if (!point && !kneelAt) return false;
    return this.go(point?.x ?? kneelAt.x, point?.z ?? kneelAt.z, { kneelAt, then, user: true });
  }

  go(x, z, { kneelAt = null, then = null, user = false, sitAfter = false, sitYaw } = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const app = this.app, mv = this.mover;
    const mushrooms = app.mode?.mushrooms ?? [];
    const obstacles = app.obstacles ?? [];
    let stop = 0;
    if (kneelAt) {
      // stop just short of the mushroom, on our side of it
      stop = Math.max(0.9, hardRadius(kneelAt) + 0.12);
      let ox = mv.x - kneelAt.x, oz = mv.z - kneelAt.z;
      const d = Math.hypot(ox, oz) || 1;
      if (d < 1e-3) { ox = 1; oz = 0; }
      _goal.set(kneelAt.x + (ox / d) * stop, kneelAt.z + (oz / d) * stop);
    } else {
      clearPoint(_goal.set(x, z), mushrooms, obstacles);
    }
    this.path = { x: _goal.x, z: _goal.y, kneelAt, then, user, sitAfter, sitYaw, stop, run: false, checkT: 0, lastD: Infinity };
    this.kneeling = null;
    this.idleTimer = 0;
    if (this.pose !== 'stand') this.stand();
    if (user) this.userMoving(true);
    return true;
  }

  /** Walk home and sit (or snap there when immediate). */
  goHome(immediate = false) {
    const h = this.homeFor(this.app.mode);
    if (!immediate && this.placed) return this.go(h.x, h.z, { sitAfter: true, sitYaw: h.yaw });
    const mv = this.mover;
    mv.x = h.x; mv.z = h.z; mv.vx = 0; mv.vz = 0;
    this.pv.x = 0; this.pv.z = 0;
    this.position.set(h.x, heightAt(h.x, h.z), h.z);
    this.yaw = this.yawTarget = h.yaw;
    this.object.rotation.y = h.yaw;
    this.path = null;
    this.kneeling = null;
    if (this.pose !== 'sit') { this.pose = 'sit'; this.emit('sit'); }
    this.w[0] = this.we[0] = 1;
    this.w[1] = this.w[2] = this.we[1] = this.we[2] = 0;
    this.state = 'sit';
    this.placed = true;
    return true;
  }

  sit() {
    if (this.pose === 'sit') return;
    this.pose = 'sit';
    this.path = null;
    this.kneeling = null;
    this.sitCheck = 3;
    this.followOff = 1.5;
    this.emit('sit');
  }

  stand() {
    if (this.pose === 'stand') return;
    this.pose = 'stand';
    this.idleTimer = 0;
    this.followOff = -1;
    this.emit('stand');
  }

  follow() {
    this.followOff = -1;
    this.app.follow = this;
  }

  // user-driven movement: stop auto-tours (throttled) and keep the camera with us; if the camera
  // is looking somewhere far off, bring it over first
  userMoving(now = false) {
    const t = performance.now();
    if (now || t - this.markT > 500) {
      this.markT = t;
      this.app.markInteraction();
    }
    if (this.app.follow !== this) {
      const tg = this.app.controls.target, mv = this.mover;
      if (Math.hypot(tg.x - mv.x, tg.z - mv.z) > 14) this.app.flyTo(this.focus(_v), { distance: 9, polar: 1.05, duration: 1.2 });
      this.follow();
    }
  }

  emit(type, data) { this.app.mode?.onAvatarEvent?.(type, data); }

  // ---- input ----------------------------------------------------------------------
  /** Keyboard input. Returns true when the key was consumed. */
  onKey(e, down) {
    if (MOVE[e.code]) {
      this.keys[e.code] = down;
      return true;
    }
    if (e.key === 'Shift') { this.shift = down; return true; }
    if (e.code === 'KeyC') {
      if (down && !e.repeat) {
        this.app.markInteraction();
        if (this.pose === 'sit') { this.stand(); this.idleTimer = 0; }
        else this.sit();
      }
      return true;
    }
    return false;
  }

  releaseKeys() {
    for (const k of MOVE_CODES) this.keys[k] = false;
    this.shift = false;
  }

  // ---- queries --------------------------------------------------------------------
  /** Where this mode wants the Gardener to sit: mode.avatarHome(), else a free spot near a default. */
  homeFor(mode) {
    const h = mode?.avatarHome?.();
    if (h) return { x: h.x, z: h.z, yaw: h.yaw ?? 0 };
    const mushrooms = mode?.mushrooms ?? [];
    const obstacles = this.app.obstacles ?? [];
    const projects = mode && mode === this.app.modes.projects;
    // Projects: beside the centre mushroom, a little in front; elsewhere as near the middle as is free
    findFreeSpot(projects ? 1.6 : 0, projects ? 1.4 : 0, SIT_R + 0.15, mushrooms, obstacles, _spot);
    // face the default camera (0, 7.5, 19), turned a touch toward the middle
    const yaw = Math.atan2(-_spot.x, 19 - _spot.y) + (projects ? -0.35 : 0);
    return { x: _spot.x, z: _spot.y, yaw };
  }

  /** Where the camera should look while following. */
  focus(out) { return out.copy(this.position).setY(this.position.y + 0.9); }

  /** World position of the laptop screen (for moths / glow). */
  screenWorldPosition(out) { return this.rig.screenAnchor.getWorldPosition(out); }

  /** True if a circle at (x, z, r) overlaps the Gardener. */
  blocks(x, z, r = 0) {
    return Math.hypot(x - this.position.x, z - this.position.z) < (this.pose === 'sit' ? SIT_R : STAND_R) + r;
  }

  onModeChange(next) {
    if (!this.placed) return; // the first frame places us at the initial mode's home
    // the new mode frames the camera itself
    if (this.app.follow === this) this.app.follow = null;
    const h = this.homeFor(next);
    if (Math.hypot(h.x - this.mover.x, h.z - this.mover.z) < 8) this.go(h.x, h.z, { sitAfter: true, sitYaw: h.yaw });
    else this.goHome(true);
  }
}

