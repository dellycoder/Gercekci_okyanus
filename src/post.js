// Son işleme: su altı ışık soğurması + hacimsel ışık huzmeleri (god rays), bloom, ACES ton eşleme,
// gece görüşü (Purkinje) kayması, vinyet ve titreme (dither).
import * as THREE from 'three';
import { NOISE, SKY_MAPPING, SKY_COMMON } from './shaders/common.js';

const VS = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const UNDERWATER_FS = /* glsl */ `
precision highp float;
precision highp sampler2D;
${NOISE}
${SKY_MAPPING}
${SKY_COMMON}
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uNear;
uniform float uFar;
uniform sampler2D uDisp0;
uniform sampler2D uDisp1;
uniform sampler2D uDisp2;
uniform vec3 uLengths;
uniform vec3 uAbsorb;
uniform vec3 uKd;
uniform vec3 uScatterTint;
uniform float uGodRays;
uniform float uActive;
in vec2 vUv;
out vec4 outColor;

vec3 disp(vec2 p) {
  return textureLod(uDisp0, p / uLengths.x, 0.0).xyz + textureLod(uDisp1, p / uLengths.y, 0.0).xyz
       + textureLod(uDisp2, p / uLengths.z, 0.0).xyz;
}
float waterHeight(vec2 xz) {
  vec2 p = xz;
  for (int i = 0; i < 3; i++) { vec3 d = disp(p); p = xz - d.xz; }
  return disp(p).y;
}
float shaftPattern(vec2 p) {
  float t = uTime;
  float a = vnoise(p * 0.45 + vec2(t * 0.25, t * 0.12));
  float b = vnoise(p * 1.1 - vec2(t * 0.18, -t * 0.3));
  float s = a * b;
  return s * s * 5.0;
}
void main() {
  vec3 c = texture(tColor, vUv).rgb;
  if (uActive < 0.5) { outColor = vec4(c, 1.0); return; }
  vec4 vn = uInvProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
  vn /= vn.w;
  vec3 nearW = (uCamWorld * vec4(vn.xyz, 1.0)).xyz;
  vec3 rd = normalize(nearW - uCamPos);
  float wh = waterHeight(nearW.xz);
  float dh = nearW.y - wh;
  if (dh > 0.025) { outColor = vec4(c, 1.0); return; }

  // Su altı bozulması
  vec2 wob = vec2(sin(vUv.y * 40.0 + uTime * 1.7), cos(vUv.x * 33.0 + uTime * 1.3)) * 0.0012;
  if (dh < 0.0) c = texture(tColor, vUv + wob).rgb;

  float z = texture(tDepth, vUv).r;
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  vp /= vp.w;
  float dist = z >= 0.99999 ? 2000.0 : length(vp.xyz);
  dist = max(dist - length(vn.xyz), 0.0);

  vec3 Lr = refract(-uSunDir, vec3(0.0, 1.0, 0.0), 1.0 / 1.333);
  vec3 toSun = uSunDir.y > 0.0 ? -Lr : vec3(0.0, 1.0, 0.0);
  float camDepth = max(0.0, -nearW.y);
  vec3 mid = nearW + rd * min(dist, 30.0) * 0.5;
  float midDepth = max(0.0, -mid.y);
  float mu = dot(rd, toSun);
  float phase = 0.35 + 2.5 * pow(max(mu, 0.0), 6.0);
  vec3 E = uSunColor * max(toSun.y, 0.0) * cloudShadow(vec3(uCamPos.x, 0.0, uCamPos.z)) * 0.05 * phase
         + skyAmbient() * 0.5 + uMoonColor * 0.15;
  vec3 Linf = uScatterTint * E * exp(-uKd * midDepth);
  vec3 T = exp(-uAbsorb * dist);
  vec3 col = c * T + Linf * (1.0 - T);

  // Hacimsel ışık huzmeleri
  if (uGodRays > 0.0 && (uSunColor.g + uMoonColor.g) > 1e-4) {
    const int S = 28;
    float maxD = min(dist, 55.0);
    float stepL = maxD / float(S);
    float j = hash12(gl_FragCoord.xy + fract(uTime) * 100.0);
    vec3 acc = vec3(0.0);
    for (int i = 0; i < S; i++) {
      float t = (float(i) + j) * stepL;
      vec3 p = nearW + rd * t;
      float dp = max(0.0, -p.y);
      vec2 sp = p.xz + toSun.xz / max(toSun.y, 0.25) * dp;
      float sh = shaftPattern(sp);
      acc += exp(-uKd * dp - uAbsorb * t) * sh;
    }
    float hg = 0.08 + 1.4 * pow(max(mu, 0.0), 8.0);
    col += acc * stepL * (uSunColor + uMoonColor * 3.0) * hg * 0.004 * uGodRays;
  }

  // Su çizgisi (menisküs)
  float men = exp(-abs(dh) / 0.006);
  col *= 1.0 - 0.55 * men;
  float blend = smoothstep(0.025, 0.0, dh);
  outColor = vec4(mix(c, col, blend), 1.0);
}
`;

const DOWN_FS = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uKaris;
in vec2 vUv;
out vec4 outColor;
float lumaW(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
void main() {
  vec2 t = uTexel;
  vec3 a = texture(tSrc, vUv + t * vec2(-2, 2)).rgb;
  vec3 b = texture(tSrc, vUv + t * vec2(0, 2)).rgb;
  vec3 c = texture(tSrc, vUv + t * vec2(2, 2)).rgb;
  vec3 d = texture(tSrc, vUv + t * vec2(-2, 0)).rgb;
  vec3 e = texture(tSrc, vUv).rgb;
  vec3 f = texture(tSrc, vUv + t * vec2(2, 0)).rgb;
  vec3 g = texture(tSrc, vUv + t * vec2(-2, -2)).rgb;
  vec3 h = texture(tSrc, vUv + t * vec2(0, -2)).rgb;
  vec3 i = texture(tSrc, vUv + t * vec2(2, -2)).rgb;
  vec3 j = texture(tSrc, vUv + t * vec2(-1, 1)).rgb;
  vec3 k = texture(tSrc, vUv + t * vec2(1, 1)).rgb;
  vec3 l = texture(tSrc, vUv + t * vec2(-1, -1)).rgb;
  vec3 m = texture(tSrc, vUv + t * vec2(1, -1)).rgb;
  vec3 col;
  if (uKaris > 0.5) {
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = lumaW(g0), w1 = lumaW(g1), w2 = lumaW(g2), w3 = lumaW(g3), w4 = lumaW(g4);
    col = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5)
        / (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
    col = min(col, vec3(4000.0));
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  outColor = vec4(col, 1.0);
}
`;

const UP_FS = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uRadius;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 s = texture(tSrc, vUv).rgb * 4.0;
  s += (texture(tSrc, vUv + vec2(t.x, 0)).rgb + texture(tSrc, vUv - vec2(t.x, 0)).rgb
      + texture(tSrc, vUv + vec2(0, t.y)).rgb + texture(tSrc, vUv - vec2(0, t.y)).rgb) * 2.0;
  s += texture(tSrc, vUv + t).rgb + texture(tSrc, vUv - t).rgb
     + texture(tSrc, vUv + vec2(t.x, -t.y)).rgb + texture(tSrc, vUv + vec2(-t.x, t.y)).rgb;
  outColor = vec4(s / 16.0, 1.0);
}
`;

const COMPOSITE_FS = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uExposure;
uniform float uBloom;
uniform float uNight;
uniform float uVignette;
uniform float uSaturation;
uniform float uContrast;
uniform float uTime;
uniform float uUnderwater;
uniform vec2 uResolution;
in vec2 vUv;
out vec4 outColor;
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 ACESFitted(vec3 color) {
  const mat3 ACESInputMat = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 ACESOutputMat = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 col = texture(tScene, vUv).rgb;
  vec3 bl = texture(tBloom, vUv).rgb;
  col = mix(col, bl, uBloom);
  col *= uExposure;
  // Karanlıkta mavimsi skotopik görüş
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float scot = uNight * (1.0 - smoothstep(0.02, 0.6, lum));
  col = mix(col, vec3(0.55, 0.7, 1.0) * lum * 1.15, scot * 0.55);
  col = ACESFitted(col * 1.1);
  float l2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l2), col, uSaturation);
  col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);
  vec2 q = vUv - 0.5;
  q.x *= uResolution.x / uResolution.y;
  float v = 1.0 - uVignette * smoothstep(0.35, 1.1, length(q));
  col *= v;
  col = toSRGB(col);
  col += (hash(vUv * uResolution + fract(uTime)) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}
`;

export class PostFX {
  constructor(renderer, shared) {
    this.renderer = renderer;
    this.shared = shared;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(tri);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    const mk = (fs, uniforms, extra = {}) => new THREE.RawShaderMaterial({
      vertexShader: VS, fragmentShader: fs, uniforms, glslVersion: THREE.GLSL3,
      depthTest: false, depthWrite: false, ...extra,
    });
    this.uwMat = mk(UNDERWATER_FS, {
      ...shared,
      tColor: { value: null }, tDepth: { value: null },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() }, uNear: { value: 0.1 }, uFar: { value: 1000 },
      uDisp0: { value: null }, uDisp1: { value: null }, uDisp2: { value: null },
      uLengths: { value: new THREE.Vector3() },
      uGodRays: { value: 1 }, uActive: { value: 0 },
    });
    this.downMat = mk(DOWN_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 } });
    this.upMat = mk(UP_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } }, {
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true,
    });
    this.compMat = mk(COMPOSITE_FS, {
      tScene: { value: null }, tBloom: { value: null }, uExposure: { value: 1 }, uBloom: { value: 0.05 },
      uNight: { value: 0 }, uVignette: { value: 0.25 }, uSaturation: { value: 1.05 }, uContrast: { value: 1.03 },
      uTime: { value: 0 }, uUnderwater: { value: 0 }, uResolution: { value: new THREE.Vector2(1, 1) },
    });
    this.bloomLevels = 7;
    this.msaa = 4;
    this.bloomEnabled = true;
  }

  setSize(w, h, msaa) {
    this.width = w; this.height = h; this.msaa = msaa;
    this.sceneRT?.dispose();
    this.uwRT?.dispose();
    (this.bloomRTs || []).forEach((r) => r.dispose());
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples: msaa,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthTexture, depthBuffer: true,
    });
    this.uwRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.bloomRTs = [];
    let bw = w, bh = h;
    for (let i = 0; i < this.bloomLevels; i++) {
      bw = Math.max(1, Math.floor(bw / 2)); bh = Math.max(1, Math.floor(bh / 2));
      this.bloomRTs.push(new THREE.WebGLRenderTarget(bw, bh, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      }));
    }
  }

  run(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  render(scene, camera, sim, opts) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.clear(true, true, false);
    r.render(scene, camera);

    // Su altı
    const u = this.uwMat.uniforms;
    u.tColor.value = this.sceneRT.texture;
    u.tDepth.value = this.sceneRT.depthTexture;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uCamPos.value.copy(camera.position);
    u.uNear.value = camera.near; u.uFar.value = camera.far;
    const d = sim.dispTextures;
    u.uDisp0.value = d[0]; u.uDisp1.value = d[1]; u.uDisp2.value = d[2];
    u.uLengths.value.set(...sim.lengths);
    u.uGodRays.value = opts.godRays;
    u.uActive.value = opts.nearWater ? 1 : 0;
    let src = this.sceneRT.texture;
    if (opts.nearWater) {
      this.run(this.uwMat, this.uwRT);
      src = this.uwRT.texture;
    }

    // Bloom
    if (this.bloomEnabled && opts.bloom > 0) {
      let s = src;
      let sw = this.width, sh = this.height;
      for (let i = 0; i < this.bloomLevels; i++) {
        const dm = this.downMat.uniforms;
        dm.tSrc.value = s;
        dm.uTexel.value.set(1 / sw, 1 / sh);
        dm.uKaris.value = i === 0 ? 1 : 0;
        this.run(this.downMat, this.bloomRTs[i]);
        s = this.bloomRTs[i].texture;
        sw = this.bloomRTs[i].width; sh = this.bloomRTs[i].height;
      }
      for (let i = this.bloomLevels - 1; i > 0; i--) {
        const um = this.upMat.uniforms;
        um.tSrc.value = this.bloomRTs[i].texture;
        um.uTexel.value.set(1 / this.bloomRTs[i].width, 1 / this.bloomRTs[i].height);
        um.uRadius.value = 1.0;
        this.run(this.upMat, this.bloomRTs[i - 1]);
      }
    }

    const c = this.compMat.uniforms;
    c.tScene.value = src;
    c.tBloom.value = this.bloomRTs[0].texture;
    c.uExposure.value = opts.exposure;
    c.uBloom.value = this.bloomEnabled ? opts.bloom : 0;
    c.uNight.value = opts.night;
    c.uVignette.value = opts.vignette;
    c.uSaturation.value = opts.saturation;
    c.uContrast.value = opts.contrast;
    c.uTime.value = opts.time;
    c.uResolution.value.set(this.width, this.height);
    this.run(this.compMat, null);
  }
}
