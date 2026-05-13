import { useEffect, useMemo } from 'react';
import { useGameStore } from '../../stores/gameStore';
import type { InteractiveObject } from '../../types';

export function LinkModal() {
  const openId = useGameStore((s) => s.openLinkId);
  const setOpen = useGameStore((s) => s.setOpenLink);
  const objects = useGameStore((s) => s.interactiveObjects);

  const link = useMemo<InteractiveObject | null>(() => {
    if (!openId) return null;
    return objects.find((o) => o.id === openId) ?? null;
  }, [openId, objects]);

  const isOpen = openId !== null && link !== null && link.type === 'link';

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, setOpen]);

  if (!isOpen || !link || link.type !== 'link') return null;

  const handleOpen = () => {
    window.open(link.data.url, '_blank', 'noopener,noreferrer');
    setOpen(null);
  };

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(null);
      }}
    >
      <div className="flex w-[420px] max-w-[95vw] flex-col rounded-2xl bg-slate-900 p-5 text-slate-100 shadow-2xl ring-1 ring-white/10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-indigo-200">{link.data.label}</h2>
          <button
            onClick={() => setOpen(null)}
            className="rounded-md bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600"
          >
            Fermer
          </button>
        </div>
        <a
          href={link.data.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-4 block truncate rounded-md bg-slate-800/60 px-3 py-2 text-sm text-indigo-300 underline ring-1 ring-white/5 hover:text-indigo-200"
        >
          {link.data.url}
        </a>
        <button
          onClick={handleOpen}
          className="w-full rounded-lg bg-indigo-500 px-4 py-2.5 font-semibold text-white transition hover:bg-indigo-400"
        >
          Ouvrir le lien &rarr;
        </button>
        <div className="mt-3 text-center text-xs text-slate-400">Esc pour fermer</div>
      </div>
    </div>
  );
}
