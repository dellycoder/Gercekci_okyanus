// Okyanus yüzeyi: kameraya bağlı radyal ızgara + fiziksel tabanlı su gölgelendirmesi.
import * as THREE from 'three';
import { NOISE, SKY_MAPPING, SKY_COMMON } from '../shaders/common.js';

// Merkezde çok sık, uzakta üstel olarak seyrelen radyal ızgara
export function buildOceanGeometry(rings, segments, maxRadius, innerSpacing) {
  // r(i) = a (e^{b i/rings} - 1),  a*b/rings = innerSpacing,  r(rings) = maxRadius
  const target = maxRadius / (innerSpacing * rings);
  let lo = 0.01, hi = 40;
  for (let it = 0; it < 80; it++) {
    const mid = 0.5 * (lo + hi);
    const f = (Math.exp(mid) - 1) / mid;
    if (f > target) hi = mid; else lo = mid;
  }
  const b = 0.5 * (lo + hi);
  const a = innerSpacing * rings / b;
  const radius = (i) => a * (Math.exp(b * i / rings) - 1);

  const vcount = 1 + rings * segments;
  const pos = new Float32Array(vcount * 3);
  const spacing = new Float32Array(vcount);
  spacing[0] = innerSpacing;
  for (let i = 1; i <= rings; i++) {
    const r = radius(i);
    const dr = radius(i) - radius(i - 1);
    const arc = 2 * Math.PI * r / segments;
    const offset = (i % 2) * 0.5; // halkaları kaydırarak daha düzgün üçgenler
    for (let j = 0; j < segments; j++) {
      const ang = (j + offset) / segments * Math.PI * 2;
      const idx = 1 + (i - 1) * segments + j;
      pos[idx * 3] = Math.cos(ang) * r;
      pos[idx * 3 + 1] = 0;
      pos[idx * 3 + 2] = Math.sin(ang) * r;
      spacing[idx] = Math.max(dr, arc);
    }
  }
  const tris = segments + (rings - 1) * segments * 2;
  const index = new Uint32Array(tris * 3);
  let k = 0;
  for (let j = 0; j < segments; j++) {
    index[k++] = 0;
    index[k++] = 1 + (j + 1) % segments;
    index[k++] = 1 + j;
  }
  for (let i = 1; i < rings; i++) {
    const r0 = 1 + (i - 1) * segments;
    const r1 = 1 + i * segments;
    const odd = i % 2 === 1;
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      const a0 = r0 + j, a1 = r0 + j1, b0 = r1 + j, b1 = r1 + j1;
      if (odd) {
        index[k++] = a0; index[k++] = a1; index[k++] = b1;
        index[k++] = a0; index[k++] = b1; index[k++] = b0;
      } else {
        index[k++] = a0; index[k++] = a1; index[k++] = b0;
        index[k++] = a1; index[k++] = b1; index[k++] = b0;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSpacing', new THREE.BufferAttribute(spacing, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), maxRadius);
  return geo;
}

const VS = /* glsl */ `
attribute float aSpacing;
uniform sampler2D uDisp0;
uniform sampler2D uDisp1;
uniform sampler2D uDisp2;
uniform vec3 uLengths;
uniform float uN;
uniform vec2 uGridOffset;
uniform float uGridScale;
varying vec3 vWorld;
varying vec2 vUV;
void main() {
  vec2 xz = position.xz * uGridScale + uGridOffset;
  float sp = aSpacing * uGridScale;
  vec3 d = vec3(0.0);
  d += textureLod(uDisp0, xz / uLengths.x, log2(max(sp * uN / uLengths.x, 1.0))).xyz;
  d += textureLod(uDisp1, xz / uLengths.y, log2(max(sp * uN / uLengths.y, 1.0))).xyz;
  d += textureLod(uDisp2, xz / uLengths.z, log2(max(sp * uN / uLengths.z, 1.0))).xyz;
  vec3 wp = vec3(xz.x + d.x, d.y, xz.y + d.z);
  vec2 rel = wp.xz - cameraPosition.xz;
  wp.y -= dot(rel, rel) / (2.0 * 6371e3);
  vWorld = wp;
  vUV = xz;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FS = /* glsl */ `
${NOISE}
${SKY_MAPPING}
${SKY_COMMON}
uniform sampler2D uDisp0;
uniform sampler2D uDisp1;
uniform sampler2D uDisp2;
uniform sampler2D uDeriv0;
uniform sampler2D uDeriv1;
uniform sampler2D uDeriv2;
uniform vec3 uLengths;
uniform vec3 uDeepColor;
uniform vec3 uScatterColor;
uniform float uSSS;
uniform float uFoamStrength;
uniform float uWind;
uniform float uReflectivity;
uniform float uSpecular;
uniform vec3 uScatterTint;
varying vec3 vWorld;
varying vec2 vUV;

float ggx(vec3 N, vec3 V, vec3 L, float a, float NV) {
  float NL = dot(N, L);
  if (NL <= 0.0) return 0.0;
  vec3 H = normalize(V + L);
  float NH = max(dot(N, H), 0.0);
  float VH = max(dot(V, H), 0.0);
  float a2 = a * a;
  float d = NH * NH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * d * d);
  float k = a * 0.5;
  float G = (NV / (NV * (1.0 - k) + k)) * (NL / (NL * (1.0 - k) + k));
  float F = 0.02 + 0.98 * pow(1.0 - VH, 5.0);
  return D * G * F / (4.0 * NV);
}

uniform float uWindDir;
float foamPattern(vec2 uv) {
  float cw = cos(uWindDir), sw = sin(uWindDir);
  vec2 p = vec2(cw * uv.x + sw * uv.y, -sw * uv.x + cw * uv.y) * vec2(0.45, 1.3);
  float t = uTime * 0.05;
  float a = fbm4(p + vec2(t, -t * 0.7));
  float b = fbm4(p * 2.7 - vec2(t * 1.3, t * 0.4) + a * 1.5);
  float c = vnoise(p * 9.0 + b * 3.0);
  return clamp(a * 0.45 + b * 0.45 + c * 0.25, 0.0, 1.0);
}

void main() {
  vec3 wp = vWorld;
  vec3 toCam = cameraPosition - wp;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  vec2 uv0 = vUV / uLengths.x, uv1 = vUV / uLengths.y, uv2 = vUV / uLengths.z;
  vec4 der = texture(uDeriv0, uv0) + texture(uDeriv1, uv1) + texture(uDeriv2, uv2);
  vec2 slope = der.xy / max(1.0 + der.zw, vec2(0.5));
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
  float foamRaw = texture(uDisp0, uv0).a * 0.9 + texture(uDisp1, uv1).a + texture(uDisp2, uv2).a * 0.5;

  vec3 amb = skyAmbient();
  vec3 col;

  if (gl_FrontFacing) {
    // ---------------- Yukarıdan görünüm ----------------
    float NV = dot(N, V);
    if (NV < 0.03) { N = normalize(N + V * (0.03 - NV)); NV = dot(N, V); }
    NV = max(NV, 0.03);
    float far = clamp(log2(max(dist, 1.0) / 12.0) / 7.0, 0.0, 1.0);
    float cm = sqrt(0.003 + 0.00512 * uWind);
    float alpha = mix(0.045, max(cm * 1.1, 0.08), far);
    float F = 0.02 + 0.98 * pow(1.0 - NV, 5.0);
    F = mix(F, F * 0.8, far * 0.5) * uReflectivity;

    vec3 R = reflect(-V, N);
    R.y = abs(R.y) + 0.002;
    R = normalize(R);
    vec3 refl = sampleSky(uSkyFull, R, alpha * 7.0 + far * 1.0) + uNightAmbient * 1.5;

    float shadow = cloudShadow(wp);
    vec3 sunE = uSunColor * shadow;
    vec3 L = uSunDir;
    vec3 spec = ggx(N, V, L, alpha, NV) * sunE + ggx(N, V, uMoonDir, alpha, NV) * uMoonColor;
    spec *= uSpecular;

    // Su kütlesi içi saçılım (dalga tepelerinde ışık geçirgenliği)
    float waveH = max(0.0, wp.y + 0.3);
    float NL = max(dot(N, L), 0.0);
    float k1 = uSSS * waveH * pow(max(0.0, dot(L, -V)), 4.0) * pow(0.5 - 0.5 * dot(L, N), 3.0);
    float k2 = 0.35 * pow(NV, 2.0);
    vec3 lightE = sunE + uMoonColor * 0.8;
    vec3 scatter = (k1 * 1.6 + k2 * 0.12) * uScatterColor * lightE
                 + 0.05 * NL * uScatterColor * sunE
                 + uDeepColor * amb;
    // Uzak ufka doğru saçılımın azalması
    scatter *= mix(1.0, 0.6, far);

    col = (1.0 - F) * scatter + F * refl + spec;

    // Köpük
    float fp = foamPattern(vUV);
    float foam = clamp(foamRaw * uFoamStrength, 0.0, 2.0);
    float foamMask = smoothstep(0.25, 0.95, foam * (0.45 + 0.9 * fp));
    foamMask = max(foamMask, smoothstep(1.0, 1.8, foam) * 0.95);
    vec3 foamCol = sunE * (0.35 + 0.65 * max(dot(N, L), 0.0)) * 0.9 / PI + uMoonColor * 0.3 + amb * 1.5;
    col = mix(col, foamCol, foamMask * 0.95);

    // Atmosferik perspektif
    float fog = 1.0 - exp(-dist * uFogDensity);
    col = mix(col, horizonFogColor(-V), fog);
  } else {
    // ---------------- Su altından görünüm ----------------
    N = -N;
    float NV = max(dot(N, V), 0.001);
    vec3 T = refract(-V, N, 1.333);
    vec3 uw = uScatterTint * (uSunColor * max(uSunDir.y, 0.0) * 0.04 + amb * 0.5 + uMoonColor * 0.15);
    if (dot(T, T) < 0.01) {
      // Tam iç yansıma: derinliklerin yansıması
      col = uw * 0.9;
    } else {
      float cosT = abs(T.y);
      float F = 0.02 + 0.98 * pow(1.0 - NV, 5.0);
      F = mix(F, 1.0, smoothstep(0.35, 0.0, cosT) * 0.6);
      vec3 sky = sampleSky(uSkyFull, normalize(vec3(T.x, max(T.y, 0.001), T.z)), 1.0);
      float sd = max(dot(T, uSunDir), 0.0);
      sky += uSunColor * (pow(sd, 900.0) * 60.0 + pow(sd, 40.0) * 0.8) * cloudShadow(wp);
      float md = max(dot(T, uMoonDir), 0.0);
      sky += uMoonColor * pow(md, 900.0) * 40.0;
      col = mix(sky * 0.95, uw, F);
    }
    float foam = clamp(foamRaw * uFoamStrength, 0.0, 2.0);
    float foamMask = smoothstep(0.2, 1.2, foam * (0.4 + foamPattern(vUV)));
    col = mix(col, (uSunColor * 0.08 + amb * 0.5) * 0.6, foamMask * 0.8);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createOceanSurface(shared, sim, quality) {
  const uniforms = {
    ...shared,
    uDisp0: { value: null }, uDisp1: { value: null }, uDisp2: { value: null },
    uDeriv0: { value: null }, uDeriv1: { value: null }, uDeriv2: { value: null },
    uLengths: { value: new THREE.Vector3(...sim.lengths) },
    uN: { value: sim.size },
    uGridOffset: { value: new THREE.Vector2() },
    uGridScale: { value: 1 },
    uScatterColor: { value: new THREE.Color(0.02, 0.21, 0.19) },
    uSSS: { value: 1.0 },
    uFoamStrength: { value: 1.0 },
    uWind: { value: 9 },
    uWindDir: { value: 0 },
    uReflectivity: { value: 1.0 },
    uSpecular: { value: 1.0 },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, uniforms,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(buildOceanGeometry(quality.rings, quality.segments, 250000, 0.05), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  return {
    mesh, material,
    setQuality(q) {
      mesh.geometry.dispose();
      mesh.geometry = buildOceanGeometry(q.rings, q.segments, 250000, 0.05);
    },
    update(camera, simulation) {
      const d = simulation.dispTextures, r = simulation.derivTextures;
      uniforms.uDisp0.value = d[0]; uniforms.uDisp1.value = d[1]; uniforms.uDisp2.value = d[2];
      uniforms.uDeriv0.value = r[0]; uniforms.uDeriv1.value = r[1]; uniforms.uDeriv2.value = r[2];
      uniforms.uN.value = simulation.size;
      uniforms.uGridOffset.value.set(camera.position.x, camera.position.z);
      const alt = Math.abs(camera.position.y);
      uniforms.uGridScale.value = Math.max(1, alt / 6);
      uniforms.uWind.value = simulation.params.windSpeed;
      uniforms.uWindDir.value = simulation.params.windDir * Math.PI / 180;
    },
  };
}
