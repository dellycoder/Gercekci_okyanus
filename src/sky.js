// Fiziksel atmosfer gökyüzü: LUT (Rayleigh + Mie + ozon, Güneş ve Ay), bulutlar, yıldızlar, Samanyolu,
// evreli Ay diski ve ufuk ötesi uzak okyanus.
import * as THREE from 'three';
import { NOISE, SKY_MAPPING, ATMOSPHERE, SKY_COMMON, STARS } from './shaders/common.js';

const LUT_VS = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const LUT_FS = /* glsl */ `
precision highp float;
precision highp sampler2D;
${NOISE}
${SKY_MAPPING}
${ATMOSPHERE}
${SKY_COMMON}
uniform float uSunI;
uniform float uMoonI;
uniform vec3 uCamPos;
in vec2 vUv;
layout(location = 0) out vec4 oAtmo;
layout(location = 1) out vec4 oFull;
void main() {
  vec3 rd = skyUVToDir(vUv);
  // Ufkun altı: gezegene çarpan kısa ışınlar yerine ufuk rengini kullan (uzak okyanus/sis için)
  vec3 ra = normalize(vec3(rd.x, max(rd.y, 0.0015), rd.z));
  vec3 atmo = atmosphere(ra, 2.0, uSunDir, uSunI, uMoonDir, uMoonI);
  // Kapalı havada gökyüzü griye döner ve kararır
  float oc = smoothstep(0.55, 1.0, uCloudCoverage) * min(uCloudDensity, 2.0) * 0.5;
  float al = dot(atmo, vec3(0.2126, 0.7152, 0.0722));
  atmo = mix(atmo, vec3(al) * vec3(0.92, 0.96, 1.0) * 0.55, clamp(oc, 0.0, 0.9));
  atmo += vec3(0.6, 0.65, 0.8) * uLightning * 0.4;
  oAtmo = vec4(atmo, 1.0);
  vec4 cl = renderClouds(vec3(uCamPos.x, 2.0, uCamPos.z), rd, atmo);
  oFull = vec4(atmo * (1.0 - cl.a) + cl.rgb, 1.0);
}
`;

const DOME_VS = /* glsl */ `
uniform mat4 uInvViewProj;
varying vec3 vDir;
void main() {
  vec4 p = vec4(position.xy, 1.0, 1.0);
  vec4 w = uInvViewProj * p;
  vDir = w.xyz / w.w - cameraPosition;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const DOME_FS = /* glsl */ `
${NOISE}
${SKY_MAPPING}
${SKY_COMMON}
${STARS}
uniform float uMoonIllum;
uniform float uMoonDiscIntensity;
uniform float uSunDiscScale;
uniform float uStarBrightness;
uniform vec3 uDeepColor;
varying vec3 vDir;

vec3 moonDisc(vec3 rd, out float mask) {
  const float R = 0.0048;
  mask = 0.0;
  float cd = dot(rd, uMoonDir);
  if (cd < cos(R * 1.6)) return vec3(0.0);
  vec3 right = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, uMoonDir);
  vec2 q = vec2(dot(rd, right), dot(rd, up)) / R;
  float r2 = dot(q, q);
  float edge = 1.0 - smoothstep(0.92, 1.0, sqrt(r2));
  if (edge <= 0.0) return vec3(0.0);
  mask = edge;
  vec3 n = normalize(q.x * right + q.y * up - sqrt(max(1.0 - r2, 0.0)) * uMoonDir);
  float lit = smoothstep(-0.03, 0.12, dot(n, uSunDir));
  // Denizler (maria) ve kraterler
  float maria = fbm4(q * 1.6 + 2.0);
  float albedo = mix(0.55, 1.0, smoothstep(0.35, 0.65, maria));
  albedo *= 0.85 + 0.15 * vnoise(q * 14.0);
  float limb = mix(0.75, 1.0, sqrt(max(1.0 - r2, 0.0)));
  vec3 base = vec3(1.0, 0.97, 0.9) * albedo * limb;
  return base * (lit + 0.004) * edge; // çok hafif dünya ışığı
}

vec3 skyColor(vec3 rd) {
  vec3 atmo = sampleSky(uSkyAtmo, rd, 0.0);
  float vis = smoothstep(-0.02, 0.12, rd.y);
  // Yıldızlar yalnızca karanlık gökyüzünde görünür
  float lum = dot(atmo, vec3(0.2126, 0.7152, 0.0722));
  float starVis = exp(-lum * 250.0) * vis;
  vec3 col = atmo + uNightAmbient * 0.6;
  col += nightSky(rd) * starVis * uStarBrightness;
  // Güneş diski (kenar kararması)
  float cs = dot(rd, uSunDir);
  float sunR = 0.00465 * uSunDiscScale;
  float ang = acos(clamp(cs, -1.0, 1.0));
  if (ang < sunR * 1.2) {
    float x = clamp(ang / sunR, 0.0, 1.0);
    float mu = sqrt(max(1.0 - x * x, 0.0));
    float limb = 1.0 - 0.6 * (1.0 - mu);
    float disc = 1.0 - smoothstep(0.93, 1.05, ang / sunR);
    col += uSunColor * 900.0 * limb * disc;
  }
  float mm;
  vec3 moon = moonDisc(rd, mm) * uMoonDiscIntensity;
  col = mix(col, atmo + moon, mm * vis);
  vec4 cl = renderClouds(cameraPosition, rd, atmo);
  col = col * (1.0 - cl.a) + cl.rgb;
  return col;
}

void main() {
  vec3 rd = normalize(vDir);
  float camH = max(cameraPosition.y, 1.0);
  // Ufuk çizgisinin gerçek eğimi (dünya eğriliği)
  float horizonDip = -sqrt(2.0 * camH / 6371e3);
  vec3 col;
  if (rd.y > horizonDip) {
    col = skyColor(rd);
  } else {
    // Ufuk ötesi uzak okyanus (düz yansıyan deniz)
    float NV = max(-rd.y, 0.0005);
    float F = 0.02 + 0.98 * pow(1.0 - NV, 5.0);
    vec3 R = normalize(vec3(rd.x, -rd.y + 0.002, rd.z));
    vec3 refl = sampleSky(uSkyFull, R, 2.0);
    vec3 water = uDeepColor * skyAmbient();
    col = mix(water, refl, F * 0.85);
    float d = camH / max(-rd.y, 1e-4);
    col = mix(col, horizonFogColor(rd), 1.0 - exp(-d * uFogDensity));
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  constructor(renderer, shared) {
    this.renderer = renderer;
    this.shared = shared;
    this.lutSize = [512, 256];
    // Bulutlar ortam ışığını bir önceki LUT'tan okur: geri besleme döngüsünü önlemek için iki hedef
    const mkLut = () => {
      const rt = new THREE.WebGLRenderTarget(this.lutSize[0], this.lutSize[1], {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, count: 2,
        minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, generateMipmaps: true,
      });
      rt.textures.forEach((t) => { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; });
      return rt;
    };
    this.luts = [mkLut(), mkLut()];
    this.lutIndex = 0;
    this.lut = this.luts[0];
    shared.uSkyAtmo.value = this.lut.textures[0];
    shared.uSkyFull.value = this.lut.textures[1];

    this.lutMat = new THREE.RawShaderMaterial({
      vertexShader: LUT_VS, fragmentShader: LUT_FS, glslVersion: THREE.GLSL3,
      uniforms: {
        ...shared,
        uSunI: { value: 20 }, uMoonI: { value: 0 }, uCamPos: { value: new THREE.Vector3() },
      },
      depthTest: false, depthWrite: false,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.lutScene = new THREE.Scene();
    this.lutCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const q = new THREE.Mesh(tri, this.lutMat);
    q.frustumCulled = false;
    this.lutScene.add(q);

    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VS, fragmentShader: DOME_FS,
      uniforms: {
        ...shared,
        uInvViewProj: { value: new THREE.Matrix4() },
        uSunDiscScale: { value: 1.0 },
        uStarBrightness: { value: 1.0 },
        uMoonDiscIntensity: { value: 1.0 },
      },
      depthTest: false, depthWrite: false,
    });
    this.dome = new THREE.Mesh(tri, this.domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
  }

  renderLUT(camera, sunI, moonI) {
    const u = this.lutMat.uniforms;
    u.uSunI.value = sunI;
    u.uMoonI.value = moonI;
    u.uCamPos.value.copy(camera.position);
    // Paylaşılan uniformlar hâlâ önceki LUT'u gösteriyor; yenisine yaz
    this.lutIndex = 1 - this.lutIndex;
    const target = this.luts[this.lutIndex];
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.lutScene, this.lutCam);
    this.renderer.setRenderTarget(null);
    this.lut = target;
    this.shared.uSkyAtmo.value = target.textures[0];
    this.shared.uSkyFull.value = target.textures[1];
  }

  updateDome(camera) {
    const m = this.domeMat.uniforms.uInvViewProj.value;
    m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
  }
}

// ---- CPU tarafı: güneş/ay ışığının atmosferden geçirgenliği (ışık rengi için) ----
const BR = [5.802e-6, 13.558e-6, 33.1e-6];
const BO = [0.650e-6, 1.881e-6, 0.085e-6];
export function transmittance(dir, mie) {
  const R = 6371e3, RA = 6471e3;
  const ro = [0, R + 2, 0];
  const b = ro[1] * dir[1];
  const c = ro[1] * ro[1] - RA * RA;
  const len = -b + Math.sqrt(b * b - c);
  // Güneş diski ufuk altına inerken yumuşak geçiş (gezegen gölgesi)
  const n = 48;
  let odR = 0, odM = 0, odO = 0;
  const ds = len / n;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * ds;
    const x = dir[0] * t, y = ro[1] + dir[1] * t, z = dir[2] * t;
    const h = Math.sqrt(x * x + y * y + z * z) - R;
    odR += Math.exp(-h / 8000) * ds;
    odM += Math.exp(-h / 1200) * ds;
    odO += Math.max(0, 1 - Math.abs(h - 25000) / 15000) * ds;
  }
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) out[k] = Math.exp(-(BR[k] * odR + mie * 1.11 * odM + BO[k] * odO));
  return out;
}
