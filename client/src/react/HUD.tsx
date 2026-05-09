import { useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import { socketManager } from '../network/SocketManager';
import { Minimap } from './Minimap';

export function HUD() {
  const name = useGameStore((s) => s.name);
  const connected = useGameStore((s) => s.connected);
  const playerCount = useGameStore((s) => s.players.size);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);

  const handleLeave = () => {
    socketManager.disconnect();
    useGameStore.getState().reset();
  };

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col">
      <div className="pointer-events-auto flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-4 py-3 text-slate-100">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-indigo-500/30 px-3 py-1 text-sm font-semibold ring-1 ring-indigo-400/50">
            {name || 'Anonyme'}
          </div>
          <div className="text-xs text-slate-300">
            {connected ? 'Connecté' : 'Déconnecté'} · {playerCount} joueur(s)
          </div>
        </div>
        <div className="text-sm font-semibold tracking-wide text-slate-300">
          WebintiSpace · demo
        </div>
      </div>

      <div className="flex-1" />

      <div className="pointer-events-none flex items-end justify-between p-4">
        <div className="pointer-events-auto flex gap-2 rounded-full bg-slate-900/80 p-2 ring-1 ring-white/10 backdrop-blur">
          <ControlButton
            active={micOn}
            onClick={() => setMicOn((v) => !v)}
            label="Mic"
          />
          <ControlButton
            active={camOn}
            onClick={() => setCamOn((v) => !v)}
            label="Cam"
          />
          <button
            onClick={handleLeave}
            className="rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400"
          >
            Quitter
          </button>
        </div>
        <Minimap />
      </div>
    </div>
  );
}

function ControlButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
        active
          ? 'bg-indigo-500 text-white'
          : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
      }`}
    >
      {label}
    </button>
  );
}
