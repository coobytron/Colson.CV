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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const port = Number(opt('port', 4177));
const outDir = resolve(ROOT, opt('out', '.shots'));
const timescale = Number(opt('timescale', 6));
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

  const draws = await page.evaluate(() => window.colsonCV.app.renderer.info.render.calls);
  check(`${tag} console clean`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  return { size: tag, drawCalls: draws, errors };
}

const server = await serve();
const runs = [];
try {
  for (const s of sizes) runs.push(await run(server.base, s));
} finally {
  server.stop();
}
const failed = results.filter((r) => !r.ok);
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ when: new Date().toISOString(), runs, results }, null, 2));
log(`${results.length - failed.length}/${results.length} checks passed; screenshots in ${outDir}`);
process.exit(failed.length ? 1 : 0);
