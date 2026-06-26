import { useEffect, useState } from 'react';
import { socketManager } from '../../network/SocketManager';
import type { EmoteType } from '../../types';
import { gameShortcutsBlocked } from '../../utils/inputGuard';

const EMOTES: Array<{ type: EmoteType; emoji: string; key: string }> = [
  { type: 'wave', emoji: '\u{1F44B}', key: '1' },
  { type: 'thumbsup', emoji: '\u{1F44D}', key: '2' },
  { type: 'laugh', emoji: '\u{1F602}', key: '3' },
  { type: 'heart', emoji: '❤️', key: '4' },
  { type: 'question', emoji: '❓', key: '5' },
  { type: 'exclaim', emoji: '❗', key: '6' },
];

export function EmoteBar() {
  // Barre minimale : un seul bouton 😊 qui ouvre la palette de réactions (façon
  // Gather). Les raccourcis 1-6 restent actifs sans ouvrir le popover.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if (gameShortcutsBlocked()) return;
      const m = EMOTES.find((x) => x.key === e.key);
      if (!m) return;
      e.preventDefault();
      socketManager.sendEmote(m.type);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative">
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Réactions (1-6)"
        aria-pressed={open}
        className={`flex h-9 w-9 items-center justify-center rounded-full text-lg transition ${
          open ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-200 hover:bg-indigo-500'
        }`}
      >
        <span>😊</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 z-50 mb-2 flex -translate-x-1/2 gap-1 rounded-2xl bg-slate-900/95 p-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur">
          {EMOTES.map((e) => (
            <button
              key={e.type}
              onClick={() => { socketManager.sendEmote(e.type); setOpen(false); }}
              title={`${e.type} (${e.key})`}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700 text-lg transition hover:bg-indigo-500"
            >
              <span>{e.emoji}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
