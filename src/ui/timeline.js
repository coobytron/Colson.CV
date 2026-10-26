import * as THREE from 'three';
import { heightAt } from '../world/terrain.js';
import { clamp, damp, smoothstep } from '../lib/math.js';
import { h } from './dom.js';
import { LAB_ID } from '../modes/LocalLab.js';

const TOP_SAFE = 78; // keep clear of the top bar (scaled by the text size)
const LIFT = 0.6; // world metres above the tallest mushroom in the garden
const NUDGE = 0.6; // per step, in label heights, when something is in the way
const STEPS = 8;

const _v = new THREE.Vector3();
const _g = new THREE.Vector3();

/**
 * The career timeline, in the world (#15): each chapter's dates hang over its garden, tethered to it by a
 * hairline, so the chronology reads from the projected view without opening a card. The text comes from
 * the stop data (`dates`, `label`), the one source shared with the cards and the text version.
 *
 * The current chapter's date is brightest, the next one gently reveals, earlier ones recede (never vanish).
 * In Free Explore the Gardener's nearest garden is brightest. Labels are screen-space and pointer-transparent,
 * so they never take a click from a mushroom or label; they step up out of the way of the stop and project
 * labels and the Gardener, stay below the top bar, and dim behind the card.
 */
export class TimelineLabels {
  constructor(cv) {
    this.cv = cv;
    this.el = h('div', { id: 'timeline', 'aria-hidden': 'true' });
    cv.labelsEl.prepend(this.el); // under the stop and project labels
    this.items = cv.stops.map((s) => {
      // the Local Lab is a demo handoff, not another employment date
      const lab = s.id === LAB_ID;
      const el = h('div', { class: `dlabel${lab ? ' lab' : ''}`, style: { '--c': s.color } },
        h('span', { class: 'when' }, lab ? `${s.label} · ${s.dates}` : s.dates),
        lab ? null : h('span', { class: 'what' }, s.label),
        h('span', { class: 'tether' }));
      el.dataset.stop = s.id;
      this.el.append(el);
      const y = heightAt(s.centre.x, s.centre.z);
      const anchor = new THREE.Vector3(s.centre.x, y + s.top + LIFT, s.centre.z);
      const ground = new THREE.Vector3(s.centre.x, y + s.top * 0.6, s.centre.z);
      const peak = new THREE.Vector3(s.centre.x, y + s.top, s.centre.z);
      return { s, el, anchor, ground, peak, alpha: 0, size: null, last: null, at: null }; // last: offset kept from the ideal spot
    });
  }

  /** How prominent each chapter's date should be right now (0–1), before screen-space concerns. */
  emphasis(item) {
    const { tourMode, currentStop } = this.cv.state;
    const cur = this.cv.byId[currentStop];
    if (tourMode === 'free') {
      const av = this.cv.app.avatar.position;
      const d = Math.hypot(av.x - item.s.centre.x, av.z - item.s.centre.z);
      return 0.5 + 0.5 * smoothstep(9, 3.5, d);
    }
    if (!cur) return 0.8; // the start screen and the overview: the whole timeline at once
    const k = item.s.index - cur.index;
    if (k === 0) return 1;
    if (k === 1) return 0.55; // the next chapter, gently revealed
    if (k < 0) return Math.max(0.28, 0.48 + k * 0.06); // earlier chapters recede, never vanish
    return 0.22;
  }

  update(dt) {
    const cv = this.cv, app = cv.app;
    const zoom = cv.view.scale;
    // read everything first (one layout at most), then write
    const card = cv.card.classList.contains('open') && cv.view.card ? cv.card.getBoundingClientRect() : null;
    for (const it of this.items) {
      if (!it.size || it.size.zoom !== zoom || !it.size.w) it.size = { w: it.el.offsetWidth, h: it.el.offsetHeight, zoom };
    }
    const avoid = [];
    for (const s of [...cv.stops, ...cv.projects]) if (s.screen) avoid.push({ x: s.screen.x - s.screen.w / 2, y: s.screen.y - s.screen.h, w: s.screen.w, h: s.screen.h });
    avoid.push(...(cv.skillScreens ?? []));
    for (const logo of cv.logos ?? []) { const r = logo.screenRect(app); if (r) avoid.push(r); }
    const av = app.avatar;
    const head = app.toScreen(_v.set(av.position.x, av.position.y + 1.0, av.position.z));
    const foot = app.toScreen(_g.set(av.position.x, av.position.y, av.position.z));
    if (head && foot) {
      const tall = Math.max(40, foot.y - head.y) * 1.1;
      avoid.push({ x: head.x - tall * 0.25, y: foot.y - tall, w: tall * 0.5, h: tall });
    }
    const placed = [];
    const camPos = app.camera.position;

    for (const it of this.items) {
      const { el, size } = it;
      let want = this.emphasis(it) * clamp(it.s.marker.appear);
      const p = app.toScreen(it.anchor);
      const g = app.toScreen(it.ground);
      // off screen, behind the camera, or so close it'd fill the view: let it go
      const dist = camPos.distanceTo(it.anchor);
      want *= smoothstep(2.5, 4.5, dist);
      if (!p || !g || g.x < -40 || g.x > innerWidth + 40 || g.y > innerHeight + 40) want = 0;
      let x = 0, y = 0, slid = 0;
      const current = cv.state.currentStop === it.s.id && cv.state.tourMode === 'guided';
      if (p && g && want > 0) {
        x = clamp(p.x, size.w / 2 + 12, innerWidth - size.w / 2 - 12);
        // y is the label's bottom edge: over the garden's tallest cap (seen from high up the lift alone isn't
        // enough), and below the top bar
        const peak = app.toScreen(it.peak);
        y = Math.max(Math.min(p.y, peak ? peak.y - size.h * 0.9 : p.y), TOP_SAFE * zoom + size.h);
        // step up out of the way of labels, the Gardener and earlier dates; if the top bar is in the way,
        // try below instead; if nothing is free, recede
        const top = TOP_SAFE * zoom + size.h;
        const free = (yy) => { const r = { x: x - size.w / 2, y: yy - size.h, w: size.w, h: size.h }; return ![...avoid, ...placed].some((o) => overlap(r, o)); };
        // keep last frame's spot while it's still free: without this a label can hop between two equally good
        // spots from one frame to the next, which reads as a glitch while nothing else moves
        // (kept as an offset from the ideal spot, so it still follows the garden as the camera moves)
        const kept = it.last === null ? null : y + it.last;
        let spot = kept !== null && kept >= top && kept < innerHeight - 120 * zoom && free(kept) ? kept : null;
        for (let k = 0; k <= STEPS && spot === null; k++) {
          for (const yy of k ? [y - size.h * NUDGE * k, y + size.h * NUDGE * k] : [y]) {
            if (yy >= top && yy < innerHeight - 120 * zoom && free(yy)) { spot = yy; break; }
          }
        }
        it.last = spot === null ? null : spot - y;
        if (spot === null) want *= 0.2; else y = spot;
        // behind the card: step out to its left if there's room (the Local Lab's close-up), else recede
        const cardBox = card && { x: card.left, y: card.top, w: card.width, h: card.height };
        if (cardBox && overlap({ x: x - size.w / 2, y: y - size.h, w: size.w, h: size.h }, cardBox)) {
          const left = card.left - size.w / 2 - 16;
          // only the current chapter steps aside; the others simply recede behind the card
          if (current && left >= size.w / 2 + 12) { slid = x - left; x = left; } else want *= 0.15;
        }
        const r = { x: x - size.w / 2, y: y - size.h, w: size.w, h: size.h };
        if (slid && [...avoid, ...placed].some((o) => overlap(r, o))) want *= 0.3;
        placed.push(r);
      }
      it.alpha = damp(it.alpha, want, 4, dt);
      if (it.alpha < 0.02) { el.style.visibility = 'hidden'; it.at = null; continue; }
      // glide to a new spot rather than jump; a fresh label appears where it belongs
      if (!it.at) it.at = { x, y };
      else if (want > 0) { it.at.x = damp(it.at.x, x, 10, dt); it.at.y = damp(it.at.y, y, 10, dt); } // fading out: stay put
      ({ x, y } = it.at);
      el.style.visibility = 'visible';
      el.style.opacity = it.alpha.toFixed(2);
      el.classList.toggle('current', current);
      // the hairline drops to the garden, unless the label had to step aside from it
      el.style.setProperty('--tether', `${slid > size.w / 2 ? 0 : Math.max(0, (g?.y ?? y) - y).toFixed(0)}px`);
      el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }
}

const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
