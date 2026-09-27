// Paylaşılan GLSL parçaları: gürültü, atmosferik saçılım, bulutlar, yıldızlar, kostikler.

export const NOISE = /* glsl */ `
#ifndef PI
#define PI 3.14159265359
#define TAU 6.28318530718
#endif
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
const mat2 FBM_ROT = mat2(0.80, 0.60, -0.60, 0.80);
float fbm4(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = FBM_ROT * p * 2.03; a *= 0.5; }
  return s / 0.9375;
}
float fbm6(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = FBM_ROT * p * 2.01; a *= 0.5; }
  return s / 0.984375;
}
`;

// Gökyüzü LUT'u için eşdikdörtgen eşleme (ufuk yakınında daha yoğun örnekleme)
export const SKY_MAPPING = /* glsl */ `
vec2 dirToSkyUV(vec3 d) {
  float u = atan(d.z, d.x) / TAU + 0.5;
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(lat) * sqrt(abs(lat) / (0.5 * PI));
  return vec2(u, v);
}
vec3 skyUVToDir(vec2 uv) {
  float x = uv.y * 2.0 - 1.0;
  float lat = sign(x) * x * x * 0.5 * PI;
  float phi = (uv.x - 0.5) * TAU;
  return vec3(cos(lat) * cos(phi), sin(lat), cos(lat) * sin(phi));
}
`;

export const ATMOSPHERE = /* glsl */ `
const float R_PLANET = 6371e3;
const float R_ATMOS = 6471e3;
const vec3 BETA_R = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const vec3 BETA_O = vec3(0.650e-6, 1.881e-6, 0.085e-6);
const float H_R = 8000.0;
const float H_M = 1200.0;
uniform float uMie;      // Mie saçılım katsayısı (pus)
uniform float uMieG;

vec2 rsi(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}
float ozoneDensity(float h) { return max(0.0, 1.0 - abs(h - 25000.0) / 15000.0); }

vec3 lightOpticalDepth(vec3 p, vec3 L) {
  vec2 g = rsi(p, L, R_PLANET);
  if (g.x > 0.0) return vec3(1e6);
  float len = rsi(p, L, R_ATMOS).y;
  const int N = 6;
  float ds = len / float(N);
  vec3 od = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 q = p + L * ((float(i) + 0.5) * ds);
    float h = length(q) - R_PLANET;
    od += vec3(exp(-h / H_R), exp(-h / H_M), ozoneDensity(h));
  }
  return od * ds;
}
float phaseRayleigh(float mu) { return 3.0 / (16.0 * PI) * (1.0 + mu * mu); }
float phaseMie(float mu, float g) {
  float g2 = g * g;
  return 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) /
         ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}

// İki ışık kaynağı (Güneş + Ay) için tek saçılımlı atmosfer
vec3 atmosphere(vec3 rd, float camH, vec3 L1, float I1, vec3 L2, float I2) {
  vec3 ro = vec3(0.0, R_PLANET + max(camH, 1.0), 0.0);
  float tmax = rsi(ro, rd, R_ATMOS).y;
  vec2 g = rsi(ro, rd, R_PLANET);
  if (g.x > 0.0) tmax = min(tmax, g.x);
  const int STEPS = 20;
  vec3 odView = vec3(0.0);
  vec3 sR1 = vec3(0.0), sM1 = vec3(0.0), sR2 = vec3(0.0), sM2 = vec3(0.0);
  float mieExt = uMie * 1.11;
  float prevT = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float f = (float(i) + 1.0) / float(STEPS);
    float t = tmax * f * f;
    float ds = t - prevT;
    float tm = 0.5 * (t + prevT);
    prevT = t;
    vec3 p = ro + rd * tm;
    float h = length(p) - R_PLANET;
    vec3 dens = vec3(exp(-h / H_R), exp(-h / H_M), ozoneDensity(h)) * ds;
    odView += dens;
    vec3 od1 = lightOpticalDepth(p, L1);
    vec3 att1 = exp(-(BETA_R * (odView.x + od1.x) + mieExt * (odView.y + od1.y) + BETA_O * (odView.z + od1.z)));
    sR1 += dens.x * att1;
    sM1 += dens.y * att1;
    if (I2 > 0.0) {
      vec3 od2 = lightOpticalDepth(p, L2);
      vec3 att2 = exp(-(BETA_R * (odView.x + od2.x) + mieExt * (odView.y + od2.y) + BETA_O * (odView.z + od2.z)));
      sR2 += dens.x * att2;
      sM2 += dens.y * att2;
    }
  }
  float mu1 = dot(rd, L1);
  float mu2 = dot(rd, L2);
  vec3 c = I1 * (phaseRayleigh(mu1) * BETA_R * sR1 + phaseMie(mu1, uMieG) * uMie * sM1);
  c += I2 * (phaseRayleigh(mu2) * BETA_R * sR2 + phaseMie(mu2, uMieG) * uMie * sM2);
  // Çoklu saçılım yaklaşımı: gökyüzüne yumuşak dolgu ışığı (alacakaranlıkta önemli)
  c += (I1 * (BETA_R * sR1 + uMie * sM1) + I2 * (BETA_R * sR2 + uMie * sM2)) * 0.012;
  return c;
}
`;

// Tüm sahne malzemelerinin paylaştığı aydınlatma/gökyüzü uniformları
export const SKY_COMMON = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;     // deniz seviyesinde güneş ışınımı
uniform vec3 uMoonColor;    // deniz seviyesinde ay ışınımı
uniform float uTime;
uniform sampler2D uSkyAtmo; // yalnız atmosfer
uniform sampler2D uSkyFull; // atmosfer + bulut
uniform float uFogDensity;
uniform float uCloudCoverage;
uniform float uCloudDensity;
uniform vec2 uCloudOffset;
uniform float uLightning;
uniform vec3 uNightAmbient;
const float CLOUD_ALT = 2600.0;

vec3 sampleSky(sampler2D tex, vec3 d, float lod) {
  return textureLod(tex, dirToSkyUV(d), lod).rgb;
}
vec3 skyAmbient() {
  return textureLod(uSkyFull, vec2(0.5, 0.93), 6.0).rgb * 1.2 + uNightAmbient + vec3(0.55, 0.6, 0.8) * uLightning * 0.8;
}
vec3 horizonFogColor(vec3 rd) {
  vec3 h = normalize(vec3(rd.x, max(rd.y, 0.0) * 0.5 + 0.015, rd.z));
  return sampleSky(uSkyAtmo, h, 2.0) + uNightAmbient * 0.5;
}

float cloudMap(vec2 p) {
  vec2 q = (p + uCloudOffset) * 0.00011;
  vec2 w = vec2(fbm4(q * 0.6 + vec2(3.1, 1.7)), fbm4(q * 0.6 + vec2(7.7, 4.3)));
  float n = fbm6(q + (w - 0.5) * 1.2);
  float t = mix(0.78, 0.18, uCloudCoverage);
  return smoothstep(t, t + 0.28, n);
}
float cloudMapLo(vec2 p) {
  vec2 q = (p + uCloudOffset) * 0.00011;
  vec2 w = vec2(fbm4(q * 0.6 + vec2(3.1, 1.7)), fbm4(q * 0.6 + vec2(7.7, 4.3)));
  float n = fbm4(q + (w - 0.5) * 1.2);
  float t = mix(0.78, 0.18, uCloudCoverage);
  return smoothstep(t, t + 0.3, n);
}
float hgPhase(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}

// Bulut katmanı: premultiplied (renk * alfa, alfa)
vec4 renderClouds(vec3 camPos, vec3 rd, vec3 atmoCol) {
  if (rd.y <= 0.0 || uCloudCoverage <= 0.001) return vec4(0.0);
  float r0 = 6371e3 + camPos.y;
  float b = r0 * rd.y;
  float rc = 6371e3 + CLOUD_ALT;
  float t = -b + sqrt(b * b - r0 * r0 + rc * rc);
  vec2 p = camPos.xz + rd.xz * t;
  float d = cloudMap(p);
  if (d <= 0.002) return vec4(0.0);
  float dens = uCloudDensity;

  vec3 col = vec3(0.0);
  // Güneş
  if (uSunColor.r + uSunColor.g + uSunColor.b > 1e-4) {
    vec2 sd = normalize(uSunDir.xz + 1e-5);
    float s1 = cloudMapLo(p + sd * 180.0);
    float s2 = cloudMapLo(p + sd * 520.0);
    float shade = exp(-(s1 * 1.2 + s2 * 0.8) * dens * 1.8);
    float mu = dot(rd, uSunDir);
    float phase = mix(hgPhase(mu, 0.65), hgPhase(mu, -0.15), 0.4) * 4.0 * PI;
    float thick = exp(-d * dens * 1.4);
    float powder = 1.0 - exp(-d * dens * 4.0);
    col += uSunColor * (0.16 * shade * thick * (0.55 + 0.9 * phase) * mix(0.6, 1.0, powder) + 0.035 * shade);
  }
  // Ay
  if (uMoonColor.r > 1e-6) {
    float mu = dot(rd, uMoonDir);
    float phase = mix(hgPhase(mu, 0.65), hgPhase(mu, -0.15), 0.4) * 4.0 * PI;
    col += uMoonColor * 0.16 * exp(-d * dens * 1.4) * (0.55 + 0.9 * phase);
  }
  vec3 amb = skyAmbient();
  amb = mix(amb, vec3(dot(amb, vec3(0.2126, 0.7152, 0.0722))), 0.55);
  col += amb * (1.05 - 0.6 * d * min(dens, 1.6));
  col += vec3(0.75, 0.8, 1.0) * uLightning * (1.5 + 3.0 * d);
  float a = 1.0 - exp(-d * dens * 3.5);
  // Uzaklıkla atmosferik perspektif
  float haze = 1.0 - exp(-t / 38000.0);
  col = mix(col, atmoCol, haze);
  a *= smoothstep(0.0, 0.035, rd.y) * exp(-t / 160000.0);
  return vec4(col * a, a);
}

// Bulut gölgesi (yüzeydeki bir nokta için güneş yönünde)
float cloudShadow(vec3 wp) {
  if (uCloudCoverage <= 0.001) return 1.0;
  vec3 L = uSunDir.y > 0.05 ? uSunDir : normalize(vec3(uSunDir.x, 0.05, uSunDir.z));
  vec2 p = wp.xz + L.xz / L.y * (CLOUD_ALT - wp.y);
  float d = cloudMapLo(p);
  return mix(1.0, exp(-d * uCloudDensity * 2.2), 0.92);
}
`;

export const CAUSTICS = /* glsl */ `
float causticPattern(vec2 p, float t) {
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 7.0);
}
float caustics(vec2 xz, float t) {
  vec2 p = mod(xz * 0.9, TAU) - 250.0;
  float a = causticPattern(p, t * 0.6);
  float b = causticPattern(mod(xz * 0.53 + 1.7, TAU) - 250.0, t * 0.45 + 3.0);
  return min(a * 0.6 + b * 0.5, 3.0);
}
`;

export const STARS = /* glsl */ `
uniform mat3 uWorldToEq;
uniform float uPixelAngle;
vec3 starColor(float h) {
  vec3 a = vec3(0.62, 0.72, 1.0);
  vec3 b = vec3(1.0, 0.97, 0.92);
  vec3 c = vec3(1.0, 0.72, 0.45);
  return h < 0.5 ? mix(a, b, h * 2.0) : mix(b, c, (h - 0.5) * 2.0);
}
vec3 starLayer(vec3 d, float scale, float density, float boost) {
  vec3 p = d * scale;
  vec3 id = floor(p);
  vec3 h = hash33(id);
  if (h.x > density) return vec3(0.0);
  vec3 sp = id + 0.25 + 0.5 * hash33(id + 17.31);
  vec3 dv = sp / length(sp) - d;
  float dist = length(dv);
  float px = max(uPixelAngle, 1e-5) * 0.7;
  float core = exp(-dist * dist / (px * px));
  float mag = pow(h.y, 16.0) * 30.0 + 0.02 * h.y;
  float tw = 0.75 + 0.25 * sin(uTime * (4.0 + 6.0 * h.z) + h.x * 90.0);
  return starColor(h.z) * core * mag * tw * boost;
}
vec3 milkyWay(vec3 e) {
  const vec3 GN = vec3(-0.8676, -0.1981, 0.4560);
  const vec3 GC = vec3(-0.0548, -0.8734, -0.4838);
  vec3 GY = cross(GN, GC);
  float b = dot(e, GN);
  float l = atan(dot(e, GY), dot(e, GC));
  vec2 gp = vec2(l, b);
  float band = exp(-b * b / 0.018);
  float centre = pow(max(dot(e, GC), 0.0), 3.0);
  float n = fbm6(gp * vec2(6.0, 18.0) + 4.0);
  float dust = smoothstep(0.45, 0.75, fbm4(gp * vec2(9.0, 30.0) + 11.0)) * exp(-b * b / 0.003);
  float mw = band * (0.35 + 1.4 * centre) * (0.3 + n) * (1.0 - 0.75 * dust);
  vec3 col = mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.85, 0.68), clamp(centre * 1.5, 0.0, 1.0));
  return col * mw;
}
vec3 nightSky(vec3 rd) {
  vec3 e = uWorldToEq * rd;
  vec3 s = starLayer(e, 160.0, 0.14, 1.0) + starLayer(e, 380.0, 0.05, 0.4) + starLayer(e, 800.0, 0.025, 0.25);
  return s * 0.004 + milkyWay(e) * 0.011;
}
`;
