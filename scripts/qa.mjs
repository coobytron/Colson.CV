#!/usr/bin/env node
// Navigation QA: builds, serves dist/ with vite preview, and drives the tour in headless Chromium
// (SwiftShader). Checks that every stop is reached by walking (not teleporting), that the Gardener holds
// his place at a stop when left alone, that Free Explore and back keeps the tour's place, and that the
// console stays clean. Screenshots and a report go to .shots/.
//
//   npm run qa                         build + test at 1440x900 and 1920x1080
//   npm run qa -- --skip-build         reuse dist/
//   npm run qa -- --url http://…/      test an already running server
//   options: --port 4177  --out .shots  --sizes 1440x900,1920x1080  --timescale 6 (sim steps per frame;
//   SwiftShader renders a few fps, so the walk is sped up — screenshots are low-quality preset)
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, writeFileSync, createReadStream, statSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import CV from '../src/data/cv.js';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const port = Number(opt('port', 4177));
const outDir = resolve(ROOT, opt('out', '.shots'));
const timescale = Number(opt('timescale', 6));
const only = opt('only', 'all'); // all | smoke | full | extras
const sizes = opt('sizes', '1440x900,1920x1080').split(',').map((s) => s.split('x').map(Number));
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[qa]', ...a);

async function waitForHttp(url, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error(`server at ${url} did not come up`);
}

async function serve() {
  const external = opt('url', null);
  if (external) return { base: external, stop: () => {} };
  if (!flag('skip-build') || !existsSync(join(ROOT, 'dist/index.html'))) {
    log('building…');
    const b = spawnSync('npx', ['vite', 'build', '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit' });
    if (b.status !== 0) throw new Error('vite build failed');
  }
  const child = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', detached: true });
  const base = `http://127.0.0.1:${port}/`;
  await waitForHttp(base);
  return { base, stop: () => { try { process.kill(-child.pid); } catch { /* gone */ } } };
}

function browserPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const p of ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser']) if (existsSync(p)) return p;
  return undefined; // playwright-core's own lookup
}

// ---- checks -----------------------------------------------------------------------------------
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const state = (page) => page.evaluate(() => ({ ...window.colsonCV.state }));
const avatar = (page) => page.evaluate(() => {
  const a = window.colsonCV.app.avatar;
  return { x: a.position.x, z: a.position.z, pose: a.pose, state: a.state };
});

/** Wait for the Gardener to arrive at `id`, sampling his position to prove he walked there. */
async function arriveAt(page, id, ms = 120000) {
  const start = await avatar(page);
  const samples = [start];
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await sleep(250);
    samples.push(await avatar(page));
    const s = await state(page);
    if (s.currentStop === id && s.avatarAtStop) break;
  }
  const end = samples.at(-1);
  const total = Math.hypot(end.x - start.x, end.z - start.z);
  let maxStep = 0;
  for (let i = 1; i < samples.length; i++) maxStep = Math.max(maxStep, Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z));
  const s = await state(page);
  let moving = 0;
  for (let i = 1; i < samples.length; i++) if (Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z) > 0.01) moving++;
  return { arrived: s.currentStop === id && s.avatarAtStop, total, maxStep, moving, walked: samples.some((p) => p.state === 'walk') };
}

async function run(base, [w, hgt]) {
  const tag = `${w}x${hgt}`;
  const browser = await chromium.launch({ executablePath: browserPath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: w, height: hgt } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const outside = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (!/^(data|blob|about):/.test(r.url()) && u.origin !== new URL(base).origin) outside.push(r.url()); });
  await page.goto(`${base}?quality=low&timescale=${timescale}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.colsonCV && document.getElementById('loader').classList.contains('done'), null, { timeout: 30000 });
  await sleep(4000);
  const shot = (n) => page.screenshot({ path: join(outDir, `${tag}-${n}.png`) });
  await shot('00-intro');
  const s0 = await state(page);
  check(`${tag} intro state`, s0.tourMode === 'intro' && s0.currentStop === null, JSON.stringify(s0));
  check(`${tag} gardener present`, await page.evaluate(() => !!window.colsonCV.app.avatar.rig.root.parent));

  const stops = await page.evaluate(() => window.colsonCV.cv.stops.map((s) => s.id));
  for (let i = 0; i < stops.length; i++) {
    await page.keyboard.press(i === 0 ? 'Enter' : 'n');
    const r = await arriveAt(page, stops[i]);
    // a teleport would be one sample covering most of the distance; a walk is many small steps
    check(`${tag} walk to ${stops[i]}`, r.arrived && r.walked && r.moving >= 4 && r.maxStep < Math.max(0.5, r.total * 0.4),
      `moved ${r.total.toFixed(1)} m over ${r.moving} samples, largest sample step ${r.maxStep.toFixed(2)} m`);
    await sleep(1800); // camera settles
    await shot(`${String(i + 1).padStart(2, '0')}-${stops[i]}`);
  }
  await page.keyboard.press('n');
  check(`${tag} no wrap past the last stop`, (await state(page)).currentStop === stops.at(-1));

  await page.keyboard.press('b');
  const back = await arriveAt(page, stops.at(-2));
  check(`${tag} previous stop`, back.arrived, stops.at(-2));

  // presenter talks for a long time: pretend nobody has touched anything for 2 minutes
  const before = await avatar(page);
  await page.evaluate(() => { window.colsonCV.app.lastInteraction = performance.now() - 120000; });
  await sleep(12000);
  const after = await avatar(page);
  const s1 = await state(page);
  check(`${tag} holds at stop when idle`, s1.avatarAtStop && after.pose === 'stand' && Math.hypot(after.x - before.x, after.z - before.z) < 0.2,
    `pose ${after.pose}, drift ${Math.hypot(after.x - before.x, after.z - before.z).toFixed(2)} m`);
  check(`${tag} no auto-advance`, s1.currentStop === stops.at(-2));

  await page.keyboard.press('f');
  await sleep(1500);
  const s2 = await state(page);
  check(`${tag} free explore keeps place`, s2.tourMode === 'free' && s2.currentStop === stops.at(-2), JSON.stringify(s2));
  await page.keyboard.down('KeyW');
  await sleep(2500);
  await page.keyboard.up('KeyW');
  await shot('20-free-explore');
  await page.keyboard.press('g');
  const ret = await arriveAt(page, stops.at(-2));
  check(`${tag} back to tour returns to same stop`, ret.arrived && (await state(page)).tourMode === 'guided');

  // ---- projects: the Experiments card lists them, Q / E browse, he walks over and kneels ----
  const projects = await page.evaluate(() => window.colsonCV.cv.projects.map(({ id, label, demoLink, repoLink, availability }) => ({ id, label, demoLink, repoLink, availability })));
  const listed = await page.$$eval('#card .project-chip', (b) => b.map((x) => x.textContent.trim()));
  check(`${tag} experiments card lists every project`, projects.every((p) => listed.includes(p.label)), listed.join(', '));
  await page.keyboard.press('e');
  const first = projects[0];
  let knelt = null;
  for (let t = 0; t < 240 && !knelt; t++) {
    await sleep(250);
    knelt = await page.evaluate((id) => {
      const { cv, app } = window.colsonCV;
      const a = app.avatar, p = cv.projects.find((x) => x.id === id);
      return a.pose === 'kneel' && a.we[2] > 0.9 && Math.hypot(a.position.x - p.x, a.position.z - p.z) < 2 ? true : null;
    }, first.id);
  }
  const open = await page.evaluate(() => window.colsonCV.cv.cardProject?.id);
  check(`${tag} E opens first project, gardener kneels there`, open === first.id && knelt, `card ${open}`);
  await sleep(1500);
  await shot('30-project');
  // every project card: a verified demo button, or an honest "where it lives" note, never an invented link
  const cards = await page.evaluate(() => window.colsonCV.cv.projects.map((p) => {
    window.colsonCV.cv.openProjectCard(p);
    const card = document.getElementById('card');
    return { id: p.id, hrefs: [...card.querySelectorAll('a[href]')].map((a) => a.href), text: card.textContent };
  }));
  for (const c of cards) {
    const p = projects.find((x) => x.id === c.id);
    // exactly the links in the data: the verified demo (web only) and the OK'd repo, nothing invented
    const want = [p.availability === 'web' ? p.demoLink : null, p.repoLink].filter(Boolean);
    const ok = c.hrefs.length === want.length && want.every((u) => c.hrefs.includes(u))
      && (p.availability === 'web' || c.text.includes(p.availability === 'local' ? 'Live on Colson’s Mac' : 'No public link yet'));
    check(`${tag} card ${c.id}`, ok, c.hrefs.join(' ') || p.availability);
  }
  // free explore reaches a project through its label
  await page.keyboard.press('f');
  await sleep(800);
  await page.evaluate(() => window.colsonCV.cv.projects.at(-1).marker.label.click());
  await sleep(500);
  check(`${tag} free explore opens a project from its label`, (await page.evaluate(() => window.colsonCV.cv.cardProject?.id)) === projects.at(-1).id);

  await page.keyboard.press('3');
  const jump = await arriveAt(page, stops[2]);
  check(`${tag} number key jumps to stop 3`, jump.arrived);

  // ---- boredom (#3): default 180 s; tests shorten `cv.boredom.seconds` ----
  const cvState = () => page.evaluate(() => {
    const { cv, app } = window.colsonCV;
    const av = app.avatar;
    return { ...cv.state, elapsed: cv.boredom.elapsed, seconds: cv.boredom.seconds, weight: av.bored, boredT: av.boredT, pose: av.pose };
  });
  const waitFor = async (fn, ms = 120000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) { const v = await fn(); if (v) return v; await sleep(250); }
    return null;
  };
  const settle = async (id) => { const r = await arriveAt(page, id); await sleep(500); return r.arrived; };
  const shorten = (secs) => page.evaluate((n) => { const c = window.colsonCV.cv.boredom; c.seconds = c.elapsed + n; }, secs);

  await page.keyboard.press('3');
  await settle(stops[2]);
  await waitFor(async () => (await cvState()).elapsed > 1, 60000);
  const b0 = await cvState();
  check(`${tag} boredom default is 180 s and the clock runs while he waits`, b0.seconds === 180 && b0.elapsed > 1 && !b0.bored, `${b0.elapsed.toFixed(1)} s of ${b0.seconds}`);
  for (let i = 0; i < 8; i++) { await page.mouse.move(200 + i * 90, 300 + (i % 3) * 60); await sleep(150); }
  const b1 = await cvState();
  check(`${tag} incidental mouse movement does not reset the clock`, b1.elapsed > b0.elapsed, `${b0.elapsed.toFixed(1)} → ${b1.elapsed.toFixed(1)}`);

  // pause: Local Lab handoff and a hidden tab hold the clock, keep the elapsed time, and never fire
  await shorten(6);
  await page.evaluate(() => window.colsonCV.cv.holdBoredom('handoff', true));
  const h0 = await cvState();
  await sleep(9000);
  const h1 = await cvState();
  check(`${tag} Local Lab handoff holds the clock`, !h1.bored && Math.abs(h1.elapsed - h0.elapsed) < 0.3, `${h0.elapsed.toFixed(2)} → ${h1.elapsed.toFixed(2)}`);
  await page.evaluate(() => { window.colsonCV.cv.holdBoredom('handoff', false); window.colsonCV.cv.setState({ presenterPaused: true }); });
  await sleep(8000);
  const h2 = await cvState();
  check(`${tag} a hidden tab holds the clock`, !h2.bored && Math.abs(h2.elapsed - h1.elapsed) < 0.3, `${h1.elapsed.toFixed(2)} → ${h2.elapsed.toFixed(2)}`);
  await page.evaluate(() => window.colsonCV.cv.setState({ presenterPaused: false }));
  const fired = await waitFor(async () => (await cvState()).bored);
  const bd = await cvState();
  check(`${tag} resuming does not misfire; boredom starts once the interval is used up`, !!fired && bd.elapsed + 0.5 >= bd.seconds, `${bd.elapsed.toFixed(1)} of ${bd.seconds}`);
  check(`${tag} bored: still at the stop, standing, no auto-advance`, bd.currentStop === stops[2] && bd.avatarAtStop && bd.pose === 'stand', `stop ${bd.currentStop}, pose ${bd.pose}`);

  // a frame strip across the 15 s loop, for visual review
  for (const [i, at] of [2.5, 6, 9.8, 13, 14.7].entries()) {
    await waitFor(async () => (await cvState()).boredT >= at, 30000);
    await shot(`40-bored-${i + 1}`);
  }
  const loop1 = await cvState();
  check(`${tag} the bored animation is eased in and stays at the stop`, loop1.weight > 0.95 && loop1.bored && loop1.currentStop === stops[2], `weight ${loop1.weight.toFixed(2)}`);

  // reduced motion: a stable pose instead of the looping gestures
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await sleep(500);
  const r0 = await cvState();
  await sleep(2500);
  const r1 = await cvState();
  check(`${tag} reduced motion freezes the loop but keeps the bored pose`, r1.bored && r1.weight > 0.9 && Math.abs(r1.boredT - r0.boredT) < 0.01, `boredT ${r0.boredT.toFixed(2)} → ${r1.boredT.toFixed(2)}`);
  await shot('41-bored-reduced-motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // meaningful action: walking clears it at once, he fades back to attentive, and a revisit starts afresh
  await page.keyboard.down('KeyD');
  await sleep(1200);
  await page.keyboard.up('KeyD');
  const w0 = await cvState();
  check(`${tag} moving clears boredom immediately`, !w0.bored && w0.elapsed === 0 && w0.weight < 0.5, `bored ${w0.bored}, weight ${w0.weight.toFixed(2)}`);
  await page.keyboard.press('n');
  await settle(stops[3]);
  await page.keyboard.press('b');
  await settle(stops[2]);
  const w1 = await cvState();
  check(`${tag} revisiting a stop starts a fresh interval`, !w1.bored && w1.elapsed < 10 && w1.seconds > 0, `${w1.elapsed.toFixed(1)} s`);

  // a project stop: bored while kneeling at a mushroom makes him stand up beside it
  await page.keyboard.press('5');
  await settle(stops[4]);
  await page.keyboard.press('e');
  await waitFor(async () => (await cvState()).pose === 'kneel', 60000);
  await sleep(1500);
  await shorten(6);
  const pb = await waitFor(async () => (await cvState()).bored);
  await waitFor(async () => (await cvState()).weight > 0.5, 30000);
  const p1 = await cvState();
  check(`${tag} bored at a project: he stands up beside it`, !!pb && p1.pose === 'stand' && p1.weight > 0.5, `pose ${p1.pose}, weight ${p1.weight.toFixed(2)}`);
  await shot('42-bored-project');
  await page.keyboard.press('f');
  await waitFor(async () => { const c = await cvState(); return c.tourMode === 'free' && !c.bored; }, 30000);
  const fx = await cvState();
  check(`${tag} Free Explore is never bored`, fx.tourMode === 'free' && !fx.bored);

  // ---- Local Lab (#4): workstation, speech bubble, handoff, Cmd-Tab and back ----
  const lab = () => page.evaluate(() => {
    const { cv, app } = window.colsonCV, a = app.avatar;
    return {
      ...cv.state, pose: a.pose, sit: a.we[0], x: a.position.x, z: a.position.z, avatarSame: app.avatar === a,
      mushrooms: cv.mushrooms.length, elapsed: cv.boredom.elapsed, labPhase: cv.lab.phase,
      bubble: document.getElementById('speech').classList.contains('show') ? document.getElementById('speech').textContent : null,
      card: document.getElementById('card').textContent, status: document.getElementById('status').textContent,
    };
  });
  const phaseIs = (ph, ms) => waitFor(async () => (await lab()).labPhase === ph, ms);

  await page.keyboard.press('l'); // Jump to Local Lab, from Free Explore
  const toLab = await arriveAt(page, 'local-lab');
  check(`${tag} L jumps to the Local Lab from Free Explore, by walking`, toLab.arrived && toLab.walked && toLab.moving >= 4, `moved ${toLab.total.toFixed(1)} m`);
  const spoke = await phaseIs('speaking', 60000);
  const l1 = await lab();
  check(`${tag} he sits and says the line`, !!spoke && l1.pose === 'sit' && l1.sit > 0.9 && l1.bubble === 'I can’t open Metal shaders in here… they’re on my Mac.', `${l1.pose}, bubble: ${l1.bubble}`);
  const handed = await phaseIs('handoff', 60000);
  const l2 = await lab();
  check(`${tag} the LOCAL LAB / LIVE DEMO handoff says to switch to Finder`, !!handed && /Local Lab · Live demo/.test(l2.card) && /Switch to Finder/.test(l2.card), l2.card.slice(0, 80));
  check(`${tag} the handoff card offers the way back to the forest`, /Back to the forest/.test(l2.card));
  await sleep(1800);
  await shot('50-local-lab');

  // Cmd-Tab to Finder: the window blurs, the presenter is gone for a while, nothing moves
  await page.evaluate(() => { window.colsonCV.app.lastInteraction = performance.now() - 120000; window.dispatchEvent(new Event('blur')); });
  await sleep(10000);
  const aw = await lab();
  check(`${tag} away in Finder: the scene holds exactly`, aw.labPhase === 'away' && aw.pose === 'sit' && Math.hypot(aw.x - l2.x, aw.z - l2.z) < 0.05
    && aw.currentStop === 'local-lab' && aw.tourMode === 'guided' && aw.avatarSame && aw.mushrooms === l2.mushrooms, `phase ${aw.labPhase}, drift ${Math.hypot(aw.x - l2.x, aw.z - l2.z).toFixed(3)}`);
  check(`${tag} away in Finder: not bored, not sent home, no auto-advance`, !aw.bored && aw.elapsed === 0 && aw.currentStop === 'local-lab' && aw.avatarAtStop);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(800);
  const bk = await lab();
  check(`${tag} back from Finder: same scene, Q&A and Back to the forest on offer`, bk.labPhase === 'back' && /Welcome back/.test(bk.card) && /Back to the forest/.test(bk.card)
    && /Q&A/.test(bk.status) && Math.hypot(bk.x - l2.x, bk.z - l2.z) < 0.05 && bk.pose === 'sit' && !bk.bored, `${bk.labPhase} · ${bk.status}`);
  await sleep(1500);
  await shot('51-local-lab-back');

  // back to the forest, then revisit reliably (shortcut, previous/next, jump while already there)
  await page.click('#card .handoff button');
  await waitFor(async () => (await lab()).labPhase === 'idle', 30000);
  const fr = await lab();
  check(`${tag} Back to the forest hands the grove over (Free Explore)`, fr.tourMode === 'free' && fr.labPhase === 'idle' && !fr.bubble, `${fr.tourMode}, ${fr.labPhase}`);
  await page.keyboard.press('l');
  await arriveAt(page, 'local-lab');
  check(`${tag} the Local Lab can be revisited from Free Explore`, !!(await phaseIs('handoff', 90000)));
  await page.keyboard.press('l');
  await sleep(500);
  check(`${tag} Jump to Local Lab while already there replays the beat`, !!(await phaseIs('handoff', 90000)));
  await page.keyboard.press('b');
  await arriveAt(page, stops.at(-2));
  const off = await lab();
  check(`${tag} leaving the lab resets it and hides the line`, off.labPhase === 'idle' && !off.bubble && off.pose === 'stand', `${off.labPhase}, ${off.pose}`);
  await page.keyboard.press('n');
  await arriveAt(page, 'local-lab');
  check(`${tag} next stop back into the lab replays the beat`, !!(await phaseIs('handoff', 90000)));
  await page.keyboard.press('f');
  await sleep(1000);

  const draws = await page.evaluate(() => window.colsonCV.app.renderer.info.render.calls);
  check(`${tag} standalone: no requests leave the page's own origin`, outside.length === 0, outside.slice(0, 3).join(' '));
  check(`${tag} console clean`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  return { size: tag, drawCalls: draws, errors };
}

// ---- shared helpers for the extra pages ------------------------------------------------------------------
const waitUntil = async (fn, ms = 120000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { const v = await fn(); if (v) return v; await sleep(250); }
  return null;
};

async function openPage(base, [w, hgt], { init, setup, query = `?quality=low&timescale=${timescale}`, expectApp = true } = {}) {
  const browser = await chromium.launch({ executablePath: browserPath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: w, height: hgt } });
  const errors = [], bad = [], outside = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => bad.push(`failed ${r.url()}`));
  page.on('request', (r) => { if (!/^(data|blob|about):/.test(r.url()) && new URL(r.url()).origin !== new URL(base).origin) outside.push(r.url()); });
  if (init) await page.addInitScript(init);
  if (setup) await setup(page);
  await page.goto(base + query, { waitUntil: 'load' });
  if (expectApp) {
    await page.waitForFunction(() => window.colsonCV && document.getElementById('loader').classList.contains('done'), null, { timeout: 30000 });
    await sleep(3000);
  }
  return { browser, page, errors, bad, outside };
}

// ---- boredom at every section on the REAL 180 s clock, on a fresh page (nothing shortened) ---------------
async function boredomSweep(base, size) {
  const tag = `sweep ${size.join('x')}`;
  const { browser, page, errors } = await openPage(base, size);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = waitUntil;
  const cvState = () => page.evaluate(() => { const a = window.colsonCV.app.avatar; return { ...window.colsonCV.cv.state, pose: a.pose }; });
  const phaseIs = (ph, ms) => waitFor(async () => (await page.evaluate(() => window.colsonCV.cv.lab.phase)) === ph, ms);
  await page.keyboard.press('Enter');
  await arriveAt(page, 'cbu');
  const stepSim = (n, dt = 0.05) => page.evaluate(([k, d]) => { for (let i = 0; i < k; i++) window.colsonCV.app.step(d); }, [n, dt]);
  // Reset the clock once he is settled, then 179.95 s and 180.00 s of simulated time, in ONE uninterrupted call
  // (so the live render loop can't add frames in between); a mid-way restart would show up as lost time.
  const exact180 = () => page.evaluate(() => {
    const { cv, app } = window.colsonCV;
    for (let i = 0; i < 600 && !(cv.boredomTarget(app.avatar).settled && cv.boredom.elapsed > 1); i++) app.step(0.05);
    cv.boredom.reset();
    for (let i = 0; i < 3599; i++) app.step(0.05);
    const at = (k) => ({ s: cv.boredom.seconds, e: cv.boredom.elapsed, b: cv.boredom.bored, st: cv.state.bored, pose: app.avatar.pose, stop: cv.state.currentStop });
    const before = at();
    app.step(0.05);
    return { before, after: at() };
  });
  const clock = () => page.evaluate(() => { const { cv, app } = window.colsonCV; return { s: cv.boredom.seconds, e: cv.boredom.elapsed, b: cv.boredom.bored, st: cv.state.bored, pose: app.avatar.pose, stop: cv.state.currentStop }; });
  for (const [key, id] of [['1', 'cbu'], ['2', 'freelance'], ['3', 'vice'], ['4', 'apple'], ['5', 'experiments']]) {
    await page.keyboard.press(key);
    await arriveAt(page, id);
    await sleep(800);
    const { before, after } = await exact180(); // 179.95 s, then 180.00 s
    check(`${tag} ${id}: on the real 180 s clock, not bored at 179.95 s, bored at 180.00 s`,
      before.s === 180 && before.stop === id && !before.b && after.b && after.st && Math.abs(after.e - 180) < 0.01 && after.stop === id,
      `limit ${before.s} s · ${before.e.toFixed(2)} s → ${after.e.toFixed(2)} s · bored ${before.b} → ${after.b}`);
  }
  await page.keyboard.press('e'); // a project at the Experiments stop
  await waitFor(async () => (await cvState()).pose === 'kneel', 60000);
  await sleep(1200);
  const { before: pj0, after: pj1 } = await exact180();
  check(`${tag} project: on the real 180 s clock, not bored at 179.95 s, bored at 180.00 s (he stands up)`, !pj0.b && pj1.b && pj1.pose === 'stand', `${pj0.b} → ${pj1.b}, ${pj1.pose}`);
  await page.keyboard.press('l'); // the lab holds the clock: a long Q&A at the desk is never boredom
  await arriveAt(page, 'local-lab');
  await phaseIs('handoff', 90000);
  await page.evaluate(() => window.colsonCV.cv.boredom.reset());
  await stepSim(4800); // four minutes
  const lb = await clock();
  check(`${tag} local-lab: four minutes at the desk is never boredom`, !lb.b && !lb.st && lb.pose === 'sit' && lb.stop === 'local-lab', `bored ${lb.b}, ${lb.pose}`);
  await page.keyboard.press('f');
  await sleep(600);

  check(`${tag}: console clean`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- the staged smoke route: CBU → Freelance → VICE → Apple → Projects → Local Lab → Q&A ----------------
async function smoke(base, size) {
  const tag = `smoke ${size.join('x')}`;
  const { browser, page, errors, bad, outside } = await openPage(base, size);
  const shot = (n) => page.screenshot({ path: join(outDir, `smoke-${size[0]}x${size[1]}-${n}.png`) });
  const stops = ['cbu', 'freelance', 'vice', 'apple', 'experiments'];
  await page.keyboard.press('Enter');
  for (const [i, id] of stops.entries()) {
    if (i > 0) await page.keyboard.press('n');
    const r = await arriveAt(page, id);
    check(`${tag}: ${i + 1}. ${id}, reached by walking`, r.arrived && (i === 0 || r.walked), `${r.total.toFixed(1)} m`);
    await sleep(1500);
    await shot(`${i + 1}-${id}`);
  }
  // Projects: the list is on the Experiments card; E opens the first one and he kneels beside it
  const listed = await page.$$eval('#card .project-chip', (b) => b.length);
  check(`${tag}: 5. projects listed on the Experiments card`, listed === CV.projects.length, `${listed} of ${CV.projects.length}`);
  await page.keyboard.press('e');
  await waitUntil(() => page.evaluate(() => window.colsonCV.app.avatar.pose === 'kneel' && window.colsonCV.app.avatar.we[2] > 0.9), 90000);
  const first = CV.projects[0];
  const href = await page.$eval('#card a.btn.primary', (a) => a.href).catch(() => null);
  check(`${tag}: 5. first project card opens its verified demo`, href === first.demoLink, href ?? 'no link');
  await sleep(1200);
  await shot('5b-project');
  // back to the tour, then the last stop (stop 6): Local Lab
  await page.evaluate(() => window.colsonCV.cv.goToStop(4));
  await arriveAt(page, 'experiments');
  await page.keyboard.press('n');
  const lab = await arriveAt(page, 'local-lab');
  check(`${tag}: 6. local-lab, reached by walking`, lab.arrived && lab.walked, `${lab.total.toFixed(1)} m`);
  await waitUntil(() => page.evaluate(() => window.colsonCV.cv.lab.phase === 'handoff'), 90000);
  await sleep(1500);
  await shot('6-local-lab');
  const line = await page.$eval('#speech', (e) => e.textContent);
  check(`${tag}: 6. he says the line and the handoff asks for Finder`, /Metal shaders/.test(line) && /Switch to Finder/.test(await page.$eval('#card', (e) => e.textContent)));
  // Cmd-Tab to Finder and back → Q&A
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(4000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(1000);
  const qa = await page.evaluate(() => ({ phase: window.colsonCV.cv.lab.phase, status: document.getElementById('status').textContent, stop: window.colsonCV.cv.state.currentStop }));
  check(`${tag}: 7. back from Finder: Q&A at the Local Lab`, qa.phase === 'back' && /Q&A/.test(qa.status) && qa.stop === 'local-lab', JSON.stringify(qa));
  await shot('7-qa');
  check(`${tag}: console clean, no failed requests, nothing leaves the origin`, errors.length === 0 && bad.length === 0 && outside.length === 0, [...errors, ...bad, ...outside].slice(0, 3).join(' | '));
  await browser.close();
}

// ---- presenter controls, layout at every text size, touch targets, text version ---------------------------
async function controls(base, size) {
  const tag = `controls ${size.join('x')}`;
  const { browser, page, errors } = await openPage(base, size);
  const shot = (n) => page.screenshot({ path: join(outDir, `controls-${size[0]}x${size[1]}-${n}.png`) });
  await page.keyboard.press('5');
  await arriveAt(page, 'experiments');
  await sleep(1500);
  const vis = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.1 && r.width > 0; });
  // the card slides and fades: judge it only once the transition has settled
  const settled = (shown) => page.waitForFunction((on) => {
    const c = document.querySelector('#card'), cs = getComputedStyle(c);
    return on ? cs.transform === 'none' && Number(cs.opacity) === 1 : Number(cs.opacity) === 0;
  }, shown, { timeout: 20000 }).then(() => true, () => false);
  check(`${tag}: labels and card are on`, (await vis('#labels')) && (await vis('#card')));
  await page.keyboard.press('v');
  check(`${tag}: V hides the labels, V brings them back`, !(await vis('#labels')) && (await (async () => { await page.keyboard.press('v'); return vis('#labels'); })()));
  await page.keyboard.press('i');
  const hid = await settled(false);
  await page.keyboard.press('i');
  const back = await settled(true);
  check(`${tag}: I hides the card, I brings it back`, hid && back);

  // every text size: nothing runs off the screen, nothing scrolls sideways
  for (const [step, want] of [[0, 1], [1, 1.25], [1, 1.5], [1, 1.75]]) {
    if (step) await page.keyboard.press('=');
    await settled(true);
    const m = await page.evaluate(() => {
      const inside = (sel) => { const e = document.querySelector(sel); if (!e) return true; const r = e.getBoundingClientRect(); return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; };
      return {
        zoom: Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')),
        card: inside('#card'), dock: inside('#dock'), topbar: inside('.topbar > .brand') && inside('#status'),
        clear: (() => { const c = document.querySelector('#card').getBoundingClientRect(), d = document.querySelector('#dock').getBoundingClientRect(); return c.bottom <= d.top + 1; })(),
        scrollX: document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth,
      };
    });
    check(`${tag}: text size ${Math.round(want * 100)}%: card, dock and top bar stay on screen, the card clears the dock, no sideways scroll`,
      m.zoom === want && m.card && m.dock && m.topbar && m.clear && m.scrollX, JSON.stringify(m));
    await shot(`scale-${Math.round(want * 100)}`);
  }
  await page.keyboard.press('=');
  check(`${tag}: the text size stops at the largest step`, (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom').trim())) === '1.75');
  await page.keyboard.press('-');
  await sleep(300);
  // remembered across a reload
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.colsonCV && document.getElementById('loader').classList.contains('done'));
  const kept = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom').trim());
  check(`${tag}: the text size is remembered after a reload`, kept === '1.5', kept);
  for (let i = 0; i < 2; i++) await page.keyboard.press('-');
  await sleep(300);

  // touch targets and contrast of the interface text, at the default size, with the card showing
  await page.keyboard.press('5');
  await arriveAt(page, 'experiments');
  await sleep(1200);
  const small = await page.evaluate(() => [...document.querySelectorAll('#ui button, #ui a[href]')]
    .filter((e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.1 && !e.closest('#intro.hidden, #help:not(.show)'); })
    .map((e) => { const r = e.getBoundingClientRect(); return { t: (e.getAttribute('aria-label') || e.title || e.textContent).trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((x) => x.w < 24 || x.h < 24)); // WCAG 2.2 AA minimum target size is 24 × 24 px
  check(`${tag}: every visible button and link is at least 24 × 24 px`, small.length === 0, JSON.stringify(small.slice(0, 4)));
  const keys = await page.evaluate(() => [...document.querySelectorAll('#ui button, #ui a[href]')].every((e) => e.tabIndex >= 0 || e.disabled));
  check(`${tag}: every control is reachable by keyboard`, keys);

  // text version
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.colsonCV.cv.explore());
  await sleep(500);
  await page.evaluate(() => document.querySelector('[data-list]').click());
  const open = await page.$eval('#listView', (e) => e.textContent).catch(() => '');
  check(`${tag}: the text version lists every stop and project`, CV.stops.every((x) => open.includes(x.label)) && CV.projects.every((x) => open.includes(x.label)));
  await shot('text-version');
  await page.keyboard.press('Escape');
  check(`${tag}: Esc closes the text version`, (await page.$('#listView')) === null);
  check(`${tag}: console clean`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---- phone width, no WebGL, and the GitHub Pages sub-path -------------------------------------------------------
async function phone(base) {
  const { browser, page, errors } = await openPage(base, [390, 844]);
  await page.screenshot({ path: join(outDir, 'phone-intro.png') });
  const m = await page.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    const btn = r('[data-begin]');
    return { scrollX: document.documentElement.scrollWidth <= innerWidth, begin: btn.l >= 0 && btn.r <= innerWidth && btn.b <= innerHeight };
  });
  check('phone 390×844: the start screen fits, with Begin on screen and no sideways scroll', m.scrollX && m.begin, JSON.stringify(m));
  await page.keyboard.press('Enter');
  await sleep(4000);
  const g = await page.evaluate(() => {
    const inside = (sel) => { const e = document.querySelector(sel); const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; };
    return { card: inside('#card'), dock: inside('#dock'), scrollX: document.documentElement.scrollWidth <= innerWidth };
  });
  check('phone 390×844: card and dock stay on screen on the first stop', g.card && g.dock && g.scrollX, JSON.stringify(g));
  await page.screenshot({ path: join(outDir, 'phone-stop.png') });
  check('phone 390×844: console clean', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

async function noWebgl(base) {
  const init = () => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/i.test(t) ? null : g.call(this, t, ...a); }; };
  const { browser, page, errors, outside } = await openPage(base, [1440, 900], { init, query: '', expectApp: false });
  await sleep(1500);
  const info = await page.evaluate(() => ({ fb: document.getElementById('loader').className, text: document.getElementById('loader').textContent, hrefs: [...document.querySelectorAll('#loader a')].map((a) => a.href) }));
  await page.screenshot({ path: join(outDir, 'no-webgl.png') });
  check('no WebGL: the CV shows as a plain list', info.fb === 'fallback' && CV.stops.every((s) => info.text.includes(s.label)) && CV.projects.every((p) => info.text.includes(p.label)));
  const want = [...CV.stops.flatMap((s) => s.links.map((l) => l.href)), ...CV.projects.flatMap((p) => [p.availability === 'web' ? p.demoLink : null, p.repoLink])].filter(Boolean).sort();
  check('no WebGL: its links are exactly the verified demos and repos', JSON.stringify([...info.hrefs].sort()) === JSON.stringify(want), `${info.hrefs.length} of ${want.length}`);
  check('no WebGL: no errors and no outside requests', errors.length === 0 && outside.length === 0, [...errors, ...outside].join(' | '));
  await browser.close();
}

async function subpath() {
  // GitHub Pages serves a project site from /<repo>/: prove the build works from a sub-path, not just from the root
  const root = resolve(ROOT, 'dist'), prefix = '/Colson.CV/';
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!p.startsWith(prefix)) { res.writeHead(404); res.end('not found'); return; }
    p = p.slice(prefix.length) || 'index.html';
    if (p.endsWith('/')) p += 'index.html';
    const f = normalize(join(root, p));
    if (!f.startsWith(root + sep) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
    createReadStream(f).pipe(res);
  });
  await new Promise((ok) => srv.listen(port + 7, '127.0.0.1', ok));
  try {
    const base = `http://127.0.0.1:${port + 7}${prefix}`;
    const { browser, page, errors, bad } = await openPage(base, [1280, 800], { query: `?quality=low&timescale=${timescale}` });
    const ok = await page.evaluate(() => !!window.colsonCV && window.colsonCV.app.mode?.id === 'cv');
    check('GitHub Pages sub-path (/Colson.CV/): loads with relative paths, no failed requests, no errors', ok && bad.length === 0 && errors.length === 0, [...bad, ...errors].slice(0, 3).join(' | '));
    await browser.close();
  } finally { srv.close(); }
}

async function unbuilt() {
  // GitHub Pages set to "Deploy from a branch" serves the repo files as they are, not the Vite build. Prove that
  // still boots: serve the repo root unbuilt, with three.js coming from its CDN (answered here from node_modules).
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = normalize(join(ROOT, p.endsWith('/') ? p + 'index.html' : p));
    if (!f.startsWith(ROOT + sep) || f.includes(`${sep}node_modules${sep}`) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
    createReadStream(f).pipe(res);
  });
  await new Promise((ok) => srv.listen(port + 9, '127.0.0.1', ok));
  try {
    const cdn = [];
    const setup = (page) => page.route('https://cdn.jsdelivr.net/npm/three@0.180.0/**', (route) => {
      const rel = new URL(route.request().url()).pathname.replace('/npm/three@0.180.0/', '');
      const f = join(ROOT, 'node_modules/three', rel);
      cdn.push(rel);
      if (existsSync(f)) route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(f) }); else route.fulfill({ status: 404, body: '' });
    });
    const { browser, page, errors, bad } = await openPage(`http://127.0.0.1:${port + 9}/`, [1280, 800], { setup, expectApp: false });
    const booted = await page.waitForFunction(() => window.colsonCV && document.getElementById('loader').classList.contains('done'), null, { timeout: 20000 }).then(() => true, () => false);
    const ok = booted && (await page.evaluate(() => window.colsonCV.app.mode?.id === 'cv'));
    const shown = booted ? '' : await page.evaluate(() => document.getElementById('loader').textContent.trim().slice(0, 120));
    await page.screenshot({ path: join(outDir, 'unbuilt-source.png') });
    check('unbuilt source (Pages "Deploy from a branch") boots, with three.js from the CDN import map', ok && errors.length === 0 && bad.length === 0 && cdn.length > 0,
      shown || [...errors, ...bad].slice(0, 3).join(' | ') || `${cdn.length} three.js files via the import map`);
    await browser.close();
  } finally { srv.close(); }
}

const server = await serve();
const runs = [];
try {
  if (only === 'all' || only === 'full') for (const s of sizes) runs.push(await run(server.base, s));
  if (only === 'all' || only === 'smoke') for (const s of sizes) await smoke(server.base, s);
  if (only === 'all' || only === 'full') for (const s of sizes) await boredomSweep(server.base, s);
  if (only === 'all' || only === 'full') for (const s of sizes) await controls(server.base, s);
  if (only === 'all' || only === 'extras') {
    await phone(server.base);
    await noWebgl(server.base);
    if (!opt('url', null)) await subpath();
    if (!opt('url', null)) await unbuilt();
  }
} finally {
  server.stop();
}
const failed = results.filter((r) => !r.ok);
writeFileSync(join(outDir, opt('report', 'report.json')), JSON.stringify({ when: new Date().toISOString(), runs, results }, null, 2));
log(`${results.length - failed.length}/${results.length} checks passed; screenshots in ${outDir}`);
process.exit(failed.length ? 1 : 0);
