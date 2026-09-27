// Sahne öğeleri: kostikli deniz tabanı, su altı partikülleri, yağmur ve yüzen şamandıra.
import * as THREE from 'three';
import { NOISE, SKY_MAPPING, SKY_COMMON, CAUSTICS } from './shaders/common.js';

// ------------------------------------------------------------------ Deniz tabanı
const SEABED_VS = /* glsl */ `
${NOISE}
uniform float uSeabedDepth;
uniform vec2 uOffset;
varying vec3 vWorld;
float bedHeight(vec2 p) {
  float dunes = (fbm4(p * 0.012) - 0.5) * 7.0;
  float ripples = (fbm4(p * 0.08) - 0.5) * 1.2;
  return -uSeabedDepth + dunes + ripples;
}
void main() {
  vec2 xz = position.xz + uOffset;
  vec3 wp = vec3(xz.x, bedHeight(xz), xz.y);
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const SEABED_FS = /* glsl */ `
${NOISE}
${SKY_MAPPING}
${SKY_COMMON}
${CAUSTICS}
uniform float uSeabedDepth;
uniform vec3 uKd;
uniform float uCausticStrength;
varying vec3 vWorld;
float bedDetail(vec2 p) {
  float dunes = (fbm4(p * 0.012) - 0.5) * 7.0;
  float ripples = (fbm4(p * 0.08) - 0.5) * 1.2;
  vec2 q = p + vec2(fbm4(p * 0.3), fbm4(p * 0.3 + 5.0)) * 2.0;
  float sandRip = sin(dot(q, vec2(0.6, 0.8)) * 5.0) * 0.035;
  float grain = (vnoise(p * 9.0) - 0.5) * 0.02;
  return dunes + ripples + sandRip + grain;
}
void main() {
  vec3 wp = vWorld;
  float e = 0.05;
  float h0 = bedDetail(wp.xz);
  float hx = bedDetail(wp.xz + vec2(e, 0.0));
  float hz = bedDetail(wp.xz + vec2(0.0, e));
  vec3 N = normalize(vec3(h0 - hx, e, h0 - hz));
  float patchN = fbm4(wp.xz * 0.05);
  vec3 sand = mix(vec3(0.62, 0.56, 0.44), vec3(0.45, 0.42, 0.36), smoothstep(0.4, 0.7, patchN));
  float weed = smoothstep(0.62, 0.72, fbm4(wp.xz * 0.11 + 9.0));
  vec3 albedo = mix(sand, vec3(0.1, 0.16, 0.07), weed * 0.8);
  albedo *= 0.85 + 0.3 * vnoise(wp.xz * 3.0);

  float depth = max(0.0, -wp.y);
  vec3 Lr = refract(-uSunDir, vec3(0.0, 1.0, 0.0), 1.0 / 1.333);
  if (uSunDir.y <= 0.0) Lr = vec3(0.0, -1.0, 0.0);
  vec3 toSun = -Lr;
  float cosr = max(toSun.y, 0.2);
  vec3 sunUnder = uSunColor * 0.96 * exp(-uKd * depth / cosr);
  vec2 sp = wp.xz + toSun.xz / cosr * depth;
  float c = caustics(sp * 0.55, uTime);
  float cs = uCausticStrength * exp(-depth / 45.0);
  float caus = mix(1.0, 0.25 + c * 2.4, clamp(cs, 0.0, 1.0));
  float shadow = cloudShadow(vec3(sp.x, 0.0, sp.y));
  vec3 moonUnder = uMoonColor * exp(-uKd * depth / 0.8);
  vec3 diffuse = albedo / PI * (sunUnder * caus * shadow + moonUnder) * max(dot(N, toSun), 0.0);
  vec3 ambient = albedo * skyAmbient() * exp(-uKd * depth) * 0.45;
  gl_FragColor = vec4(diffuse + ambient, 1.0);
}
`;

export function createSeabed(shared) {
  const geo = new THREE.CircleGeometry(700, 180, 0, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  // Merkeze yakın daha yoğun köşe: halka tabanlı basit alt bölme
  const rings = 90, segs = 160;
  const pos = [];
  const idx = [];
  pos.push(0, 0, 0);
  for (let i = 1; i <= rings; i++) {
    const r = 700 * Math.pow(i / rings, 2.0);
    for (let j = 0; j < segs; j++) {
      const a = j / segs * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + (j + 1) % segs, 1 + j);
  for (let i = 1; i < rings; i++) {
    const r0 = 1 + (i - 1) * segs, r1 = 1 + i * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(r0 + j, r0 + j1, r1 + j, r0 + j1, r1 + j1, r1 + j);
    }
  }
  geo.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const uniforms = {
    ...shared,
    uOffset: { value: new THREE.Vector2() },
    uCausticStrength: { value: 1.0 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: SEABED_VS, fragmentShader: SEABED_FS, uniforms,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  return {
    mesh, uniforms,
    update(camera) {
      uniforms.uOffset.value.set(Math.round(camera.position.x / 4) * 4, Math.round(camera.position.z / 4) * 4);
      mesh.visible = camera.position.y < 12;
    },
  };
}

// ------------------------------------------------------------------ Su altı partikülleri
const SNOW_VS = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uBox;
uniform float uPixelRatio;
varying float vFade;
varying float vSeed;
void main() {
  vec3 p = position * uBox;
  p += vec3(sin(uTime * 0.2 + aSeed * 10.0), -uTime * 0.05 * (0.5 + aSeed), cos(uTime * 0.17 + aSeed * 7.0)) * 0.6;
  vec3 rel = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 wp = cameraPosition + rel;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float d = -mv.z;
  vFade = smoothstep(uBox * 0.5, uBox * 0.2, length(rel)) * smoothstep(0.2, 0.8, d) * step(wp.y, -0.2);
  vSeed = aSeed;
  gl_PointSize = clamp((1.2 + aSeed * 2.5) * uPixelRatio * 18.0 / max(d, 0.1), 1.0, 24.0);
  gl_Position = projectionMatrix * mv;
}
`;
const SNOW_FS = /* glsl */ `
uniform vec3 uColor;
varying float vFade;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(c)) * vFade;
  if (a <= 0.001) discard;
  gl_FragColor = vec4(uColor * (0.6 + vSeed), a * 0.55);
}
`;

export function createMarineSnow(count = 3500) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random();
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = {
    uTime: { value: 0 }, uBox: { value: 24 }, uPixelRatio: { value: 1 },
    uColor: { value: new THREE.Color(0.2, 0.3, 0.3) },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: SNOW_VS, fragmentShader: SNOW_FS, uniforms,
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return { mesh: pts, uniforms };
}

// ------------------------------------------------------------------ Yağmur
const RAIN_VS = /* glsl */ `
attribute float aEnd;
uniform float uTime;
uniform vec2 uWindVel;
uniform float uIntensity;
varying float vAlpha;
void main() {
  vec3 box = vec3(50.0, 30.0, 50.0);
  vec3 seed = position;
  float speed = 9.0 + seed.y * 3.0;
  vec3 vel = vec3(uWindVel.x, -speed, uWindVel.y);
  vec3 p = seed * box + vel * uTime;
  vec3 rel = mod(p - cameraPosition + box * 0.5, box) - box * 0.5;
  vec3 wp = cameraPosition + rel;
  wp -= normalize(vel) * aEnd * 0.9;
  float keep = step(fract(seed.x * 91.7 + seed.z * 13.3), uIntensity);
  vAlpha = keep * (1.0 - aEnd * 0.8) * smoothstep(25.0, 5.0, length(rel.xz)) * step(0.0, wp.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const RAIN_FS = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  if (vAlpha <= 0.001) discard;
  gl_FragColor = vec4(uColor, vAlpha * 0.35);
}
`;

export function createRain(count = 9000) {
  const pos = new Float32Array(count * 6);
  const end = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = Math.random(), y = Math.random(), z = Math.random();
    pos.set([x, y, z, x, y, z], i * 6);
    end[i * 2] = 0; end[i * 2 + 1] = 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const uniforms = {
    uTime: { value: 0 }, uWindVel: { value: new THREE.Vector2() }, uIntensity: { value: 0 },
    uColor: { value: new THREE.Color(0.6, 0.65, 0.7) },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: RAIN_VS, fragmentShader: RAIN_FS, uniforms,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 6;
  return { mesh: lines, uniforms };
}

// ------------------------------------------------------------------ Şamandıra
const BUOY_VS = /* glsl */ `
attribute vec3 color;
attribute float aEmissive;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vColor;
varying float vEmissive;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vColor = color;
  vEmissive = aEmissive;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const BUOY_FS = /* glsl */ `
${NOISE}
${SKY_MAPPING}
${SKY_COMMON}
uniform float uBlink;
uniform vec3 uKd;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vColor;
varying float vEmissive;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  vec3 albedo = vColor;
  float grime = vnoise(vWorld.xz * 4.0 + vWorld.y * 3.0);
  albedo *= 0.8 + 0.3 * grime;
  float wet = smoothstep(0.6, -0.2, vWorld.y);
  albedo *= mix(1.0, 0.55, wet);
  vec3 L = uSunDir;
  float NL = max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), mix(40.0, 200.0, wet)) * mix(0.15, 0.6, wet);
  float under = step(vWorld.y, 0.0);
  float depth = max(0.0, -vWorld.y);
  vec3 sunE = uSunColor * cloudShadow(vWorld) * mix(vec3(1.0), exp(-uKd * depth), under);
  vec3 amb = skyAmbient() * (0.6 + 0.4 * N.y);
  vec3 col = albedo / PI * (sunE * NL + uMoonColor * max(dot(N, uMoonDir), 0.0)) + albedo * amb * 0.9 + sunE * spec;
  vec3 R = reflect(-V, N);
  col += sampleSky(uSkyFull, normalize(vec3(R.x, abs(R.y), R.z)), 3.0) * 0.06 * (1.0 + wet);
  col += vEmissive * vec3(1.0, 0.55, 0.2) * uBlink * 40.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

function colored(geo, color, emissive = 0) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) { c[i * 3] = color[0]; c[i * 3 + 1] = color[1]; c[i * 3 + 2] = color[2]; e[i] = emissive; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.setAttribute('aEmissive', new THREE.BufferAttribute(e, 1));
  return geo;
}

function mergeGeometries(list) {
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ['aEmissive', 1]]) {
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of list) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

export function createBuoy(shared) {
  const red = [0.55, 0.04, 0.03], white = [0.8, 0.8, 0.78], dark = [0.08, 0.08, 0.09], yellow = [0.75, 0.55, 0.05];
  const parts = [];
  const add = (geo, color, y, em = 0) => { geo.translate(0, y, 0); parts.push(colored(geo, color, em)); };
  add(new THREE.CylinderGeometry(1.05, 0.95, 1.3, 48, 1), red, -0.2);
  add(new THREE.TorusGeometry(1.05, 0.1, 12, 48).rotateX(Math.PI / 2), dark, 0.42);
  add(new THREE.CylinderGeometry(0.95, 0.5, 0.35, 48, 1), red, -0.98);
  add(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 12), dark, -1.7);
  // Kafes kule
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.CylinderGeometry(0.05, 0.05, 2.3, 8);
    leg.rotateZ(0.16);
    leg.rotateY(-a);
    leg.translate(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45);
    add(leg, i % 2 ? white : red, 1.6);
  }
  add(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 32), red, 0.72);
  add(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 32), white, 1.6);
  add(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 32), red, 2.5);
  add(new THREE.ConeGeometry(0.28, 0.5, 24), yellow, 3.05);
  add(new THREE.CylinderGeometry(0.1, 0.12, 0.25, 16), dark, 2.65);
  add(new THREE.SphereGeometry(0.11, 16, 12), [1, 0.8, 0.5], 2.85, 1);
  const geo = mergeGeometries(parts);
  const uniforms = { ...shared, uBlink: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    vertexShader: BUOY_VS, fragmentShader: BUOY_FS, uniforms,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  const state = { y: 0, tiltX: 0, tiltZ: 0, yaw: 0.4 };
  return {
    mesh, uniforms, position: new THREE.Vector2(22, -48),
    update(dt, height, slope, time, night) {
      const k = 1 - Math.exp(-dt * 3.5);
      state.y += (height + 0.05 - state.y) * k;
      state.tiltX += (Math.atan(slope[1]) * 0.8 - state.tiltX) * (1 - Math.exp(-dt * 2.0));
      state.tiltZ += (-Math.atan(slope[0]) * 0.8 - state.tiltZ) * (1 - Math.exp(-dt * 2.0));
      state.yaw += Math.sin(time * 0.13) * dt * 0.05;
      mesh.position.set(this.position.x, state.y, this.position.y);
      mesh.rotation.set(state.tiltX, state.yaw, state.tiltZ, 'YXZ');
      const phase = time % 4.0;
      uniforms.uBlink.value = (phase < 0.6 ? 1 : 0.02) * (0.1 + 0.9 * night);
    },
  };
}
