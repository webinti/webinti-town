import { useEffect, useMemo } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';

const SHIRT_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#f3f4f6',
];

export function AdminPanel() {
  const open = useGameStore((s) => s.adminPanelOpen);
  const setOpen = useGameStore((s) => s.setAdminPanelOpen);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const hostPlayerId = useGameStore((s) => s.hostPlayerId);
  const players = useGameStore((s) => s.players);
  const isHost = !!localPlayerId && localPlayerId === hostPlayerId;

  const sortedPlayers = useMemo(() => {
    return Array.from(players.values()).sort((a, b) => {
      if (a.playerId === hostPlayerId) return -1;
      if (b.playerId === hostPlayerId) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [players, hostPlayerId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open || !isHost) return null;

  const handleMuteAll = () => {
    socketManager.adminMuteAll();
  };

  const handleCloseRoom = () => {
    if (!window.confirm('Déconnecter tous les joueurs (sauf vous) ?')) return;
    socketManager.adminCloseRoom();
  };

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="flex max-h-[90vh] w-[520px] max-w-[95vw] flex-col rounded-2xl bg-slate-900 p-5 text-slate-100 shadow-2xl ring-1 ring-white/10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Admin · Joueurs ({sortedPlayers.length})</h2>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600"
          >
            Fermer
          </button>
        </div>

        <div className="mb-4 flex gap-2">
          <button
            onClick={handleMuteAll}
            className="flex-1 rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold hover:bg-amber-500"
          >
            Tout muter
          </button>
          <button
            onClick={handleCloseRoom}
            className="flex-1 rounded-md bg-red-600 px-3 py-2 text-sm font-semibold hover:bg-red-500"
          >
            Fermer la salle
          </button>
        </div>

        <div className="overflow-y-auto pr-1">
          <ul className="space-y-1.5">
            {sortedPlayers.map((p) => {
              const isSelf = p.playerId === localPlayerId;
              const color = SHIRT_COLORS[p.appearance.shirt % SHIRT_COLORS.length];
              return (
                <li
                  key={p.playerId}
                  className="flex items-center gap-3 rounded-lg bg-slate-800/60 px-3 py-2 ring-1 ring-white/5"
                >
                  <span
                    className="h-3 w-3 flex-none rounded-full ring-1 ring-white/20"
                    style={{ backgroundColor: color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {p.name}
                      {isSelf && (
                        <span className="ml-1 text-xs text-slate-400">(vous)</span>
                      )}
                      {p.playerId === hostPlayerId && (
                        <span className="ml-1 rounded bg-amber-500/30 px-1 text-[10px] font-semibold uppercase text-amber-200">
                          hôte
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    disabled={isSelf}
                    title="Promouvoir hôte"
                    onClick={() => {
                      if (!window.confirm(`Transférer le rôle d'hôte à ${p.name} ?`)) return;
                      socketManager.adminTransferHost(p.playerId);
                      setOpen(false);
                    }}
                    className="rounded-md bg-indigo-600/80 px-2.5 py-1 text-xs font-semibold hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    👑
                  </button>
                  <button
                    disabled={isSelf}
                    onClick={() => socketManager.adminMute(p.playerId)}
                    className="rounded-md bg-amber-600/80 px-2.5 py-1 text-xs font-semibold hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Mute
                  </button>
                  <button
                    disabled={isSelf}
                    onClick={() => {
                      if (!window.confirm(`Expulser ${p.name} ?`)) return;
                      socketManager.adminKick(p.playerId);
                    }}
                    className="rounded-md bg-red-600/80 px-2.5 py-1 text-xs font-semibold hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Kick
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mt-3 text-center text-xs text-slate-400">Esc pour fermer</div>
      </div>
    </div>
  );
}
