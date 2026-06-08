import { useEffect, useState } from 'react';
import { socketManager } from '../../network/SocketManager';

// Notif « toc toc » : quelqu'un veut te parler. PERSISTANTE — elle reste affichée
// jusqu'à ce que tu cliques « Vu ». Le son est joué par SocketManager.

interface Toast { id: string; name: string }

export function KnockNotify() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const off = socketManager.onKnock((p) => {
      const id = `${p.fromPlayerId}-${Date.now()}`;
      // Max 6 en pile ; pas d'auto-dismiss (l'utilisateur clique « Vu »).
      setToasts((t) => [...t, { id, name: p.fromName }].slice(-6));
    });
    return off;
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-24 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col items-stretch gap-2 px-3">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-3 rounded-xl bg-indigo-600/95 px-4 py-3 text-white shadow-2xl ring-1 ring-indigo-300/40 backdrop-blur"
        >
          <span className="text-2xl">👋</span>
          <span className="min-w-0 flex-1 text-sm font-semibold">
            <span className="font-bold">{t.name}</span> aimerait te parler
          </span>
          <button
            onClick={() => setToasts((arr) => arr.filter((x) => x.id !== t.id))}
            className="shrink-0 rounded-lg bg-white/90 px-3 py-1.5 text-sm font-bold text-indigo-700 transition hover:bg-white"
          >
            Vu
          </button>
        </div>
      ))}
    </div>
  );
}
