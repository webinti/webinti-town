import { useState } from 'react';
import { socketManager } from '../../network/SocketManager';
import { useGameStore } from '../../stores/gameStore';
import type { KanbanCard, KanbanColumn } from '../../types';

const COLUMN_LABELS: Record<KanbanColumn, string> = {
  todo: 'À faire',
  doing: 'En cours',
  done: 'Terminé',
};

const COLUMN_ORDER: KanbanColumn[] = ['todo', 'doing', 'done'];

const COLUMN_BG: Record<KanbanColumn, string> = {
  todo: 'bg-amber-100/5 ring-amber-300/20',
  doing: 'bg-sky-100/5 ring-sky-300/20',
  done: 'bg-emerald-100/5 ring-emerald-300/20',
};

export function KanbanModal() {
  const openId = useGameStore((s) => s.openKanbanId);
  const setOpen = useGameStore((s) => s.setOpenKanban);
  const cards = useGameStore((s) => s.kanbanCards);
  if (!openId) return null;

  const byColumn: Record<KanbanColumn, KanbanCard[]> = { todo: [], doing: [], done: [] };
  for (const c of cards) byColumn[c.column].push(c);

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-full max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-slate-900 text-slate-100 ring-1 ring-white/10 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-lg font-semibold">Tableau d'idées</h2>
          <button
            onClick={() => setOpen(null)}
            className="rounded-md bg-white/10 px-3 py-1 text-sm hover:bg-white/20"
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        <div className="flex flex-1 gap-3 overflow-auto p-4">
          {COLUMN_ORDER.map((col) => (
            <div
              key={col}
              className={`flex w-1/3 min-w-[260px] flex-col gap-2 rounded-lg p-3 ring-1 ${COLUMN_BG[col]}`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide">{COLUMN_LABELS[col]}</h3>
                <span className="text-xs text-slate-400">{byColumn[col].length}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-auto">
                {col === 'todo' && <CreateCardForm />}
                {byColumn[col].map((c) => (
                  <CardView key={c.id} card={c} />
                ))}
                {byColumn[col].length === 0 && (
                  <div className="rounded-md border border-dashed border-white/10 p-3 text-center text-xs text-slate-500">
                    Aucune carte
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CreateCardForm() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const submit = () => {
    const t = title.trim();
    if (t.length < 1 || t.length > 80) return;
    socketManager.kanbanCreate(t, description.slice(0, 500));
    setTitle('');
    setDescription('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-dashed border-white/20 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
      >
        + Nouvelle idée
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-md bg-slate-800/80 p-3 ring-1 ring-indigo-400/40">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 80))}
        placeholder="Titre de l'idée (max 80)"
        className="rounded bg-slate-900 px-2 py-1 text-sm outline-none ring-1 ring-white/10 focus:ring-indigo-400"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value.slice(0, 500))}
        placeholder="Description (optionnel, max 500)"
        rows={3}
        className="resize-none rounded bg-slate-900 px-2 py-1 text-xs outline-none ring-1 ring-white/10 focus:ring-indigo-400"
      />
      <div className="flex gap-2">
        <button
          disabled={title.trim().length < 1}
          onClick={submit}
          className="rounded bg-indigo-600 px-3 py-1 text-xs font-semibold hover:bg-indigo-500 disabled:opacity-40"
        >
          Ajouter
        </button>
        <button
          onClick={() => { setOpen(false); setTitle(''); setDescription(''); }}
          className="rounded bg-white/10 px-3 py-1 text-xs hover:bg-white/20"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

function CardView({ card }: { card: KanbanCard }) {
  return (
    <div className="rounded-md bg-slate-800/80 p-3 ring-1 ring-white/10">
      <div className="text-sm font-semibold">{card.title}</div>
      {card.description && (
        <div className="mt-1 whitespace-pre-wrap text-xs text-slate-300">{card.description}</div>
      )}
      <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">
        Par {card.authorName}
      </div>
    </div>
  );
}
