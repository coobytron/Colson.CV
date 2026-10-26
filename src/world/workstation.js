import * as THREE from 'three';
import { heightAt } from './terrain.js';

/**
 * The Local Lab workstation: a rug, a low desk and a monitor, set in the grove next to the Local Lab
 * marker. The Gardener sits cross-legged on the rug facing the desk. The monitor is just a glowing panel:
 * it says the Metal shaders run on Colson's Mac. Nothing here pretends to run them in the browser.
 *
 * Everything is placed from one sit spot S and a facing direction f (unit, ground plane), so the
 * layout, the Gardener's pose and the camera framing in LocalLab.js all share the same numbers.
 */

export const DESK_OFFSET = 1.25; // sit spot → desk centre, along the facing direction
export const DESK_R = 0.5; // the desk's footprint for steering (kept clear of the sitting footprint)

function screenTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 300;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, 300);
  bg.addColorStop(0, '#071a1f'); bg.addColorStop(1, '#0c3a40');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 300);
  g.strokeStyle = 'rgba(120, 255, 240, 0.35)'; g.lineWidth = 3; g.strokeRect(10, 10, 492, 280);
  g.textAlign = 'center';
  g.fillStyle = '#7ff7ea'; g.font = '600 24px ui-monospace, Menlo, monospace';
  g.fillText('L O C A L   L A B', 256, 64);
  g.fillStyle = '#eafffb'; g.font = '700 58px -apple-system, "Helvetica Neue", Arial, sans-serif';
  g.fillText('Metal shaders', 256, 160);
  g.fillStyle = 'rgba(190, 255, 246, 0.75)'; g.font = '500 26px -apple-system, "Helvetica Neue", Arial, sans-serif';
  g.fillText('runs on Colson’s Mac', 256, 218);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(120,255,235,0.8)'); r.addColorStop(0.45, 'rgba(60,200,190,0.3)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * @param {{x:number,z:number}} sit  where the Gardener sits
 * @param {{x:number,z:number}} f    unit vector from the sit spot toward the desk
 * @param {number} turn              how far (rad) the monitor is turned toward the camera side
 */
export function createWorkstation(sit, f, turn = 0) {
  const group = new THREE.Group();
  group.name = 'local-lab-workstation';
  const desk = { x: sit.x + f.x * DESK_OFFSET, z: sit.z + f.z * DESK_OFFSET };
  const yaw = Math.atan2(-f.x, -f.z); // the desk's local +z faces the Gardener

  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.88, metalness: 0, emissive: 0x120a05, emissiveIntensity: 0.5, flatShading: true });
  const metal = new THREE.MeshStandardMaterial({ color: 0x1a2024, roughness: 0.4, metalness: 0.6, emissive: 0x0c1418, emissiveIntensity: 0.6, flatShading: true });
  const rug = new THREE.MeshStandardMaterial({ color: 0x1c2b27, roughness: 1, metalness: 0, emissive: 0x0a1613, emissiveIntensity: 0.6 });
  const rim = new THREE.MeshStandardMaterial({ color: 0x35e0d8, roughness: 0.6, emissive: 0x35e0d8, emissiveIntensity: 0.9 });
  const screen = new THREE.MeshBasicMaterial({ map: screenTexture(), toneMapped: false });
  screen.color.setScalar(1.6); // bright enough to catch the bloom, still readable
  const glow = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });

  // rug under the Gardener and the desk
  const m = { x: sit.x + f.x * 0.6, z: sit.z + f.z * 0.6 };
  const rugMesh = new THREE.Mesh(new THREE.CircleGeometry(1.75, 40), rug);
  rugMesh.rotation.x = -Math.PI / 2;
  rugMesh.position.set(m.x, heightAt(m.x, m.z) + 0.02, m.z);
  rugMesh.receiveShadow = true;
  const rimMesh = new THREE.Mesh(new THREE.RingGeometry(1.7, 1.76, 56), rim);
  rimMesh.rotation.x = -Math.PI / 2;
  rimMesh.position.set(m.x, heightAt(m.x, m.z) + 0.025, m.z);
  group.add(rugMesh, rimMesh);

  // the desk, in its own frame (local +z faces the Gardener)
  const d = new THREE.Group();
  d.position.set(desk.x, heightAt(desk.x, desk.z) + 0.02, desk.z);
  d.rotation.y = yaw;
  const box = (w, h, dp, x, y, z, mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, dp), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    d.add(mesh);
    return mesh;
  };
  box(1.5, 0.07, 0.7, 0, 0.4, 0, wood); // top
  for (const lx of [-0.68, 0.68]) for (const lz of [-0.28, 0.28]) box(0.07, 0.4, 0.07, lx, 0.2, lz, wood);
  box(0.34, 0.025, 0.22, 0, 0.4475, 0, metal); // monitor foot
  box(0.06, 0.26, 0.04, 0, 0.58, 0, metal); // neck
  // monitor head, turned a little toward the camera side so the room can read the screen
  const head = new THREE.Group();
  head.position.set(0, 0.92, 0);
  head.rotation.y = turn;
  d.add(head);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.54, 0.04), metal);
  bezel.castShadow = true;
  head.add(bezel);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.468), screen);
  face.position.z = 0.0215;
  head.add(face);
  // a halo around the monitor, as if the screen were lighting the air in front of it
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.5), glow);
  halo.position.z = 0.03;
  head.add(halo);
  group.add(d);

  // soft light pooled on the rug in front of the screen (a sprite: no extra light, no shader recompiles)
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), glow);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(m.x, heightAt(m.x, m.z) + 0.035, m.z);
  group.add(pool);

  return { group, desk, yaw, screenWorld: () => head.getWorldPosition(new THREE.Vector3()) };
}
