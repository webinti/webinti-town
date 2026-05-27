import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';
import { WORKSTATIONS } from '../../workstations';

export function WorkstationPanel() {
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const nearbyId      = useGameStore((s) => s.nearbyWorkstationId);
  const workstations  = useGameStore((s) => s.workstations);
  const players       = useGameStore((s) => s.players);

  if (!nearbyId || !localPlayerId) return null;

  const ws    = workstations.get(nearbyId);
  const def   = WORKSTATIONS.find((w) => w.id === nearbyId);
  const name  = def?.name ?? nearbyId;

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

  return (
    <div className="pointer-events-auto fixed bottom-4 left-4 z-30 w-72 rounded-xl bg-slate-900/95 p-4 text-slate-100 ring-1 ring-white/10 shadow-2xl">
      {/* En-tête */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{name}</h3>
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
