// GPU üzerinde FFT tabanlı okyanus simülasyonu (Tessendorf yöntemi).
// JONSWAP spektrumu + Donelan-Banner yönsel yayılımı, 3 kademeli (cascade) dalga alanları,
// Jacobian tabanlı köpük birikimi.
import * as THREE from 'three';

const G = 9.81;

const FULLSCREEN_VS = /* glsl */ `
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const SPECTRUM_GLSL = /* glsl */ `
const float G = 9.81;
const float PI = 3.14159265359;
uniform float uWind;
uniform float uWindDir;
uniform float uFetch;
uniform float uSwell;
uniform float uSwellDir;
uniform float uSwellWind;
uniform float uSpread;
uniform float uGamma;

float jonswap(float w, float U, float F, float gamma) {
  float wp = 22.0 * pow(G * G / (U * F), 1.0 / 3.0);
  float alpha = 0.076 * pow(U * U / (F * G), 0.22);
  float sigma = w <= wp ? 0.07 : 0.09;
  float r = exp(-(w - wp) * (w - wp) / (2.0 * sigma * sigma * wp * wp));
  return alpha * G * G / pow(w, 5.0) * exp(-1.25 * pow(wp / w, 4.0)) * pow(gamma, r);
}
float peakOmega(float U, float F) { return 22.0 * pow(G * G / (U * F), 1.0 / 3.0); }
float wrapAngle(float a) { return mod(a + PI, 2.0 * PI) - PI; }
float donelanBanner(float theta, float w, float wp) {
  float r = w / wp;
  float beta = r < 0.95 ? 2.61 * pow(r, 1.3) : (r < 1.6 ? 2.28 * pow(r, -1.3)
      : pow(10.0, -0.4 + 0.8393 * exp(-0.567 * log(r * r))));
  float c = cosh(clamp(beta * theta, -15.0, 15.0));
  return beta / (2.0 * tanh(beta * PI)) / (c * c);
}
// k-uzayında 2B spektrum yoğunluğu S(kx, kz)
float spectrum2D(vec2 kv) {
  float k = length(kv);
  if (k < 1e-5) return 0.0;
  float w = sqrt(G * k);
  float dwdk = G / (2.0 * w);
  float theta = atan(kv.y, kv.x);
  float wp = peakOmega(uWind, uFetch);
  float D = donelanBanner(wrapAngle(theta - uWindDir), w, wp);
  D = mix(D, 1.0 / (2.0 * PI), uSpread);
  float S = jonswap(w, uWind, uFetch, uGamma) * D;
  if (uSwell > 0.0) {
    float swp = peakOmega(uSwellWind, 900e3);
    float s = 22.0;
    float a = wrapAngle(theta - uSwellDir);
    float Ds = sqrt(s / (4.0 * PI)) * pow(abs(cos(a * 0.5)), 2.0 * s);
    S += uSwell * jonswap(w, uSwellWind, 900e3, 5.0) * Ds;
  }
  // Kılcal dalga bölgesinde yumuşak kesim
  S *= exp(-k * k * 0.0004);
  return S * dwdk / k;
}
`;

const INIT_FS = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uNoise;
uniform float uN;
uniform float uL;
uniform float uKMin;
uniform float uKMax;
uniform float uAmp;
${SPECTRUM_GLSL}
out vec4 outColor;

vec2 h0(ivec2 id) {
  int N = int(uN);
  int mx = id.x < N / 2 ? id.x : id.x - N;
  int mz = id.y < N / 2 ? id.y : id.y - N;
  if (mx == -N / 2 || mz == -N / 2) return vec2(0.0);
  float dk = 2.0 * PI / uL;
  vec2 kv = vec2(float(mx), float(mz)) * dk;
  float k = length(kv);
  if (k < uKMin || k >= uKMax) return vec2(0.0);
  vec2 xi = texelFetch(uNoise, id, 0).xy;
  return xi * 0.5 * sqrt(spectrum2D(kv)) * dk * uAmp;
}
void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  int N = int(uN);
  ivec2 nid = ivec2((N - id.x) % N, (N - id.y) % N);
  vec2 a = h0(id);
  vec2 b = h0(nid);
  outColor = vec4(a, b.x, -b.y);
}
`;

const TIME_FS = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uH0;
uniform float uN;
uniform float uL;
uniform float uTime;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 mulI(vec2 a) { return vec2(-a.y, a.x); }
void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  int N = int(uN);
  int mx = id.x < N / 2 ? id.x : id.x - N;
  int mz = id.y < N / 2 ? id.y : id.y - N;
  vec2 kv = vec2(float(mx), float(mz)) * (6.28318530718 / uL);
  float k = length(kv);
  vec4 h0 = texelFetch(uH0, id, 0);
  float w = sqrt(9.81 * k);
  float ph = mod(w * uTime, 6.28318530718);
  vec2 e = vec2(cos(ph), sin(ph));
  vec2 h = cmul(h0.xy, e) + cmul(h0.zw, vec2(e.x, -e.y));
  vec2 ih = mulI(h);
  float invk = k > 1e-6 ? 1.0 / k : 0.0;
  vec2 dx = ih * kv.x * invk;
  vec2 dz = ih * kv.y * invk;
  vec2 hx = ih * kv.x;
  vec2 hz = ih * kv.y;
  vec2 dxx = -h * kv.x * kv.x * invk;
  vec2 dzz = -h * kv.y * kv.y * invk;
  vec2 dxz = -h * kv.x * kv.y * invk;
  o0 = vec4(h + mulI(dx), dz + mulI(hx));
  o1 = vec4(hz + mulI(dxx), dzz + mulI(dxz));
}
`;

// Stockham radix-2 ters FFT adımı (doğal sıra giriş / doğal sıra çıkış)
const FFT_FS = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uIn0;
uniform sampler2D uIn1;
uniform int uSub;
uniform int uHoriz;
uniform int uN;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int idx = uHoriz == 1 ? p.x : p.y;
  int halfSub = uSub / 2;
  int ev = (idx / uSub) * halfSub + (idx % halfSub);
  int od = ev + uN / 2;
  ivec2 pe = uHoriz == 1 ? ivec2(ev, p.y) : ivec2(p.x, ev);
  ivec2 po = uHoriz == 1 ? ivec2(od, p.y) : ivec2(p.x, od);
  float a = 6.28318530718 * float(idx % uSub) / float(uSub);
  vec2 tw = vec2(cos(a), sin(a));
  vec4 e0 = texelFetch(uIn0, pe, 0), q0 = texelFetch(uIn0, po, 0);
  vec4 e1 = texelFetch(uIn1, pe, 0), q1 = texelFetch(uIn1, po, 0);
  o0 = vec4(e0.xy + cmul(tw, q0.xy), e0.zw + cmul(tw, q0.zw));
  o1 = vec4(e1.xy + cmul(tw, q1.xy), e1.zw + cmul(tw, q1.zw));
}
`;

const ASSEMBLE_FS = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uF0;
uniform sampler2D uF1;
uniform sampler2D uPrev;
uniform float uLambda;
uniform float uDt;
uniform float uFoamDecay;
uniform float uFoamBias;
uniform float uFoamAdd;
layout(location = 0) out vec4 oDisp;
layout(location = 1) out vec4 oDeriv;
void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uF0, id, 0);
  vec4 b = texelFetch(uF1, id, 0);
  float h = a.x, dx = a.y, dz = a.z, hx = a.w;
  float hz = b.x, dxx = b.y, dzz = b.z, dxz = b.w;
  float L = uLambda;
  float J = (1.0 + L * dxx) * (1.0 + L * dzz) - L * L * dxz * dxz;
  float foam = texelFetch(uPrev, id, 0).a;
  foam *= exp(-uFoamDecay * uDt);
  foam += max(0.0, uFoamBias - J) * uFoamAdd * uDt * 60.0;
  foam = clamp(foam, 0.0, 2.5);
  oDisp = vec4(L * dx, h, L * dz, foam);
  oDeriv = vec4(hx, hz, L * dxx, L * dzz);
}
`;

// Belirli noktalarda su yüksekliği ve eğimi sorgusu (CPU'ya geri okunur)
const QUERY_FS = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uDisp0;
uniform sampler2D uDisp1;
uniform sampler2D uDisp2;
uniform sampler2D uDeriv0;
uniform sampler2D uDeriv1;
uniform sampler2D uDeriv2;
uniform vec3 uLengths;
uniform vec2 uPoints[8];
out vec4 outColor;
vec3 disp(vec2 p) {
  return textureLod(uDisp0, p / uLengths.x, 0.0).xyz
       + textureLod(uDisp1, p / uLengths.y, 0.0).xyz
       + textureLod(uDisp2, p / uLengths.z, 0.0).xyz;
}
void main() {
  int i = int(gl_FragCoord.x);
  vec2 target = uPoints[i];
  vec2 p = target;
  for (int k = 0; k < 5; k++) { vec3 d = disp(p); p = target - d.xz; }
  vec3 d = disp(p);
  vec4 der = textureLod(uDeriv0, p / uLengths.x, 1.0) + textureLod(uDeriv1, p / uLengths.y, 2.0);
  vec2 slope = der.xy / (1.0 + der.zw);
  outColor = vec4(d.y, slope, 0.0);
}
`;

export class OceanSimulation {
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.lengths = options.lengths || [600, 80, 13];
    this.params = {
      windSpeed: 9,
      windDir: 30,        // derece
      fetch: 250,         // km
      swell: 0.5,
      swellDir: 60,
      swellWind: 12,
      spread: 0.12,
      gamma: 3.3,
      choppiness: 0.9,
      foamAmount: 1.0,
      foamDecay: 0.35,
      foamBias: 0.55,
      amplitude: 1.0,
    };
    Object.assign(this.params, options.params || {});

    const gl = renderer.getContext();
    const hasFloatRT = !!renderer.extensions.get('EXT_color_buffer_float');
    this.computeType = hasFloatRT ? THREE.FloatType : THREE.HalfFloatType;
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
    this.gl = gl;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(tri);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    const raw = (fs, uniforms) => new THREE.RawShaderMaterial({
      vertexShader: FULLSCREEN_VS, fragmentShader: fs, uniforms,
      glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    });

    this.initMat = raw(INIT_FS, {
      uNoise: { value: null }, uN: { value: 0 }, uL: { value: 0 }, uKMin: { value: 0 }, uKMax: { value: 0 },
      uWind: { value: 0 }, uWindDir: { value: 0 }, uFetch: { value: 0 }, uSwell: { value: 0 },
      uSwellDir: { value: 0 }, uSwellWind: { value: 0 }, uSpread: { value: 0 }, uGamma: { value: 3.3 },
      uAmp: { value: 1 },
    });
    this.timeMat = raw(TIME_FS, { uH0: { value: null }, uN: { value: 0 }, uL: { value: 0 }, uTime: { value: 0 } });
    this.fftMat = raw(FFT_FS, {
      uIn0: { value: null }, uIn1: { value: null }, uSub: { value: 2 }, uHoriz: { value: 1 }, uN: { value: 0 },
    });
    this.assembleMat = raw(ASSEMBLE_FS, {
      uF0: { value: null }, uF1: { value: null }, uPrev: { value: null }, uLambda: { value: 1 },
      uDt: { value: 0.016 }, uFoamDecay: { value: 0.3 }, uFoamBias: { value: 0.6 }, uFoamAdd: { value: 0.1 },
    });
    this.queryMat = raw(QUERY_FS, {
      uDisp0: { value: null }, uDisp1: { value: null }, uDisp2: { value: null },
      uDeriv0: { value: null }, uDeriv1: { value: null }, uDeriv2: { value: null },
      uLengths: { value: new THREE.Vector3(...this.lengths) },
      uPoints: { value: Array.from({ length: 8 }, () => new THREE.Vector2()) },
    });
    this.queryTarget = new THREE.WebGLRenderTarget(8, 1, {
      type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    this.queryBuffer = new Float32Array(32);
    this.queryResults = new Float32Array(32);
    this.queryPending = false;
    this.queryType = THREE.FloatType;

    this.time = 0;
    this.build(options.size || 256);
  }

  build(size) {
    this.dispose(true);
    this.size = size;
    const N = size;
    const cType = this.computeType;
    const pingOpts = {
      type: cType, format: THREE.RGBAFormat, depthBuffer: false, count: 2,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    };
    this.pingA = new THREE.WebGLRenderTarget(N, N, pingOpts);
    this.pingB = new THREE.WebGLRenderTarget(N, N, pingOpts);

    const outOpts = {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, count: 2,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, generateMipmaps: true,
      anisotropy: this.maxAniso,
    };

    // Kademe sınırları: bir sonraki kademenin çözebildiği dalga boyları ona bırakılır
    const Ls = this.lengths;
    const bounds = [0.0001, (2 * Math.PI / Ls[1]) * 6, (2 * Math.PI / Ls[2]) * 6, 1e9];
    this.cascades = Ls.map((L, i) => {
      const noise = this.makeNoise(N, 1337 + i * 7919);
      const h0 = new THREE.WebGLRenderTarget(N, N, {
        type: cType, format: THREE.RGBAFormat, depthBuffer: false,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
      });
      const outs = [new THREE.WebGLRenderTarget(N, N, outOpts), new THREE.WebGLRenderTarget(N, N, outOpts)];
      for (const o of outs) {
        o.textures.forEach((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = this.maxAniso; });
      }
      return { L, kMin: bounds[i], kMax: bounds[i + 1], noise, h0, outs, cur: 0 };
    });
    // Köpük geri beslemesi için hedefleri temizle
    const r = this.renderer;
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const c of this.cascades) for (const o of c.outs) { r.setRenderTarget(o); r.clear(); }
    r.setRenderTarget(null);
    r.setClearColor(prevClear, prevAlpha);
    this.spectrumDirty = true;
  }

  makeNoise(N, seed) {
    let s = seed >>> 0;
    const rand = () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const data = new Float32Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      const u1 = Math.max(rand(), 1e-7), u2 = rand();
      const u3 = Math.max(rand(), 1e-7), u4 = rand();
      const r1 = Math.sqrt(-2 * Math.log(u1)), r2 = Math.sqrt(-2 * Math.log(u3));
      data[i * 4] = r1 * Math.cos(2 * Math.PI * u2);
      data[i * 4 + 1] = r1 * Math.sin(2 * Math.PI * u2);
      data[i * 4 + 2] = r2 * Math.cos(2 * Math.PI * u4);
      data[i * 4 + 3] = r2 * Math.sin(2 * Math.PI * u4);
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }

  run(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  markDirty() { this.spectrumDirty = true; }

  updateSpectrum() {
    const p = this.params;
    const u = this.initMat.uniforms;
    u.uN.value = this.size;
    u.uWind.value = Math.max(0.5, p.windSpeed);
    u.uWindDir.value = p.windDir * Math.PI / 180;
    u.uFetch.value = p.fetch * 1000;
    u.uSwell.value = 0.06 * p.swell * p.swell;
    u.uSwellDir.value = p.swellDir * Math.PI / 180;
    u.uSwellWind.value = p.swellWind;
    u.uSpread.value = p.spread;
    u.uGamma.value = p.gamma;
    u.uAmp.value = p.amplitude;
    for (const c of this.cascades) {
      u.uNoise.value = c.noise;
      u.uL.value = c.L;
      u.uKMin.value = c.kMin;
      u.uKMax.value = c.kMax;
      this.run(this.initMat, c.h0);
    }
    this.spectrumDirty = false;
  }

  update(dt) {
    this.time += dt;
    if (this.spectrumDirty) this.updateSpectrum();
    const N = this.size;
    const log2N = Math.round(Math.log2(N));
    const p = this.params;
    for (const c of this.cascades) {
      // Zaman evrimi
      const tu = this.timeMat.uniforms;
      tu.uH0.value = c.h0.texture;
      tu.uN.value = N;
      tu.uL.value = c.L;
      tu.uTime.value = this.time;
      this.run(this.timeMat, this.pingA);
      // FFT: önce yatay, sonra dikey
      let src = this.pingA, dst = this.pingB;
      const fu = this.fftMat.uniforms;
      fu.uN.value = N;
      for (let dir = 1; dir >= 0; dir--) {
        fu.uHoriz.value = dir;
        for (let s = 1; s <= log2N; s++) {
          fu.uSub.value = 1 << s;
          fu.uIn0.value = src.textures[0];
          fu.uIn1.value = src.textures[1];
          this.run(this.fftMat, dst);
          const t = src; src = dst; dst = t;
        }
      }
      // Birleştir + köpük
      const au = this.assembleMat.uniforms;
      const prev = c.outs[c.cur];
      const next = c.outs[1 - c.cur];
      au.uF0.value = src.textures[0];
      au.uF1.value = src.textures[1];
      au.uPrev.value = prev.textures[0];
      au.uLambda.value = p.choppiness;
      au.uDt.value = Math.min(dt, 0.1);
      au.uFoamDecay.value = p.foamDecay;
      au.uFoamBias.value = p.foamBias;
      au.uFoamAdd.value = 0.02 * p.foamAmount;
      this.run(this.assembleMat, next);
      c.cur = 1 - c.cur;
    }
    this.renderer.setRenderTarget(null);
  }

  get dispTextures() { return this.cascades.map((c) => c.outs[c.cur].textures[0]); }
  get derivTextures() { return this.cascades.map((c) => c.outs[c.cur].textures[1]); }

  // Dünya xz noktalarında su yüksekliği sorgusu (asenkron, bir kare gecikmeli)
  query(points) {
    const qu = this.queryMat.uniforms;
    const disp = this.dispTextures, der = this.derivTextures;
    qu.uDisp0.value = disp[0]; qu.uDisp1.value = disp[1]; qu.uDisp2.value = disp[2];
    qu.uDeriv0.value = der[0]; qu.uDeriv1.value = der[1]; qu.uDeriv2.value = der[2];
    for (let i = 0; i < 8; i++) {
      const pt = points[i] || points[0];
      qu.uPoints.value[i].set(pt[0], pt[1]);
    }
    this.run(this.queryMat, this.queryTarget);
    this.renderer.setRenderTarget(null);
    if (this.queryPending) return;
    this.queryPending = true;
    this.renderer.readRenderTargetPixelsAsync(this.queryTarget, 0, 0, 8, 1, this.queryBuffer)
      .then(() => { this.queryResults.set(this.queryBuffer); })
      .catch(() => {})
      .finally(() => { this.queryPending = false; });
  }

  heightAt(i) { return this.queryResults[i * 4]; }
  slopeAt(i) { return [this.queryResults[i * 4 + 1], this.queryResults[i * 4 + 2]]; }

  // Spektrumun sayısal integraliyle belirgin dalga yüksekliği (Hs)
  significantWaveHeight() {
    const p = this.params;
    const U = Math.max(0.5, p.windSpeed), F = p.fetch * 1000;
    const jon = (w, U, F, gamma) => {
      const wp = 22 * Math.cbrt(G * G / (U * F));
      const alpha = 0.076 * Math.pow(U * U / (F * G), 0.22);
      const sigma = w <= wp ? 0.07 : 0.09;
      const r = Math.exp(-((w - wp) ** 2) / (2 * sigma * sigma * wp * wp));
      return alpha * G * G / w ** 5 * Math.exp(-1.25 * (wp / w) ** 4) * Math.pow(gamma, r);
    };
    let v = 0;
    const kMin = 2 * Math.PI / this.lengths[0];
    const w0 = Math.sqrt(G * kMin), w1 = 30;
    const n = 2000;
    const dw = (w1 - w0) / n;
    for (let i = 0; i < n; i++) {
      const w = w0 + (i + 0.5) * dw;
      const k = w * w / G;
      const cut = Math.exp(-k * k * 0.0004);
      let S = jon(w, U, F, p.gamma);
      if (p.swell > 0) S += 0.06 * p.swell * p.swell * jon(w, p.swellWind, 900e3, 5.0);
      v += S * cut * dw;
    }
    return 4 * Math.sqrt(v) * p.amplitude;
  }

  dispose(keepMaterials = false) {
    if (this.cascades) {
      for (const c of this.cascades) {
        c.noise.dispose(); c.h0.dispose(); c.outs.forEach((o) => o.dispose());
      }
      this.pingA.dispose(); this.pingB.dispose();
      this.cascades = null;
    }
    if (!keepMaterials) {
      [this.initMat, this.timeMat, this.fftMat, this.assembleMat, this.queryMat].forEach((m) => m.dispose());
      this.queryTarget.dispose();
    }
  }
}
