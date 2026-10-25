import * as THREE from 'three';

// Deformation shared by the colour pass and the shadow-depth pass so shadows bend too.
const DEFORM = /* glsl */ `
  vec3 transformed = vec3(position);
  float part = aPart;
  bool isCap = part > 0.5 && part < 2.5;
  float grow = uGrow;
  if (isCap) {
    vec3 local = transformed - uStemTop;
    float rr = length(local.xz);
    local.xz *= mix(0.5, 1.0, uOpen);
    local.y -= (1.0 - uOpen) * rr * rr * 1.1;      // closed caps hang like bells
    local.y -= uWilt * rr * rr * 0.7;               // wilting caps droop
    local *= mix(0.32, 1.0, grow);
    transformed = vec3(uStemTop.x, uStemTop.y * grow, uStemTop.z) + local;
  } else {
    transformed.y *= grow;
  }
  float hh = clamp(aH, 0.0, 1.0);
  float stemLen = uStemTop.y * grow;
  vec2 bend = uBend;
  transformed.xz += bend * hh * hh * stemLen;
  transformed.y -= 0.5 * dot(bend, bend) * hh * stemLen;
  if (isCap) transformed.xz += bend * (transformed.y - stemLen) * 0.9;
`;

const DEFORM_UNIFORMS = /* glsl */ `
  attribute float aPart; attribute float aH; attribute float aGlow;
  uniform vec3 uStemTop; uniform vec2 uBend; uniform float uGrow; uniform float uOpen; uniform float uWilt;
`;

export function createMushroomMaterial(genome, { transparent = false } = {}) {
  const uniforms = {
    uTime: { value: 0 },
    uStemTop: { value: new THREE.Vector3(0, 1, 0) },
    uBend: { value: new THREE.Vector2() },
    uGrow: { value: 1 },
    uOpen: { value: 1 },
    uWilt: { value: 0 },
    uGlow: { value: genome.glow },
    uGlowColor: { value: new THREE.Color(genome.glowColor) },
    uHighlight: { value: 0 },
    uSeed: { value: Math.random() },
    uNight: { value: 1 },
    uDim: { value: 0 },
  };

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent,
    opacity: transparent ? 0.5 : 1,
    depthWrite: !transparent,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        ${DEFORM_UNIFORMS}
        varying float vGlow; varying float vPart; varying float vHh;`)
      .replace('#include <begin_vertex>', `${DEFORM}
        vGlow = aGlow; vPart = aPart; vHh = aH;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uGlow, uHighlight, uSeed, uWilt, uNight, uDim;
        uniform vec3 uGlowColor;
        varying float vGlow; varying float vPart; varying float vHh;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(luma) * vec3(0.45, 0.38, 0.3), uWilt * 0.85);
        diffuseColor.rgb *= 1.0 - uDim * 0.6;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 Vv = normalize(vViewPosition);
        float fres = pow(1.0 - abs(dot(normal, Vv)), 2.2);
        float pulse = 0.82 + 0.18 * sin(uTime * 1.6 + uSeed * 6.2831 + vHh * 2.5);
        float nightBoost = mix(0.45, 1.0, uNight);
        float g = vGlow * uGlow * pulse * (1.0 - uWilt) * nightBoost * (1.0 - uDim * 0.8);
        vec3 glowCol = uGlowColor;
        // gills and rims glow hard, cap tops only softly (keeps the form readable)
        float partK = vPart > 1.5 && vPart < 2.5 ? 2.2 : 1.1;
        totalEmissiveRadiance += glowCol * g * partK;
        totalEmissiveRadiance += diffuseColor.rgb * glowCol * g * 0.35;
        // cheap subsurface: light bleeding through thin cap edges
        totalEmissiveRadiance += diffuseColor.rgb * glowCol * pow(1.0 - abs(dot(normal, Vv)), 4.0) * 0.25 * nightBoost;
        totalEmissiveRadiance += glowCol * fres * (0.25 * uGlow * nightBoost + uHighlight * 1.6) * (1.0 - uDim * 0.8);`);
  };
  material.customProgramCacheKey = () => 'mushroom-v1' + (transparent ? '-t' : '');

  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DEFORM_UNIFORMS}`)
      .replace('#include <begin_vertex>', DEFORM);
  };
  depthMaterial.customProgramCacheKey = () => 'mushroom-depth-v1';

  return { material, depthMaterial, uniforms };
}
