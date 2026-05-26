import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';

interface Toast { id: number; text: string }

export function KanbanToasts() {
  const cards = useGameStore((s) => s.kanbanCards);
  const me = useGameStore((s) => s.localPlayerId);
  const seen = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  useEffect(() => {
    if (!initialized.current) {
      // First batch: just register IDs, don't toast for the existing state.
      for (const c of cards) seen.current.add(c.id);
      initialized.current = true;
      return;
    }
    const fresh: Toast[] = [];
    for (const c of cards) {
      if (seen.current.has(c.id)) continue;
      seen.current.add(c.id);
      if (c.authorId === me) continue; // don't toast our own creations
      fresh.push({ id: nextId.current++, text: `${c.authorName} a ajouté : ${c.title}` });
    }
    if (fresh.length > 0) {
      setToasts((prev) => [...prev, ...fresh].slice(-3));
    }
    // Also clean up IDs that disappeared (deletes), so a re-add gets a toast.
    const live = new Set(cards.map((c) => c.id));
    for (const id of seen.current) if (!live.has(id)) seen.current.delete(id);
  }, [cards, me]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts((prev) => prev.slice(1)), 4000);
    return () => clearTimeout(t);
  }, [toasts]);

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-20 z-30 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto rounded-md bg-indigo-600/95 px-3 py-2 text-xs text-white shadow-lg ring-1 ring-indigo-300/40"
        >
          💡 {t.text}
        </div>
      ))}
    </div>
  );
}
