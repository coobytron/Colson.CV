import { App } from './app.js';
import { CVMode, UI_SCALES } from './modes/CVMode.js';
import { Avatar } from './avatar/Avatar.js';
import { createAmbient } from './world/ambient.js';
import { h, button } from './ui/dom.js';
import { I } from './ui/icons.js';
import DATA from './data/cv.js';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

/** The whole CV as plain text and links: the no-WebGL fallback, and the "Text version" for any browser. */
function listCard() {
  return h('div', { class: 'fallback-card' },
    h('h1', { id: 'listTitle' }, DATA.name), h('p', { class: 'dim' }, `${DATA.role}. Career stops, in order.`),
    h('ol', {}, ...DATA.stops.map((s) => h('li', {},
      h('b', {}, s.label), ' ', h('span', { class: 'dim' }, s.dates), h('br'), s.summary,
      s.skills.length ? [h('br'), h('span', { class: 'dim' }, `Skills added: ${s.skills.join(', ')}.`)] : null,
      ...s.links.map((k) => [' ', h('a', { href: k.href, target: '_blank', rel: 'noopener' }, k.label)])))),
    h('h2', {}, 'Featured projects'),
    h('ul', {}, ...DATA.projects.map((p) => h('li', {},
      h('b', {}, p.label), h('br'), p.summary, ' ',
      p.repoLink ? [h('a', { href: p.repoLink, target: '_blank', rel: 'noopener' }, 'Code'), ' '] : null,
      p.availability === 'web' && p.demoLink ? h('a', { href: p.demoLink, target: '_blank', rel: 'noopener' }, 'Open demo')
        : h('span', { class: 'dim' }, p.availability === 'local' ? 'Live on Colson’s Mac' : 'No public link yet')))));
}

/** Without WebGL the CV is still readable: the same list, full page. */
function fallback() {
  const l = document.getElementById('loader');
  l.className = 'fallback';
  const card = listCard();
  card.querySelector('p').textContent = `${DATA.role}. The 3D grove needs WebGL, so here is the whole CV as a list.`;
  l.replaceChildren(card);
}

/** "Text version": the same list as an overlay over the grove; Esc or Close returns to it. */
function listOverlay() {
  const closeBtn = button({ icon: I.close, label: 'Close', cls: 'small', onClick: () => close() });
  const el = h('div', { id: 'listView', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'listTitle' }, closeBtn, listCard());
  let opener = null;
  function close() { el.remove(); opener?.focus?.(); }
  return {
    open() { if (el.isConnected) return; opener = document.activeElement; document.body.append(el); closeBtn.focus(); },
    close() { if (el.isConnected) close(); },
    get isOpen() { return el.isConnected; },
  };
}

function boot() {
  if (!webglAvailable()) { fallback(); return; }
  const canvas = document.getElementById('scene');
  const app = new App(canvas);
  const cv = new CVMode(app);
  app.registerMode('cv', cv);
  // the original Mycelia Gardener, plus the moths and falling leaves
  app.avatar = app.addActor(new Avatar(app));
  app.addActor(createAmbient(app));
  // handy for poking around in devtools and for the QA script
  window.colsonCV = { app, cv, get state() { return cv.state; } };

  const list = listOverlay();
  const toastMsg = (t) => cv.toast(t);
  // a lost graphics context (sleep, GPU reset, another heavy tab) pauses drawing; the engine recovers on its own
  canvas.addEventListener('webglcontextlost', () => toastMsg('Graphics paused. Waiting for the browser to give them back…'));
  canvas.addEventListener('webglcontextrestored', () => toastMsg('Graphics are back'));

  // ---- intro ----
  const intro = document.getElementById('intro');
  intro.querySelector('[data-list]').addEventListener('click', () => list.open());
  intro.querySelector('[data-begin]').addEventListener('click', () => cv.begin());
  intro.querySelector('[data-explore]').addEventListener('click', () => cv.explore());
  cv.onState((s) => intro.classList.toggle('hidden', s.tourMode !== 'intro'));

  // ---- status pill: where the tour is ----
  const status = document.getElementById('status');
  const syncStatus = (s) => {
    const stop = cv.byId[s.currentStop];
    status.textContent = s.tourMode === 'intro' ? 'Playable CV'
      : s.tourMode === 'free' ? 'Free explore'
        : s.labPhase === 'back' ? `Q&A · ${stop.label}`
          : `${stop.index + 1} / ${cv.stops.length} · ${stop.label}`;
  };
  cv.onState(syncStatus);
  syncStatus(cv.state);

  // ---- actions ----
  const actions = document.getElementById('actions');
  const pressable = (label, title, onClick) => {
    const b = button({ label, title, cls: 'small ghost', onClick });
    b.setAttribute('aria-pressed', 'true');
    return b;
  };
  const labelsBtn = pressable('Labels', 'Show or hide the mushroom labels (V)', () => cv.toggleLabels());
  const cardBtn = pressable('Card', 'Show or hide the info card (I)', () => cv.toggleCard());
  const smaller = button({ label: 'A−', title: 'Smaller text (−)', cls: 'small ghost', onClick: () => cv.nudgeScale(-1) });
  const bigger = button({ label: 'A+', title: 'Larger text (+)', cls: 'small ghost', onClick: () => cv.nudgeScale(1) });
  const full = button({ label: 'Full', title: 'Fullscreen', cls: 'small ghost', onClick: () => cv.toggleFullscreen() });
  smaller.setAttribute('aria-label', 'Smaller text');
  bigger.setAttribute('aria-label', 'Larger text');
  cv.onView((v) => {
    labelsBtn.setAttribute('aria-pressed', String(v.labels));
    cardBtn.setAttribute('aria-pressed', String(v.card));
    smaller.disabled = v.scale <= UI_SCALES[0];
    bigger.disabled = v.scale >= UI_SCALES.at(-1);
  });
  actions.classList.add('presenter');
  actions.append(
    labelsBtn, cardBtn, smaller, bigger, full,
    button({ icon: I.eye, title: 'Hide interface (H)', cls: 'icon ghost', onClick: () => toggleUi() }),
    button({ icon: I.help, title: 'Controls (?)', cls: 'icon ghost', onClick: () => toggleHelp() }),
  );
  const help = document.getElementById('help');
  const toggleHelp = (force) => help.classList.toggle('show', force);
  help.addEventListener('click', (e) => { if (e.target === help || e.target.closest('[data-close]')) toggleHelp(false); });
  const toggleUi = () => {
    document.body.classList.toggle('ui-hidden');
    if (document.body.classList.contains('ui-hidden')) {
      const t = document.getElementById('toast');
      t.textContent = 'Press H or tap here to bring the interface back';
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2600);
    }
  };
  document.getElementById('toast').addEventListener('click', () => document.body.classList.remove('ui-hidden'));

  // ---- keyboard ----
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (list.isOpen) { if (e.key === 'Escape') { list.close(); e.preventDefault(); } return; }
    if (help.classList.contains('show') && e.key !== '?' && e.key !== 'Escape') return;
    if (app.mode?.onKey?.(e)) { e.preventDefault(); return; }
    if (app.avatar?.onKey?.(e, true)) { e.preventDefault(); return; }
    if (e.key === 'h' || e.key === 'H') toggleUi();
    else if (e.key === '?') toggleHelp();
    else if (e.key === 'Escape') { list.close(); toggleHelp(false); document.body.classList.remove('ui-hidden'); }
  });
  window.addEventListener('keyup', (e) => { if (!e.target.closest('input, textarea')) app.avatar?.onKey?.(e, false); });
  window.addEventListener('blur', () => app.avatar?.releaseKeys?.());

  app.setMode('cv');
  app.start();

  // deep link: #apple starts the tour at that stop
  const deep = () => { const s = cv.byId[location.hash.slice(1)]; if (s) cv.goToStop(s.index); };
  window.addEventListener('hashchange', deep);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.getElementById('loader').classList.add('done');
    deep();
  }));
}

boot();
