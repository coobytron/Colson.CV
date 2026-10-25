import { App } from './app.js';
import { CVMode } from './modes/CVMode.js';
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

/** Without WebGL the CV is still readable: a plain list of the stops. */
function fallback() {
  const l = document.getElementById('loader');
  l.className = 'fallback';
  l.replaceChildren(h('div', { class: 'fallback-card' },
    h('h1', {}, DATA.name), h('p', { class: 'dim' }, `${DATA.role}. The 3D grove needs WebGL, so here are the stops as a list.`),
    h('ol', {}, ...DATA.stops.map((s) => h('li', {},
      h('b', {}, s.title), ' ', h('span', { class: 'dim' }, s.dates), h('br'), s.summary,
      ...s.links.map((k) => [' ', h('a', { href: k.href, target: '_blank', rel: 'noopener' }, k.label)]))))));
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

  // ---- intro ----
  const intro = document.getElementById('intro');
  intro.querySelector('[data-begin]').addEventListener('click', () => cv.begin());
  intro.querySelector('[data-explore]').addEventListener('click', () => cv.explore());
  cv.onState((s) => intro.classList.toggle('hidden', s.tourMode !== 'intro'));

  // ---- status pill: where the tour is ----
  const status = document.getElementById('status');
  const syncStatus = (s) => {
    const stop = cv.byId[s.currentStop];
    status.textContent = s.tourMode === 'intro' ? 'Playable CV'
      : s.tourMode === 'free' ? 'Free explore'
        : `${stop.index + 1} / ${cv.stops.length} · ${stop.title}`;
  };
  cv.onState(syncStatus);
  syncStatus(cv.state);

  // ---- actions ----
  const actions = document.getElementById('actions');
  actions.append(
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
    if (help.classList.contains('show') && e.key !== '?' && e.key !== 'Escape') return;
    if (app.mode?.onKey?.(e)) { e.preventDefault(); return; }
    if (app.avatar?.onKey?.(e, true)) { e.preventDefault(); return; }
    if (e.key === 'h' || e.key === 'H') toggleUi();
    else if (e.key === '?') toggleHelp();
    else if (e.key === 'Escape') { toggleHelp(false); document.body.classList.remove('ui-hidden'); }
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
