import { useEffect, useState } from 'react';
import { useRecording } from '../hooks/useRecording';
import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function RecordingControls() {
  const rec = useRecording();
  const [includeMic, setIncludeMic] = useState(true);
  const [includeRemote, setIncludeRemote] = useState(true);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const hostPlayerId = useGameStore((s) => s.hostPlayerId);
  const isRecording = useGameStore((s) => s.isRecording);
  const recordingHostName = useGameStore((s) => s.recordingHostName);
  const isHost = !!localPlayerId && localPlayerId === hostPlayerId;

  useEffect(() => {
    if (!isHost) return;
    if (rec.status === 'recording' && !isRecording) {
      socketManager.sendRecordingState(true);
    } else if (rec.status === 'idle' && isRecording) {
      socketManager.sendRecordingState(false);
    }
  }, [rec.status, isRecording, isHost]);

  if (!isHost) {
    if (!isRecording) return null;
    return (
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-red-600/90 px-3 py-1.5 ring-1 ring-red-400/40">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
        <span className="text-xs font-semibold text-white">
          Enregistrement par {recordingHostName || 'l\'hôte'}
        </span>
      </div>
    );
  }

  if (rec.status === 'idle') {
    return (
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900/80 px-3 py-1 ring-1 ring-white/10">
        <label className="flex items-center gap-1 text-xs text-slate-300 select-none">
          <input
            type="checkbox"
            checked={includeMic}
            onChange={(e) => setIncludeMic(e.target.checked)}
            className="h-3 w-3"
          />
          micro
        </label>
        <label
          className="flex items-center gap-1 text-xs text-slate-300 select-none"
          title="Mixe les voix des autres participants directement, indépendamment du partage d'écran"
        >
          <input
            type="checkbox"
            checked={includeRemote}
            onChange={(e) => setIncludeRemote(e.target.checked)}
            className="h-3 w-3"
          />
          audio participants
        </label>
        <button
          onClick={() => {
            void rec.start({ includeMic, includeRemote });
          }}
          title="Enregistrer la session"
          className="flex items-center gap-2 rounded-full bg-slate-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-600"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
          Enregistrer
        </button>
        {rec.error && (
          <span className="max-w-[260px] truncate text-xs text-red-300" title={rec.error}>
            {rec.error}
          </span>
        )}
      </div>
    );
  }

  const isPaused = rec.status === 'paused';

  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900/90 px-3 py-1.5 ring-1 ring-red-500/40">
      <span
        className={`h-2.5 w-2.5 rounded-full ${
          isPaused ? 'bg-amber-400' : 'animate-pulse bg-red-500'
        }`}
      />
      <span className="font-mono text-sm tabular-nums text-white">
        {formatElapsed(rec.elapsedMs)}
      </span>
      {isPaused ? (
        <button
          onClick={rec.resume}
          className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-400"
        >
          Reprendre
        </button>
      ) : (
        <button
          onClick={rec.pause}
          className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-400"
        >
          Pause
        </button>
      )}
      <button
        onClick={() => {
          void rec.stop();
        }}
        className="rounded-full bg-red-500 px-3 py-1 text-xs font-semibold text-white hover:bg-red-400"
      >
        Stop
      </button>
    </div>
  );
}
