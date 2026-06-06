import { useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useAuthStore } from '../stores/authStore';
import { socketManager } from '../network/SocketManager';
import type { Appearance } from '../types';
import { DEFAULT_APPEARANCE } from '../types';
import { AvatarPreview, AvatarControls, clampAppearance } from './avatar/AvatarCustomizer';
import { readLastPosition } from '../lastPosition';

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
    // Respawn à la dernière position connue de cette salle (sinon spawn par défaut).
    const pos = readLastPosition(roomSlug);
    socketManager.joinRoom({
      roomSlug, playerName: name, appearance, hostToken,
      spawnX: pos?.x, spawnY: pos?.y,
      email: user?.email,
    });
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

          <AvatarControls appearance={appearance} onChange={setAppearance} />

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
