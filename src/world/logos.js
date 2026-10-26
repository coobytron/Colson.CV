import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { clamp, damp } from '../lib/math.js';

// Company logos as glowing marks floating over their chapter's garden. The textures are glow masks made from
// the logos Colson supplied (originals kept in docs/logos/): R = the part that glows (VICE's white letters,
// the whole Apple mark), G = the logo's silhouette (VICE's black keyline shows as a faint rim), B = a soft halo.
// Drawn additively with no depth write, so they can't z-fight or sort-flicker against the caps behind them.
export const LOGOS = {
  vice: { url: new URL('../assets/logos/vice.png', import.meta.url).href, width: 1.9 },
  apple: { url: new URL('../assets/logos/apple.png', import.meta.url).href, width: 0.95 },
};

const LIFT = 0.22; // gap (metres) between the marker's cap and the bottom of its logo
const BACK = 0.35; // metres behind the marker, away from where the Gardener stands

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const fragmentShader = /* glsl */ `
  uniform sampler2D uMap; uniform vec3 uColor; uniform float uAlpha, uPulse;
  varying vec2 vUv;
  void main() {
    vec3 m = texture2D(uMap, vUv).rgb;
    float rim = max(m.g - m.r, 0.0);
    // kept under the bloom threshold's blow-out point, so the letterforms stay crisp rather than a white smear
    vec3 core = mix(uColor, vec3(1.0), 0.35) * m.r * (0.78 + 0.1 * uPulse);
    vec3 col = core + uColor * (rim * 0.1 + m.b * 0.2);
    gl_FragColor = vec4(col * uAlpha, 1.0);
  }`;

/** One floating logo over a chapter's garden. update() bobs it, turns it to the camera and fades it. */
export class FloatingLogo {
  constructor(stop, def, loader) {
    this.stop = stop;
    const s = stop;
    this.uniforms = { uMap: { value: null }, uColor: { value: new THREE.Color(stop.color) }, uAlpha: { value: 0 }, uPulse: { value: 0 } };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader, fragmentShader,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    this.alpha = 0;
    this.ready = false;
    this.width = def.width;
    loader.load(def.url, (tex) => {
      tex.colorSpace = THREE.NoColorSpace; // a mask, not a colour image
      tex.anisotropy = 4;
      this.uniforms.uMap.value = tex;
      this.mesh.scale.set(def.width, def.width * (tex.image.height / tex.image.width), 1);
      // hang it just over the marker's cap, where the chapter's name label would be (CVMode hides that label
      // while the logo is lit); the texture's padding is ~14% of its width on each side
      this.base.y = this.ground + s.marker.height + LIFT + this.mesh.scale.y * 0.5 - def.width * 0.1;
      this.ready = true;
    });
    this.base = new THREE.Vector3(s.x - s.dir.x * BACK, 0, s.z - s.dir.z * BACK);
    this.ground = heightAt(s.x, s.z);
    this.base.y = this.ground + s.marker.height + LIFT;
    this.phase = (s.index * 1.7) % (Math.PI * 2);
  }

  /** Screen rectangle (CSS px) the logo covers, for the date labels to step around; null when hidden. */
  screenRect(app) {
    if (!this.mesh.visible || this.alpha < 0.1) return null;
    const p = app.toScreen(this.mesh.position);
    if (!p) return null;
    const d = app.camera.position.distanceTo(this.mesh.position);
    const px = innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(app.camera.fov) / 2) * d);
    const w = this.mesh.scale.x * px, h = this.mesh.scale.y * px;
    return { x: p.x - w / 2, y: p.y - h / 2, w, h };
  }

  update(dt, time, camera, want, calm) {
    this.alpha = damp(this.alpha, this.ready ? want : 0, 3, dt);
    this.uniforms.uAlpha.value = clamp(this.alpha);
    this.mesh.visible = this.alpha > 0.01;
    if (!this.mesh.visible) return;
    const t = time + this.phase;
    const bob = calm ? 0 : Math.sin(t * 0.8) * 0.07;
    this.mesh.position.set(this.base.x, this.base.y + bob, this.base.z);
    // turn to face the camera about the vertical only, with a slow sway, so it reads as hanging in the air
    const yaw = Math.atan2(camera.position.x - this.base.x, camera.position.z - this.base.z);
    this.mesh.rotation.set(0, yaw + (calm ? 0 : Math.sin(t * 0.45) * 0.12), 0);
    this.uniforms.uPulse.value = calm ? 0 : Math.sin(t * 1.3);
  }
}

/** Builds the logos for every stop that names one (`logo` in src/data/cv.js). */
export function createLogos(stops, group) {
  const loader = new THREE.TextureLoader();
  const out = [];
  for (const s of stops) {
    const def = s.logo && LOGOS[s.logo];
    if (!def) continue;
    const logo = new FloatingLogo(s, def, loader);
    group.add(logo.mesh);
    s.logoMark = logo;
    out.push(logo);
  }
  return out;
}
