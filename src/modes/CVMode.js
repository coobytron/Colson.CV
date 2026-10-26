import * as THREE from 'three';
import { Mode } from './Mode.js';
import { Mushroom } from '../mushroom/Mushroom.js';
import { seededGenome } from '../mushroom/genome.js';
import { hashString, mulberry32, clamp, smoothstep } from '../lib/math.js';
import { heightAt } from '../world/terrain.js';
import { findFreeSpot } from '../avatar/steer.js';
import { h, button, icon } from '../ui/dom.js';
import { I } from '../ui/icons.js';
import DATA from '../data/cv.js';

const STAND_OFF = 1.75; // how far in front of a marker (toward the middle of the grove) the Gardener stands
const AT_STOP = 1.2; // within this of the stand point counts as "at the stop"
const VIEW_TURN = 0.6; // camera swings this far (rad) off the marker→centre line, so both are in frame

const NEXT_KEYS = ['PageDown', 'n', 'N', ']', '.'];
const PREV_KEYS = ['PageUp', 'b', 'B', '[', ','];

const _v = new THREE.Vector3();
const _spot = new THREE.Vector2();

/**
 * The playable CV: one seamless grove where each career chapter is a marker mushroom. A manual guided
 * tour walks the Gardener from stop to stop (never auto-advancing), and Free Explore hands the grove back
 * to the visitor without forgetting where the tour was.
 *
 * State (read by later features: boredom timer, Local Lab):
 *   currentStop     stop id the tour is on, or null before the tour starts
 *   tourMode        'intro' | 'guided' | 'free'
 *   presenterPaused true while the tab is hidden (presenter switched to another app)
 *   avatarAtStop    the Gardener has arrived and is standing at currentStop
 * Subscribe with onState(fn); fn(state, prev) runs after every change.
 */
export class CVMode extends Mode {
  constructor(app) {
    super(app);
    this.id = 'cv';
    this.stops = DATA.stops.map((s, index) => ({ ...s, index }));
    this.byId = Object.fromEntries(this.stops.map((s) => [s.id, s]));
    this.state = { currentStop: null, tourMode: 'intro', presenterPaused: false, avatarAtStop: false };
    this.listeners = [];
    this.travel = null; // { stop, attempts, then } while the tour is walking the Gardener somewhere
    this.cardStop = null;
    this.labelsEl = document.getElementById('labels');
    this.card = document.getElementById('card');
    this.build();
    document.addEventListener('visibilitychange', () => this.setState({ presenterPaused: document.hidden }));
  }

  // ---- state ------------------------------------------------------------------
  setState(patch) {
    const prev = this.state;
    const next = { ...prev, ...patch };
    if (Object.keys(next).every((k) => next[k] === prev[k])) return;
    this.state = next;
    document.body.dataset.tour = next.tourMode;
    for (const fn of this.listeners) fn(next, prev);
  }

  onState(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }

  get current() { return this.byId[this.state.currentStop] ?? null; }

  // ---- layout -------------------------------------------------------------------
  build() {
    const links = [];
    let prev = null;
    for (const s of this.stops) {
      const seed = hashString(s.id);
      const rng = mulberry32(seed);
      const marker = this.add(new Mushroom(seededGenome(s.strain, seed, 0.12), { x: s.x, z: s.z, scale: 1.55, seed, data: s, grow: 1, autoGrow: false }));
      marker.stop = s;
      s.marker = marker;
      // stand point: in front of the marker, toward the middle of the grove
      const len = Math.hypot(s.x, s.z) || 1;
      s.dir = { x: -s.x / len, z: -s.z / len };
      s.stand = { x: s.x + s.dir.x * STAND_OFF, z: s.z + s.dir.z * STAND_OFF };
      // a few smaller mushrooms of the same strain behind it, clear of the stand side
      const back = Math.atan2(-s.dir.z, -s.dir.x);
      for (let i = 0; i < 4; i++) {
        const a = back + (i - 1.5) * 0.75 + (rng() - 0.5) * 0.3;
        const r = 1.1 + rng() * 0.7;
        const cs = seed + i + 1;
        this.add(new Mushroom(seededGenome(s.strain, cs, 0.22), { x: s.x + Math.cos(a) * r, z: s.z + Math.sin(a) * r, scale: 0.42 + rng() * 0.32, seed: cs, grow: 1, autoGrow: false }));
      }
      // the career path, marker to marker
      if (prev) links.push({ a: { x: prev.x, z: prev.z }, b: { x: s.x, z: s.z }, color: s.color, width: 0.06, strength: 1.1, seed: s.index * 31 });
      prev = s;

      const label = h('button', { class: 'plabel', type: 'button', 'aria-label': `${s.title}, ${s.dates}` },
        h('span', { class: 'dot', style: { background: s.color } }), h('span', { class: 'num' }, String(s.index + 1)), s.title);
      label.addEventListener('click', () => this.onSelect(marker));
      this.labelsEl.append(label);
      marker.label = label;
    }
    this.net.setLinks(links);
  }

  // ---- mode lifecycle -----------------------------------------------------------
  enter(prev) {
    super.enter(prev);
    const env = this.app.env;
    env.cycle = false;
    env.targetTimeOfDay = 0.02;
    env.speed = 1;
    env.setWeather({ rain: 0, wind: 0.18, mist: 0.3, storm: 0 });
    this.labelsEl.classList.add('show');
    document.body.dataset.tour = this.state.tourMode;
  }

  exit() {
    super.exit();
    this.closeCard();
    this.labelsEl.classList.remove('show');
  }

  avatarHome() {
    findFreeSpot(1.4, 3.2, 0.7, this.mushrooms, this.app.obstacles, _spot);
    return { x: _spot.x, z: _spot.y, yaw: Math.atan2(-_spot.x, 19 - _spot.y) - 0.3 };
  }

  holdAvatar() { return this.state.tourMode === 'guided' && !!this.state.currentStop; }

  // Free Explore keeps the original Mycelia feel: tap the ground to walk there.
  get tapToWalk() { return this.state.tourMode === 'free'; }

  // ---- tour -----------------------------------------------------------------------
  begin() { this.goToStop(this.current ? this.current.index : 0); }

  next() {
    if (this.state.tourMode !== 'guided' || !this.current) return this.goToStop(this.current ? this.current.index : 0);
    if (this.current.index >= this.stops.length - 1) return this.toast('That’s the last stop');
    this.goToStop(this.current.index + 1);
  }

  prev() {
    if (this.state.tourMode !== 'guided' || !this.current) return this.goToStop(this.current ? this.current.index : 0);
    if (this.current.index <= 0) return this.toast('That’s the first stop');
    this.goToStop(this.current.index - 1);
  }

  /** Walk the Gardener to stop i (real locomotion), then frame him beside its marker. */
  goToStop(i) {
    const s = this.stops[clamp(i, 0, this.stops.length - 1)];
    if (!s) return;
    this.setState({ tourMode: 'guided', currentStop: s.id, avatarAtStop: false });
    this.openCard(s);
    const av = this.app.avatar;
    if (Math.hypot(av.position.x - s.stand.x, av.position.z - s.stand.z) < AT_STOP && av.pose === 'stand' && !av.path) {
      this.arrived(s);
      return;
    }
    this.travel = { stop: s, attempts: 0 };
    this.walk();
    // pull back enough to see the walk; the camera then follows him
    this.app.flyTo(av.focus(_v), { distance: 11, polar: 1.05, duration: 1 });
  }

  walk() {
    const t = this.travel;
    const s = t.stop;
    t.then = () => { if (this.travel === t) this.arrived(s); };
    // fallback when the straight line keeps getting blocked: try the far side of the stand point
    const k = t.attempts === 0 ? 1 : -0.6;
    const side = t.attempts === 0 ? 0 : 0.8;
    const x = s.x + s.dir.x * STAND_OFF * k - s.dir.z * side;
    const z = s.z + s.dir.z * STAND_OFF * k + s.dir.x * side;
    this.app.avatar.go(t.attempts === 0 ? s.stand.x : x, t.attempts === 0 ? s.stand.z : z, { user: true, then: t.then });
  }

  arrived(s) {
    this.travel = null;
    const av = this.app.avatar;
    this.setState({ avatarAtStop: Math.hypot(av.position.x - s.stand.x, av.position.z - s.stand.z) < AT_STOP * 1.6 });
    this.frameStop(s);
  }

  frameStop(s, duration = 1.6) {
    const app = this.app, av = app.avatar;
    if (app.follow === av) app.follow = null;
    const tx = av.position.x * 0.6 + s.x * 0.4, tz = av.position.z * 0.6 + s.z * 0.4;
    const target = new THREE.Vector3(tx, heightAt(tx, tz) + 1.05, tz);
    const ca = Math.cos(VIEW_TURN), sa = Math.sin(VIEW_TURN);
    const ox = s.dir.x * ca - s.dir.z * sa, oz = s.dir.x * sa + s.dir.z * ca;
    // face the camera, turned slightly toward the marker
    av.yawTarget = Math.atan2(ox, oz) + 0.35;
    app.flyTo(target, { distance: 7.5, polar: 1.2, azimuth: Math.atan2(ox, oz), duration });
  }

  /** Free Explore: the visitor drives; the tour remembers its stop. */
  explore() {
    this.travel = null;
    this.setState({ tourMode: 'free', avatarAtStop: false });
    this.closeCard();
    this.app.flyTo(new THREE.Vector3(0, 0.9, 0), { distance: 22, polar: 1.1, duration: 1.6 });
  }

  toggleExplore() { if (this.state.tourMode === 'free') this.begin(); else this.explore(); }

  // ---- card ---------------------------------------------------------------------------
  openCard(s) {
    this.cardStop = s;
    const n = this.stops.length;
    const guided = this.state.tourMode === 'guided';
    this.card.replaceChildren(...[
      h('div', { class: 'card-top' },
        h('span', { class: 'tag', style: { '--c': s.color } }, `Chapter ${s.index + 1}`),
        h('span', { class: 'count' }, `${s.index + 1} / ${n}`),
        guided ? null : button({ icon: I.close, title: 'Close', cls: 'icon ghost', onClick: () => this.closeCard() })),
      h('h2', { id: 'cardTitle' }, s.title),
      h('div', { class: 'meta' }, h('span', { class: 'pill' }, s.dates)),
      h('p', { class: 'desc' }, s.summary),
      s.links.length ? h('div', { class: 'card-actions' }, ...s.links.map((l) =>
        h('a', { class: 'btn primary', href: l.href, target: '_blank', rel: 'noopener' }, icon(I.external), h('span', { class: 'lbl' }, l.label)))) : null,
      h('div', { class: 'card-nav' },
        button({ icon: I.prev, title: 'Previous stop (PageUp / B)', cls: 'icon', onClick: () => this.prev() }),
        h('span', { class: 'hint' }, h('kbd', {}, 'B'), ' ', h('kbd', {}, 'N'), ' previous / next'),
        button({ icon: I.next, title: 'Next stop (PageDown / N)', cls: 'icon', onClick: () => this.next() })),
    ].filter(Boolean));
    this.card.setAttribute('aria-labelledby', 'cardTitle');
    this.card.style.setProperty('--accent', s.color);
    this.card.classList.add('open');
    for (const st of this.stops) st.marker.highlightTarget = st === s ? 1 : 0;
    if (innerWidth < 760) this.app.viewShiftTarget.set(0, 0.2);
    else this.app.viewShiftTarget.set(-0.14, 0);
    this.syncDock();
  }

  closeCard() {
    this.card.classList.remove('open');
    if (this.cardStop) this.cardStop.marker.highlightTarget = 0;
    this.cardStop = null;
    this.app.viewShiftTarget.set(0, 0);
  }

  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ---- dock ---------------------------------------------------------------------------
  buildDock(el) {
    this.stopBtns = this.stops.map((s) => h('button', {
      type: 'button', class: 'stop-chip', 'data-stop': s.id, title: `${s.title} (${s.index + 1})`,
      'aria-label': `Go to ${s.title}`, onclick: () => this.goToStop(s.index),
    }, h('span', { class: 'dot', style: { background: s.color } }), h('span', { class: 'lbl' }, s.title)));
    this.exploreBtn = button({ label: 'Free explore', icon: I.walk, title: 'Free explore (F)', onClick: () => this.toggleExplore() });
    el.replaceChildren(h('nav', { class: 'dock-row', 'aria-label': 'Tour' },
      button({ icon: I.prev, title: 'Previous stop (PageUp / B)', cls: 'icon', onClick: () => this.prev() }),
      h('div', { class: 'stops seg' }, ...this.stopBtns),
      button({ icon: I.next, title: 'Next stop (PageDown / N)', cls: 'icon', onClick: () => this.next() }),
      h('span', { class: 'sep' }),
      this.exploreBtn));
    this.syncDock();
    if (!this.dockSync) this.dockSync = this.onState(() => this.syncDock());
  }

  syncDock() {
    const { currentStop, tourMode } = this.state;
    for (const b of this.stopBtns ?? []) {
      const on = b.dataset.stop === currentStop;
      b.classList.toggle('on', on && tourMode === 'guided');
      b.classList.toggle('last', on && tourMode !== 'guided');
      if (on) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    }
    if (this.exploreBtn) {
      const free = tourMode === 'free';
      this.exploreBtn.classList.toggle('on', free);
      this.exploreBtn.querySelector('.lbl').textContent = free ? 'Back to tour' : 'Free explore';
      this.exploreBtn.title = free ? 'Back to the tour (G or F)' : 'Free explore (F)';
    }
  }

  // ---- interaction --------------------------------------------------------------------
  onSelect(m) {
    const s = m.stop;
    if (!s) return;
    if (this.state.tourMode === 'free') {
      this.openCard(s);
      this.app.avatar.walkTo(null, { kneelAt: m });
    } else this.goToStop(s.index);
  }

  onClick(hit) {
    if (!hit.mushroom && this.state.tourMode === 'free' && this.cardStop) this.closeCard();
  }

  onKey(e) {
    if (e.repeat && !NEXT_KEYS.includes(e.key) && !PREV_KEYS.includes(e.key)) return false;
    if (NEXT_KEYS.includes(e.key)) { if (!e.repeat) this.next(); return true; }
    if (PREV_KEYS.includes(e.key)) { if (!e.repeat) this.prev(); return true; }
    if (e.key === 'Enter' && this.state.tourMode === 'intro') { this.begin(); return true; }
    if (e.key === 'f' || e.key === 'F') { this.toggleExplore(); return true; }
    if ((e.key === 'g' || e.key === 'G') && this.state.tourMode !== 'guided') { this.begin(); return true; }
    const d = Number(e.key);
    if (Number.isInteger(d) && d >= 1 && d <= this.stops.length) { this.goToStop(d - 1); return true; }
    if (e.key === 'Escape' && this.state.tourMode === 'free' && this.cardStop) { this.closeCard(); return true; }
    return false;
  }

  // ---- per frame ----------------------------------------------------------------------
  update(dt, isActive) {
    super.update(dt, isActive);
    if (!isActive) return;
    const av = this.app.avatar;
    const t = this.travel;
    if (t && av.path?.then !== t.then) {
      // the visitor took the wheel (WASD / tap): let them, the stop stays current
      if (Object.values(av.keys).some(Boolean) || av.path) this.travel = null;
      // the path gave up (blocked): close enough counts, else try once more, else just frame the stop
      else if (Math.hypot(av.position.x - t.stop.stand.x, av.position.z - t.stop.stand.z) < AT_STOP * 2) this.arrived(t.stop);
      else if (t.attempts < 1) { t.attempts++; this.walk(); }
      else this.arrived(t.stop);
    }
    const s = this.current;
    if (s && this.state.avatarAtStop && Math.hypot(av.position.x - s.stand.x, av.position.z - s.stand.z) > AT_STOP * 1.6) {
      this.setState({ avatarAtStop: false });
    }
    this.updateLabels();
  }

  updateLabels() {
    const cam = this.app.camera;
    for (const s of this.stops) {
      const m = s.marker;
      m.capWorldPosition(_v);
      _v.y += 0.3 * m.scale;
      const p = this.app.toScreen(_v);
      const focus = s === this.cardStop;
      let a = p ? smoothstep(40, 16, cam.position.distanceTo(_v)) : 0;
      a *= clamp(m.appear);
      if (this.cardStop && !focus) a *= 0.45;
      if (focus) a = Math.max(a, p ? 1 : 0);
      const el = m.label;
      if (!p || a < 0.02) { el.style.opacity = 0; el.style.visibility = 'hidden'; continue; }
      el.style.visibility = 'visible';
      el.style.opacity = a.toFixed(2);
      el.style.transform = `translate(-50%, -100%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${focus ? 1.08 : 1})`;
      el.classList.toggle('focus', focus);
    }
  }
}
