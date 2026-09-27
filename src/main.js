import * as THREE from 'three';
import GUI from 'lil-gui';
import { OceanSimulation } from './ocean/simulation.js';
import { createOceanSurface } from './ocean/surface.js';
import { Sky, transmittance } from './sky.js';
import { createSeabed, createMarineSnow, createRain, createBuoy } from './world.js';
import { PostFX } from './post.js';
import { CameraController, MODES } from './controls.js';
import { computeAstronomy, makeDate } from './astro.js';
import { OceanAudio } from './audio.js';

// ------------------------------------------------------------------ Sabitler / ön ayarlar
const LOCATIONS = {
  'Antalya, Türkiye': { lat: 36.85, lon: 30.70, tz: 3 },
  'Bodrum, Türkiye': { lat: 37.03, lon: 27.43, tz: 3 },
  'Karadeniz (Trabzon)': { lat: 41.00, lon: 39.72, tz: 3 },
  'Maldivler': { lat: 4.17, lon: 73.50, tz: 5 },
  'Hawaii': { lat: 21.30, lon: -157.80, tz: -10 },
  'Tahiti (Güney Pasifik)': { lat: -17.65, lon: -149.40, tz: -10 },
  'Lofoten, Norveç': { lat: 68.20, lon: 14.00, tz: 2 },
  'Karayipler (Porto Riko)': { lat: 18.20, lon: -66.50, tz: -4 },
};

const QUALITY = {
  'Düşük': { fft: 128, rings: 260, segments: 256, scale: 0.75, msaa: 0, godRays: 0.6 },
  'Orta': { fft: 256, rings: 380, segments: 384, scale: 1.0, msaa: 0, godRays: 1 },
  'Yüksek': { fft: 256, rings: 560, segments: 576, scale: 1.0, msaa: 4, godRays: 1 },
  'Ultra': { fft: 512, rings: 760, segments: 800, scale: 1.25, msaa: 4, godRays: 1 },
};

const WEATHER = {
  'Sakin': { fetch: 20, windSpeed: 3.5, swell: 0.35, choppiness: 0.7, cloudCoverage: 0.15, cloudDensity: 0.8, rain: 0, lightning: false, haze: 0.8, visibility: 60 },
  'Açık ve esintili': { fetch: 60, windSpeed: 8, swell: 0.5, choppiness: 0.9, cloudCoverage: 0.32, cloudDensity: 1.0, rain: 0, lightning: false, haze: 1.0, visibility: 45 },
  'Rüzgarlı': { fetch: 150, windSpeed: 14, swell: 0.7, choppiness: 1.0, cloudCoverage: 0.55, cloudDensity: 1.3, rain: 0, lightning: false, haze: 1.6, visibility: 30 },
  'Fırtına': { fetch: 500, windSpeed: 23, swell: 1.0, choppiness: 1.05, cloudCoverage: 0.97, cloudDensity: 2.6, rain: 0.85, lightning: true, haze: 4.0, visibility: 7 },
  'Sisli': { fetch: 30, windSpeed: 4, swell: 0.4, choppiness: 0.8, cloudCoverage: 0.6, cloudDensity: 1.2, rain: 0, lightning: false, haze: 8.0, visibility: 2.5 },
};

const DEFAULTS = {
  mode: MODES.SWIM,
  location: 'Antalya, Türkiye',
  lat: 36.85, lon: 30.70, tz: 3,
  date: '2026-07-18',
  hour: 18.9,
  timeSpeed: 1,
  realTime: false,
  cloudCoverage: 0.32, cloudDensity: 1.0, cloudSpeed: 1.0, haze: 1.0, visibility: 45,
  starBrightness: 1.0, sunDiscScale: 1.0,
  windSpeed: 8, windDir: 30, fetch: 60, swell: 0.5, swellDir: 70, choppiness: 0.9, amplitude: 1.0,
  spread: 0.12, foamAmount: 1.0, foamDecay: 0.35,
  deepColor: '#0a2c47', scatterColor: '#0f8a7a', sss: 1.0, clarity: 1.0, reflectivity: 1.0,
  godRays: 1.0, caustics: 1.0, seabedDepth: 26,
  rain: 0, lightning: false,
  quality: 'Yüksek', renderScale: 1.0, msaa: 4, bloom: 0.045, exposure: 1.0, vignette: 0.28,
  saturation: 1.05, contrast: 1.04, fov: 68,
  audio: true, volume: 0.7,
};

function loadSettings() {
  const s = { ...DEFAULTS };
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  if (coarse) { s.quality = 'Orta'; s.msaa = 0; }
  try {
    const saved = JSON.parse(localStorage.getItem('gercekci-okyanus-ayarlar') || 'null');
    if (saved && typeof saved === 'object') Object.assign(s, saved);
  } catch { /* depolama kullanılamıyor */ }
  if (!QUALITY[s.quality]) s.quality = DEFAULTS.quality;
  return s;
}
let saveTimer = 0;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('gercekci-okyanus-ayarlar', JSON.stringify(settings)); } catch { /* yok say */ }
  }, 400);
}

const settings = loadSettings();

// ------------------------------------------------------------------ Renderer
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
} catch (e) {
  document.getElementById('error').hidden = false;
  throw e;
}
if (!renderer.capabilities.isWebGL2) {
  document.getElementById('error').hidden = false;
  throw new Error('WebGL2 gerekli');
}
renderer.autoClear = false;
renderer.setClearColor(0x000000, 1);

const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 400000);
const scene = new THREE.Scene();

// Tüm malzemelerin paylaştığı uniform nesneleri
const shared = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
  uSunColor: { value: new THREE.Vector3(1, 1, 1) },
  uMoonColor: { value: new THREE.Vector3() },
  uTime: { value: 0 },
  uSkyAtmo: { value: null },
  uSkyFull: { value: null },
  uFogDensity: { value: 1 / 45000 },
  uCloudCoverage: { value: 0.3 },
  uCloudDensity: { value: 1 },
  uCloudOffset: { value: new THREE.Vector2() },
  uLightning: { value: 0 },
  uNightAmbient: { value: new THREE.Vector3(0.0003, 0.00045, 0.0009) },
  uMie: { value: 3.996e-6 },
  uMieG: { value: 0.8 },
  uWorldToEq: { value: new THREE.Matrix3() },
  uPixelAngle: { value: 0.001 },
  uMoonIllum: { value: 0.5 },
  uDeepColor: { value: new THREE.Color() },
  uAbsorb: { value: new THREE.Vector3(0.4, 0.085, 0.055) },
  uKd: { value: new THREE.Vector3(0.36, 0.07, 0.045) },
  uScatterTint: { value: new THREE.Vector3(0.03, 0.22, 0.3) },
  uSeabedDepth: { value: 26 },
};

const sim = new OceanSimulation(renderer, { size: QUALITY[settings.quality].fft });
const sky = new Sky(renderer, shared);
const ocean = createOceanSurface(shared, sim, QUALITY[settings.quality]);
const seabed = createSeabed(shared);
const snow = createMarineSnow();
const rain = createRain();
const buoy = createBuoy(shared);
const post = new PostFX(renderer, shared);
const audio = new OceanAudio();

scene.add(sky.dome, ocean.mesh, seabed.mesh, snow.mesh, rain.mesh, buoy.mesh);

const controls = new CameraController(camera, canvas);
controls.buoyPos = buoy.position;
controls.mode = settings.mode === MODES.CINEMATIC ? MODES.CINEMATIC : settings.mode;
if (controls.mode === MODES.AERIAL) { controls.pos.set(0, 60, 40); controls.pitch = -0.3; }

// ------------------------------------------------------------------ Zaman yönetimi
const clock = { y: 2026, m: 7, d: 18, hour: settings.hour };
function parseDate() {
  const [y, m, d] = (settings.date || DEFAULTS.date).split('-').map(Number);
  clock.y = y || 2026; clock.m = m || 7; clock.d = d || 18;
}
parseDate();
function currentDate() {
  if (settings.realTime) return new Date();
  return makeDate(clock.y, clock.m, clock.d, settings.hour, settings.tz);
}
function advanceDay(delta) {
  const dt = new Date(Date.UTC(clock.y, clock.m - 1, clock.d + delta));
  clock.y = dt.getUTCFullYear(); clock.m = dt.getUTCMonth() + 1; clock.d = dt.getUTCDate();
  settings.date = `${clock.y}-${String(clock.m).padStart(2, '0')}-${String(clock.d).padStart(2, '0')}`;
}

// Güneşin doğuş/batış saatlerini sayısal arama ile bul
function findSunEvents() {
  const alt = (h) => computeAstronomy(makeDate(clock.y, clock.m, clock.d, h, settings.tz), settings.lat, settings.lon).sunDir[1];
  let rise = null, set = null, prev = alt(0);
  for (let h = 0.1; h <= 24.001; h += 0.1) {
    const a = alt(h);
    if (prev < -0.0145 && a >= -0.0145 && rise === null) rise = h;
    if (prev >= -0.0145 && a < -0.0145) set = h;
    prev = a;
  }
  return { rise, set };
}

// ------------------------------------------------------------------ Parametre uygulama
function applyOceanParams() {
  const p = sim.params;
  for (const k of ['windSpeed', 'windDir', 'fetch', 'swell', 'swellDir', 'choppiness', 'amplitude', 'spread', 'foamAmount', 'foamDecay']) {
    p[k] = settings[k];
  }
  p.swellWind = 5 + settings.swell * 6;
  sim.markDirty();
}
function applyWaterParams() {
  shared.uDeepColor.value.set(settings.deepColor).convertSRGBToLinear();
  const sc = new THREE.Color(settings.scatterColor).convertSRGBToLinear();
  ocean.material.uniforms.uScatterColor.value.copy(sc);
  ocean.material.uniforms.uSSS.value = settings.sss;
  ocean.material.uniforms.uReflectivity.value = settings.reflectivity;
  const c = settings.clarity;
  shared.uAbsorb.value.set(0.4, 0.085, 0.055).multiplyScalar(c);
  shared.uKd.value.set(0.36, 0.07, 0.045).multiplyScalar(c);
  shared.uSeabedDepth.value = settings.seabedDepth;
  controls.seabed = -settings.seabedDepth - 3.5;
  seabed.uniforms.uCausticStrength.value = settings.caustics;
  ocean.material.uniforms.uFoamStrength.value = 1.0;
}
function applyGraphics(rebuild = false) {
  const q = QUALITY[settings.quality];
  if (rebuild) {
    if (sim.size !== q.fft) {
      sim.build(q.fft);
    }
    ocean.setQuality(q);
  }
  camera.fov = settings.fov;
  resize();
}
function applyAll() {
  applyOceanParams();
  applyWaterParams();
  applyGraphics(false);
  audio.volume = settings.volume;
  audio.enabled = settings.audio;
}

// ------------------------------------------------------------------ Boyutlandırma
let internalW = 1, internalH = 1, captureFactor = 1;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(dpr * captureFactor);
  renderer.setSize(w, h, true);
  let scale = settings.renderScale * dpr * captureFactor;
  // Aşırı büyük iç çözünürlükten kaçın (~12 MP)
  const maxPixels = captureFactor > 1 ? 36e6 : 12.5e6;
  if (w * h * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (w * h));
  const maxTex = renderer.capabilities.maxTextureSize;
  internalW = Math.min(maxTex, Math.max(1, Math.floor(w * scale)));
  internalH = Math.min(maxTex, Math.max(1, Math.floor(h * scale)));
  post.setSize(internalW, internalH, settings.msaa);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  shared.uPixelAngle.value = THREE.MathUtils.degToRad(camera.fov) / internalH;
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ Arayüz (lil-gui)
const gui = new GUI({ title: 'Okyanus Ayarları', width: 320 });
gui.domElement.id = 'gui';
const onAny = () => saveSettings();

const fView = gui.addFolder('Görünüm');
fView.add(settings, 'mode', { 'Yüzme': MODES.SWIM, 'Havadan': MODES.AERIAL, 'Sinematik': MODES.CINEMATIC })
  .name('Kamera modu').onChange((v) => { controls.setMode(v); onAny(); }).listen();
fView.add(settings, 'fov', 35, 100, 1).name('Görüş açısı (°)').onChange(() => { applyGraphics(); onAny(); });

const fTime = gui.addFolder('Zaman ve Gökyüzü');
fTime.add(settings, 'location', Object.keys(LOCATIONS)).name('Konum').onChange((v) => {
  Object.assign(settings, { lat: LOCATIONS[v].lat, lon: LOCATIONS[v].lon, tz: LOCATIONS[v].tz });
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  onAny();
});
fTime.add(settings, 'date').name('Tarih (YYYY-AA-GG)').onFinishChange(() => { parseDate(); onAny(); }).listen();
fTime.add(settings, 'hour', 0, 24, 0.01).name('Saat').listen().onChange(onAny);
fTime.add(settings, 'timeSpeed', { 'Durdur': 0, 'Gerçek (1x)': 1, '60x': 60, '300x': 300, '1200x': 1200, '3600x': 3600 }).name('Zaman akışı').listen().onChange(onAny);
fTime.add(settings, 'realTime').name('Gerçek saat (canlı)').onChange(onAny);
const timePresets = {
  'Gün doğumu': () => setTimeEvent('rise', 0.05),
  'Sabah': () => setTimeEvent('rise', 2.0),
  'Öğle': () => { settings.hour = 12.8; },
  'Altın saat': () => setTimeEvent('set', -0.75),
  'Gün batımı': () => setTimeEvent('set', -0.12),
  'Mavi saat': () => setTimeEvent('set', 0.45),
  'Gece': () => { settings.hour = 23.5; },
};
function setTimeEvent(which, offset) {
  settings.realTime = false;
  const ev = findSunEvents();
  const base = ev[which];
  if (base === null) { settings.hour = which === 'rise' ? 6 : 19; return; }
  settings.hour = (base + offset + 24) % 24;
  onAny();
}
const fPresetT = fTime.addFolder('Hızlı zaman seçimi');
Object.entries(timePresets).forEach(([k, f]) => fPresetT.add({ [k]: f }, k));
fPresetT.close();
fTime.add(settings, 'cloudCoverage', 0, 1, 0.01).name('Bulut örtüsü').onChange(onAny).listen();
fTime.add(settings, 'cloudDensity', 0.2, 3, 0.01).name('Bulut kalınlığı').onChange(onAny).listen();
fTime.add(settings, 'cloudSpeed', 0, 5, 0.1).name('Bulut hızı').onChange(onAny);
fTime.add(settings, 'haze', 0.2, 10, 0.1).name('Pus / nem').onChange(onAny).listen();
fTime.add(settings, 'visibility', 1, 120, 0.5).name('Görüş mesafesi (km)').onChange(onAny).listen();
fTime.add(settings, 'starBrightness', 0, 3, 0.05).name('Yıldız parlaklığı').onChange(onAny);
fTime.add(settings, 'sunDiscScale', 0.5, 4, 0.05).name('Güneş disk boyutu').onChange(onAny);

const fWave = gui.addFolder('Hava ve Dalgalar');
const weatherObj = { preset: 'Açık ve esintili' };
fWave.add(weatherObj, 'preset', Object.keys(WEATHER)).name('Hava durumu').onChange((v) => {
  Object.assign(settings, WEATHER[v]);
  applyOceanParams();
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  onAny();
});
const oceanCtl = (key, min, max, step, name) => fWave.add(settings, key, min, max, step).name(name).listen()
  .onChange(() => { applyOceanParams(); onAny(); });
oceanCtl('windSpeed', 0.5, 30, 0.1, 'Rüzgar hızı (m/s)');
oceanCtl('windDir', 0, 360, 1, 'Rüzgar yönü (°)');
oceanCtl('fetch', 5, 1000, 1, 'Rüzgar etki mesafesi (km)');
oceanCtl('swell', 0, 1.5, 0.01, 'Soluğan (swell)');
oceanCtl('swellDir', 0, 360, 1, 'Soluğan yönü (°)');
oceanCtl('choppiness', 0, 1.6, 0.01, 'Dalga sivriliği');
oceanCtl('amplitude', 0.1, 2.5, 0.01, 'Dalga ölçeği');
oceanCtl('spread', 0, 1, 0.01, 'Yön dağınıklığı');
oceanCtl('foamAmount', 0, 3, 0.01, 'Köpük miktarı');
oceanCtl('foamDecay', 0.05, 2, 0.01, 'Köpük sönümü');
fWave.add(settings, 'rain', 0, 1, 0.01).name('Yağmur').onChange(onAny).listen();
fWave.add(settings, 'lightning').name('Şimşek').onChange(onAny).listen();

const fWater = gui.addFolder('Su');
fWater.addColor(settings, 'deepColor').name('Derin su rengi').onChange(() => { applyWaterParams(); onAny(); });
fWater.addColor(settings, 'scatterColor').name('Saçılım rengi').onChange(() => { applyWaterParams(); onAny(); });
fWater.add(settings, 'sss', 0, 3, 0.01).name('Işık geçirgenliği (SSS)').onChange(() => { applyWaterParams(); onAny(); });
fWater.add(settings, 'reflectivity', 0.3, 1.5, 0.01).name('Yansıma').onChange(() => { applyWaterParams(); onAny(); });
fWater.add(settings, 'clarity', 0.3, 3, 0.01).name('Bulanıklık (su altı)').onChange(() => { applyWaterParams(); onAny(); });
fWater.add(settings, 'godRays', 0, 3, 0.01).name('Işık huzmeleri').onChange(onAny);
fWater.add(settings, 'caustics', 0, 2, 0.01).name('Kostikler').onChange(() => { applyWaterParams(); onAny(); });
fWater.add(settings, 'seabedDepth', 8, 60, 0.5).name('Deniz tabanı derinliği (m)').onChange(() => { applyWaterParams(); onAny(); });
fWater.close();

const fGfx = gui.addFolder('Grafik');
fGfx.add(settings, 'quality', Object.keys(QUALITY)).name('Kalite ön ayarı').onChange((v) => {
  const q = QUALITY[v];
  settings.renderScale = q.scale; settings.msaa = q.msaa;
  applyGraphics(true);
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  onAny();
});
fGfx.add(settings, 'renderScale', 0.5, 2, 0.05).name('Çözünürlük ölçeği').onChange(() => { applyGraphics(); onAny(); }).listen();
fGfx.add(settings, 'msaa', { 'Kapalı': 0, '2x': 2, '4x': 4, '8x': 8 }).name('Kenar yumuşatma (MSAA)').onChange(() => { applyGraphics(); onAny(); }).listen();
fGfx.add(settings, 'exposure', 0.2, 4, 0.01).name('Pozlama').onChange(onAny);
fGfx.add(settings, 'bloom', 0, 0.2, 0.001).name('Parlama (bloom)').onChange(onAny);
fGfx.add(settings, 'vignette', 0, 1, 0.01).name('Vinyet').onChange(onAny);
fGfx.add(settings, 'saturation', 0, 2, 0.01).name('Doygunluk').onChange(onAny);
fGfx.add(settings, 'contrast', 0.5, 1.5, 0.01).name('Kontrast').onChange(onAny);
fGfx.close();

const fAudio = gui.addFolder('Ses');
fAudio.add(settings, 'audio').name('Ses açık').onChange((v) => { audio.enabled = v; onAny(); });
fAudio.add(settings, 'volume', 0, 1, 0.01).name('Ses düzeyi').onChange((v) => { audio.volume = v; onAny(); });
fAudio.close();

gui.add({ reset: () => {
  try { localStorage.removeItem('gercekci-okyanus-ayarlar'); } catch { /* yok say */ }
  Object.assign(settings, DEFAULTS);
  parseDate();
  applyAll();
  applyGraphics(true);
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
} }, 'reset').name('Varsayılanlara dön');

if (window.innerWidth < 700) gui.close();

// ------------------------------------------------------------------ HUD ve kontroller
const $ = (id) => document.getElementById(id);
const hud = {
  time: $('hud-time'), date: $('hud-date'), sun: $('hud-sun'), moon: $('hud-moon'),
  waves: $('hud-waves'), fps: $('hud-fps'), mode: $('hud-mode'), depth: $('hud-depth'),
};
const timeSlider = $('time-slider');
timeSlider.addEventListener('input', () => { settings.realTime = false; settings.hour = parseFloat(timeSlider.value); onAny(); });
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  settings.mode = b.dataset.mode; controls.setMode(b.dataset.mode); onAny();
}));
document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
  settings.timeSpeed = Number(b.dataset.speed); settings.realTime = false; onAny();
}));
$('btn-shot').addEventListener('click', () => { pendingShot = 1; });
$('btn-shot-hi').addEventListener('click', () => { pendingShot = 2; });
$('btn-full').addEventListener('click', toggleFullscreen);
$('btn-help').addEventListener('click', () => { $('help').hidden = !$('help').hidden; });
$('help-close').addEventListener('click', () => { $('help').hidden = true; });
controls.onModeChange = (m) => { settings.mode = m; updateModeButtons(); };
function updateModeButtons() {
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === controls.mode));
}
function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
}
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  switch (e.code) {
    case 'Digit1': controls.setMode(MODES.SWIM); break;
    case 'Digit2': controls.setMode(MODES.AERIAL); break;
    case 'Digit3': controls.setMode(MODES.CINEMATIC); break;
    case 'KeyH': document.body.classList.toggle('hide-ui'); break;
    case 'KeyP': pendingShot = 1; break;
    case 'KeyF': toggleFullscreen(); break;
    case 'KeyT': {
      const speeds = [0, 1, 60, 300, 1200, 3600];
      settings.timeSpeed = speeds[(speeds.indexOf(settings.timeSpeed) + 1) % speeds.length];
      settings.realTime = false;
      break;
    }
    case 'BracketRight': settings.hour = (settings.hour + 0.5) % 24; settings.realTime = false; break;
    case 'BracketLeft': settings.hour = (settings.hour + 23.5) % 24; settings.realTime = false; break;
    default: break;
  }
});

// Dokunmatik joystick
(function setupTouch() {
  const pad = $('joystick'), knob = $('joystick-knob');
  if (!pad) return;
  let id = null, cx = 0, cy = 0;
  pad.addEventListener('pointerdown', (e) => {
    id = e.pointerId; const r = pad.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    pad.setPointerCapture(id); e.stopPropagation();
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    let dx = (e.clientX - cx) / 50, dy = (e.clientY - cy) / 50;
    const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    controls.touchMove.set(dx, -dy);
    knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
  });
  const end = () => { id = null; controls.touchMove.set(0, 0); knob.style.transform = ''; };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  const hold = (el, v) => {
    el.addEventListener('pointerdown', (e) => { controls.touchVert = v; e.stopPropagation(); });
    const off = () => { controls.touchVert = 0; };
    el.addEventListener('pointerup', off); el.addEventListener('pointerleave', off); el.addEventListener('pointercancel', off);
  };
  hold($('btn-up'), 1); hold($('btn-down'), -1);
})();

// ------------------------------------------------------------------ Ekran görüntüsü
let pendingShot = 0;
function saveCanvas() {
  const d = new Date();
  const name = `okyanus-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}.png`;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
  flash('Ekran görüntüsü kaydedildi');
}
function flash(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

// ------------------------------------------------------------------ Aydınlatma yardımcıları
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function interp(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1], [x1, y1] = points[i];
      const t = (x - x0) / (x1 - x0);
      return Math.exp(Math.log(y0) * (1 - t) + Math.log(y1) * t);
    }
  }
  return points[points.length - 1][1];
}
const EXPOSURE_CURVE = [[-0.3, 20], [-0.2, 20], [-0.12, 14], [-0.06, 7], [-0.02, 3.6], [0.02, 2.3], [0.1, 1.6], [0.3, 1.25], [1, 1.15]];

function moonPhaseName(illum, waxing) {
  if (illum < 0.03) return 'Yeni Ay';
  if (illum > 0.97) return 'Dolunay';
  if (illum < 0.45) return waxing ? 'Hilal (büyüyen)' : 'Hilal (küçülen)';
  if (illum < 0.55) return waxing ? 'İlk dördün' : 'Son dördün';
  return waxing ? 'Şişkin Ay (büyüyen)' : 'Şişkin Ay (küçülen)';
}
function dirToAltAz(d) {
  const alt = Math.asin(d[1]) * 180 / Math.PI;
  let az = Math.atan2(d[0], -d[2]) * 180 / Math.PI;
  if (az < 0) az += 360;
  return { alt, az };
}
const COMPASS = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'];

// ------------------------------------------------------------------ Ana döngü
let last = performance.now();
let elapsed = 0;
let fpsAcc = 0, fpsFrames = 0, fpsValue = 0, hudTimer = 0;
let lightning = 0, nextStrike = 5;
let prevIllum = 0.5;
let waxing = true;
let started = false;
const tmpV = new THREE.Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0.0001, (now - last) / 1000));
  last = now;
  elapsed += dt;
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 0.5) { fpsValue = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }

  // Zaman ilerlet
  if (!settings.realTime && settings.timeSpeed > 0) {
    settings.hour += dt * settings.timeSpeed / 3600;
    if (settings.hour >= 24) { settings.hour -= 24; advanceDay(1); }
  }
  if (settings.realTime) {
    const n = new Date();
    const local = new Date(n.getTime() + settings.tz * 3600000);
    settings.hour = local.getUTCHours() + local.getUTCMinutes() / 60 + local.getUTCSeconds() / 3600;
  }
  const date = currentDate();
  const astro = computeAstronomy(date, settings.lat, settings.lon);
  const sd = astro.sunDir, md = astro.moonDir;
  shared.uSunDir.value.set(sd[0], sd[1], sd[2]);
  shared.uMoonDir.value.set(md[0], md[1], md[2]);
  const [ex, ey, ez] = astro.eqToWorld;
  // dünya->ekvatoral = (ekvatoral->dünya)^T ; satırlar = ex, ey, ez
  shared.uWorldToEq.value.set(ex[0], ex[1], ex[2], ey[0], ey[1], ey[2], ez[0], ez[1], ez[2]);
  const illum = astro.moonIllum;
  if (Math.abs(illum - prevIllum) > 1e-5) waxing = illum > prevIllum;
  prevIllum = illum;
  shared.uMoonIllum.value = illum;
  shared.uTime.value = elapsed;

  // Atmosfer ve ışık renkleri
  const mie = 3.996e-6 * settings.haze;
  shared.uMie.value = mie;
  shared.uMieG.value = THREE.MathUtils.clamp(0.8 - (settings.haze - 1) * 0.02, 0.6, 0.85);
  const sunI = 20;
  const moonI = 20 * 0.0045 * Math.pow(illum, 1.5);
  const ts = transmittance(sd, mie), tm = transmittance(md, mie);
  const sunVis = smoothstep(-0.012, 0.006, sd[1]);
  const moonVis = smoothstep(-0.012, 0.006, md[1]);
  const overcast = 1 - 0.25 * settings.cloudCoverage * settings.cloudCoverage;
  shared.uSunColor.value.set(ts[0], ts[1], ts[2]).multiplyScalar(sunI * sunVis * overcast);
  shared.uMoonColor.value.set(tm[0], tm[1], tm[2]).multiplyScalar(moonI * moonVis);
  shared.uFogDensity.value = 1 / (settings.visibility * 1000);
  shared.uCloudCoverage.value = settings.cloudCoverage;
  shared.uCloudDensity.value = settings.cloudDensity;
  const wdir = settings.windDir * Math.PI / 180;
  const cloudSpd = (4 + settings.windSpeed * 1.2) * settings.cloudSpeed * Math.max(1, Math.min(settings.timeSpeed, 120) * 0.3);
  shared.uCloudOffset.value.x -= Math.cos(wdir) * cloudSpd * dt;
  shared.uCloudOffset.value.y -= Math.sin(wdir) * cloudSpd * dt;
  const night = 1 - smoothstep(-0.14, 0.02, sd[1]);
  shared.uNightAmbient.value.set(0.00022, 0.00034, 0.0007).multiplyScalar(1 + 2 * illum * moonVis);

  // Şimşek
  if (settings.lightning && started) {
    nextStrike -= dt;
    if (nextStrike <= 0) {
      lightning = 1.5 + Math.random() * 2.5;
      nextStrike = 3 + Math.random() * 11;
      audio.thunder(0.6 + Math.random() * 3.5, 0.6 + Math.random() * 0.8);
    }
  }
  lightning *= Math.exp(-dt * (lightning > 0.6 ? 9 : 4));
  const flicker = lightning > 0.05 ? lightning * (0.6 + 0.4 * Math.sin(elapsed * 60)) : 0;
  shared.uLightning.value = flicker;

  // Okyanus simülasyonu + yükseklik sorgusu
  sim.update(dt);
  sim.query([[camera.position.x, camera.position.z], [buoy.position.x, buoy.position.y]]);
  controls.waterH = sim.heightAt(0);
  controls.waterSlope = sim.slopeAt(0);

  // Kamera
  controls.update(dt, elapsed);
  const alt = camera.position.y - controls.waterH;
  camera.near = alt > 50 ? Math.min(2, alt * 0.01) : 0.05;
  camera.far = 400000;
  camera.updateProjectionMatrix();

  // Gökyüzü LUT
  sky.renderLUT(camera, sunI * sunVis + 0.001, moonI * moonVis);
  sky.updateDome(camera);
  sky.domeMat.uniforms.uStarBrightness.value = settings.starBrightness;
  sky.domeMat.uniforms.uSunDiscScale.value = settings.sunDiscScale;
  sky.domeMat.uniforms.uMoonDiscIntensity.value = THREE.MathUtils.lerp(0.9, 0.18, night);

  ocean.update(camera, sim);
  seabed.update(camera);
  buoy.update(dt, sim.heightAt(1), sim.slopeAt(1), elapsed, night);

  const underwater = camera.position.y < controls.waterH - 0.02;
  snow.mesh.visible = camera.position.y < 1;
  snow.uniforms.uTime.value = elapsed;
  snow.uniforms.uPixelRatio.value = internalH / 900;
  tmpV.set(0.03, 0.2, 0.26).multiplyScalar(0.02 + Math.max(0, sd[1]) * 0.4 + illum * moonVis * 0.01);
  snow.uniforms.uColor.value.setRGB(tmpV.x, tmpV.y, tmpV.z);
  rain.mesh.visible = settings.rain > 0.01 && !underwater;
  rain.uniforms.uTime.value = elapsed;
  rain.uniforms.uIntensity.value = settings.rain;
  rain.uniforms.uWindVel.value.set(-Math.cos(wdir) * settings.windSpeed * 0.3, -Math.sin(wdir) * settings.windSpeed * 0.3);
  const rb = 0.03 + 0.12 * (1 - night) + flicker * 0.3;
  rain.uniforms.uColor.value.setRGB(rb * 0.9, rb * 0.95, rb);

  // Pozlama (otomatik göz uyumu)
  let exposure = interp(EXPOSURE_CURVE, sd[1]) * settings.exposure;
  exposure *= 1 + settings.cloudCoverage * settings.cloudDensity * 0.18;
  if (underwater) exposure *= 1.25;
  if (controls.mode === MODES.CINEMATIC) exposure *= controls.cineFade ?? 1;

  const nearWater = camera.position.y < controls.waterH + 4;
  post.bloomEnabled = settings.bloom > 0;
  post.render(scene, camera, sim, {
    exposure, bloom: settings.bloom, night, vignette: settings.vignette + (underwater ? 0.25 : 0),
    saturation: settings.saturation, contrast: settings.contrast, time: elapsed,
    godRays: settings.godRays * QUALITY[settings.quality].godRays, nearWater,
  });

  if (pendingShot === 1) { saveCanvas(); pendingShot = 0; }
  else if (pendingShot === 2) {
    pendingShot = 3;
    captureFactor = 2; resize();
  } else if (pendingShot === 3) {
    saveCanvas(); pendingShot = 0; captureFactor = 1; resize();
  }

  audio.update(dt, {
    windSpeed: settings.windSpeed, altitude: alt, rain: settings.rain,
    underwater, swimming: controls.mode === MODES.SWIM,
  });

  // HUD
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.25;
    const h = settings.hour;
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    hud.time.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const loc = settings.realTime ? 'canlı' : (settings.timeSpeed === 0 ? 'durdu' : `${settings.timeSpeed}x`);
    hud.date.textContent = `${settings.date} · UTC${settings.tz >= 0 ? '+' : ''}${settings.tz} · ${loc}`;
    const sa = dirToAltAz(sd), ma = dirToAltAz(md);
    hud.sun.textContent = `Güneş: ${sa.alt.toFixed(1)}° yükseklik, ${COMPASS[Math.round(sa.az / 45) % 8]} (${sa.az.toFixed(0)}°)`;
    hud.moon.textContent = `Ay: ${ma.alt.toFixed(1)}° · ${moonPhaseName(illum, waxing)} (%${Math.round(illum * 100)})`;
    hud.waves.textContent = `Dalga Hs ≈ ${sim.significantWaveHeight().toFixed(1)} m · Rüzgar ${settings.windSpeed.toFixed(1)} m/s (${Math.round(settings.windSpeed * 3.6)} km/sa)`;
    hud.fps.textContent = `${fpsValue.toFixed(0)} FPS · ${internalW}×${internalH}`;
    const modeName = { swim: 'Yüzme', aerial: 'Havadan', cinematic: 'Sinematik' }[controls.mode];
    hud.mode.textContent = modeName;
    hud.depth.textContent = underwater
      ? `Derinlik: ${(controls.waterH - camera.position.y).toFixed(1)} m`
      : `Yükseklik: ${alt.toFixed(1)} m`;
    if (document.activeElement !== timeSlider) timeSlider.value = settings.hour.toFixed(2);
    document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('active', !settings.realTime && Number(b.dataset.speed) === settings.timeSpeed));
    updateModeButtons();
  }
}

applyAll();
updateModeButtons();

// İlk kareyi derle, sonra başlat ekranını göster
requestAnimationFrame((t) => {
  last = t;
  frame(t);
  document.body.classList.add('ready');
  $('loading').textContent = 'Hazır';
  $('start').disabled = false;
});

$('start').addEventListener('click', () => {
  started = true;
  $('intro').classList.add('hidden');
  audio.enabled = settings.audio;
  audio.volume = settings.volume;
  audio.start();
});

// Test ve hata ayıklama için
window.__ocean = { settings, controls, sim, camera, shared, applyAll, applyGraphics, MODES };
