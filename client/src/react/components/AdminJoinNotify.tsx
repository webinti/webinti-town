import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';

// Notifie l'ADMIN quand un participant se connecte : petit bandeau in-app +
// notification bureau (API Notification, si la permission est accordée).

interface JoinToast { id: string; name: string }

export function AdminJoinNotify() {
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const hostPlayerId = useGameStore((s) => s.hostPlayerId);
  const isAdmin = !!localPlayerId && localPlayerId === hostPlayerId;
  const [toasts, setToasts] = useState<JoinToast[]>([]);
  const permRequested = useRef(false);

  useEffect(() => {
    if (!isAdmin) return;
    // Demande (une fois) la permission de notification bureau.
    if (
      !permRequested.current &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default'
    ) {
      permRequested.current = true;
      void Notification.requestPermission().catch(() => { /* ignore */ });
    }
    const off = socketManager.onPlayerJoined((p) => {
      if (p.playerId === localPlayerId) return; // pas soi-même
      const id = `${p.playerId}-${Date.now()}`;
      setToasts((t) => [...t, { id, name: p.name }].slice(-4));
      window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Webinti Town', {
            body: `${p.name} vient de se connecter`,
            tag: 'webinti-join',
          });
        }
      } catch { /* ignore */ }
    });
    return off;
  }, [isAdmin, localPlayerId]);

  if (!isAdmin || toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-20 z-50 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="rounded-full bg-emerald-600/90 px-4 py-1.5 text-sm font-semibold text-white shadow-lg ring-1 ring-emerald-300/40 backdrop-blur"
        >
          👋 {t.name} s'est connecté
        </div>
      ))}
    </div>
  );
}
