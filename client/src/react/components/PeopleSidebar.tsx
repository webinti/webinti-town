import { useMemo, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import type { PlayerState, Presence } from '../../types';
import { wavePlayer, locatePlayer, dmPlayer } from '../playerInteractions';

// Sidebar « Personnes » façon Gather : liste des connectés, recherche, et pour
// chaque joueur → Localiser (caméra), Faire signe (wave), Message privé (DM).

const SHIRT_HEX = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f3f4f6',
];

const PRESENCE_META: Record<Presence, { label: string; dot: string }> = {
  available: { label: 'Disponible', dot: 'bg-emerald-400' },
  away: { label: 'Absent', dot: 'bg-amber-400' },
  brb: { label: 'Je reviens', dot: 'bg-amber-400' },
  dnd: { label: 'Ne pas déranger', dot: 'bg-rose-500' },
  inactive: { label: 'Inactif', dot: 'bg-slate-400' },
};

function shirtFor(p: PlayerState): string {
  return SHIRT_HEX[p.appearance.outfit % SHIRT_HEX.length] ?? '#6366f1';
}

// Évite de re-render la sidebar à chaque déplacement (~20×/s) : on ne réagit que
// si la liste (ids), un nom, une tenue ou une présence change. Les positions
// (qui changent en continu) sont lues en direct au clic (locatePlayer), pas ici.
function samePeople(a: Map<string, PlayerState>, b: Map<string, PlayerState>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, pa] of a) {
    const pb = b.get(id);
    if (!pb || pb.name !== pa.name || pb.appearance.outfit !== pa.appearance.outfit || pb.presence !== pa.presence) {
      return false;
    }
  }
  return true;
}

export function PeopleSidebar() {
  const open = useGameStore((s) => s.peopleSidebarOpen);
  const setOpen = useGameStore((s) => s.setPeopleSidebarOpen);
  const players = useGameStore((s) => s.players, samePeople);
  const localId = useGameStore((s) => s.localPlayerId);

  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const list = useMemo(() => {
    const all = Array.from(players.values());
    const q = query.trim().toLowerCase();
    const filtered = q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all;
    // Moi en premier, puis ordre alphabétique.
    return filtered.sort((a, b) => {
      if (a.playerId === localId) return -1;
      if (b.playerId === localId) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [players, query, localId]);

  if (!open) return null;

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard refusé — ignore */
    }
  };

  return (
    <div className="pointer-events-auto fixed left-3 top-20 bottom-3 z-40 flex w-72 flex-col rounded-2xl bg-white text-slate-900 shadow-2xl ring-1 ring-black/10">
      {/* En-tête */}
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <h2 className="text-lg font-bold">Webinti</h2>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          title="Fermer le panneau"
          aria-label="Fermer"
        >
          <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
            <path d="M5 4h2v12H5V4zm4.7 1.3l1.4-1.4 5 5-5 5-1.4-1.4L13 11H8V9h5L9.7 5.3z" />
          </svg>
        </button>
      </div>

      {/* Invitation */}
      <div className="mx-3 mb-3 rounded-xl bg-indigo-50 p-3">
        <p className="text-sm font-semibold text-slate-800">Invitez vos collègues</p>
        <p className="mt-0.5 text-xs text-slate-500">Partagez le lien de cet espace.</p>
        <button
          onClick={copyInvite}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 active:scale-95"
        >
          {copied ? '✓ Lien copié' : '🔗 Copier le lien d’invitation'}
        </button>
      </div>

      {/* Recherche */}
      <div className="mx-3 mb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une personne"
          className="w-full rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800 outline-none ring-1 ring-transparent placeholder:text-slate-400 focus:bg-white focus:ring-indigo-400"
        />
      </div>

      {/* Liste */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          En ligne ({list.length})
        </p>
        {list.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-slate-400">Personne pour l’instant.</p>
        )}
        {list.map((p) => {
          const isSelf = p.playerId === localId;
          const presence = PRESENCE_META[p.presence ?? 'available'];
          const isExpanded = expandedId === p.playerId;
          return (
            <div key={p.playerId} className="rounded-xl">
              <button
                onClick={() => !isSelf && setExpandedId(isExpanded ? null : p.playerId)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition ${
                  isSelf ? 'cursor-default' : 'hover:bg-slate-100'
                } ${isExpanded ? 'bg-slate-100' : ''}`}
              >
                <div className="relative shrink-0">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ backgroundColor: shirtFor(p) }}
                  >
                    {p.name.trim().charAt(0).toUpperCase() || '?'}
                  </div>
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white ${presence.dot}`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold leading-tight">
                    {p.name}
                    {isSelf && <span className="ml-1 text-xs font-normal text-slate-400">(vous)</span>}
                  </p>
                  <p className="truncate text-xs text-slate-500">{presence.label}</p>
                </div>
              </button>

              {isExpanded && !isSelf && (
                <div className="mb-1 flex gap-1.5 px-2 pb-2">
                  <ActionBtn
                    label="Localiser"
                    icon="📍"
                    onClick={() => {
                      locatePlayer(p.playerId);
                      setOpen(false);
                    }}
                  />
                  <ActionBtn label="Signe" icon="👋" onClick={() => wavePlayer(p.playerId)} />
                  <ActionBtn
                    label="Message"
                    icon="💬"
                    primary
                    onClick={() => dmPlayer(p.playerId)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionBtn({
  label,
  icon,
  onClick,
  primary,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[11px] font-semibold transition active:scale-95 ${
        primary
          ? 'bg-indigo-600 text-white hover:bg-indigo-500'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      <span className="text-base leading-none">{icon}</span>
      {label}
    </button>
  );
}
