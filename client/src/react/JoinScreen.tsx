import { useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import { socketManager } from '../network/SocketManager';

const AVATAR_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
];

export function JoinScreen() {
  const [pseudo, setPseudo] = useState('');
  const [avatar, setAvatar] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = pseudo.trim().slice(0, 20);
    if (!name) return;
    setSubmitting(true);
    useGameStore.getState().setName(name);
    useGameStore.getState().setAvatar(avatar);
    socketManager.connect();
    socketManager.joinRoom({ slug: 'demo', name, avatar });
  };

  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-slate-100">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl bg-slate-800/80 p-8 shadow-2xl ring-1 ring-white/10 backdrop-blur"
      >
        <h1 className="mb-1 text-3xl font-bold tracking-tight">WebintiSpace</h1>
        <p className="mb-6 text-sm text-slate-400">
          Rejoignez la salle pour explorer.
        </p>

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

        <label className="mb-2 block text-sm font-medium">Avatar</label>
        <div className="mb-6 grid grid-cols-8 gap-2">
          {AVATAR_COLORS.map((color, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setAvatar(i)}
              className={`h-10 w-10 rounded-full ring-2 transition ${
                avatar === i ? 'ring-white scale-110' : 'ring-transparent'
              }`}
              style={{ backgroundColor: color }}
              aria-label={`Avatar ${i}`}
            />
          ))}
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
