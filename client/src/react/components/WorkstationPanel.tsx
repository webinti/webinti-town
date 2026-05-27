import { useState, useRef, useEffect } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';
import { WORKSTATIONS } from '../../workstations';

export function WorkstationPanel() {
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const nearbyId      = useGameStore((s) => s.nearbyWorkstationId);
  const workstations  = useGameStore((s) => s.workstations);
  const players       = useGameStore((s) => s.players);

  const [editing, setEditing]   = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // ⚠ TOUS les hooks DOIVENT être appelés AVANT le early return,
  // sinon React jette "Rendered more hooks than during the previous render"
  // dès que `nearbyId` passe de null à une string → app entière crash.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  if (!nearbyId || !localPlayerId) return null;

  const ws    = workstations.get(nearbyId);
  const def   = WORKSTATIONS.find((w) => w.id === nearbyId);
  // Zone "fantôme" (ex: salle de conférence) : pas de panel, l'audio
  // fonctionne automatiquement pour tous ceux qui sont dans la zone.
  if (def?.hidden) return null;
  const name  = ws?.customName ?? def?.name ?? nearbyId;

  const isFree      = !ws || ws.claimedBy === null;
  const isMine      = !!ws && ws.claimedBy === localPlayerId;
  const claimerName = ws?.claimedByName ?? '?';

  // Liste des joueurs dans la room (pour "Inviter"), sauf moi et déjà invités
  const invitedIds  = ws?.invitedPlayerIds ?? [];
  const candidates  = Array.from(players.values()).filter(
    (p) => p.playerId !== localPlayerId && !invitedIds.includes(p.playerId),
  );

  const handleClaim   = () => socketManager.workstationClaim(nearbyId);
  const handleRelease = () => socketManager.workstationRelease(nearbyId);
  const handleInvite  = (targetId: string) => socketManager.workstationInvite(nearbyId, targetId);
  const handleUninvite = (targetId: string) => socketManager.workstationUninvite(nearbyId, targetId);

  const startEditing = () => {
    setEditValue(ws?.customName ?? def?.name ?? nearbyId);
    setEditing(true);
  };

  const commitEdit = () => {
    const trimmed = editValue.trim();
    // Send null to revert to default name if empty
    socketManager.workstationRename(nearbyId, trimmed.length > 0 ? trimmed : null);
    setEditing(false);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  return (
    <div className="pointer-events-auto fixed right-4 top-32 z-30 w-64 rounded-xl bg-slate-900/95 p-3 text-slate-100 ring-1 ring-white/10 shadow-2xl">
      {/* En-tête */}
      <div className="mb-3 flex items-center justify-between">
        {isMine && editing ? (
          <div className="flex flex-1 items-center gap-1 mr-2">
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              maxLength={40}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={commitEdit}
              className="flex-1 rounded bg-slate-700 px-2 py-0.5 text-sm font-semibold text-slate-100 outline-none ring-1 ring-indigo-400/60 focus:ring-indigo-400"
            />
            <button
              onMouseDown={(e) => { e.preventDefault(); commitEdit(); }}
              className="rounded bg-indigo-600 px-2 py-0.5 text-xs hover:bg-indigo-500"
              title="Enregistrer"
            >
              ✓
            </button>
            <button
              onMouseDown={(e) => { e.preventDefault(); cancelEdit(); }}
              className="rounded bg-white/10 px-2 py-0.5 text-xs hover:bg-white/20"
              title="Annuler"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 mr-2 min-w-0">
            <h3 className="text-sm font-semibold truncate">{name}</h3>
            {isMine && (
              <button
                onClick={startEditing}
                className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-200 hover:bg-white/10"
                title="Renommer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className="shrink-0">
          {isFree && (
            <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-400">Libre</span>
          )}
          {isMine && (
            <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">Revendiqué</span>
          )}
          {!isFree && !isMine && (
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-400">Occupé</span>
          )}
        </div>
      </div>

      {/* Action principale */}
      {isFree && (
        <button
          onClick={handleClaim}
          className="mb-3 w-full rounded-lg bg-green-600 py-2 text-sm font-semibold hover:bg-green-500 active:scale-95"
        >
          Revendiquer cet espace
        </button>
      )}
      {isMine && (
        <button
          onClick={handleRelease}
          className="mb-3 w-full rounded-lg bg-red-600 py-2 text-sm font-semibold hover:bg-red-500 active:scale-95"
        >
          Libérer l'espace
        </button>
      )}
      {!isFree && !isMine && (
        <p className="mb-3 text-xs text-slate-400">
          Revendiqué par <span className="font-semibold text-slate-200">{claimerName}</span>
        </p>
      )}

      {/* Section invités — visible uniquement si je suis le claimer */}
      {isMine && (
        <>
          {invitedIds.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Avec :</p>
              <ul className="flex flex-col gap-1">
                {invitedIds.map((id) => {
                  const p = players.get(id);
                  return (
                    <li key={id} className="flex items-center justify-between text-xs">
                      <span>{p?.name ?? id}</span>
                      <button
                        onClick={() => handleUninvite(id)}
                        className="rounded bg-white/10 px-2 py-0.5 text-xs hover:bg-white/20"
                        title="Désinviter"
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {candidates.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Inviter :</p>
              <ul className="flex flex-col gap-1">
                {candidates.map((p) => (
                  <li key={p.playerId} className="flex items-center justify-between text-xs">
                    <span>{p.name}</span>
                    <button
                      onClick={() => handleInvite(p.playerId)}
                      className="rounded bg-indigo-600 px-2 py-0.5 text-xs hover:bg-indigo-500"
                    >
                      Inviter
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {candidates.length === 0 && invitedIds.length === 0 && (
            <p className="text-xs text-slate-500">Aucun autre joueur dans la room.</p>
          )}
        </>
      )}
    </div>
  );
}
