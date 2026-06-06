let ctx: AudioContext | null = null;
let muted = false;

function getCtx(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined);
  }
  return ctx;
}

function ensureCtx(): AudioContext | null {
  if (muted) return null;
  return getCtx();
}

export function setMuted(v: boolean): void {
  muted = v;
  if (fireMasterGain) {
    fireMasterGain.gain.value = muted ? 0 : fireTargetVolume;
  }
}

let fireMasterGain: GainNode | null = null;
let fireTargetVolume = 0;
let fireCrackleTimer: number | null = null;

function ensureFireRunning(): GainNode | null {
  const c = getCtx();
  if (!c) return null;
  if (fireMasterGain) return fireMasterGain;

  fireMasterGain = c.createGain();
  fireMasterGain.gain.value = 0;
  fireMasterGain.connect(c.destination);

  // Continuous rumble: 2s of low-pass filtered noise looped
  const bufferSize = Math.floor(c.sampleRate * 2);
  const rumbleBuf = c.createBuffer(1, bufferSize, c.sampleRate);
  const rumbleData = rumbleBuf.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    rumbleData[i] = (Math.random() * 2 - 1) * 0.5;
  }
  const rumbleSrc = c.createBufferSource();
  rumbleSrc.buffer = rumbleBuf;
  rumbleSrc.loop = true;
  const lowpass = c.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 350;
  lowpass.Q.value = 0.5;
  const rumbleGain = c.createGain();
  rumbleGain.gain.value = 0.45;
  rumbleSrc.connect(lowpass).connect(rumbleGain).connect(fireMasterGain);
  rumbleSrc.start();

  // Random crackles
  const scheduleCrackle = () => {
    if (!fireMasterGain) return;
    if (fireTargetVolume > 0.02 && !muted) {
      const len = 0.015 + Math.random() * 0.05;
      const sampleCount = Math.floor(c.sampleRate * len);
      const buf = c.createBuffer(1, sampleCount, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < sampleCount; i++) {
        const t = i / sampleCount;
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 5);
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 600 + Math.random() * 2200;
      bp.Q.value = 1.2;
      const g = c.createGain();
      g.gain.value = 0.25 + Math.random() * 0.45;
      src.connect(bp).connect(g).connect(fireMasterGain);
      const now = c.currentTime;
      src.start(now);
      src.stop(now + len + 0.05);
    }
    const delay = 60 + Math.random() * 220;
    fireCrackleTimer = window.setTimeout(scheduleCrackle, delay);
  };
  scheduleCrackle();

  return fireMasterGain;
}

export function setFireVolume(v: number): void {
  const gain = ensureFireRunning();
  if (!gain) return;
  const c = getCtx();
  if (!c) return;
  fireTargetVolume = Math.max(0, Math.min(1, v));
  const target = muted ? 0 : fireTargetVolume;
  gain.gain.cancelScheduledValues(c.currentTime);
  gain.gain.linearRampToValueAtTime(target, c.currentTime + 0.15);
}

export function stopFire(): void {
  if (fireCrackleTimer !== null) {
    clearTimeout(fireCrackleTimer);
    fireCrackleTimer = null;
  }
  if (fireMasterGain) {
    try { fireMasterGain.disconnect(); } catch { /* ignore */ }
    fireMasterGain = null;
  }
  fireTargetVolume = 0;
}

export function isMuted(): boolean {
  return muted;
}

function blip(frequency: number, duration: number, type: OscillatorType = 'sine', gain = 0.15): void {
  const c = ensureCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  env.gain.value = 0;
  osc.connect(env).connect(c.destination);
  const t0 = c.currentTime;
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

function sweep(fromHz: number, toHz: number, duration: number, gain = 0.15): void {
  const c = ensureCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = 'triangle';
  osc.frequency.value = fromHz;
  env.gain.value = 0;
  osc.connect(env).connect(c.destination);
  const t0 = c.currentTime;
  osc.frequency.exponentialRampToValueAtTime(toHz, t0 + duration);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

// Miaou : vrai sample mp3 (respecte la sourdine 🔇 via `muted`).
const MEOW_URL = `${import.meta.env.BASE_URL}assets/sounds/meow.mp3`;
let meowAudio: HTMLAudioElement | null = null;
export function playMeow(): void {
  if (muted) return;
  try {
    if (!meowAudio) {
      meowAudio = new Audio(MEOW_URL);
      meowAudio.preload = 'auto';
    }
    const a = meowAudio.cloneNode() as HTMLAudioElement;
    a.volume = 0.45;
    void a.play().catch(() => { /* autoplay/gesture — ignore */ });
  } catch {
    /* ignore */
  }
}

export function playJoin(): void {
  sweep(440, 880, 0.18, 0.12);
}

export function playLeave(): void {
  sweep(660, 220, 0.22, 0.1);
}

export function playChat(): void {
  blip(1200, 0.08, 'sine', 0.08);
  setTimeout(() => blip(1600, 0.05, 'sine', 0.05), 60);
}

// F10 — son distinct pour les DM : double-ding plus grave, type "messagerie"
export function playDmNotif(): void {
  blip(880, 0.1, 'triangle', 0.14);
  setTimeout(() => blip(660, 0.15, 'triangle', 0.12), 110);
}

export function playInteract(): void {
  blip(880, 0.06, 'square', 0.05);
}

export function playApplause(): void {
  const c = ensureCtx();
  if (!c) return;
  const duration = 3.0;
  const bufferSize = Math.floor(c.sampleRate * duration);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);

  // Synthesize a crowd of overlapping claps. Each clap is a short burst of
  // bandpass-filtered noise, jittered in time and amplitude. Density follows
  // an attack-sustain-release curve: builds up, peaks, fades out.
  const sr = c.sampleRate;
  const clapCount = 110;
  for (let k = 0; k < clapCount; k++) {
    // Bias clap times toward the middle for a crescendo-decrescendo shape.
    const r = Math.random();
    const u = (Math.random() + r) * 0.5; // triangular distribution around 0.5
    const startT = u * (duration - 0.06);
    const startIdx = Math.floor(startT * sr);
    const clapLen = Math.floor(sr * (0.04 + Math.random() * 0.03));
    const amp = 0.4 + Math.random() * 0.5;
    for (let i = 0; i < clapLen; i++) {
      const idx = startIdx + i;
      if (idx >= bufferSize) break;
      const env = Math.exp(-(i / clapLen) * 6);
      data[idx] += (Math.random() * 2 - 1) * env * amp;
    }
  }

  // Global envelope to keep tails clean
  for (let i = 0; i < bufferSize; i++) {
    const t = i / sr;
    let g = 1;
    if (t < 0.1) g = t / 0.1;
    else if (t > duration - 0.4) g = (duration - t) / 0.4;
    data[i] = Math.max(-1, Math.min(1, data[i] * g * 0.5));
  }

  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2200;
  filter.Q.value = 0.8;
  const gain = c.createGain();
  gain.gain.value = 0.55;
  src.connect(filter).connect(gain).connect(c.destination);
  src.start();
}
