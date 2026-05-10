let ctx: AudioContext | null = null;
let muted = false;

function ensureCtx(): AudioContext | null {
  if (muted) return null;
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

export function setMuted(v: boolean): void {
  muted = v;
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

export function playInteract(): void {
  blip(880, 0.06, 'square', 0.05);
}

export function playApplause(): void {
  const c = ensureCtx();
  if (!c) return;
  const duration = 1.2;
  const bufferSize = Math.floor(c.sampleRate * duration);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    const t = i / c.sampleRate;
    const env = Math.exp(-t * 1.5);
    const noise = (Math.random() * 2 - 1) * env;
    data[i] = noise * 0.4;
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2500;
  filter.Q.value = 0.7;
  const gain = c.createGain();
  gain.gain.value = 0.25;
  src.connect(filter).connect(gain).connect(c.destination);
  src.start();
}
