import { useEffect, useState } from 'react';
import { socketManager } from '../../network/SocketManager';
import { useGameStore } from '../../stores/gameStore';
import { wavePlayer, walkToPlayer } from '../playerInteractions';
import { relativeTimeFr } from './kanbanRelativeTime';

// Notif « coucou / toc toc » : quelqu'un t'a fait signe. PERSISTANTE — reste
// affichée jusqu'à action. Façon Gather : on peut répondre (faire signe en
// retour) ou aller le rejoindre. Le son est joué par SocketManager.

interface Toast {
  id: string;
  fromPlayerId: string;
  name: string;
  at: number;
}

export function KnockNotify() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Tick toutes les 30 s pour rafraîchir le temps relatif (« il y a 3min »).
  const [, setNow] = useState(0);

  useEffect(() => {
    const off = socketManager.onKnock((p) => {
      const at = Date.now();
      const id = `${p.fromPlayerId}-${at}`;
      // Max 6 en pile ; pas d'auto-dismiss (l'utilisateur agit).
      setToasts((t) => [...t, { id, fromPlayerId: p.fromPlayerId, name: p.fromName, at }].slice(-6));
    });
    return off;
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const t = window.setInterval(() => setNow((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [toasts.length]);

  const dismiss = (id: string) => setToasts((arr) => arr.filter((x) => x.id !== id));

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-24 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col items-stretch gap-2 px-3">
      {toasts.map((t) => {
        const knownPos = useGameStore.getState().players.has(t.fromPlayerId);
        return (
          <div
            key={t.id}
            className="pointer-events-auto rounded-xl bg-white px-4 py-3 text-slate-900 shadow-2xl ring-1 ring-black/10"
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl leading-none">👋</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight">
                  <span className="font-bold">{t.name}</span> vous a fait signe
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{relativeTimeFr(t.at)}</p>
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                title="Ignorer"
                aria-label="Ignorer"
              >
                ✕
              </button>
            </div>
            <div className="mt-2.5 flex gap-2">
              <button
                onClick={() => {
                  wavePlayer(t.fromPlayerId);
                  dismiss(t.id);
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-100 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-200 active:scale-95"
              >
                <span>👋</span> Répondre
              </button>
              {knownPos && (
                <button
                  onClick={() => {
                    walkToPlayer(t.fromPlayerId);
                    dismiss(t.id);
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 active:scale-95"
                  title="Me téléporter à côté de ce joueur"
                >
                  <span>📍</span> Aller vers
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
