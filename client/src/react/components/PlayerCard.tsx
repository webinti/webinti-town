import { useEffect } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { wavePlayer, walkToPlayer } from '../playerInteractions';

// Carte d'interaction « façon Gather » : ouverte par un clic sur un avatar dans
// le monde (cf. RemotePlayer.makeClickable → gameStore.selectedPlayer). Permet de
// faire signe (wave) ou de rejoindre le joueur (Aller vers).

const PRESENCE_DOT: Record<string, string> = {
  available: 'bg-emerald-400',
  away: 'bg-amber-400',
  brb: 'bg-amber-400',
  dnd: 'bg-rose-500',
  inactive: 'bg-slate-400',
};

const CARD_W = 240;

export function PlayerCard() {
  const selected = useGameStore((s) => s.selectedPlayer);
  const setSelected = useGameStore((s) => s.setSelectedPlayer);
  const players = useGameStore((s) => s.players);
  const localPlayerId = useGameStore((s) => s.localPlayerId);

  // Fermer sur Échap.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, setSelected]);

  if (!selected || selected.playerId === localPlayerId) return null;

  const p = players.get(selected.playerId);
  const name = p?.name ?? 'Joueur';
  const presence = p?.presence ?? 'available';
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  // Ancrage : centré horizontalement sur le clic, juste au-dessus, recadré dans l'écran.
  const left = Math.min(Math.max(8, selected.sx - CARD_W / 2), window.innerWidth - CARD_W - 8);
  const top = Math.max(8, selected.sy - 150);

  const onWave = () => {
    wavePlayer(selected.playerId);
    setSelected(null);
  };
  const onGoto = () => {
    walkToPlayer(selected.playerId);
    setSelected(null);
  };

  return (
    <>
      {/* Capteur de clic extérieur — referme la carte. */}
      <div
        className="pointer-events-auto fixed inset-0 z-[55]"
        onMouseDown={() => setSelected(null)}
      />
      <div
        className="pointer-events-auto fixed z-[56] rounded-2xl bg-white p-3 text-slate-900 shadow-2xl ring-1 ring-black/10"
        style={{ left, top, width: CARD_W }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2.5">
          <div className="relative shrink-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500 text-base font-bold text-white">
              {initial}
            </div>
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white ${PRESENCE_DOT[presence] ?? 'bg-emerald-400'}`}
            />
          </div>
          <p className="min-w-0 flex-1 truncate text-sm font-bold leading-tight">{name}</p>
          <button
            onClick={() => setSelected(null)}
            className="shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            title="Fermer"
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onWave}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-100 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-200 active:scale-95"
          >
            <span>👋</span> Faire signe
          </button>
          <button
            onClick={onGoto}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 active:scale-95"
            title="Me téléporter à côté de ce joueur"
          >
            <span>📍</span> Aller vers
          </button>
        </div>
      </div>
    </>
  );
}
