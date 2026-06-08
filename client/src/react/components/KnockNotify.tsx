import { useEffect, useState } from 'react';
import { socketManager } from '../../network/SocketManager';

// Bandeau quand quelqu'un te « toque » (veut te parler). Le son est joué par
// SocketManager ; ici on affiche juste le message.

interface Toast { id: string; name: string }

export function KnockNotify() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const off = socketManager.onKnock((p) => {
      const id = `${p.fromPlayerId}-${Date.now()}`;
      setToasts((t) => [...t, { id, name: p.fromName }].slice(-4));
      window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
    });
    return off;
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-32 z-50 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="rounded-full bg-indigo-600/90 px-4 py-2 text-sm font-semibold text-white shadow-lg ring-1 ring-indigo-300/40 backdrop-blur"
        >
          👋 {t.name} aimerait te parler
        </div>
      ))}
    </div>
  );
}
