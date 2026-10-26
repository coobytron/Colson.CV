// Career story (#15): skills per chapter, garden profiles that grow from one small mushroom at CBU to the
// Experiments garden, and garden layouts that are deterministic and leave every path and project clear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import CV from '../src/data/cv.js';
import { growGarden, keepClear, placeStand, segmentDistance, footprint } from '../src/world/garden.js';

const stops = [...CV.stops].sort((a, b) => a.presentationOrder - b.presentationOrder);
const byId = Object.fromEntries(stops.map((s) => [s.id, s]));
const career = ['cbu', 'freelance', 'vice', 'apple', 'experiments'];

test('the walk order is CBU, Freelance, VICE, Apple, Experiments, Local Lab', () => {
  assert.deepEqual(stops.map((s) => s.id), [...career, 'local-lab']);
});

test('each card shows exactly the skills that chapter added', () => {
  assert.deepEqual(byId.cbu.skills, ['Design foundations', 'Typography and composition', 'Visual thinking', 'Interest in code']);
  assert.deepEqual(byId.freelance.skills, ['Production skills', 'Design skills', 'Experimentation']);
  assert.deepEqual(byId.vice.skills, ['Art direction', 'Experiential design', 'Directing', 'Animation']);
  assert.deepEqual(byId.apple.skills, ['Creative direction', 'Presentation design', 'Relationships', 'Organizational navigation']);
  assert.deepEqual(byId.experiments.skills, ['Creative coding', 'Generative systems', 'Prototyping', 'Interactive design', 'Self-directed tool building']);
  assert.deepEqual(byId['local-lab'].skills, []);
  // what each stage added, not a running total
  const all = career.flatMap((id) => byId[id].skills);
  assert.equal(new Set(all).size, all.length);
});

test('the dates are the real, overlapping periods', () => {
  assert.deepEqual(stops.map((s) => s.dates), ['2009 – 2011', '2012 – 2014', 'Jan 2014 – Apr 2016', 'Apr 2016 – present', 'Ongoing', 'Live']);
});

test('the gardens grow with the career: CBU is one small mushroom, Experiments is the largest', () => {
  const g = (id) => byId[id].garden;
  assert.equal(g('cbu').count, 0, 'CBU is a single mushroom');
  assert.ok(g('cbu').marker < 1, 'and a small one');
  for (let i = 1; i < career.length; i++) {
    const a = g(career[i - 1]), b = g(career[i]);
    assert.ok(b.count > a.count, `${career[i]} has more mushrooms than ${career[i - 1]}`);
    assert.ok(b.marker > a.marker, `${career[i]}'s marker is bigger`);
    assert.ok(b.glow >= a.glow && b.mycelium >= a.mycelium, `${career[i]} glows and branches at least as much`);
  }
  assert.ok(g('vice').tall > g('freelance').tall && g('vice').tall > g('apple').tall, 'VICE stretches tallest');
  assert.ok(g('apple').variety < g('vice').variety && g('apple').rows, 'Apple is ordered and refined');
  assert.ok(g('experiments').strains.length >= 7, 'Experiments mixes every strain');
  assert.ok(g('experiments').count >= 2 * g('apple').count, 'Experiments is unmistakably the largest');
});

// the same calls CVMode makes
function world() {
  for (const s of stops) placeStand(s);
  const c = CV.projectClearing;
  const home = { x: 1.4, z: 3.2 };
  const keep = keepClear(stops, c, { home, wideStand: 'local-lab' });
  const gardens = Object.fromEntries(stops.map((s) => [s.id, growGarden(s, c, keep)]));
  return { keep, gardens, c, home };
}

test('every garden grows its full count, deterministically', () => {
  const a = world().gardens, b = world().gardens;
  assert.deepEqual(a, b);
  for (const s of stops) assert.equal(a[s.id].length, s.garden.count, `${s.id}: ${a[s.id].length} of ${s.garden.count}`);
  const strains = new Set(a.experiments.map((p) => p.strain));
  assert.equal(strains.size, byId.experiments.garden.strains.length);
});

test('no garden mushroom blocks a stand point, the walk between stops, the clearing or a project', () => {
  const { gardens, c, home } = world();
  const plants = Object.values(gardens).flat();
  for (const p of plants) {
    const r = footprint(p.scale);
    for (const s of stops) assert.ok(Math.hypot(p.x - s.stand.x, p.z - s.stand.z) > r + 1.2, `clear of the ${s.id} stand`);
    for (let i = 1; i < stops.length; i++) for (let j = 0; j < i; j++) assert.ok(segmentDistance(p.x, p.z, stops[j].stand, stops[i].stand) > r + 0.85, `clear of the walk ${stops[j].id} → ${stops[i].id}`);
    for (const s of stops) assert.ok(segmentDistance(p.x, p.z, c, s.stand) > r + 0.85, `clear of the walk from the project clearing to ${s.id}`);
    assert.ok(segmentDistance(p.x, p.z, home, stops[0].stand) > r + 0.75, 'clear of the first walk');
    assert.ok(Math.hypot(p.x - c.x, p.z - c.z) > c.r + 0.8 + r, 'outside the project clearing');
  }
  // the project ring itself: no garden mushroom closer than 1 m to any spot on it
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2;
    const q = { x: c.x + Math.cos(a) * c.r, z: c.z + Math.sin(a) * c.r };
    for (const p of plants) assert.ok(Math.hypot(p.x - q.x, p.z - q.z) > footprint(p.scale) + 0.75);
  }
});
