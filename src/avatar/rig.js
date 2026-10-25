import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The Gardener's rig: the low-poly figure from mycelia-splash (buildHero), rebuilt as a joint
 * hierarchy so it can sit, stand, walk and kneel. Faces +Z, feet on y = 0, ~1.45 tall standing.
 *
 *   root → hips → spine (torso) → neck → head (hair, glasses, braids → braid tips)
 *                     spine → upperArm → forearm (L/R)
 *          hips → thigh → shin + foot (L/R)
 *   root → laptop (base) → lid (screen) · screen light
 *
 * Static parts are merged per joint (one mesh each, material groups where needed): 15 meshes.
 */

export const S = 0.55; // splash hero units → world units (the splash hero is chunkier and sits at 2×)
export const HIP_Y = 0.8; // standing hip height
export const THIGH = 0.385;
export const SHIN = 0.36;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

function place(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  geo.applyMatrix4(_m);
  return geo.index ? geo.toNonIndexed() : geo;
}
const box = (w, h, d, ...t) => place(new THREE.BoxGeometry(w, h, d), ...t);
const ico = (r, ...t) => place(new THREE.IcosahedronGeometry(r, 0), ...t);

/** One mesh from [geometry, material] pairs: merged per material, material groups between. */
function part(name, pairs, parent) {
  const byMat = new Map();
  for (const [g, m] of pairs) {
    if (!byMat.has(m)) byMat.set(m, []);
    byMat.get(m).push(g);
  }
  const mats = [...byMat.keys()];
  const merged = mats.map((m) => {
    const list = byMat.get(m);
    const g = list.length === 1 ? list[0] : mergeGeometries(list);
    if (list.length > 1) list.forEach((x) => x.dispose());
    return g;
  });
  const geo = merged.length === 1 ? merged[0] : mergeGeometries(merged, true);
  if (merged.length > 1) merged.forEach((x) => x.dispose());
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, mats.length === 1 ? mats[0] : mats);
  mesh.name = name;
  mesh.castShadow = true;
  // Always drawn: keeps every program compiled from the first frame (no hitches when it walks into view).
  mesh.frustumCulled = false;
  parent.add(mesh);
  return mesh;
}

function joint(name, parent, x = 0, y = 0, z = 0, order = 'XYZ') {
  const j = new THREE.Group();
  j.name = name;
  j.position.set(x, y, z);
  j.rotation.order = order;
  parent.add(j);
  return j;
}

export function buildGardener() {
  // materials — straight from the splash
  const skin = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.72, metalness: 0,
    emissive: 0x1c3038, emissiveIntensity: 0.4, flatShading: true });
  const body = new THREE.MeshStandardMaterial({ color: 0x141a22, roughness: 0.85, metalness: 0,
    emissive: 0x0a1016, emissiveIntensity: 0.2, flatShading: true });
  const hair = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.9, metalness: 0,
    emissive: 0x0b0806, emissiveIntensity: 0.3, flatShading: true });
  const frame = new THREE.MeshStandardMaterial({ color: 0x0a0d10, roughness: 0.35, metalness: 0.6,
    emissive: 0x1b2b34, emissiveIntensity: 0.6, flatShading: true });
  const lens = new THREE.MeshStandardMaterial({ color: 0x0a1418, emissive: 0x7fc8ff,
    emissiveIntensity: 1.2, transparent: true, opacity: 0.4, roughness: 0.1, metalness: 0 });
  const tie = new THREE.MeshStandardMaterial({ color: 0x6a2f4a, roughness: 0.8,
    emissive: 0x1a060f, emissiveIntensity: 0.3, flatShading: true });
  const alu = new THREE.MeshStandardMaterial({ color: 0x0c1013, roughness: 0.4, metalness: 0.5, flatShading: true });
  const screen = new THREE.MeshStandardMaterial({ color: 0x0a0f14, emissive: 0x9fdcff,
    emissiveIntensity: 2.2, roughness: 0.3, metalness: 0 });

  const root = new THREE.Group();
  root.name = 'gardener';
  const J = {};

  // ---- body ----
  J.hips = joint('hips', root, 0, HIP_Y, 0);
  J.spine = joint('spine', J.hips, 0, 0.02, 0);
  part('torso', [
    [box(0.25, 0.13, 0.16, 0, 0.0, -0.005), body], // pelvis
    [box(0.242, 0.33, 0.165, 0, 0.2, 0), body], // torso
    [box(0.275, 0.083, 0.125, 0, 0.335, 0.005), body], // shoulders
    [box(0.072, 0.08, 0.066, 0, 0.395, 0.012), skin], // neck
  ], J.spine);
  J.neck = joint('neck', J.spine, 0, 0.405, 0.012);
  J.head = joint('head', J.neck, 0, 0.035, 0);
  // head group from the splash, scaled: head, hair crown, hair down the back, glasses
  const T = (g) => place(g, 0, 0, 0, 0, 0, 0, S, S, S);
  part('head', [
    [T(ico(0.2, 0, 0.08, 0.02)), skin],
    [T(ico(0.225, 0, 0.12, -0.03, 0, 0, 0, 1.05, 1.0, 1.12)), hair],
    [T(box(0.38, 0.3, 0.24, 0, -0.05, -0.12)), hair],
    [T(place(new THREE.TorusGeometry(0.058, 0.02, 5, 12), -0.08, 0.03, 0.185)), frame],
    [T(place(new THREE.TorusGeometry(0.058, 0.02, 5, 12), 0.08, 0.03, 0.185)), frame],
    [T(box(0.06, 0.016, 0.016, 0, 0.04, 0.19)), frame],
    [T(place(new THREE.CircleGeometry(0.05, 12), -0.08, 0.03, 0.182)), lens],
    [T(place(new THREE.CircleGeometry(0.05, 12), 0.08, 0.03, 0.182)), lens],
  ], J.head);

  // two plaited braids hanging down the front, each a two-link chain
  J.braids = [-1, 1].map((s) => {
    const a = joint(`braid${s < 0 ? 'R' : 'L'}`, J.head, s * 0.1, -0.035, 0.075);
    const seg = (k, y) => [T(ico(0.06 - k * 0.007, 0, y, 0, 0, 0, 0, 1, 1.75, 1)), hair];
    part('braid', [seg(0, 0), seg(1, -0.17)], a);
    const b = joint('braidTip', a, 0, -0.34 * S, 0);
    part('braidTip', [
      seg(2, 0), seg(3, -0.17),
      [T(place(new THREE.CylinderGeometry(0.036, 0.036, 0.045, 6), 0, -0.36, 0)), tie],
      [T(ico(0.03, 0, -0.43, 0)), hair],
    ], b);
    return [a, b];
  });

  // arms: short dark sleeve, bare forearm and hand
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const up = J[`upperArm${side}`] = joint(`upperArm${side}`, J.spine, s * 0.152, 0.345, 0.005);
    part(`upperArm${side}`, [
      [box(0.078, 0.14, 0.082, 0, -0.05, 0), body],
      [box(0.066, 0.13, 0.07, 0, -0.18, 0), skin],
    ], up);
    const fo = J[`forearm${side}`] = joint(`forearm${side}`, up, 0, -0.245, 0);
    part(`forearm${side}`, [
      [box(0.062, 0.2, 0.066, 0, -0.1, 0), skin],
      [box(0.052, 0.075, 0.034, 0, -0.235, 0.004), skin],
    ], fo);
  }

  // legs: trousers + dark shoes. Thighs use YZX so a -π/2 pitch and ±π/2 roll give a
  // horizontal knee hinge (the crossed-legs fold).
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const th = J[`thigh${side}`] = joint(`thigh${side}`, J.hips, s * 0.074, -0.02, 0, 'YZX');
    part(`thigh${side}`, [[box(0.115, THIGH + 0.02, 0.125, 0, -THIGH / 2, 0), body]], th);
    const sh = J[`shin${side}`] = joint(`shin${side}`, th, 0, -THIGH, 0);
    part(`shin${side}`, [
      [box(0.095, SHIN, 0.105, 0, -SHIN / 2 + 0.01, 0), body],
      [box(0.09, 0.06, 0.19, 0, -SHIN - 0.005, 0.04), alu],
    ], sh);
  }

  // ---- laptop: base + lid hinged on the far (+Z) edge, screen on the lid's underside ----
  const LW = 0.28, LD = 0.2;
  J.laptop = joint('laptop', root, 0, 0.21, 0.26);
  part('laptop', [[box(LW, 0.018, LD, 0, 0, 0), alu]], J.laptop);
  J.lid = joint('lid', J.laptop, 0, 0.011, LD / 2);
  part('lid', [
    [box(LW, 0.01, LD, 0, 0.006, -LD / 2), alu],
    [box(LW - 0.02, 0.004, LD - 0.024, 0, 0.0, -LD / 2 - 0.002), screen],
  ], J.lid);

  // the money shot: soft cool light from the screen onto the face. Permanent; only intensity changes.
  const glow = new THREE.PointLight(0xa9d8ff, 1.5, 1.9, 2.2);
  glow.name = 'screenGlow';
  glow.position.set(0, 0.15, 0.07);
  J.laptop.add(glow);
  // where the screen's centre is, in lid space (for moths / glow queries)
  const screenAnchor = new THREE.Object3D();
  screenAnchor.position.set(0, -0.01, -LD / 2);
  J.lid.add(screenAnchor);

  return { root, joints: J, screenMat: screen, glow, screenAnchor, materials: { skin, body, hair, frame, lens, tie, alu, screen } };
}
