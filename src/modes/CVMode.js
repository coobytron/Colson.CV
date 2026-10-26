import * as THREE from 'three';
import { Mode } from './Mode.js';
import { Mushroom } from '../mushroom/Mushroom.js';
import { seededGenome } from '../mushroom/genome.js';
import { hashString, clamp, smoothstep, easeOutCubic } from '../lib/math.js';
import { heightAt } from '../world/terrain.js';
import { findFreeSpot } from '../avatar/steer.js';
import { nearestLinks } from '../world/mycelium.js';
import { growGarden, gardenCentre, keepClear, placeStand, capsOverlap, STAND_OFF } from '../world/garden.js';
import { createLogos } from '../world/logos.js';
import { GOLDEN_HOUR } from '../world/environment.js';
import { TimelineLabels } from '../ui/timeline.js';
import { BoredomClock, BOREDOM_SECONDS } from '../avatar/boredom.js';
import { LocalLab, LAB_ID } from './LocalLab.js';
import { h, button, icon } from '../ui/dom.js';
import { I } from '../ui/icons.js';
import DATA from '../data/cv.js';

const HOME = { x: 1.4, z: 3.2 }; // where the Gardener waits before the tour (see avatarHome)
const AT_STOP = 1.2; // within this of the stand point counts as "at the stop"
const VIEW_TURN = 0.6; // camera swings this far (rad) off the marker→centre line, so both are in frame

export const UI_SCALES = [1, 1.25, 1.5, 1.75]; // presenter font / UI scale steps
const SCALE_KEY = 'colsoncv.uiScale';
const PROJECT_KEYS = { q: -1, Q: -1, e: 1, E: 1 };
const NEXT_KEYS = ['PageDown', 'n', 'N', ']', '.'];
const PREV_KEYS = ['PageUp', 'b', 'B', '[', ','];
// presentation mode: the arrow keys and a clicker step through the sections instead of walking the Gardener
const PRESENT_NEXT = ['ArrowRight', 'ArrowDown', ' '];
const PRESENT_PREV = ['ArrowLeft', 'ArrowUp'];
const SKILL_IN = 0.5, SKILL_STAGGER = 0.6; // seconds before the first skill sprouts, and between skills
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const _v = new THREE.Vector3();

/** A strain's genome, varied by seed, then shaped by its chapter's profile (taller at VICE, brighter later on). */
function chapterGenome(strain, seed, variety, g) {
  const out = seededGenome(strain, seed, variety);
  out.stemH = clamp(out.stemH * g.tall, 0.4, 2.2);
  out.glow = clamp(out.glow * g.glow, 0.2, 1.8);
  return out;
}
const _spot = new THREE.Vector2();

/**
 * The playable CV: one seamless grove where each career chapter is a marker mushroom. A manual guided
 * tour walks the Gardener from stop to stop (never auto-advancing), and Free Explore hands the grove back
 * to the visitor without forgetting where the tour was. Featured projects grow in a clearing beside the
 * Experiments stop; each opens a card with its verified demo link (or says where it lives instead).
 *
 * State (read by later features: boredom timer, Local Lab):
 *   currentStop     stop id the tour is on, or null before the tour starts
 *   tourMode        'intro' | 'guided' | 'free'
 *   presenterPaused true while the tab is hidden (presenter switched to another app)
 *   avatarAtStop    the Gardener has arrived and is standing at currentStop
 *   labPhase        the Local Lab beat: idle | sitting | speaking | handoff | away | back (see LocalLab.js)
 *   bored           he has waited BOREDOM_SECONDS (180) at the current stop and is now visibly bored
 *   present         presentation mode: big previous / next arrows step through the sections, little else on screen
 * Skills are mushrooms: each one a chapter added sprouts beside its marker when the Gardener reaches it, and stays
 * grown for the chapters after (see syncSkills).
 * Subscribe with onState(fn); fn(state, prev) runs after every change.
 */
export class CVMode extends Mode {
  constructor(app) {
    super(app);
    this.id = 'cv';
    this.stops = [...DATA.stops].sort((a, b) => a.presentationOrder - b.presentationOrder).map((s, index) => ({ ...s, index }));
    this.byId = Object.fromEntries(this.stops.map((s) => [s.id, s]));
    this.projects = DATA.projects.map((p, index) => ({ ...p, index }));
    this.clearing = DATA.projectClearing;
    this.state = { currentStop: null, tourMode: 'intro', presenterPaused: false, avatarAtStop: false, bored: false, labPhase: 'idle', present: false };
    this.skillsReached = -1; // the last chapter whose skills have been gained (see syncSkills)
    // 180 s by default. `?boredom=N` shortens it for local development only (stripped from production
    // builds); tests set `cv.boredom.seconds` directly.
    const dev = import.meta.env?.DEV ? Number(new URLSearchParams(location.search).get('boredom')) : 0;
    this.boredom = new BoredomClock(dev > 0 ? dev : BOREDOM_SECONDS);
    this.boredomHolds = new Set(); // reasons the boredom clock is held, e.g. 'handoff' (Local Lab, #4)
    this.listeners = [];
    this.travel = null; // { stop, attempts, then } while the tour is walking the Gardener somewhere
    this.cardStop = null;
    this.cardProject = null;
    this.labelsEl = document.getElementById('labels');
    this.card = document.getElementById('card');
    this.view = { labels: true, card: true, scale: this.loadScale() };
    this.viewListeners = [];
    this.applyView();
    this.build();
    this.lab = new LocalLab(this); // the final chapter's workstation and handoff
    document.addEventListener('visibilitychange', () => this.setState({ presenterPaused: document.hidden }));
  }

  // ---- state ------------------------------------------------------------------
  setState(patch) {
    const prev = this.state;
    const next = { ...prev, ...patch };
    if (Object.keys(next).every((k) => next[k] === prev[k])) return;
    this.state = next;
    document.body.dataset.tour = next.tourMode;
    document.body.classList.toggle('present', next.present);
    for (const fn of this.listeners) fn(next, prev);
  }

  // ---- presenter view controls: labels, card, UI scale, fullscreen -------------------------
  loadScale() {
    try {
      const v = Number(localStorage.getItem(SCALE_KEY));
      return UI_SCALES.includes(v) ? v : 1;
    } catch { return 1; } // storage blocked: the default is fine
  }

  applyView() {
    const { labels, card, scale } = this.view;
    document.documentElement.style.setProperty('--ui-zoom', String(scale));
    document.body.classList.toggle('labels-off', !labels);
    document.body.classList.toggle('card-off', !card);
    for (const fn of this.viewListeners) fn(this.view);
  }

  onView(fn) { this.viewListeners.push(fn); fn(this.view); }

  toggleLabels() { this.view.labels = !this.view.labels; this.applyView(); this.toast(this.view.labels ? 'Labels on' : 'Labels off'); }
  toggleCard() { this.view.card = !this.view.card; this.applyView(); this.toast(this.view.card ? 'Card on' : 'Card off'); }

  nudgeScale(dir) {
    const i = Math.min(UI_SCALES.length - 1, Math.max(0, UI_SCALES.indexOf(this.view.scale) + dir));
    this.view.scale = UI_SCALES[i];
    try { localStorage.setItem(SCALE_KEY, String(this.view.scale)); } catch { /* storage blocked */ }
    this.applyView();
    this.toast(`Text size ${Math.round(this.view.scale * 100)}%`);
  }

  toggleFullscreen() {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => this.toast('Fullscreen isn’t available here. Try F11 or your browser’s menu.'));
  }

  /** Hold or release the boredom clock (the elapsed time is kept). Used for the Local Lab handoff. */
  holdBoredom(reason, on = true) { if (on) this.boredomHolds.add(reason); else this.boredomHolds.delete(reason); }

  onState(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }

  get current() { return this.byId[this.state.currentStop] ?? null; }

  // ---- layout -------------------------------------------------------------------
  build() {
    const links = [];
    const c = this.clearing;
    // the stand points first, so every garden can keep them (and the walks between them) clear
    for (const s of this.stops) placeStand(s);
    const keep = keepClear(this.stops, c, { home: HOME, wideStand: LAB_ID }); // the lab's desk needs room
    let prev = null;
    for (const s of this.stops) {
      const seed = hashString(s.id);
      const g = s.garden;
      const marker = this.add(new Mushroom(chapterGenome(s.strain, seed, 0.12, g), { x: s.x, z: s.z, scale: g.marker, seed, data: s, grow: 1, autoGrow: false }));
      marker.stop = s;
      s.marker = marker;
      // the chapter's garden: what this period added, grown from its profile (src/world/garden.js). Its skills
      // are mushrooms too, ungrown until the Gardener reaches the chapter.
      const grown = growGarden(s, c, keep).map((p) => {
        const skill = !!p.skill;
        const genome = skill ? chapterGenome(s.strain, p.seed, 0.22, { ...g, tall: 1 }) : chapterGenome(p.strain, p.seed, g.variety, g);
        const m = this.add(new Mushroom(genome,
          { x: p.x, z: p.z, scale: p.scale, seed: p.seed, grow: skill ? 0 : 1, autoGrow: false, detail: p.scale < 0.6 ? 0.6 : 0.85 }));
        m.chapter = s.id;
        if (skill) {
          Object.assign(m, { skill: p.skill, growT: 0, growWant: 0, growWait: 0 });
          m.skillLabel = h('div', { class: 'slabel', style: { '--c': s.color } }, p.skill);
          this.labelsEl.append(m.skillLabel);
        }
        return m;
      });
      this.settleCaps(marker, grown);
      s.skillMushrooms = grown.filter((m) => m.skill);
      s.plants = grown.filter((m) => !m.skill);
      s.centre = gardenCentre(s, s.plants, g.marker);
      s.top = Math.max(marker.height, ...grown.map((m) => m.height)); // the garden's tallest cap, skills grown
      // its mycelium: stronger and more branched as the career goes on
      for (const ln of nearestLinks([marker, ...s.plants], { k: 1 + g.twigs, maxDist: 3.2 })) {
        links.push({ a: ln.a, b: ln.b, color: s.color, width: 0.022 + 0.012 * g.mycelium, strength: 0.45 * g.mycelium, seed: (seed % 997) + ln.i * 13 + ln.j });
      }
      // the career path, marker to marker
      if (prev) links.push({ a: { x: prev.x, z: prev.z }, b: { x: s.x, z: s.z }, color: s.color, width: 0.06, strength: 1.1 * Math.max(0.8, g.mycelium * 0.8), seed: s.index * 31 });
      prev = s;

      marker.label = this.makeLabel(`${s.label}, ${s.dates}`, s.color, s.label, String(s.index + 1), () => this.onSelect(marker));
    }
    this.buildProjects(links);
    this.net.setLinks(links);
    this.clearRocks();
    this.dates = new TimelineLabels(this);
    this.logos = createLogos(this.stops, this.group);
  }

  /**
   * Caps that cut through each other flicker as they sway (the glitch at a stop while the Gardener stands
   * still). The layout keeps footprints apart on the ground, but real caps vary by strain, so each new
   * mushroom is checked against the real caps already placed and shrunk until it clears them.
   */
  settleCaps(marker, plants) {
    this.placedCaps ??= [];
    const cap = (m) => {
      const o = m.info.capOrigin, cs = Math.cos(m.rotY), sn = Math.sin(m.rotY);
      return {
        x: m.x + (o.x * cs + o.z * sn) * m.scale, z: m.z + (-o.x * sn + o.z * cs) * m.scale, r: m.info.capR * m.scale,
        y0: (o.y - m.info.capR * 0.45) * m.scale, y1: m.info.capTop * m.scale,
      };
    };
    this.placedCaps.push(cap(marker));
    for (const m of plants) {
      const start = m.scale;
      let c = cap(m);
      while (this.placedCaps.some((o) => capsOverlap(c, o)) && m.scale > start * 0.55) {
        m.scale *= 0.92;
        c = cap(m);
      }
      this.placedCaps.push(c);
    }
  }

  /**
   * The gardens and the project clearing are tended ground: a scenery rock that landed on them (or on a
   * stand point) is taken away, so it can't wall off a project or grow through a garden.
   */
  clearRocks() {
    const c = this.clearing;
    const plants = this.stops.flatMap((s) => s.plants);
    const obstacles = this.app.obstacles;
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      if (o.kind !== 'rock') continue;
      const onGround = Math.hypot(o.x - c.x, o.z - c.z) < c.r + o.r + 1.2
        || this.stops.some((s) => Math.hypot(o.x - s.stand.x, o.z - s.stand.z) < o.r + 1.4 || Math.hypot(o.x - s.x, o.z - s.z) < o.r + 0.8)
        || plants.some((m) => Math.hypot(o.x - m.x, o.z - m.z) < o.r + m.radius * 0.8);
      if (!onGround) continue;
      if (o.mesh) o.mesh.visible = false;
      obstacles.splice(i, 1);
    }
  }

  /** Project mushrooms on an arc in the clearing, opening away from their stop so its marker stays clear. */
  buildProjects(links) {
    const c = this.clearing;
    const stop = this.byId[c.stop];
    const toStop = Math.atan2(stop.z - c.z, stop.x - c.x);
    const n = this.projects.length;
    const span = Math.PI * 1.45;
    for (const p of this.projects) {
      const a = toStop + Math.PI - span / 2 + (span * p.index) / Math.max(1, n - 1);
      p.x = c.x + Math.cos(a) * c.r;
      p.z = c.z + Math.sin(a) * c.r;
      const seed = hashString(p.id);
      const m = this.add(new Mushroom(seededGenome(p.strain, seed, 0.16), { x: p.x, z: p.z, scale: 0.95, seed, data: p, grow: 1, autoGrow: false }));
      this.settleCaps(m, []);
      m.project = p;
      p.marker = m;
      links.push({ a: { x: stop.x, z: stop.z }, b: { x: p.x, z: p.z }, color: p.color, width: 0.035, strength: 0.7, seed: 500 + p.index * 17 });
      m.label = this.makeLabel(p.label, p.color, p.label, null, () => this.onSelect(m), 'project');
    }
  }

  makeLabel(aria, color, text, num, onClick, cls = '') {
    const label = h('button', { class: `plabel ${cls}`, type: 'button', 'aria-label': aria },
      h('span', { class: 'dot', style: { background: color } }), num ? h('span', { class: 'num' }, num) : null, text);
    label.addEventListener('click', onClick);
    this.labelsEl.append(label);
    return label;
  }

  // ---- mode lifecycle -----------------------------------------------------------
  enter(prev) {
    super.enter(prev);
    const env = this.app.env;
    env.cycle = false;
    // golden hour, not night: the grove still glows, lit low and warm (see GOLDEN in environment.js)
    env.timeOfDay = env.targetTimeOfDay = GOLDEN_HOUR;
    env.minNight = 0.6;
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
    findFreeSpot(HOME.x, HOME.z, 0.7, this.mushrooms, this.app.obstacles, _spot);
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
    this.boredom.reset(); // any explicit presenter action starts a fresh interval
    this.setState({ tourMode: 'guided', currentStop: s.id, avatarAtStop: false });
    this.syncSkills(s.index - 1); // the chapters before this one have been gained; this one sprouts on arrival
    this.openCard(s);
    const av = this.app.avatar;
    const there = Math.hypot(av.position.x - s.stand.x, av.position.z - s.stand.z) < AT_STOP && !av.path;
    if (there && (av.pose === 'stand' || (s.id === LAB_ID && av.pose === 'sit'))) {
      if (s.id === LAB_ID) this.lab.restart(); // Jump to Local Lab while already there replays the beat
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
    const off = s.standOff ?? STAND_OFF;
    const x = s.x + s.dir.x * off * k - s.dir.z * side;
    const z = s.z + s.dir.z * off * k + s.dir.x * side;
    // the Local Lab is a seat at a workstation: he sits when he gets there
    const seat = s.workstation ? { sitAfter: true, sitYaw: s.workstation.yaw } : {};
    this.app.avatar.go(t.attempts === 0 ? s.stand.x : x, t.attempts === 0 ? s.stand.z : z, { user: true, then: t.then, ...seat });
  }

  arrived(s) {
    this.travel = null;
    if (this.state.currentStop === s.id) this.syncSkills(s.index, s);
    const av = this.app.avatar;
    this.setState({ avatarAtStop: Math.hypot(av.position.x - s.stand.x, av.position.z - s.stand.z) < AT_STOP * 1.6 });
    this.frameStop(s);
  }

  frameStop(s, duration = 1.6) {
    if (s.id === LAB_ID) { this.lab.frame(duration); return; }
    const app = this.app, av = app.avatar;
    if (app.follow === av) app.follow = null;
    const tx = av.position.x * 0.6 + s.x * 0.4, tz = av.position.z * 0.6 + s.z * 0.4;
    // aim a little higher for a taller garden, so it and its date both fit in the frame
    // (a stop with a logo over its marker aims higher still, to keep the logo below the top bar)
    const target = new THREE.Vector3(tx, heightAt(tx, tz) + clamp(s.top * 0.5, 1.05, 1.9) + (s.logoMark ? 0.45 : 0), tz);
    const ca = Math.cos(VIEW_TURN), sa = Math.sin(VIEW_TURN);
    const ox = s.dir.x * ca - s.dir.z * sa, oz = s.dir.x * sa + s.dir.z * ca;
    // face the camera, turned slightly toward the marker
    av.yawTarget = Math.atan2(ox, oz) + 0.35;
    app.flyTo(target, { distance: s.garden.view, polar: 1.2, azimuth: Math.atan2(ox, oz), duration });
  }

  /** Free Explore: the visitor drives; the tour remembers its stop. */
  explore() {
    this.travel = null;
    this.boredom.reset();
    this.setState({ tourMode: 'free', avatarAtStop: false });
    this.syncSkills(this.stops.length - 1, this.stops); // the whole story, grown
    this.closeCard();
    // high and wide enough to see every garden, and the dates over them, in their walk order
    this.app.flyTo(new THREE.Vector3(2, 0.9, 0), { distance: 30, polar: 0.8, azimuth: 0.15, duration: 1.6 });
  }

  toggleExplore() { if (this.state.tourMode === 'free') this.begin(); else this.explore(); }

  // ---- presentation mode --------------------------------------------------------------
  /**
   * The talk as a flat list of sections, for the arrows: every chapter in order, with the featured
   * experiments right after the Experiments stop (each its own section), then the Local Lab.
   */
  get sections() {
    this._sections ??= this.stops.flatMap((s) => [
      { kind: 'stop', s, label: s.label, color: s.color },
      ...(s.id === this.clearing.stop ? this.projects.map((p) => ({ kind: 'project', p, label: p.label, color: p.color })) : []),
    ]);
    return this._sections;
  }

  /** Index into sections of what is on screen now (-1 before the tour starts). */
  get sectionIndex() {
    const p = this.cardProject;
    if (p) return this.sections.findIndex((x) => x.p === p);
    if (this.state.tourMode !== 'guided' || !this.current) return -1;
    return this.sections.findIndex((x) => x.s === this.current);
  }

  goToSection(i) {
    const list = this.sections;
    const x = list[clamp(i, 0, list.length - 1)];
    if (x.kind === 'stop') { this.goToStop(x.s.index); return; }
    // a project is a section of the Experiments chapter: the tour stays on that stop
    const exp = this.byId[this.clearing.stop];
    if (this.state.tourMode !== 'guided' || this.state.currentStop !== exp.id) {
      this.setState({ tourMode: 'guided', currentStop: exp.id, avatarAtStop: false });
      this.syncSkills(exp.index);
    }
    this.selectProject(x.p);
  }

  stepSection(dir) {
    const i = this.sectionIndex;
    const last = this.sections.length - 1;
    if (i < 0) return this.goToSection(0);
    if (i + dir > last) return this.toast('That’s the last section');
    if (i + dir < 0) return this.toast('That’s the first section');
    this.goToSection(i + dir);
  }

  /** Presentation mode on or off. Starting it before the tour starts the tour. */
  setPresent(on) {
    this.setState({ present: on });
    if (on) {
      this.view.card = true;
      this.applyView();
      if (this.state.tourMode !== 'guided') this.goToSection(Math.max(0, this.sectionIndex));
    }
    this.toast(on ? 'Presentation mode: ← → or click the arrows · P to leave' : 'Presentation mode off');
    for (const fn of this.viewListeners) fn(this.view);
  }

  togglePresent() { this.setPresent(!this.state.present); }

  // ---- skills -----------------------------------------------------------------------
  /**
   * Skills are gained in order: every chapter up to `reached` has its skill mushrooms grown, the rest are
   * ungrown. `sprout` (a stop, or stops) grows in slowly, one skill after another, for the room to watch; any
   * other change catches up quickly (a jump past chapters, or stepping back before them).
   */
  syncSkills(reached, sprout = null) {
    this.skillsReached = reached;
    const slow = new Set([sprout].flat().filter(Boolean));
    for (const s of this.stops) {
      const want = s.index <= reached ? 1 : 0;
      let k = 0;
      for (const m of s.skillMushrooms) {
        if (m.growWant === want) continue;
        m.growWant = want;
        m.growSlow = want === 1 && slow.has(s);
        m.growWait = m.growSlow ? SKILL_IN + SKILL_STAGGER * k++ : 0;
      }
    }
  }

  updateSkills(dt) {
    for (const s of this.stops) for (const m of s.skillMushrooms) {
      if (m.growT === m.growWant) continue;
      if (m.growWait > 0) { m.growWait -= dt; continue; }
      // sprouting takes about two seconds; catching up or shrinking back, a third of that
      const speed = m.growSlow ? 0.5 : 1.6;
      m.growT = m.growWant > m.growT ? Math.min(1, m.growT + dt * speed) : Math.max(0, m.growT - dt * speed);
      m.grow = easeOutCubic(m.growT);
      if (m.growSlow && m.growT > 0.05 && !m.puffed) { m.puffed = true; m.impulse(0.6, 0.3); } // a little spring as it breaks ground
      if (m.growT === 0) m.puffed = false;
    }
  }

  // ---- card ---------------------------------------------------------------------------
  openCard(s) {
    if (this.cardProject) this.cardProject.marker.highlightTarget = 0;
    this.cardProject = null;
    this.cardStop = s;
    const n = this.stops.length;
    const guided = this.state.tourMode === 'guided';
    this.card.replaceChildren(...[
      h('div', { class: 'card-top' },
        h('span', { class: 'tag', style: { '--c': s.color } }, `Chapter ${s.index + 1}`),
        h('span', { class: 'count' }, `${s.index + 1} / ${n}`),
        guided ? null : button({ icon: I.close, title: 'Close', cls: 'icon ghost', onClick: () => this.closeCard() })),
      h('h2', { id: 'cardTitle' }, s.label),
      h('div', { class: 'meta' }, h('span', { class: 'pill' }, s.dates)),
      h('p', { class: 'desc' }, s.summary),
      // only what this chapter added: the story is cumulative, the card isn't
      s.skills.length ? h('div', { class: 'skills' }, h('h3', {}, 'Skills added'),
        h('ul', { 'aria-label': `Skills added at ${s.label}` }, ...s.skills.map((k) => h('li', {}, k)))) : null,
      s.id === LAB_ID ? this.lab.cardBlock() : null,
      s.links.length ? h('div', { class: 'card-actions' }, ...s.links.map((l) =>
        h('a', { class: 'btn primary', href: l.href, target: '_blank', rel: 'noopener' }, icon(I.external), h('span', { class: 'lbl' }, l.label)))) : null,
      s.id === this.clearing.stop ? h('div', { class: 'project-list', role: 'list', 'aria-label': 'Featured projects' },
        ...this.projects.map((p) => h('button', { type: 'button', role: 'listitem', class: 'project-chip', onclick: () => this.selectProject(p) },
          h('span', { class: 'dot', style: { background: p.color } }), p.label))) : null,
      s.id === this.clearing.stop ? h('p', { class: 'hint' }, h('kbd', {}, 'Q'), ' ', h('kbd', {}, 'E'), ' browse the projects') : null,
      h('div', { class: 'card-nav' },
        button({ icon: I.prev, title: 'Previous stop (PageUp / B)', cls: 'icon', onClick: () => this.prev() }),
        h('span', { class: 'hint' }, h('kbd', {}, 'B'), ' ', h('kbd', {}, 'N'), ' previous / next'),
        button({ icon: I.next, title: 'Next stop (PageDown / N)', cls: 'icon', onClick: () => this.next() })),
    ].filter(Boolean));
    this.card.setAttribute('aria-labelledby', 'cardTitle');
    this.card.style.setProperty('--accent', s.color);
    this.card.classList.add('open');
    for (const st of this.stops) st.marker.highlightTarget = st === s ? 1 : 0;
    this.showCard();
  }

  showCard() {
    if (innerWidth < 760) this.app.viewShiftTarget.set(0, 0.2);
    else this.app.viewShiftTarget.set(-0.14, 0);
    this.syncDock();
  }

  // ---- projects ---------------------------------------------------------------------
  /** Open a project's card and send the Gardener over to kneel beside it. */
  selectProject(p) {
    this.travel = null;
    this.boredom.reset();
    this.openProjectCard(p);
    this.app.avatar.walkTo(null, { kneelAt: p.marker });
    const c = this.clearing;
    const cap = p.marker.capWorldPosition(_v);
    // from inside the clearing, looking out: the project in front, the Experiments garden behind it
    this.app.flyTo(new THREE.Vector3(p.x, cap.y * 0.5 + heightAt(p.x, p.z) * 0.5, p.z),
      { distance: 5.4, polar: 0.92, azimuth: Math.atan2(c.x - p.x, c.z - p.z), duration: 1.4 });
  }

  stepProject(dir) {
    const i = this.cardProject ? this.cardProject.index + dir : dir > 0 ? 0 : this.projects.length - 1;
    this.selectProject(this.projects[(i + this.projects.length) % this.projects.length]);
  }

  openProjectCard(p) {
    if (this.cardStop) this.cardStop.marker.highlightTarget = 0;
    if (this.cardProject) this.cardProject.marker.highlightTarget = 0;
    this.cardStop = null;
    this.cardProject = p;
    p.marker.highlightTarget = 1;
    const stop = this.byId[this.clearing.stop];
    // only a verified demo URL becomes a button; otherwise say plainly where the project lives
    const where = p.availability === 'web' && p.demoLink
      ? h('a', { class: 'btn primary', href: p.demoLink, target: '_blank', rel: 'noopener' }, icon(I.external), h('span', { class: 'lbl' }, 'Open demo'))
      : h('span', { class: 'pill' }, p.availability === 'local' ? 'Live on Colson’s Mac' : 'No public link yet');
    this.card.replaceChildren(...[
      h('div', { class: 'card-top' },
        h('span', { class: 'tag', style: { '--c': p.color } }, 'Project'),
        h('span', { class: 'count' }, `${p.index + 1} / ${this.projects.length}`),
        button({ icon: I.close, title: 'Close', cls: 'icon ghost', onClick: () => this.closeCard() })),
      h('h2', { id: 'cardTitle' }, p.label),
      h('p', { class: 'desc' }, p.summary),
      h('div', { class: 'card-actions' }, where,
        p.repoLink ? h('a', { class: 'btn', href: p.repoLink, target: '_blank', rel: 'noopener' }, icon(I.github), h('span', { class: 'lbl' }, 'Code')) : null),
      h('div', { class: 'card-nav' },
        button({ icon: I.prev, title: 'Previous project (Q)', cls: 'icon', onClick: () => this.stepProject(-1) }),
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => this.goToStop(stop.index) }, `Back to ${stop.label}`),
        button({ icon: I.next, title: 'Next project (E)', cls: 'icon', onClick: () => this.stepProject(1) })),
    ].filter(Boolean));
    this.card.setAttribute('aria-labelledby', 'cardTitle');
    this.card.style.setProperty('--accent', p.color);
    this.card.classList.add('open');
    this.showCard();
  }

  closeCard() {
    this.card.classList.remove('open');
    if (this.cardStop) this.cardStop.marker.highlightTarget = 0;
    if (this.cardProject) this.cardProject.marker.highlightTarget = 0;
    this.cardStop = null;
    this.cardProject = null;
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
      type: 'button', class: 'stop-chip', 'data-stop': s.id, title: `${s.label} (${s.index + 1}${s.id === LAB_ID ? ' / L' : ''})`,
      'aria-label': `Go to ${s.label}`, onclick: () => this.goToStop(s.index),
    }, h('span', { class: 'dot', style: { background: s.color } }), h('span', { class: 'lbl' }, s.label)));
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
    this.onSectionChange?.(); // the presentation bar shows which section is on screen
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
    if (m.project) { this.selectProject(m.project); return; }
    const s = m.stop;
    if (!s) return;
    if (s.id === LAB_ID) { this.goToStop(s.index); return; } // the lab is a place to go to, not a mushroom to kneel at
    if (this.state.tourMode === 'free') {
      this.openCard(s);
      this.app.avatar.walkTo(null, { kneelAt: m });
    } else this.goToStop(s.index);
  }

  onClick(hit) {
    if (!hit.mushroom && this.state.tourMode === 'free' && (this.cardStop || this.cardProject)) this.closeCard();
  }

  onKey(e) {
    if (e.key === 'p' || e.key === 'P') { if (!e.repeat) this.togglePresent(); return true; }
    if (this.state.present) {
      // a clicker sends PageDown / PageUp; arrows and space work too. Everything steps a section.
      const dir = PRESENT_NEXT.includes(e.key) || NEXT_KEYS.includes(e.key) ? 1 : PRESENT_PREV.includes(e.key) || PREV_KEYS.includes(e.key) ? -1 : 0;
      if (dir) { if (!e.repeat) this.stepSection(dir); return true; }
      if (e.key === 'Escape') { this.setPresent(false); return true; }
    }
    if (e.repeat && !NEXT_KEYS.includes(e.key) && !PREV_KEYS.includes(e.key)) return false;
    if (NEXT_KEYS.includes(e.key)) { if (!e.repeat) this.next(); return true; }
    if (PREV_KEYS.includes(e.key)) { if (!e.repeat) this.prev(); return true; }
    // Q / E browse the projects from the Experiments stop, a project card, or anywhere in Free Explore
    if (PROJECT_KEYS[e.key] && (this.cardProject || this.state.currentStop === this.clearing.stop || this.state.tourMode === 'free')) {
      this.stepProject(PROJECT_KEYS[e.key]);
      return true;
    }
    // presenter view: V labels · I card · + / - text size · R back to the last stop
    if (e.key === 'v' || e.key === 'V') { this.toggleLabels(); return true; }
    if (e.key === 'i' || e.key === 'I') { this.toggleCard(); return true; }
    if (e.key === '+' || e.key === '=') { this.nudgeScale(1); return true; }
    if (e.key === '-' || e.key === '_') { this.nudgeScale(-1); return true; }
    if ((e.key === 'r' || e.key === 'R') && this.state.tourMode === 'free') { this.begin(); return true; }
    // Jump to Local Lab, from anywhere (the class contingency)
    if (e.key === 'l' || e.key === 'L') { this.goToStop(this.byId[LAB_ID].index); return true; }
    if (e.key === 'Enter' && this.state.tourMode === 'intro') { this.begin(); return true; }
    if (e.key === 'f' || e.key === 'F') { this.toggleExplore(); return true; }
    if ((e.key === 'g' || e.key === 'G') && this.state.tourMode !== 'guided') { this.begin(); return true; }
    const d = Number(e.key);
    if (Number.isInteger(d) && d >= 1 && d <= this.stops.length) { this.goToStop(d - 1); return true; }
    if (e.key === 'Escape' && (this.cardProject || (this.state.tourMode === 'free' && this.cardStop))) { this.closeCard(); return true; }
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
    this.lab.update(dt);
    this.updateBoredom(dt, av);
    this.updateSkills(dt);
    this.updateLogos(dt);
    this.updateLabels(dt);
    this.dates.update(dt);
  }

  /**
   * Which stop is the Gardener waiting at, and has he arrived and stopped there? Career stops count
   * once he has walked to the stand point; a project counts once he is beside it (kneeling, or standing
   * after boredom got him up). Free Explore and the intro never arm the clock.
   */
  boredomTarget(av) {
    const { tourMode, currentStop, avatarAtStop } = this.state;
    if (tourMode !== 'guided' || !currentStop) return { key: null, settled: false };
    const noInput = !av.path && !Object.values(av.keys).some(Boolean);
    const still = noInput && av.walkAmt < 0.05;
    const p = this.cardProject;
    if (p) {
      // getting up from the mushroom makes the steering ease him a step clear of its cap: that drift is
      // not the presenter's doing, so once boredom has begun only real input (a path, WASD) ends it
      const near = Math.hypot(av.position.x - p.x, av.position.z - p.z) < 2.2;
      const calm = this.boredom.bored ? noInput : still;
      return { key: `project:${p.id}`, settled: near && calm && (av.pose === 'kneel' || av.pose === 'stand') };
    }
    return { key: `career:${currentStop}`, settled: avatarAtStop && still && av.pose === 'stand' };
  }

  updateBoredom(dt, av) {
    const { key, settled } = this.boredomTarget(av);
    const paused = this.state.presenterPaused || this.boredomHolds.size > 0;
    const bored = this.boredom.update(dt, { key, settled, paused });
    av.setBored(bored);
    // the gag is only worth it if the room can see it: ease the camera in on him as it begins
    if (bored && !this.state.bored) {
      const t = _v.set(av.position.x, av.position.y + 1.0, av.position.z);
      if (this.app.follow === av) this.app.follow = null;
      this.app.flyTo(t.clone(), { distance: 4.4, polar: 1.3, duration: 3 });
    }
    this.setState({ bored });
  }

  /** The company logos: brightest over the current chapter, still there (dimmer) over the rest. */
  updateLogos(dt) {
    const { tourMode, currentStop } = this.state;
    const cam = this.app.camera, calm = reducedMotion();
    for (const logo of this.logos) {
      const s = logo.stop;
      let want = tourMode === 'guided' ? (s.id === currentStop ? 1 : 0.3) : 0.55;
      want *= clamp(s.marker.appear);
      logo.update(dt, this.app.env.time, cam, want, calm);
    }
  }

  updateLabels() {
    const cam = this.app.camera;
    const focused = this.cardStop ?? this.cardProject;
    for (const s of [...this.stops, ...this.projects]) {
      const m = s.marker;
      // anchored to the cap at rest, not as it sways, so the label holds perfectly still
      m.capWorldPosition(_v, { still: true });
      _v.y += 0.3 * m.scale;
      const p = this.app.toScreen(_v);
      const focus = s === focused;
      // project labels only show up close, so the overview stays readable
      let a = p ? smoothstep(m.project ? 15 : 40, m.project ? 9 : 16, cam.position.distanceTo(_v)) : 0;
      a *= clamp(m.appear);
      if (focused && !focus) a *= 0.45;
      if (focus) a = Math.max(a, p ? 1 : 0);
      // a lit company logo hangs where this label would be, and names the chapter on its own
      if (s.logoMark) a *= 1 - smoothstep(0.45, 0.85, s.logoMark.alpha);
      const el = m.label;
      s.screen = null;
      if (!p || a < 0.02) { el.style.opacity = 0; el.style.visibility = 'hidden'; continue; }
      // label sizes only change with the text size, so they're measured once per size (no layout per frame)
      if (!el.size || el.size.zoom !== this.view.scale || !el.size.w) el.size = { w: el.offsetWidth, h: el.offsetHeight, zoom: this.view.scale };
      s.screen = { x: p.x, y: p.y, w: el.size.w * (focus ? 1.08 : 1), h: el.size.h };
      el.style.visibility = 'visible';
      el.style.opacity = a.toFixed(2);
      el.style.transform = `translate(-50%, -100%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${focus ? 1.08 : 1})`;
      el.classList.toggle('focus', focus);
    }
    this.updateSkillLabels();
  }

  /**
   * Each grown skill mushroom carries its skill's name. Only the chapter in view names its skills (in Free
   * Explore, the garden the Gardener is in), so the frame never fills with words. Anchors are the caps at rest
   * and the camera holds still at a stop, so the labels hold still too; they step up out of each other's way.
   */
  updateSkillLabels() {
    const { tourMode, currentStop } = this.state;
    const av = this.app.avatar.position;
    const cam = this.app.camera.position;
    const avoid = [];
    for (const s of this.stops) if (s.screen) avoid.push({ x: s.screen.x - s.screen.w / 2, y: s.screen.y - s.screen.h, w: s.screen.w, h: s.screen.h });
    this.skillScreens = [];
    for (const s of this.stops) {
      const shown = tourMode === 'guided' ? s.id === currentStop && !this.cardProject
        : tourMode === 'free' && Math.hypot(av.x - s.x, av.z - s.z) < 4.5;
      const items = [];
      for (const m of s.skillMushrooms) {
        const el = m.skillLabel;
        let a = shown ? smoothstep(0.55, 0.95, m.grow) * clamp(m.appear) : 0;
        let p = null;
        if (a > 0.02) {
          m.capWorldPosition(_v, { still: true });
          _v.y += 0.12;
          p = this.app.toScreen(_v);
          if (!p || cam.distanceTo(_v) > 16) a = 0;
        }
        if (a <= 0.02) { el.style.visibility = 'hidden'; continue; }
        if (!el.size || el.size.zoom !== this.view.scale || !el.size.w) el.size = { w: el.offsetWidth, h: el.offsetHeight, zoom: this.view.scale };
        items.push({ el, a, x: p.x, y: p.y, w: el.size.w, h: el.size.h });
      }
      // nearest the bottom of the frame first; each steps up until it's clear of the ones already placed
      items.sort((i, j) => j.y - i.y);
      for (const it of items) {
        let r = { x: it.x - it.w / 2, y: it.y - it.h, w: it.w, h: it.h };
        for (let k = 0; k < 12 && avoid.some((o) => overlap(r, o)); k++) r = { ...r, y: r.y - it.h * 0.55 };
        avoid.push(r);
        this.skillScreens.push(r);
        it.el.style.visibility = 'visible';
        it.el.style.opacity = it.a.toFixed(2);
        it.el.style.transform = `translate(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px)`;
      }
    }
  }

}

const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
