import * as THREE from 'three';
import { MyceliumNet } from '../world/mycelium.js';

const _plane = new THREE.Plane();
const _hitP = new THREE.Vector3();

/**
 * Shared behaviour for the three modes: a group of mushrooms, a mycelium
 * network, appear/disappear transitions, and "flick" physics on drag.
 */
export class Mode {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.mushrooms = [];
    this.net = new MyceliumNet(app.shared);
    this.net.target = 0;
    this.group.add(this.net.mesh);
    this.active = false;
    this.hovered = null;
    this.grabbed = null;
  }

  pickable() { return this.mushrooms; }

  add(m) {
    if (!this.active) { m.appear = 0; m.appearTarget = 0; }
    this.mushrooms.push(m);
    this.group.add(m.group);
    return m;
  }

  remove(m) {
    const i = this.mushrooms.indexOf(m);
    if (i >= 0) this.mushrooms.splice(i, 1);
    if (this.hovered === m) this.hovered = null;
    m.dispose();
  }

  clearAll() {
    for (const m of [...this.mushrooms]) m.dispose();
    this.mushrooms.length = 0;
    this.hovered = null;
  }

  enter() {
    this.active = true;
    this.group.visible = true;
    this.net.target = 1;
    // sprout in from the centre outwards
    for (const m of this.mushrooms) {
      m.appear = 0;
      m.appearTarget = 1;
      m.appearDelay = 0.15 + Math.hypot(m.x, m.z) * 0.035 + Math.random() * 0.12;
    }
    this.buildDock(document.getElementById('dock'));
  }

  exit() {
    this.active = false;
    this.net.target = 0;
    for (const m of this.mushrooms) { m.appearTarget = 0; m.appearDelay = 0; m.highlightTarget = 0; }
    this.setHover(null);
    this.endGrab();
  }

  update(dt, isActive) {
    if (!isActive && !this.mushrooms.some((m) => m.appear > 0.01) && this.net.opacity < 0.01) {
      this.group.visible = false;
      return;
    }
    for (const m of this.mushrooms) m.update(dt, this.app.env);
    this.net.update(dt, this.app.scene);
  }

  buildDock(el) { el.replaceChildren(); }

  setHover(m) {
    if (this.hovered === m) return;
    if (this.hovered && this.hovered !== this.selected) this.hovered.highlightTarget = 0;
    this.hovered = m;
    if (m) m.highlightTarget = Math.max(m.highlightTarget, 0.6);
    this.app.canvas.style.cursor = m ? 'pointer' : '';
  }

  // ---- flick physics ----------------------------------------------------------
  startGrab(m) {
    this.grabbed = m;
    const cap = m.capWorldPosition();
    _plane.set(new THREE.Vector3(0, 1, 0), -cap.y);
    this.grabY = cap.y;
    this.grabLast = null;
    m.grabTarget = new THREE.Vector2().copy(m.bend);
    m.highlightTarget = 1;
    this.app.canvas.style.cursor = 'grabbing';
  }

  dragGrab(hit) {
    const m = this.grabbed;
    if (!m) return;
    _plane.set(new THREE.Vector3(0, 1, 0), -this.grabY);
    if (!hit.ray.intersectPlane(_plane, _hitP)) return;
    const base = m.group.position;
    m.worldToBend(_hitP.x - base.x, _hitP.z - base.z, m.grabTarget);
    // subtract the stem's natural lean
    const o = m.info.capOrigin;
    m.grabTarget.x -= (o.x * m.scale) / Math.max(0.2, m.height);
    m.grabTarget.y -= (o.z * m.scale) / Math.max(0.2, m.height);
    const l = m.grabTarget.length();
    if (l > 0.8) m.grabTarget.multiplyScalar(0.8 / l);
  }

  endGrab() {
    const m = this.grabbed;
    if (!m) return null;
    m.grabTarget = null;
    m.highlightTarget = m === this.hovered ? 0.6 : 0;
    this.grabbed = null;
    this.app.canvas.style.cursor = '';
    // big flicks shake loose a puff of spores
    const energy = m.bend.length() + m.bendVel.length() * 0.1;
    if (energy > 0.25) this.puff(m, Math.min(60, Math.floor(energy * 40)));
    return m;
  }

  puff(m, n = 24) {
    const cap = m.capWorldPosition();
    const col = new THREE.Color(m.genome.glowColor);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * m.radius * 0.8;
      this.app.spores.emit(
        cap.x + Math.cos(a) * r, cap.y - m.radius * 0.3, cap.z + Math.sin(a) * r,
        Math.cos(a) * (0.3 + Math.random()), 0.2 + Math.random() * 0.8, Math.sin(a) * (0.3 + Math.random()),
        col, this.sporeOwner?.(m) ?? null, 5 + Math.random() * 3,
      );
    }
  }

  // default pointer handling: drag = flick, click = onSelect
  onPointerDown(hit) {
    if (hit.mushroom) { this.startGrab(hit.mushroom); return true; }
    return false;
  }
  onDrag(hit) { this.dragGrab(hit); }
  onPointerUp(hit, isClick) {
    const m = this.endGrab();
    if (isClick && m) this.onSelect?.(m, hit);
  }
  onHover(hit) {
    if (this.grabbed) return;
    this.setHover(hit?.mushroom ?? null);
  }
}
