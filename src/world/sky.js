import * as THREE from 'three';

export function createSky() {
  const uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uBottom: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uStars: { value: 1 },
    uFlash: { value: 0 },
    uTime: { value: 0 },
    uCloud: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHorizon, uBottom, uSunColor, uSunDir;
      uniform float uStars, uFlash, uTime, uCloud;
      varying vec3 vDir;
      float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float n3(vec3 x) {
        vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 col = y > 0.0 ? mix(uHorizon, uTop, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(uHorizon, uBottom, pow(clamp(-y * 3.0, 0.0, 1.0), 0.5));
        // sun / moon glow
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 18.0) * 0.35 + pow(sd, 3.0) * 0.08);
        // stars
        vec3 sp = d * 220.0;
        vec3 cell = floor(sp);
        float s = h3(cell);
        float star = step(0.9975, s) * (1.0 - smoothstep(0.0, 0.55, length(fract(sp) - 0.5)));
        float tw = 0.6 + 0.4 * sin(uTime * (1.0 + s * 4.0) + s * 40.0);
        col += vec3(0.8, 0.9, 1.0) * star * tw * uStars * smoothstep(0.0, 0.25, y) * 2.5;
        // drifting cloud veil
        float cl = n3(vec3(d.xz / max(y, 0.08) * 1.4 + uTime * 0.01, uTime * 0.02)) * 0.6 + n3(vec3(d.xz / max(y, 0.08) * 3.3, 1.0)) * 0.4;
        col = mix(col, uHorizon * 0.9, smoothstep(0.45, 0.9, cl) * uCloud * smoothstep(0.0, 0.35, y));
        col += vec3(0.7, 0.8, 1.0) * uFlash * (0.6 + 0.4 * cl);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, uniforms };
}
