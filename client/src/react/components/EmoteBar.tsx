import { useEffect } from 'react';
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
    <>
      {EMOTES.map((e) => (
        <button
          key={e.type}
          onClick={() => socketManager.sendEmote(e.type)}
          title={`${e.type} (${e.key})`}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700 text-lg transition hover:bg-indigo-500"
        >
          <span>{e.emoji}</span>
        </button>
      ))}
    </>
  );
}
