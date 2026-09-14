// Звуковой движок — все эффекты синтезируются на лету через Web Audio API,
// внешние аудиофайлы не нужны.

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('sb_muted') === '1';
    this.master = null;
    this._noiseBuffer = null;
    this._unlocked = false;
    const unlock = () => this._ensureContext();
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
      window.addEventListener(ev, unlock, { once: true, passive: true })
    );
  }

  _ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    this.master.connect(this.ctx.destination);
    this._unlocked = true;
  }

  setMuted(m) {
    this.muted = m;
    localStorage.setItem('sb_muted', m ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  _noise() {
    if (this._noiseBuffer) return this._noiseBuffer;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noiseBuffer = buf;
    return buf;
  }

  _now() { return this.ctx.currentTime; }

  _tone({ freq = 440, type = 'sine', dur = 0.3, gain = 0.3, delay = 0, slideTo = null, attack = 0.005 }) {
    if (!this.ctx) return;
    const t0 = this._now() + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  _noiseBurst({ dur = 0.3, gain = 0.4, delay = 0, filterType = 'lowpass', freqFrom = 2000, freqTo = 200, q = 0.7 }) {
    if (!this.ctx) return;
    const t0 = this._now() + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise();
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freqFrom, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, freqTo), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  click() {
    this._ensureContext();
    this._tone({ freq: 700, type: 'triangle', dur: 0.08, gain: 0.18 });
  }

  select() {
    this._ensureContext();
    this._tone({ freq: 520, type: 'sine', dur: 0.12, gain: 0.15 });
  }

  error() {
    this._ensureContext();
    this._tone({ freq: 180, type: 'sawtooth', dur: 0.2, gain: 0.2 });
  }

  shotFired() {
    this._ensureContext();
    this._noiseBurst({ dur: 0.18, gain: 0.25, filterType: 'highpass', freqFrom: 800, freqTo: 3000 });
  }

  splashMiss() {
    this._ensureContext();
    this._noiseBurst({ dur: 0.5, gain: 0.35, filterType: 'lowpass', freqFrom: 2500, freqTo: 300, q: 0.9 });
    this._tone({ freq: 500, type: 'sine', dur: 0.35, gain: 0.12, slideTo: 120, delay: 0.02 });
  }

  hit() {
    this._ensureContext();
    this._noiseBurst({ dur: 0.28, gain: 0.5, filterType: 'lowpass', freqFrom: 4000, freqTo: 500, q: 0.6 });
    this._tone({ freq: 140, type: 'square', dur: 0.22, gain: 0.35, slideTo: 50 });
  }

  explosion() {
    this._ensureContext();
    this._noiseBurst({ dur: 0.9, gain: 0.6, filterType: 'lowpass', freqFrom: 5000, freqTo: 120, q: 0.5 });
    this._tone({ freq: 90, type: 'sine', dur: 0.8, gain: 0.55, slideTo: 30, attack: 0.01 });
    this._tone({ freq: 60, type: 'triangle', dur: 1.1, gain: 0.4, slideTo: 20, delay: 0.05 });
    // потрескивание
    for (let i = 0; i < 6; i++) {
      this._noiseBurst({ dur: 0.08, gain: 0.15, delay: 0.15 + i * 0.07, filterType: 'bandpass', freqFrom: 1200, freqTo: 800, q: 3 });
    }
  }

  victory() {
    this._ensureContext();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: 0.5, gain: 0.28, delay: i * 0.14 }));
    this._tone({ freq: 1318.5, type: 'sine', dur: 0.9, gain: 0.2, delay: notes.length * 0.14 });
  }

  defeat() {
    this._ensureContext();
    const notes = [392, 349.2, 293.7, 261.6];
    notes.forEach((f, i) => this._tone({ freq: f, type: 'sawtooth', dur: 0.55, gain: 0.22, delay: i * 0.22 }));
  }

  turnChime() {
    this._ensureContext();
    this._tone({ freq: 660, type: 'sine', dur: 0.18, gain: 0.15 });
    this._tone({ freq: 880, type: 'sine', dur: 0.22, gain: 0.12, delay: 0.08 });
  }

  radarPing() {
    this._ensureContext();
    this._tone({ freq: 1200, type: 'sine', dur: 0.4, gain: 0.08, slideTo: 1800 });
  }
}

export const audio = new AudioEngine();
