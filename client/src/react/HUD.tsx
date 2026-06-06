import { useEffect, useRef, useState } from 'react';
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
import { DmToasts } from './components/DmToasts';
import { HelpPanel } from './components/HelpPanel';
import { AdminPanel } from './components/AdminPanel';
import { AvatarEditModal } from './components/AvatarEditModal';
import { useActivityHeartbeat } from './hooks/useActivityHeartbeat';
import { WorkstationPanel } from './components/WorkstationPanel';
import { WorkstationInviteToast } from './components/WorkstationInviteToast';
import { RaceHud } from './components/RaceHud';
import { AvControls } from './components/AvControls';
import { AdminJoinNotify } from './components/AdminJoinNotify';
import { useSpeakerBubbles } from './hooks/useSpeakerBubbles';

export function HUD() {
  const name = useGameStore((s) => s.name);
  const connected = useGameStore((s) => s.connected);
  const playerCount = useGameStore((s) => s.players.size);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const hostPlayerId = useGameStore((s) => s.hostPlayerId);
  const isHost = !!localPlayerId && localPlayerId === hostPlayerId;
  const currentRoomSlug = useGameStore((s) => s.currentRoomSlug);
  const mapZoom = useGameStore((s) => s.mapZoom);
  const [avatarEditOpen, setAvatarEditOpen] = useState(false);
  const {
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
  useSpeakerBubbles();

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
      <div className="pointer-events-auto flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-5 py-4 text-slate-100">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setAvatarEditOpen(true)}
            title="Modifier mon avatar"
            className="rounded-full bg-indigo-500/30 px-3.5 py-1.5 text-sm font-semibold ring-1 ring-indigo-400/50 transition hover:bg-indigo-500/50 hover:ring-indigo-300"
          >
            {name || 'Anonyme'} <span className="ml-0.5 opacity-70">✎</span>
          </button>
          <PresenceSelector />
          {isHost && (
            <div className="rounded-full bg-amber-500/30 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-200 ring-1 ring-amber-400/50">
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
      {avatarEditOpen && <AvatarEditModal onClose={() => setAvatarEditOpen(false)} />}
      <KanbanToasts />
      <DmToasts />
      <WorkstationPanel />
      <WorkstationInviteToast />
      <AdminJoinNotify />
      <RaceHud />

      {kickedReason && (
        <div className="pointer-events-auto fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-md bg-red-600/95 px-4 py-2 text-sm font-semibold text-white shadow-lg ring-1 ring-red-300/40">
          Vous avez été déconnecté par l'hôte
        </div>
      )}

      <div className="pointer-events-none flex items-end justify-between p-4">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900/80 p-2 ring-1 ring-white/10 backdrop-blur">
          <AvControls />
          <ControlButton
            active={screenShareEnabled}
            onClick={() => {
              void toggleScreenShare();
            }}
            label={screenShareEnabled ? 'Stop écran' : 'Écran'}
          />
          <ChatButton />
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

function ChatButton() {
  const open       = useGameStore((s) => s.chatPanelOpen);
  const unread     = useGameStore((s) => s.unreadChat);
  const unreadDmMap = useGameStore((s) => s.unreadDm);
  const toggle     = useGameStore((s) => s.toggleChatPanel);
  let unreadDm = 0;
  for (const n of unreadDmMap.values()) unreadDm += n;
  return (
    <button
      onClick={toggle}
      title={open ? 'Fermer le chat' : 'Ouvrir le chat'}
      aria-label={
        unreadDm > 0
          ? `${unreadDm} DM non lu(s), ${unread} message(s) non lu(s)`
          : unread > 0 ? `${unread} message(s) non lu(s)` : 'Chat'
      }
      className={`relative flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
        open
          ? 'bg-indigo-500 text-white'
          : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2zm3 5h10v2H7V9zm0 4h7v2H7v-2z" />
      </svg>
      <span>Chat</span>
      {unread > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white ring-2 ring-slate-900">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
      {unreadDm > 0 && (
        <span className="absolute -left-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-emerald-500 px-1 text-[11px] font-bold text-white ring-2 ring-slate-900">
          {unreadDm > 9 ? '9+' : unreadDm}
        </span>
      )}
    </button>
  );
}

type PresenceManual = 'available' | 'away' | 'brb' | 'dnd';

interface PresenceOption {
  value: PresenceManual;
  label: string;
  dotClass: string;   // bg color of the dot
  hint?: string;      // tooltip / secondary line
}

const PRESENCE_OPTIONS: ReadonlyArray<PresenceOption> = [
  { value: 'available', label: 'Disponible',      dotClass: 'bg-emerald-400 ring-emerald-300/40' },
  { value: 'away',      label: 'Absent',           dotClass: 'bg-amber-400 ring-amber-300/40' },
  { value: 'brb',       label: 'Je reviens',       dotClass: 'bg-amber-400 ring-amber-300/40', hint: 'De retour dans un moment' },
  { value: 'dnd',       label: 'Ne pas déranger',  dotClass: 'bg-rose-500 ring-rose-300/40',  hint: 'Concentré, à éviter' },
];

function PresenceSelector() {
  const localPresence = useGameStore((s) => s.localPresence);
  const setLocalPresence = useGameStore((s) => s.setLocalPresence);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (localPresence === 'inactive') {
    return (
      <div
        title="Inactif — bougez pour revenir en Disponible"
        className="flex items-center gap-2 rounded-full bg-slate-900/80 px-3.5 py-1.5 text-sm text-slate-400 ring-1 ring-white/10 backdrop-blur"
      >
        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-slate-500 ring-2 ring-slate-400/30" />
        <span className="font-medium">Inactif</span>
      </div>
    );
  }

  const current = PRESENCE_OPTIONS.find((o) => o.value === localPresence) ?? PRESENCE_OPTIONS[0]!;

  const select = (val: PresenceManual) => {
    setLocalPresence(val);
    socketManager.sendPresenceSet(val);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Statut de présence"
        className={`flex items-center gap-2 rounded-full bg-slate-900/80 px-3.5 py-1.5 text-sm font-medium text-slate-100 ring-1 ring-white/10 backdrop-blur transition hover:bg-slate-800/90 hover:ring-white/20 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${open ? 'bg-slate-800/90 ring-indigo-400/60' : ''}`}
      >
        <span className={`inline-flex h-2.5 w-2.5 rounded-full ring-2 ${current.dotClass}`} />
        <span>{current.label}</span>
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={`h-3 w-3 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M2 4.5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Choisir un statut"
          className="absolute left-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl bg-slate-900/95 p-1 text-sm text-slate-100 shadow-2xl ring-1 ring-white/10 backdrop-blur"
        >
          {PRESENCE_OPTIONS.map((o) => {
            const isCurrent = o.value === localPresence;
            return (
              <button
                key={o.value}
                role="option"
                aria-selected={isCurrent}
                onClick={() => select(o.value)}
                className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition ${isCurrent ? 'bg-indigo-500/20 ring-1 ring-indigo-400/40' : 'hover:bg-white/5'}`}
              >
                <span className={`mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full ring-2 ${o.dotClass}`} />
                <span className="flex flex-1 flex-col">
                  <span className={`font-medium ${isCurrent ? 'text-white' : 'text-slate-100'}`}>{o.label}</span>
                  {o.hint && <span className="text-xs text-slate-400">{o.hint}</span>}
                </span>
                {isCurrent && (
                  <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 8l4 4 6-8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
