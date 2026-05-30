import { useEffect, useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import { socketManager } from '../network/SocketManager';
import type { Appearance } from '../types';
import { DEFAULT_APPEARANCE } from '../types';

const STORAGE_KEY = 'webinti-town:profile';
const HOST_TOKEN_KEY = 'webinti-town:hostToken';
const ROOM_SLUG_KEY = 'webinti-town:roomSlug';
const ROOM_SLUG_RE = /^[a-z0-9-]{1,50}$/;

function readHostToken(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('host');
    if (fromUrl) {
      localStorage.setItem(HOST_TOKEN_KEY, fromUrl);
      return fromUrl;
    }
    return localStorage.getItem(HOST_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function readRoomSlug(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('room');
    if (fromUrl && ROOM_SLUG_RE.test(fromUrl)) {
      localStorage.setItem(ROOM_SLUG_KEY, fromUrl);
      return fromUrl;
    }
    const stored = localStorage.getItem(ROOM_SLUG_KEY);
    if (stored && ROOM_SLUG_RE.test(stored)) return stored;
    return 'demo';
  } catch {
    return 'demo';
  }
}

interface StoredProfile {
  name: string;
  appearance: Appearance;
}

function loadProfile(): StoredProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredProfile>;
    if (typeof parsed.name !== 'string') return null;
    const a = parsed.appearance;
    if (!a || typeof a !== 'object') return null;
    const clamp = (v: unknown, max: number): number => {
      const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0;
      return Math.max(0, Math.min(max, n));
    };
    return {
      name: parsed.name.slice(0, 20),
      appearance: {
        skin: clamp(a.skin, 2) as Appearance['skin'],
        hairStyle: clamp(a.hairStyle, 5) as Appearance['hairStyle'],
        hairColor: clamp(a.hairColor, 5) as Appearance['hairColor'],
        shirt: clamp(a.shirt, 9) as Appearance['shirt'],
        pants: clamp(a.pants, 5) as Appearance['pants'],
      },
    };
  } catch {
    return null;
  }
}

function saveProfile(p: StoredProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // ignore quota / private mode failures
  }
}

const FRAME_W = 32;
const FRAME_H = 48;

const SKIN_COLORS = ['#f4c79a', '#c79870', '#8b5a3a'];
const HAIR_STYLE_LABELS = ['Aucun', 'Court', 'Mi-long', 'Queue', 'Casquette', 'Mohawk'];
const HAIR_COLORS = ['#1a1a1a', '#5c3a1e', '#e8c870', '#a64427', '#9aa0a6', '#f0f0f0'];
const SHIRT_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#f3f4f6',
];
const PANTS_COLORS = ['#2d3a5a', '#1f2937', '#a08868', '#6b4426', '#6b7280', '#7c8862'];

const HAIR_COLS = 6;

interface AvatarPreviewProps {
  appearance: Appearance;
  scale: number;
}

function AvatarPreview({ appearance, scale }: AvatarPreviewProps) {
  const w = FRAME_W * scale;
  const h = FRAME_H * scale;
  const hairFrame = appearance.hairColor * HAIR_COLS + appearance.hairStyle;
  const hairCol = hairFrame % HAIR_COLS;
  const hairRow = Math.floor(hairFrame / HAIR_COLS);

  const layerStyle = {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    width: w,
    height: h,
    imageRendering: 'pixelated' as const,
    backgroundRepeat: 'no-repeat' as const,
  };

  return (
    <div style={{ position: 'relative', width: w, height: h }}>
      <div
        style={{
          ...layerStyle,
          backgroundImage: `url('${import.meta.env.BASE_URL}assets/avatars/hair_back.png')`,
          backgroundSize: `${HAIR_COLS * w}px ${HAIR_COLORS.length * h}px`,
          backgroundPosition: `-${hairCol * w}px -${hairRow * h}px`,
        }}
      />
      <div
        style={{
          ...layerStyle,
          backgroundImage: `url('${import.meta.env.BASE_URL}assets/avatars/body.png')`,
          backgroundSize: `${3 * w}px ${SKIN_COLORS.length * 4 * h}px`,
          backgroundPosition: `0px -${appearance.skin * 4 * h}px`,
        }}
      />
      <div
        style={{
          ...layerStyle,
          backgroundImage: `url('${import.meta.env.BASE_URL}assets/avatars/pants.png')`,
          backgroundSize: `${3 * w}px ${PANTS_COLORS.length * 4 * h}px`,
          backgroundPosition: `0px -${appearance.pants * 4 * h}px`,
        }}
      />
      <div
        style={{
          ...layerStyle,
          backgroundImage: `url('${import.meta.env.BASE_URL}assets/avatars/shirt.png')`,
          backgroundSize: `${3 * w}px ${SHIRT_COLORS.length * 4 * h}px`,
          backgroundPosition: `0px -${appearance.shirt * 4 * h}px`,
        }}
      />
      <div
        style={{
          ...layerStyle,
          backgroundImage: `url('${import.meta.env.BASE_URL}assets/avatars/hair.png')`,
          backgroundSize: `${HAIR_COLS * w}px ${HAIR_COLORS.length * h}px`,
          backgroundPosition: `-${hairCol * w}px -${hairRow * h}px`,
        }}
      />
    </div>
  );
}

interface SwatchProps {
  color: string;
  selected: boolean;
  onClick: () => void;
  label: string;
}

function Swatch({ color, selected, onClick, label }: SwatchProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`h-8 w-8 rounded-full ring-2 transition ${
        selected ? 'ring-indigo-400 scale-110' : 'ring-slate-700 hover:ring-slate-500'
      }`}
      style={{ backgroundColor: color }}
    />
  );
}

interface HairStyleThumbProps {
  styleIndex: number;
  selected: boolean;
  onClick: () => void;
  appearance: Appearance;
}

function HairStyleThumb({ styleIndex, selected, onClick, appearance }: HairStyleThumbProps) {
  const previewAppearance: Appearance = { ...appearance, hairStyle: styleIndex as Appearance['hairStyle'] };
  return (
    <button
      type="button"
      onClick={onClick}
      title={HAIR_STYLE_LABELS[styleIndex]}
      className={`flex flex-col items-center rounded-lg bg-slate-900/60 p-1 ring-2 transition ${
        selected ? 'ring-indigo-400 bg-indigo-500/20' : 'ring-transparent hover:ring-slate-600'
      }`}
    >
      <AvatarPreview appearance={previewAppearance} scale={1} />
      <span className="mt-1 text-[10px] text-slate-300">{HAIR_STYLE_LABELS[styleIndex]}</span>
    </button>
  );
}

export function JoinScreen() {
  const stored = loadProfile();
  const [roomSlug] = useState<string>(() => readRoomSlug());
  const [pseudo, setPseudo] = useState(stored?.name ?? '');
  const [appearance, setAppearance] = useState<Appearance>(stored?.appearance ?? DEFAULT_APPEARANCE);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    saveProfile({ name: pseudo, appearance });
  }, [pseudo, appearance]);

  const update = <K extends keyof Appearance>(key: K, value: Appearance[K]) => {
    setAppearance((a) => ({ ...a, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = pseudo.trim().slice(0, 20);
    if (!name) return;
    setSubmitting(true);
    useGameStore.getState().setName(name);
    useGameStore.getState().setAppearance(appearance);
    saveProfile({ name, appearance });
    const hostToken = readHostToken();
    const roomSlug = readRoomSlug();
    useGameStore.getState().setCurrentRoomSlug(roomSlug);
    socketManager.connect();
    socketManager.joinRoom({ roomSlug, playerName: name, appearance, hostToken });
  };

  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-slate-100">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-xl rounded-2xl bg-slate-800/80 p-8 shadow-2xl ring-1 ring-white/10 backdrop-blur"
      >
        <h1 className="mb-1 text-3xl font-bold tracking-tight">Webinti Town</h1>
        <p className="mb-4 text-sm text-slate-400">Personnalisez votre avatar.</p>

        <div className="mb-2 flex justify-center">
          <div className="rounded-lg bg-slate-900/60 p-3 ring-1 ring-slate-700">
            <AvatarPreview appearance={appearance} scale={3} />
          </div>
        </div>
        <div className="mb-4 text-center text-xs text-slate-400">
          Salle : <span className="font-mono text-slate-200">{roomSlug}</span>
        </div>

        <label className="mb-1 block text-sm font-medium">Pseudo</label>
        <input
          type="text"
          maxLength={20}
          value={pseudo}
          onChange={(e) => setPseudo(e.target.value)}
          placeholder="Votre pseudo"
          className="mb-5 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-indigo-400"
          autoFocus
        />

        <div className="mb-3">
          <label className="mb-2 block text-sm font-medium">Peau</label>
          <div className="flex gap-2">
            {SKIN_COLORS.map((c, i) => (
              <Swatch
                key={i}
                color={c}
                selected={appearance.skin === i}
                onClick={() => update('skin', i as Appearance['skin'])}
                label={`Peau ${i + 1}`}
              />
            ))}
          </div>
        </div>

        <div className="mb-3">
          <label className="mb-2 block text-sm font-medium">Coiffure</label>
          <div className="flex flex-wrap gap-2">
            {HAIR_STYLE_LABELS.map((_label, i) => (
              <HairStyleThumb
                key={i}
                styleIndex={i}
                selected={appearance.hairStyle === i}
                onClick={() => update('hairStyle', i as Appearance['hairStyle'])}
                appearance={appearance}
              />
            ))}
          </div>
        </div>

        <div className="mb-3">
          <label className="mb-2 block text-sm font-medium">Couleur des cheveux</label>
          <div className="flex gap-2">
            {HAIR_COLORS.map((c, i) => (
              <Swatch
                key={i}
                color={c}
                selected={appearance.hairColor === i}
                onClick={() => update('hairColor', i as Appearance['hairColor'])}
                label={`Cheveux ${i + 1}`}
              />
            ))}
          </div>
        </div>

        <div className="mb-3">
          <label className="mb-2 block text-sm font-medium">Haut</label>
          <div className="flex flex-wrap gap-2">
            {SHIRT_COLORS.map((c, i) => (
              <Swatch
                key={i}
                color={c}
                selected={appearance.shirt === i}
                onClick={() => update('shirt', i as Appearance['shirt'])}
                label={`Haut ${i + 1}`}
              />
            ))}
          </div>
        </div>

        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium">Pantalon</label>
          <div className="flex gap-2">
            {PANTS_COLORS.map((c, i) => (
              <Swatch
                key={i}
                color={c}
                selected={appearance.pants === i}
                onClick={() => update('pants', i as Appearance['pants'])}
                label={`Pantalon ${i + 1}`}
              />
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting || !pseudo.trim()}
          className="w-full rounded-lg bg-indigo-500 px-4 py-2.5 font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Connexion...' : 'Rejoindre'}
        </button>
      </form>
    </div>
  );
}
