// Prosedürel okyanus sesleri (Web Audio): dalga uğultusu, köpük hışırtısı, rüzgar, yağmur,
// gök gürültüsü ve su altı boğuk ses.
export class OceanAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.7;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const len = ctx.sampleRate * 4;
    const makeNoise = (type) => {
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let b0 = 0, b1 = 0, b2 = 0, last = 0;
        for (let i = 0; i < len; i++) {
          const w = Math.random() * 2 - 1;
          if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
          else if (type === 'pink') {
            b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
            d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
          } else d[i] = w * 0.5;
        }
      }
      return buf;
    };
    const src = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 3); return s; };
    const brown = makeNoise('brown'), pink = makeNoise('pink'), white = makeNoise('white');

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.uwFilter = ctx.createBiquadFilter();
    this.uwFilter.type = 'lowpass';
    this.uwFilter.frequency.value = 18000;
    this.uwFilter.connect(this.master);
    this.master.connect(ctx.destination);

    // Dalga gövdesi
    this.surf = ctx.createGain();
    const surfF = ctx.createBiquadFilter(); surfF.type = 'lowpass'; surfF.frequency.value = 500;
    src(brown).connect(surfF).connect(this.surf).connect(this.uwFilter);
    // Köpük hışırtısı
    this.hiss = ctx.createGain();
    const hissF = ctx.createBiquadFilter(); hissF.type = 'bandpass'; hissF.frequency.value = 2500; hissF.Q.value = 0.4;
    src(pink).connect(hissF).connect(this.hiss).connect(this.uwFilter);
    // Rüzgar
    this.wind = ctx.createGain();
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 700; this.windF.Q.value = 1.2;
    src(pink).connect(this.windF).connect(this.wind).connect(this.uwFilter);
    // Yağmur
    this.rain = ctx.createGain(); this.rain.gain.value = 0;
    const rainF = ctx.createBiquadFilter(); rainF.type = 'highpass'; rainF.frequency.value = 1800;
    src(white).connect(rainF).connect(this.rain).connect(this.uwFilter);
    // Su altı uğultusu
    this.under = ctx.createGain(); this.under.gain.value = 0;
    const underF = ctx.createBiquadFilter(); underF.type = 'lowpass'; underF.frequency.value = 220;
    src(brown).connect(underF).connect(this.under).connect(this.master);
    // Yakın dalga şapırtısı (yüzme modunda)
    this.lap = ctx.createGain(); this.lap.gain.value = 0;
    const lapF = ctx.createBiquadFilter(); lapF.type = 'bandpass'; lapF.frequency.value = 900; lapF.Q.value = 0.8;
    src(pink).connect(lapF).connect(this.lap).connect(this.uwFilter);
    this.t = 0;
  }

  thunder(delay, strength) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const len = ctx.sampleRate * 5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.03 * w) / 1.03;
      const tt = i / ctx.sampleRate;
      const env = Math.min(1, tt * 8) * Math.exp(-tt * 0.9) * (0.6 + 0.4 * Math.sin(tt * 7 + Math.sin(tt * 13)));
      d[i] = last * 6 * env;
    }
    const s = ctx.createBufferSource(); s.buffer = buf;
    const g = ctx.createGain(); g.gain.value = strength;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    s.connect(f).connect(g).connect(this.uwFilter);
    s.start(ctx.currentTime + delay);
  }

  update(dt, s) {
    if (!this.ctx) return;
    this.t += dt;
    const ctx = this.ctx, now = ctx.currentTime, tc = 0.25;
    const vol = this.enabled ? this.volume : 0;
    this.master.gain.setTargetAtTime(vol, now, 0.3);
    const wind = Math.min(1, s.windSpeed / 20);
    const altF = Math.exp(-Math.max(0, s.altitude) / 250);
    // Yavaş dalga ritimleri
    const swell = 0.55 + 0.25 * Math.sin(this.t * 0.55) + 0.2 * Math.sin(this.t * 0.23 + 1.3);
    const crash = Math.pow(Math.max(0, Math.sin(this.t * 0.41 + Math.sin(this.t * 0.17) * 2)), 6);
    this.surf.gain.setTargetAtTime((0.35 + 0.6 * wind) * swell * (0.3 + 0.7 * altF), now, tc);
    this.hiss.gain.setTargetAtTime((0.05 + 0.25 * wind * wind) * (0.4 + crash) * altF, now, tc);
    this.wind.gain.setTargetAtTime(0.03 + wind * wind * 0.35 + (1 - altF) * 0.15 * (0.3 + wind), now, tc);
    this.windF.frequency.setTargetAtTime(500 + wind * 900 + 200 * Math.sin(this.t * 0.7), now, tc);
    this.rain.gain.setTargetAtTime(s.rain * 0.22, now, tc);
    this.lap.gain.setTargetAtTime(s.swimming && !s.underwater ? 0.12 * (0.5 + 0.5 * Math.sin(this.t * 2.1)) * (0.5 + wind) : 0, now, 0.1);
    this.under.gain.setTargetAtTime(s.underwater ? 0.9 : 0, now, 0.15);
    this.uwFilter.frequency.setTargetAtTime(s.underwater ? 350 : 18000, now, 0.12);
  }
}
