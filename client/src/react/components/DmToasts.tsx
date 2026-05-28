import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';

interface Toast { id: number; fromId: string; fromName: string; preview: string }

/**
 * F10 — Toasts éphémères quand un DM arrive ET que le chat n'est pas ouvert
 * sur la conversation correspondante. Clic = ouvre le chat + onglet Privés
 * sur le bon contact.
 */
export function DmToasts() {
  const dmConversations = useGameStore((s) => s.dmConversations);
  const me = useGameStore((s) => s.localPlayerId);
  const players = useGameStore((s) => s.players);
  const seen = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  useEffect(() => {
    if (!me) return;
    if (!initialized.current) {
      // First batch (state initial reçu du serveur) : enregistrer tous les IDs
      for (const list of dmConversations.values()) {
        for (const m of list) seen.current.add(m.id);
      }
      initialized.current = true;
      return;
    }
    const state = useGameStore.getState();
    const fresh: Toast[] = [];
    for (const [otherId, list] of dmConversations) {
      for (const m of list) {
        if (seen.current.has(m.id)) continue;
        seen.current.add(m.id);
        // Toaster uniquement les messages reçus (pas envoyés)
        if (m.from === me) continue;
        // Pas de toast si la conv est ouverte ET activement regardée
        const isViewing = state.chatPanelOpen && state.activeDmTarget === otherId;
        if (isViewing) continue;
        const player = players.get(m.from);
        const fromName = player?.name ?? m.from.slice(0, 6);
        const preview = m.text ? m.text.slice(0, 60) : (m.attachment ? '📎 pièce jointe' : '…');
        fresh.push({ id: nextId.current++, fromId: m.from, fromName, preview });
      }
    }
    if (fresh.length > 0) {
      setToasts((prev) => [...prev, ...fresh].slice(-3));
    }
  }, [dmConversations, me, players]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts((prev) => prev.slice(1)), 4500);
    return () => clearTimeout(t);
  }, [toasts]);

  if (toasts.length === 0) return null;

  const handleClick = (fromId: string, id: number) => {
    const s = useGameStore.getState();
    s.setChatPanelOpen(true);
    s.setActiveDmTarget(fromId);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-30 flex flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => handleClick(t.fromId, t.id)}
          className="pointer-events-auto max-w-xs rounded-md bg-emerald-600/95 px-3 py-2 text-left text-xs text-white shadow-lg ring-1 ring-emerald-300/40 hover:bg-emerald-500"
        >
          <div className="font-semibold">💬 {t.fromName}</div>
          <div className="mt-0.5 truncate text-emerald-100">{t.preview}</div>
        </button>
      ))}
    </div>
  );
}
