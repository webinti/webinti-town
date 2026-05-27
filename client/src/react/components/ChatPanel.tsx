import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';
import type { ChatMessage, ChatMessageType } from '../../types';

const SHIRT_HEX = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f3f4f6',
];

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function shirtColorFor(playerId: string, players: Map<string, { appearance: { shirt: number } }>): string {
  const p = players.get(playerId);
  const idx = p?.appearance.shirt ?? 5;
  return SHIRT_HEX[idx] ?? '#6366f1';
}

export function ChatPanel() {
  const open = useGameStore((s) => s.chatPanelOpen);
  const chat = useGameStore((s) => s.chat);
  const unread = useGameStore((s) => s.unreadChat);
  const localId = useGameStore((s) => s.localPlayerId);
  const players = useGameStore((s) => s.players);
  const setOpen = useGameStore((s) => s.setChatPanelOpen);
  const setInputFocused = useGameStore((s) => s.setInputFocused);

  const [tab, setTab] = useState<ChatMessageType>('global');
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollPosRef = useRef<number>(0);
  const lastTypingEmitRef = useRef<number>(0);

  // Keyboard: C toggles, Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (e.key === 'Escape') {
        if (open) {
          e.preventDefault();
          setOpen(false);
          inputRef.current?.blur();
        }
        return;
      }
      if (inField) return;
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        const willOpen = !useGameStore.getState().chatPanelOpen;
        setOpen(willOpen);
        if (willOpen) {
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Persist scroll position when toggling
  useLayoutEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = scrollPosRef.current || listRef.current.scrollHeight;
    }
  }, [open]);

  // Auto-scroll on new message
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chat, open]);

  const handleSend = useCallback(() => {
    const value = text.trim();
    if (!value) return;
    socketManager.sendChat(value.slice(0, 300), tab);
    setText('');
  }, [text, tab]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="pointer-events-auto fixed bottom-24 right-4 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg ring-1 ring-white/20 hover:bg-indigo-500"
        title="Chat (C)"
      >
        <span className="text-xl">{'\u{1F4AC}'}</span>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white ring-2 ring-slate-900">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="pointer-events-auto fixed right-4 top-20 flex h-[60vh] w-80 flex-col rounded-lg bg-slate-900/95 text-slate-100 shadow-2xl ring-1 ring-white/10 backdrop-blur">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('global')}
            className={`rounded px-2 py-1 text-xs font-semibold ${tab === 'global' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            Global
          </button>
          <button
            onClick={() => setTab('local')}
            className={`rounded px-2 py-1 text-xs font-semibold ${tab === 'local' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            Proximité
          </button>
        </div>
        <button
          onClick={() => {
            scrollPosRef.current = listRef.current?.scrollTop ?? 0;
            setOpen(false);
          }}
          className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-white"
          title="Fermer (Esc)"
        >
          {'✕'}
        </button>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-2 text-sm">
        {chat.length === 0 && (
          <div className="px-2 py-6 text-center text-xs text-slate-500">
            Aucun message. Dites bonjour !
          </div>
        )}
        {chat.map((msg) => (
          <ChatRow key={msg.id} msg={msg} localId={localId} players={players} />
        ))}
      </div>

      <div className="border-t border-white/10 p-2">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value.slice(0, 300));
            const now = Date.now();
            if (now - lastTypingEmitRef.current >= 500) {
              lastTypingEmitRef.current = now;
              socketManager.sendTypingStart();
            }
          }}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={tab === 'global' ? 'Message global...' : 'Message proximité...'}
          rows={2}
          maxLength={300}
          className="w-full resize-none rounded bg-slate-800 px-2 py-1 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-indigo-400"
        />
        <div className="mt-1 flex justify-between text-[10px] text-slate-500">
          <span>Entrée pour envoyer · Maj+Entrée saut de ligne</span>
          <span>{text.length}/300</span>
        </div>
      </div>
    </div>
  );
}

function ChatRow({
  msg,
  localId,
  players,
}: {
  msg: ChatMessage;
  localId: string | null;
  players: Map<string, { appearance: { shirt: number } }>;
}) {
  const isMine = msg.playerId === localId;
  const borderColor = msg.type === 'local' ? 'border-l-blue-400' : 'border-l-purple-400';
  const bg = isMine ? 'bg-indigo-500/10' : 'bg-slate-800/40';
  const color = shirtColorFor(msg.playerId, players);
  return (
    <div
      className={`mb-1.5 animate-fadein rounded border-l-2 px-2 py-1 ${borderColor} ${bg}`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block h-3 w-3 flex-shrink-0 rounded-full ring-1 ring-white/20"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs font-bold text-slate-100">{msg.playerName}</span>
        <span className="text-[10px] text-slate-400">{formatTime(msg.timestamp)}</span>
      </div>
      <div className="ml-4.5 break-words pl-0.5 text-[13px] text-slate-200">{msg.text}</div>
    </div>
  );
}
