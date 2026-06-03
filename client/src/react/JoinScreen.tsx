import { useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useAuthStore } from '../stores/authStore';
import { socketManager } from '../network/SocketManager';
import type { Appearance } from '../types';
import {
  DEFAULT_APPEARANCE,
  SKIN_COUNT,
  OUTFIT_COUNT,
  HAIR_STYLE_COUNT,
  HAIR_COLOR_COUNT,
} from '../types';

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

// Sanitise l'apparence stockée sur le user PocketBase (champ JSON) vers un
// Appearance valide et borné.
function clampAppearance(a: unknown): Appearance {
  const o = (a && typeof a === 'object' ? a : {}) as Partial<Appearance>;
  const clamp = (v: unknown, max: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0;
    return Math.max(0, Math.min(max, n));
  };
  return {
    skin: clamp(o.skin, SKIN_COUNT - 1),
    outfit: clamp(o.outfit, OUTFIT_COUNT - 1),
    hairStyle: clamp(o.hairStyle, HAIR_STYLE_COUNT - 1),
    hairColor: clamp(o.hairColor, HAIR_COLOR_COUNT - 1),
  };
}

const FRAME_W = 32;
const FRAME_H = 64;

const HAIR_STYLE_LABELS = ['Court', 'Ondulé', 'Mi-long', 'Bouclé', 'Long', 'Chignon'];
// Pastilles indicatives pour les 4 couleurs de cheveux LimeZu (variantes 01-04).
const HAIR_COLOR_SWATCHES = ['#3b2a1a', '#6b4423', '#c98a3a', '#1a1a1a'];

const hairVariantOf = (a: Appearance) => a.hairStyle * HAIR_COLOR_COUNT + a.hairColor;

interface AvatarPreviewProps {
  appearance: Appearance;
  scale: number;
}

// Affiche la frame "face, idle" (col 0) en superposant les 3 couches.
// Layout des planches: row = variante*4 + dir ; frame face-idle = variante*4.
function AvatarPreview({ appearance, scale }: AvatarPreviewProps) {
  const w = FRAME_W * scale;
  const h = FRAME_H * scale;

  const layerStyle = {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    width: w,
    height: h,
    imageRendering: 'pixelated' as const,
    backgroundRepeat: 'no-repeat' as const,
  };

  const layer = (file: string, variant: number, count: number) => ({
    ...layerStyle,
    backgroundImage: `url('${import.meta.env.BASE_URL}assets/avatars/${file}.png')`,
    backgroundSize: `${3 * w}px ${count * 4 * h}px`,
    backgroundPosition: `0px -${variant * 4 * h}px`,
  });

  return (
    <div style={{ position: 'relative', width: w, height: h }}>
      <div style={layer('body', appearance.skin, SKIN_COUNT)} />
      <div style={layer('outfit', appearance.outfit, OUTFIT_COUNT)} />
      <div style={layer('hair', hairVariantOf(appearance), HAIR_STYLE_COUNT * HAIR_COLOR_COUNT)} />
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

interface VariantThumbProps {
  base: Appearance;
  override: Partial<Appearance>;
  selected: boolean;
  onClick: () => void;
  title?: string;
}

// Vignette cliquable : prévisualise l'apparence courante avec un champ modifié.
function VariantThumb({ base, override, selected, onClick, title }: VariantThumbProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex items-center justify-center overflow-hidden rounded-lg bg-slate-900/60 p-1 ring-2 transition ${
        selected ? 'ring-indigo-400 bg-indigo-500/20' : 'ring-transparent hover:ring-slate-600'
      }`}
    >
      <AvatarPreview appearance={{ ...base, ...override }} scale={1} />
    </button>
  );
}

// Indices [0, n[ — petit utilitaire pour mapper sur les variantes.
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export function JoinScreen() {
  const user = useAuthStore((s) => s.user);
  const saveProfile = useAuthStore((s) => s.saveProfile);
  const logout = useAuthStore((s) => s.logout);

  const [roomSlug] = useState<string>(() => readRoomSlug());
  // Pré-rempli depuis le user connecté (PocketBase), plus de localStorage.
  const [pseudo, setPseudo] = useState(user?.name ?? '');
  const [appearance, setAppearance] = useState<Appearance>(
    user?.appearance ? clampAppearance(user.appearance) : DEFAULT_APPEARANCE,
  );
  const [submitting, setSubmitting] = useState(false);

  const update = <K extends keyof Appearance>(key: K, value: Appearance[K]) => {
    setAppearance((a) => ({ ...a, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = pseudo.trim().slice(0, 20);
    if (!name) return;
    setSubmitting(true);
    // Persiste pseudo + avatar sur le compte (best-effort, ne bloque pas l'entrée).
    try {
      await saveProfile(name, appearance);
    } catch {
      /* on entre quand même si la sauvegarde échoue */
    }
    useGameStore.getState().setName(name);
    useGameStore.getState().setAppearance(appearance);
    const hostToken = readHostToken();
    const roomSlug = readRoomSlug();
    useGameStore.getState().setCurrentRoomSlug(roomSlug);
    socketManager.connect();
    socketManager.joinRoom({ roomSlug, playerName: name, appearance, hostToken });
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-slate-100">
      <div className="flex min-h-full w-full items-center justify-center p-4">
        <form
          onSubmit={handleSubmit}
          className="my-4 w-full max-w-xl rounded-2xl bg-slate-800/80 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur"
        >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Webinti Town</h1>
          <button
            type="button"
            onClick={logout}
            className="mt-1 shrink-0 text-xs text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
          >
            Déconnexion
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-400">
          Personnalisez votre avatar.
          {user?.email ? <span className="text-slate-500"> · {user.email}</span> : null}
        </p>

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
          <div className="flex flex-wrap gap-2">
            {range(SKIN_COUNT).map((i) => (
              <VariantThumb
                key={i}
                base={appearance}
                override={{ skin: i }}
                selected={appearance.skin === i}
                onClick={() => update('skin', i)}
                title={`Peau ${i + 1}`}
              />
            ))}
          </div>
        </div>

        <div className="mb-3">
          <label className="mb-2 block text-sm font-medium">Tenue</label>
          <div className="flex flex-wrap gap-2">
            {range(OUTFIT_COUNT).map((i) => (
              <VariantThumb
                key={i}
                base={appearance}
                override={{ outfit: i }}
                selected={appearance.outfit === i}
                onClick={() => update('outfit', i)}
                title={`Tenue ${i + 1}`}
              />
            ))}
          </div>
        </div>

        <div className="mb-3">
          <label className="mb-2 block text-sm font-medium">Coiffure</label>
          <div className="flex flex-wrap gap-2">
            {range(HAIR_STYLE_COUNT).map((i) => (
              <VariantThumb
                key={i}
                base={appearance}
                override={{ hairStyle: i }}
                selected={appearance.hairStyle === i}
                onClick={() => update('hairStyle', i)}
                title={HAIR_STYLE_LABELS[i] ?? `Coiffure ${i + 1}`}
              />
            ))}
          </div>
        </div>

        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium">Couleur des cheveux</label>
          <div className="flex gap-2">
            {range(HAIR_COLOR_COUNT).map((i) => (
              <Swatch
                key={i}
                color={HAIR_COLOR_SWATCHES[i] ?? '#888'}
                selected={appearance.hairColor === i}
                onClick={() => update('hairColor', i)}
                label={`Cheveux ${i + 1}`}
              />
            ))}
          </div>
        </div>

          <div className="sticky bottom-0 -mx-6 -mb-6 mt-4 rounded-b-2xl border-t border-white/10 bg-slate-800/95 px-6 py-3 backdrop-blur">
            <button
              type="submit"
              disabled={submitting || !pseudo.trim()}
              className="w-full rounded-lg bg-indigo-500 px-4 py-2.5 font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Connexion...' : 'Rejoindre'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
