import { useState, Fragment } from 'react';
import { socketManager } from '../../network/SocketManager';
import { useGameStore } from '../../stores/gameStore';
import type { KanbanCard, KanbanColumn } from '../../types';
import { relativeTimeFr } from './kanbanRelativeTime';

function useIsHost(): boolean {
  return useGameStore((s) => s.hostPlayerId !== null && s.hostPlayerId === s.localPlayerId);
}
function useLocalPlayerId(): string | null {
  return useGameStore((s) => s.localPlayerId);
}

function canMove(
  card: KanbanCard,
  targetColumn: KanbanColumn,
  isHost: boolean,
  me: string | null,
): boolean {
  if (me === null) return false;
  const isAuthor = card.authorId === me;
  if (targetColumn === 'done' || card.column === 'done') return isHost;
  if (card.column === targetColumn) return isAuthor || isHost;
  // todo ↔ doing cross-column move
  return isAuthor;
}

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
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<KanbanColumn | null>(null);
  const [hoverGap, setHoverGap] = useState<{ column: KanbanColumn; index: number } | null>(null);
  const isHost = useIsHost();
  const me = useLocalPlayerId();
  if (!openId) return null;

  // Tri d'affichage : plus récent en haut.
  // - Terminé   → par completedAt desc (date où la carte a été marquée terminée)
  // - À faire / En cours → par createdAt desc (date de création)
  const byColumn: Record<KanbanColumn, KanbanCard[]> = { todo: [], doing: [], done: [] };
  for (const c of cards) byColumn[c.column].push(c);
  byColumn.done.sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt));
  byColumn.todo.sort((a, b) => b.createdAt - a.createdAt);
  byColumn.doing.sort((a, b) => b.createdAt - a.createdAt);

  function renderDropGap(col: KanbanColumn, index: number) {
    const dragged = cards.find((c) => c.id === draggedId);
    const active = hoverGap?.column === col && hoverGap.index === index;
    return (
      <div
        key={`gap-${col}-${index}`}
        onDragOver={(e) => {
          if (!dragged) return;
          if (!canMove(dragged, col, isHost, me)) return;
          e.preventDefault();
          e.stopPropagation();
          setHoverGap({ column: col, index });
        }}
        onDragLeave={() => {
          if (active) setHoverGap(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setHoverGap(null);
          setHoverColumn(null);
          if (!dragged) return;
          if (!canMove(dragged, col, isHost, me)) return;
          // Adjust index: if the dragged card already sits in this column at
          // index k and is being dropped at index > k, real insertion is at
          // index-1 (because removing it first shifts everything up).
          let pos = index;
          if (dragged.column === col) {
            const k = byColumn[col].findIndex((c) => c.id === dragged.id);
            if (k !== -1 && index > k) pos = index - 1;
          }
          socketManager.kanbanMove(dragged.id, col, pos);
          setDraggedId(null);
        }}
        className="h-2 transition-colors"
        style={{
          background: active ? 'rgba(99,102,241,0.7)' : 'transparent',
          borderRadius: 2,
        }}
      />
    );
  }

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
              onDragOver={(e) => {
                const card = cards.find((c) => c.id === draggedId);
                if (!card) return;
                if (!canMove(card, col, isHost, me)) {
                  setHoverColumn(null);
                  return; // do not preventDefault → cursor "not-allowed"
                }
                e.preventDefault();
                setHoverColumn(col);
              }}
              onDragLeave={() => {
                if (hoverColumn === col) setHoverColumn(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setHoverColumn(null);
                const card = cards.find((c) => c.id === draggedId);
                setDraggedId(null);
                if (!card) return;
                if (!canMove(card, col, isHost, me)) return;
                // Drop at end of target column.
                socketManager.kanbanMove(card.id, col, byColumn[col].length);
              }}
              className={`flex w-1/3 min-w-[260px] flex-col gap-2 rounded-lg p-3 ring-1 ${COLUMN_BG[col]} ${hoverColumn === col ? 'ring-2 ring-indigo-400' : ''}`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide">{COLUMN_LABELS[col]}</h3>
                <span className="text-xs text-slate-400">{byColumn[col].length}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-auto">
                {col === 'todo' && <CreateCardForm />}
                {renderDropGap(col, 0)}
                {byColumn[col].map((c, i) => (
                  <Fragment key={c.id}>
                    <CardView
                      card={c}
                      isHost={isHost}
                      me={me}
                      draggedId={draggedId}
                      setDraggedId={setDraggedId}
                    />
                    {renderDropGap(col, i + 1)}
                  </Fragment>
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

function CardView({
  card,
  isHost,
  me,
  draggedId,
  setDraggedId,
}: {
  card: KanbanCard;
  isHost: boolean;
  me: string | null;
  draggedId: string | null;
  setDraggedId: (id: string | null) => void;
}) {
  const isMine = me !== null && card.authorId === me;
  const draggable = isMine || isHost;
  const isBeingDragged = draggedId === card.id;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);

  const submit = () => {
    const t = title.trim();
    if (t.length < 1 || t.length > 80) return;
    socketManager.kanbanUpdate(card.id, { title: t, description: description.slice(0, 500) });
    setEditing(false);
  };

  const confirmDelete = () => {
    if (!window.confirm('Supprimer cette carte ?')) return;
    socketManager.kanbanDelete(card.id);
  };

  const markDone = () => socketManager.kanbanMove(card.id, 'done', 0);
  const reactivate = () => socketManager.kanbanMove(card.id, 'doing', 0);

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-md bg-slate-800/80 p-3 ring-1 ring-indigo-400/40">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 80))}
          className="rounded bg-slate-900 px-2 py-1 text-sm outline-none ring-1 ring-white/10 focus:ring-indigo-400"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 500))}
          rows={3}
          className="resize-none rounded bg-slate-900 px-2 py-1 text-xs outline-none ring-1 ring-white/10 focus:ring-indigo-400"
        />
        <div className="flex gap-2">
          <button onClick={submit} className="rounded bg-indigo-600 px-3 py-1 text-xs font-semibold hover:bg-indigo-500">Enregistrer</button>
          <button onClick={() => { setEditing(false); setTitle(card.title); setDescription(card.description); }} className="rounded bg-white/10 px-3 py-1 text-xs hover:bg-white/20">Annuler</button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group rounded-md bg-slate-800/80 p-3 ring-1 ring-white/10"
      draggable={draggable}
      onDragStart={() => setDraggedId(card.id)}
      onDragEnd={() => setDraggedId(null)}
      style={{ opacity: isBeingDragged ? 0.4 : 1, cursor: draggable ? 'grab' : 'default' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold">{card.title}</div>
        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {isMine && card.column !== 'done' && (
            <>
              <button title="Éditer" onClick={() => setEditing(true)} className="rounded bg-white/10 px-1.5 text-xs hover:bg-white/20">✏️</button>
              <button title="Supprimer" onClick={confirmDelete} className="rounded bg-white/10 px-1.5 text-xs hover:bg-white/20">🗑</button>
            </>
          )}
          {isHost && card.column !== 'done' && (
            <button title="Marquer terminé" onClick={markDone} className="rounded bg-emerald-600/80 px-1.5 text-xs hover:bg-emerald-500">✓</button>
          )}
          {isHost && card.column === 'done' && (
            <button title="Réactiver" onClick={reactivate} className="rounded bg-white/10 px-1.5 text-xs hover:bg-white/20">↩</button>
          )}
        </div>
      </div>
      {card.description && (
        <div className="mt-1 whitespace-pre-wrap text-xs text-slate-300">{card.description}</div>
      )}
      <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">
        Par {card.authorName} · {relativeTimeFr(card.createdAt)}
        {card.column === 'done' && card.completedByName && card.completedAt && (
          <> · Terminé par {card.completedByName} {relativeTimeFr(card.completedAt)}</>
        )}
      </div>
    </div>
  );
}
