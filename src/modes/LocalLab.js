import * as THREE from 'three';
import { createWorkstation } from '../world/workstation.js';
import { SIT } from '../avatar/poses.js';
import { heightAt } from '../world/terrain.js';
import { h, button } from '../ui/dom.js';
import { I } from '../ui/icons.js';

export const LAB_ID = 'local-lab';
export const LAB_LINE = 'I can’t open Metal shaders in here… they’re on my Mac.';

const SPEAK_DELAY = 1.2; // seconds seated before the line
const HANDOFF_DELAY = 2.6; // seconds after the line before the handoff card
const BUBBLE_SECONDS = 14; // the line fades on its own; the handoff card stays
const FRAME = { distance: 3.4, polar: 1.28, ahead: 2.1, side: 2.1 }; // camera: ahead of and beside the Gardener
const SIDE = -1; // which side of him the camera sits on (-1: so his face, not his back, is toward it)
const MONITOR_TURN = 0.95 * SIDE; // the monitor is turned the same way, so the screen reads from the camera too

const _v = new THREE.Vector3();

/**
 * The final chapter, done in the world. The Gardener walks to a small workstation, sits and looks at the
 * monitor, says he can't open the Metal shaders in here, and the page hands off to the presenter, who
 * switches to Finder on their own. Nothing here touches the OS: no file access, no permissions, no
 * launching anything. The page just keeps its place and waits.
 *
 * Phases (cv.state.labPhase mirrors this):
 *   idle      not at the lab
 *   sitting   walked over and sitting down, looking at the monitor
 *   speaking  the speech bubble is up
 *   handoff   the LOCAL LAB / LIVE DEMO card says to switch to Finder
 *   away      the window lost focus or the tab was hidden (the presenter is in Finder)
 *   back      focus returned: same scene, Q&A and Back to the forest are on offer
 * Leaving the lab (walking off, another stop, Free Explore) resets to idle, so a revisit replays the beat.
 */
export class LocalLab {
  constructor(cv) {
    this.cv = cv;
    this.phase = 'idle';
    this.t = 0;
    this.bubbleT = 0;
    this.away = false;
    this.afterAway = 'handoff'; // where 'back' resumes from

    const s = cv.byId[LAB_ID];
    // The Gardener sits between the marker and the grove's middle, facing toward the middle, with the
    // marker mushroom glowing behind him.
    const f = s.dir;
    this.facing = { x: f.x, z: f.z };
    this.sit = { x: s.stand.x, z: s.stand.z };
    s.workstation = { yaw: Math.atan2(f.x, f.z) };
    this.ws = createWorkstation(this.sit, f, MONITOR_TURN);
    this.ws.sitYaw = s.workstation.yaw;
    cv.group.add(this.ws.group);
    // the desk is solid: steering walks around it, and the sit-spot check keeps clear of it
    cv.app.obstacles.push({ x: this.ws.desk.x, z: this.ws.desk.z, r: 0.5, kind: 'desk' });

    this.bubble = h('div', { id: 'speech', role: 'status', 'aria-live': 'polite' }, h('span', {}, LAB_LINE));
    document.getElementById('ui').append(this.bubble);

    // The presenter switching to Finder (Cmd-Tab) blurs the window or hides the tab; coming back focuses it.
    window.addEventListener('blur', () => this.setAway(true));
    window.addEventListener('focus', () => this.setAway(false));
    document.addEventListener('visibilitychange', () => this.setAway(document.hidden));
  }

  // ---- presenter away / back ---------------------------------------------------------------
  setAway(away) {
    if (this.away === away) return;
    this.away = away;
    if (away) {
      if (this.phase === 'speaking' || this.phase === 'handoff' || this.phase === 'back') {
        this.afterAway = this.phase === 'speaking' ? 'handoff' : this.phase;
        this.setPhase('away');
      }
    } else if (this.phase === 'away') {
      // the same scene, exactly as they left it: just offer Q&A and the way back to the forest
      this.setPhase('back');
    }
  }

  setPhase(p) {
    if (this.phase === p) return;
    this.phase = p;
    this.cv.setState({ labPhase: p });
    this.showBubble();
    // re-render the stop card when it is the lab's
    if (this.cv.cardStop?.id === LAB_ID) this.cv.openCard(this.cv.cardStop);
  }

  /** The card block for the current phase (the stop card calls this when it is the lab's). */
  cardBlock() {
    const cv = this.cv;
    const forest = button({ icon: I.walk, label: 'Back to the forest', title: 'Back to the forest (F)', onClick: () => cv.explore() });
    if (this.phase === 'back') {
      return h('div', { class: 'handoff back' },
        h('span', { class: 'badge' }, 'Welcome back'),
        h('p', { class: 'instruction' }, 'Q&A: the Gardener’s still at his desk.'),
        h('p', { class: 'note' }, 'Nothing moved while you were away.'),
        h('div', { class: 'card-actions' }, forest));
    }
    if (this.phase === 'handoff' || this.phase === 'away') {
      return h('div', { class: 'handoff' },
        h('span', { class: 'badge' }, 'Local Lab · Live demo'),
        h('p', { class: 'instruction' }, 'Switch to Finder to open the Metal shaders. ', h('kbd', {}, '⌘'), h('kbd', {}, 'Tab')),
        h('p', { class: 'note' }, 'These run natively on my Mac, not in a browser. This page waits right here.'),
        h('div', { class: 'card-actions' }, forest));
    }
    return null;
  }

  // ---- per frame -----------------------------------------------------------------------------
  update(dt) {
    const cv = this.cv, av = cv.app.avatar, st = cv.state;
    const here = st.tourMode === 'guided' && st.currentStop === LAB_ID && st.avatarAtStop && av.pose === 'sit' && av.we[SIT] > 0.9;
    if (!here) {
      if (this.phase !== 'idle') this.leave();
      return;
    }
    if (this.phase === 'idle') this.begin();
    // face the monitor: walking up to the rug leaves him turned the way he arrived, so say it outright
    av.yawTarget = this.ws.sitYaw;
    if (this.away) return; // everything holds while the presenter is in Finder
    this.t += dt;
    if (this.phase === 'sitting' && this.t > SPEAK_DELAY) { this.t = 0; this.bubbleT = 0; this.setPhase('speaking'); }
    else if (this.phase === 'speaking' && this.t > HANDOFF_DELAY) this.setPhase('handoff');
    if (this.phase === 'speaking' || this.phase === 'handoff') this.bubbleT += dt;
    this.showBubble();
    this.placeBubble(av);
  }

  /** The line shows while speaking, lingers into the handoff, and fades on its own. */
  showBubble() {
    const live = (this.phase === 'speaking' || this.phase === 'handoff' || this.phase === 'away') && this.bubbleT < BUBBLE_SECONDS;
    this.bubble.classList.toggle('show', live);
  }

  begin() {
    const cv = this.cv;
    this.t = 0;
    this.bubbleT = 0;
    cv.app.avatar.setWatching(true);
    cv.holdBoredom('lab', true); // a long Q&A at the desk is not boredom
    this.setPhase(this.away ? 'away' : 'sitting');
    if (this.away) this.afterAway = 'handoff';
  }

  leave() {
    const cv = this.cv;
    cv.app.avatar.setWatching(false);
    cv.holdBoredom('lab', false);
    this.bubble.classList.remove('show');
    this.phase = 'idle'; // not via setPhase: the stop card is already moving on
    cv.setState({ labPhase: 'idle' });
    this.t = 0;
    this.bubbleT = 0;
  }

  /** Replay the beat (Jump to Local Lab while already here). */
  restart() {
    if (this.phase === 'idle') return;
    this.leave();
  }

  placeBubble(av) {
    if (!this.bubble.classList.contains('show')) return;
    av.rig.joints.head.getWorldPosition(_v);
    _v.y += 0.32;
    const p = this.cv.app.toScreen(_v);
    if (!p) return;
    const x = Math.min(innerWidth - 170, Math.max(170, p.x));
    this.bubble.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${Math.max(90, p.y).toFixed(1)}px)`;
  }

  /** Camera: beside and ahead of the Gardener, so his face and the monitor are both in frame. */
  frame(duration = 1.8) {
    const app = this.cv.app, f = this.facing;
    const r = { x: -f.z, z: f.x }; // his right
    const tx = this.sit.x + f.x * 0.55, tz = this.sit.z + f.z * 0.55;
    const target = new THREE.Vector3(tx, heightAt(tx, tz) + 0.78, tz);
    const ox = f.x * FRAME.ahead + r.x * FRAME.side * SIDE, oz = f.z * FRAME.ahead + r.z * FRAME.side * SIDE;
    if (app.follow === app.avatar) app.follow = null;
    app.flyTo(target, { distance: FRAME.distance, polar: FRAME.polar, azimuth: Math.atan2(ox, oz), duration });
  }
}
