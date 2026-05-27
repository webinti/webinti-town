import { useEffect, useRef } from 'react';
import { useGameStore } from '../../stores/gameStore';

const TOAST_DURATION_MS = 30_000;

export function WorkstationInviteToast() {
  const invite = useGameStore((s) => s.pendingInvite);
  const clear  = useGameStore((s) => s.setPendingInvite);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Démarrer / réinitialiser le timer auto-dismiss à 30 s à chaque nouvelle invitation.
  useEffect(() => {
    if (!invite) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => clear(null), TOAST_DURATION_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [invite, clear]);

  if (!invite) return null;

  const { fromPlayerName, workstationName } = invite;

  return (
    <div className="pointer-events-auto fixed bottom-4 right-4 z-50 w-80 rounded-xl bg-indigo-900/95 p-4 text-slate-100 ring-1 ring-indigo-400/30 shadow-2xl">
      <p className="mb-3 text-sm">
        <span className="font-semibold text-indigo-300">{fromPlayerName}</span>{' '}
        t'invite à rejoindre{' '}
        <span className="font-semibold text-white">{workstationName}</span>.
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => clear(null)}
          className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold hover:bg-indigo-500 active:scale-95"
        >
          Aller au poste
        </button>
        <button
          onClick={() => clear(null)}
          className="flex-1 rounded-lg bg-white/10 py-2 text-sm hover:bg-white/20 active:scale-95"
        >
          Ignorer
        </button>
      </div>
    </div>
  );
}
