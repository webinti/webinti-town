import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';

// F12 — HUD de course : chrono live, toast de tour bouclé, et leaderboard 🏆.
// La détection des passages est faite côté serveur ; ce composant ne fait
// qu'afficher l'état poussé dans le store (events circuit:*).

function formatMs(ms: number): string {
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec - min * 60;
  if (min > 0) return `${min}:${sec.toFixed(3).padStart(6, '0')}`;
  return `${sec.toFixed(3)}s`;
}

const TOAST_MS = 4000;

export function RaceHud() {
  const localKartId = useGameStore((s) => s.localKartId);
  const raceActive = useGameStore((s) => s.raceActive);
  const raceLocalStartMs = useGameStore((s) => s.raceLocalStartMs);
  const raceNextIndex = useGameStore((s) => s.raceNextIndex);
  const raceTotal = useGameStore((s) => s.raceTotal);
  const raceBestMs = useGameStore((s) => s.raceBestMs);
  const raceLastMs = useGameStore((s) => s.raceLastMs);
  const raceLastWasBest = useGameStore((s) => s.raceLastWasBest);
  const raceLastLapAt = useGameStore((s) => s.raceLastLapAt);
  const leaderboard = useGameStore((s) => s.leaderboard);
  const localPlayerId = useGameStore((s) => s.localPlayerId);

  const [board, setBoard] = useState(false);
  const [, force] = useState(0);

  // Chrono live : re-render ~10/s tant qu'un tour est en cours.
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!raceActive || raceLocalStartMs === null) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      force((n) => (n + 1) % 1_000_000);
      raf.current = window.setTimeout(() => requestAnimationFrame(tick), 90) as unknown as number;
    };
    tick();
    return () => {
      alive = false;
      if (raf.current) window.clearTimeout(raf.current);
    };
  }, [raceActive, raceLocalStartMs]);

  const onKart = localKartId !== null;
  const showToast =
    raceLastLapAt !== null && raceLastMs !== null && Date.now() - raceLastLapAt < TOAST_MS;
  // Re-render pour faire disparaître le toast.
  useEffect(() => {
    if (raceLastLapAt === null) return;
    const t = window.setTimeout(() => force((n) => n + 1), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [raceLastLapAt]);

  const liveMs =
    raceActive && raceLocalStartMs !== null ? Math.max(0, Date.now() - raceLocalStartMs) : 0;

  return (
    <>
      {/* Bouton leaderboard — toujours dispo */}
      <div className="pointer-events-auto absolute bottom-24 left-4 z-30">
        <button
          onClick={() => setBoard((b) => !b)}
          className="flex items-center gap-1.5 rounded-full bg-slate-900/80 px-3 py-1.5 text-sm font-semibold text-amber-300 ring-1 ring-white/10 backdrop-blur transition hover:bg-slate-800"
          title="Classement du circuit"
        >
          🏆 Circuit
        </button>

        {board && (
          <div className="mt-2 w-64 rounded-xl bg-slate-900/90 p-3 text-sm text-slate-100 shadow-2xl ring-1 ring-white/10 backdrop-blur">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-bold text-amber-300">🏁 Meilleurs tours</span>
              <button
                onClick={() => setBoard(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>
            {leaderboard.length === 0 ? (
              <p className="text-xs text-slate-400">
                Aucun temps encore. Monte sur un kart (E) et franchis la ligne de départ dans le
                jardin !
              </p>
            ) : (
              <ol className="space-y-1">
                {leaderboard.map((e, i) => {
                  const me = e.playerId === localPlayerId;
                  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
                  return (
                    <li
                      key={e.playerId}
                      className={`flex items-center justify-between rounded px-2 py-1 ${
                        me ? 'bg-indigo-500/25 ring-1 ring-indigo-400/40' : ''
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="w-6 shrink-0 text-center">{medal}</span>
                        <span className="truncate">{e.name}</span>
                      </span>
                      <span className="ml-2 shrink-0 font-mono text-amber-200">
                        {formatMs(e.ms)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}
      </div>

      {/* Chrono live (seulement en kart) */}
      {onKart && (
        <div className="pointer-events-none absolute left-1/2 top-32 z-30 -translate-x-1/2">
          <div className="flex flex-col items-center gap-0.5 rounded-xl bg-slate-900/80 px-4 py-2 ring-1 ring-white/10 backdrop-blur">
            <div className="font-mono text-2xl font-bold tabular-nums text-white">
              {raceActive ? formatMs(liveMs) : '—'}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-300">
              {raceActive ? (
                <span>
                  Portique <span className="font-semibold text-amber-300">{raceNextIndex === 0 ? raceTotal : raceNextIndex}</span>/{raceTotal}
                </span>
              ) : (
                <span className="text-slate-400">Franchis la ligne de départ 🏁</span>
              )}
              {raceBestMs !== null && (
                <span className="text-emerald-300">Best {formatMs(raceBestMs)}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast de tour bouclé */}
      {showToast && raceLastMs !== null && (
        <div className="pointer-events-none absolute left-1/2 top-52 z-40 -translate-x-1/2">
          <div
            className={`rounded-xl px-5 py-2.5 text-center shadow-2xl ring-1 backdrop-blur ${
              raceLastWasBest
                ? 'bg-amber-500/90 text-slate-900 ring-amber-200/60'
                : 'bg-slate-900/85 text-white ring-white/15'
            }`}
          >
            <div className="text-xs font-semibold uppercase tracking-wide opacity-80">
              {raceLastWasBest ? '🏆 Nouveau record !' : 'Tour bouclé'}
            </div>
            <div className="font-mono text-xl font-bold">{formatMs(raceLastMs)}</div>
          </div>
        </div>
      )}
    </>
  );
}
