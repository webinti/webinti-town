import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';
import type { InteractiveObject } from '../../types';

export function NoteModal() {
  const openId = useGameStore((s) => s.openNoteId);
  const setOpen = useGameStore((s) => s.setOpenNote);
  const objects = useGameStore((s) => s.interactiveObjects);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const hostPlayerId = useGameStore((s) => s.hostPlayerId);
  const isHost = !!localPlayerId && localPlayerId === hostPlayerId;

  const note = useMemo<InteractiveObject | null>(() => {
    if (!openId) return null;
    return objects.find((o) => o.id === openId) ?? null;
  }, [openId, objects]);

  const isOpen = openId !== null && note !== null && note.type === 'note';

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setEditing(false);
      return;
    }
    if (!editing && note && note.type === 'note') {
      setDraftTitle(note.data.title);
      setDraftContent(note.data.content);
    }
  }, [isOpen, note, editing]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (editing) setEditing(false);
        else setOpen(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, setOpen, editing]);

  if (!isOpen || !note || note.type !== 'note') return null;

  const handleSave = () => {
    socketManager.updateNote(note.id, draftTitle.trim() || note.data.title, draftContent);
    setEditing(false);
  };

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !editing) setOpen(null);
      }}
    >
      <div className="flex max-h-[85vh] w-[560px] max-w-[95vw] flex-col rounded-2xl bg-slate-900 p-5 text-slate-100 shadow-2xl ring-1 ring-white/10">
        <div className="mb-4 flex items-center justify-between gap-3">
          {editing ? (
            <input
              type="text"
              value={draftTitle}
              maxLength={80}
              onChange={(e) => setDraftTitle(e.target.value)}
              className="flex-1 rounded-md border border-indigo-400/40 bg-slate-800 px-3 py-1.5 text-lg font-semibold text-indigo-100 outline-none focus:border-indigo-400"
              placeholder="Titre"
              autoFocus
            />
          ) : (
            <h2 className="flex-1 text-lg font-semibold text-indigo-200">{note.data.title}</h2>
          )}
          <div className="flex gap-2">
            {isHost && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="rounded-md bg-indigo-500 px-3 py-1 text-sm font-semibold text-white hover:bg-indigo-400"
              >
                Modifier
              </button>
            )}
            {editing && (
              <>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-md bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600"
                >
                  Annuler
                </button>
                <button
                  onClick={handleSave}
                  className="rounded-md bg-emerald-500 px-3 py-1 text-sm font-semibold text-white hover:bg-emerald-400"
                >
                  Enregistrer
                </button>
              </>
            )}
            {!editing && (
              <button
                onClick={() => setOpen(null)}
                className="rounded-md bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600"
              >
                Fermer
              </button>
            )}
          </div>
        </div>

        {editing ? (
          <textarea
            value={draftContent}
            maxLength={2000}
            onChange={(e) => setDraftContent(e.target.value)}
            rows={12}
            className="resize-none rounded-md border border-indigo-400/40 bg-slate-800 p-3 font-mono text-sm leading-relaxed text-slate-100 outline-none focus:border-indigo-400"
            placeholder="Contenu de la note (max 2000 caractères)..."
          />
        ) : (
          <pre className="overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-slate-800/60 p-3 font-mono text-sm leading-relaxed text-slate-200 ring-1 ring-white/5">
            {note.data.content}
          </pre>
        )}

        <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
          <span>
            {editing ? `${draftContent.length} / 2000` : (isHost ? 'Hôte : "Modifier" pour éditer' : 'Esc pour fermer')}
          </span>
          <span>Esc pour fermer</span>
        </div>
      </div>
    </div>
  );
}
