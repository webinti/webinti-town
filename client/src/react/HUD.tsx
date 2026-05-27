import { useEffect, useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import { socketManager } from '../network/SocketManager';
import { Minimap } from './Minimap';
import { useLiveKit } from './hooks/useLiveKit';
import { VideoBar } from './components/VideoBar';
import { ChatPanel } from './components/ChatPanel';
import { EmoteBar } from './components/EmoteBar';
import { RecordingControls } from './components/RecordingControls';
import { WhiteboardModal } from './components/WhiteboardModal';
import { NoteModal } from './components/NoteModal';
import { LinkModal } from './components/LinkModal';
import { KanbanModal } from './components/KanbanModal';
import { KanbanToasts } from './components/KanbanToasts';
import { HelpPanel } from './components/HelpPanel';
import { AdminPanel } from './components/AdminPanel';
import { setMuted as setSoundsMuted, isMuted as soundsIsMuted } from '../sounds/sounds';
import { useActivityHeartbeat } from './hooks/useActivityHeartbeat';

export function HUD() {
  const name = useGameStore((s) => s.name);
  const connected = useGameStore((s) => s.connected);
  const playerCount = useGameStore((s) => s.players.size);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const hostPlayerId = useGameStore((s) => s.hostPlayerId);
  const isHost = !!localPlayerId && localPlayerId === hostPlayerId;
  const currentRoomSlug = useGameStore((s) => s.currentRoomSlug);
  const mapZoom = useGameStore((s) => s.mapZoom);
  const [soundsMuted, setSoundsMutedState] = useState(soundsIsMuted());

  const toggleSounds = () => {
    const next = !soundsMuted;
    setSoundsMuted(next);
    setSoundsMutedState(next);
  };
  const {
    micEnabled,
    camEnabled,
    screenShareEnabled,
    toggleMic,
    toggleCam,
    toggleScreenShare,
    localCamTrack,
    localScreenTrack,
    remotes,
    error,
  } = useLiveKit();

  useActivityHeartbeat();

  const handleLeave = () => {
    socketManager.disconnect();
    useGameStore.getState().reset();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (useGameStore.getState().inputFocused) return;
      const k = e.key.toLowerCase();
      if (k === 'm') {
        e.preventDefault();
        void toggleMic();
      } else if (k === 'v') {
        e.preventDefault();
        void toggleCam();
      } else if (k === 'g') {
        e.preventDefault();
        socketManager.toggleGhost();
      } else if (k === 'h' || e.key === '?') {
        e.preventDefault();
        const s = useGameStore.getState();
        s.setHelpOpen(!s.helpOpen);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        const s = useGameStore.getState();
        s.setMapZoom(s.mapZoom + 0.25);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        const s = useGameStore.getState();
        s.setMapZoom(s.mapZoom - 0.25);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleMic, toggleCam]);

  const [kickedReason, setKickedReason] = useState<string | null>(null);
  useEffect(() => {
    const off = socketManager.onKicked((reason) => {
      setKickedReason(reason);
      socketManager.disconnect();
      useGameStore.getState().reset();
    });
    return off;
  }, []);
  useEffect(() => {
    if (!kickedReason) return;
    const t = window.setTimeout(() => setKickedReason(null), 5000);
    return () => window.clearTimeout(t);
  }, [kickedReason]);

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col">
      <div className="pointer-events-auto flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-4 py-3 text-slate-100">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-indigo-500/30 px-3 py-1 text-sm font-semibold ring-1 ring-indigo-400/50">
            {name || 'Anonyme'}
          </div>
          <PresenceSelector />
          {isHost && (
            <div className="rounded-full bg-amber-500/30 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-200 ring-1 ring-amber-400/50">
              Hôte
            </div>
          )}
          <div className="text-xs text-slate-300">
            {connected ? 'Connecté' : 'Déconnecté'} · {playerCount} joueur(s)
          </div>
        </div>
        <div className="text-sm font-semibold tracking-wide text-slate-300">
          Webinti Town · {currentRoomSlug}
        </div>
      </div>

      <VideoBar
        localCamTrack={localCamTrack}
        localScreenTrack={localScreenTrack}
        localName={name}
        remotes={remotes}
      />

      {error && (
        <div className="pointer-events-auto mx-auto mt-2 max-w-md rounded-md bg-red-600/90 px-3 py-1.5 text-xs text-white shadow">
          {error}
        </div>
      )}

      <div className="flex-1" />

      <ChatPanel />

      <div className="pointer-events-none absolute right-4 top-3 z-30 flex items-center gap-2">
        {isHost && (
          <button
            onClick={() => {
              const s = useGameStore.getState();
              s.setAdminPanelOpen(!s.adminPanelOpen);
            }}
            title="Panneau admin"
            className="pointer-events-auto flex h-9 items-center gap-1 rounded-full bg-amber-600/90 px-3 text-sm font-semibold text-white ring-1 ring-amber-300/40 backdrop-blur hover:bg-amber-500"
          >
            <span>👥</span>
            <span>Admin</span>
          </button>
        )}
        <button
          onClick={toggleSounds}
          title={soundsMuted ? 'Activer les sons' : 'Couper les sons'}
          className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-slate-900/80 text-base text-slate-100 ring-1 ring-white/10 backdrop-blur hover:bg-slate-800"
        >
          {soundsMuted ? '🔇' : '🔊'}
        </button>
        <button
          onClick={() => useGameStore.getState().setHelpOpen(true)}
          title="Raccourcis clavier (H)"
          className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-slate-900/80 text-base font-bold text-slate-100 ring-1 ring-white/10 backdrop-blur hover:bg-slate-800"
        >
          ?
        </button>
        <RecordingControls />
      </div>

      <WhiteboardModal />
      <NoteModal />
      <LinkModal />
      <KanbanModal />
      <HelpPanel />
      <AdminPanel />
      <KanbanToasts />

      {kickedReason && (
        <div className="pointer-events-auto fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-md bg-red-600/95 px-4 py-2 text-sm font-semibold text-white shadow-lg ring-1 ring-red-300/40">
          Vous avez été déconnecté par l'hôte
        </div>
      )}

      <div className="pointer-events-none flex items-end justify-between p-4">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900/80 p-2 ring-1 ring-white/10 backdrop-blur">
          <ControlButton
            active={micEnabled}
            onClick={() => {
              void toggleMic();
            }}
            label="Mic"
          />
          <ControlButton
            active={camEnabled}
            onClick={() => {
              void toggleCam();
            }}
            label="Cam"
          />
          <ControlButton
            active={screenShareEnabled}
            onClick={() => {
              void toggleScreenShare();
            }}
            label={screenShareEnabled ? 'Stop écran' : 'Écran'}
          />
          <div className="mx-1 h-6 w-px bg-white/10" />
          <EmoteBar />
          <div className="mx-1 h-6 w-px bg-white/10" />
          <button
            onClick={handleLeave}
            className="rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400"
          >
            Quitter
          </button>
        </div>
        <div className="pointer-events-none flex flex-col items-end gap-2">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-slate-900/80 p-1 ring-1 ring-white/10 backdrop-blur">
            <button
              onClick={() => {
                const s = useGameStore.getState();
                s.setMapZoom(s.mapZoom - 0.25);
              }}
              title="Dézoomer (-)"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-lg font-bold text-slate-100 hover:bg-slate-600"
            >
              −
            </button>
            <span className="min-w-[3.5rem] text-center text-xs font-semibold text-slate-200">
              {Math.round(mapZoom * 100)}%
            </span>
            <button
              onClick={() => {
                const s = useGameStore.getState();
                s.setMapZoom(s.mapZoom + 0.25);
              }}
              title="Zoomer (+)"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-lg font-bold text-slate-100 hover:bg-slate-600"
            >
              +
            </button>
          </div>
          <Minimap />
        </div>
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

const PRESENCE_OPTIONS: Array<{ value: 'available' | 'away' | 'brb' | 'dnd'; label: string; dot: string }> = [
  { value: 'available', label: 'Disponible', dot: '🟢' },
  { value: 'away',      label: 'Absent',     dot: '🟡' },
  { value: 'brb',       label: 'Je reviens', dot: '🟡' },
  { value: 'dnd',       label: 'Ne pas déranger', dot: '🔴' },
];

function PresenceSelector() {
  const localPresence = useGameStore((s) => s.localPresence);
  const setLocalPresence = useGameStore((s) => s.setLocalPresence);

  if (localPresence === 'inactive') {
    return (
      <div
        title="Inactif — bougez pour revenir en Disponible"
        className="flex items-center gap-1.5 rounded-full bg-slate-900/80 px-3 py-1 text-xs text-slate-400 ring-1 ring-white/10"
      >
        <span>⚪</span>
        <span>Inactif</span>
      </div>
    );
  }

  return (
    <select
      value={localPresence}
      onChange={(e) => {
        const val = e.target.value as 'available' | 'away' | 'brb' | 'dnd';
        setLocalPresence(val);
        socketManager.sendPresenceSet(val);
      }}
      className="rounded-full bg-slate-900/80 px-3 py-1 text-xs text-slate-100 ring-1 ring-white/10 backdrop-blur focus:outline-none focus:ring-indigo-400"
      aria-label="Statut de présence"
    >
      {PRESENCE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.dot} {o.label}
        </option>
      ))}
    </select>
  );
}
