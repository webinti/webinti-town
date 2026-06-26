import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import { isTouchDevice } from '../lib/isTouchDevice';
import { TouchControls } from './components/TouchControls';
import { MobileBar } from './components/MobileBar';
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
import { KnockNotify } from './components/KnockNotify';
import { PlayerCard } from './components/PlayerCard';
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
  const isTouch = useMemo(() => isTouchDevice(), []);
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

  // Barre d'outils principale (micro/cam/écran/chat/emotes/quitter) — desktop
  // uniquement (sur tactile, MobileBar la remplace). ⚠ Pas d'overflow-* ici :
  // les menus de périphériques (AvControls) s'ouvrent AU-DESSUS de la barre en
  // position absolue, un overflow les clipperait (régression déjà vécue).
  const controlCluster = (
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
      <div className="mx-1 h-6 w-px shrink-0 bg-white/10" />
      <EmoteBar />
      <div className="mx-1 h-6 w-px shrink-0 bg-white/10" />
      <button
        onClick={handleLeave}
        className="shrink-0 rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400"
      >
        Quitter
      </button>
    </div>
  );

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
      } else if (k === 'k') {
        // Panneau Admin — réservé à l'hôte.
        const s = useGameStore.getState();
        if (s.hostPlayerId && s.hostPlayerId === s.localPlayerId) {
          e.preventDefault();
          s.setAdminPanelOpen(!s.adminPanelOpen);
        }
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
    <div
      className="pointer-events-none absolute inset-0 flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {!isTouch && (
      <div className="pointer-events-auto flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent px-3 py-3 text-slate-100 sm:px-5 sm:py-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => setAvatarEditOpen(true)}
            title="Modifier mon avatar"
            className="max-w-[40vw] truncate rounded-full bg-indigo-500/30 px-3 py-1.5 text-sm font-semibold ring-1 ring-indigo-400/50 transition hover:bg-indigo-500/50 hover:ring-indigo-300"
          >
            {name || 'Anonyme'} <span className="ml-0.5 opacity-70">✎</span>
          </button>
          <PresenceSelector />
          {isHost && (
            <div className="rounded-full bg-amber-500/30 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-200 ring-1 ring-amber-400/50">
              Hôte
            </div>
          )}
          <div className="hidden text-xs text-slate-300 sm:block">
            {connected ? 'Connecté' : 'Déconnecté'} · {playerCount} joueur(s)
          </div>
        </div>
        <div className="hidden shrink-0 text-sm font-semibold tracking-wide text-slate-300 md:block">
          Webinti Town · {currentRoomSlug}
        </div>
      </div>
      )}

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

      <div className={`pointer-events-none absolute right-4 top-3 z-30 flex items-center gap-2 ${isTouch ? 'hidden' : ''}`}>
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
      <KnockNotify />
      <PlayerCard />
      <RaceHud />

      {kickedReason && (
        <div className="pointer-events-auto fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-md bg-red-600/95 px-4 py-2 text-sm font-semibold text-white shadow-lg ring-1 ring-red-300/40">
          Vous avez été déconnecté par l'hôte
        </div>
      )}

      {isTouch ? (
        /* Tactile : chrome épuré façon WorkAdventure — joystick + bouton d'action
           (TouchControls), et une pastille compacte chat/micro/cam/menu (MobileBar)
           qui range tout le secondaire dans un panneau « ☰ ». Zoom au pinch. */
        <MobileBar
          screenShareEnabled={screenShareEnabled}
          onToggleScreenShare={() => { void toggleScreenShare(); }}
          onLeave={handleLeave}
          onOpenAvatar={() => setAvatarEditOpen(true)}
        />
      ) : (
        <div className="pointer-events-none flex items-end justify-between p-4">
          {controlCluster}
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
      )}

      {isTouch && <TouchControls />}
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
  const understudyOn = useGameStore((s) => s.understudyOn);
  const [open, setOpen] = useState(false);
  const [undModalOpen, setUndModalOpen] = useState(false);
  const [undNote, setUndNote] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const activateUnderstudy = () => {
    const note = undNote.trim();
    try { localStorage.setItem('webinti:understudyNote', note); } catch { /* ignore */ }
    socketManager.setUnderstudy(true, note);
    setUndModalOpen(false);
  };

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
          <div className="mt-1 border-t border-white/10 pt-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                if (understudyOn) {
                  socketManager.setUnderstudy(false);
                } else {
                  try { setUndNote(localStorage.getItem('webinti:understudyNote') || ''); } catch { setUndNote(''); }
                  setUndModalOpen(true);
                }
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-white/5"
            >
              <span className="text-base leading-none">🤖</span>
              <span className="flex flex-1 flex-col">
                <span className="font-medium text-slate-100">Doublure IA{understudyOn ? ' · active' : ''}</span>
                <span className="text-xs text-slate-400">
                  {understudyOn ? 'Désactiver — vous reprenez la main' : 'Une IA répond à votre place quand vous partez'}
                </span>
              </span>
              <span className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${understudyOn ? 'bg-indigo-500' : 'bg-slate-600'}`}>
                <span className={`h-4 w-4 rounded-full bg-white transition-transform ${understudyOn ? 'translate-x-4' : ''}`} />
              </span>
            </button>
          </div>
        </div>
      )}

      {undModalOpen && (
        <div
          className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setUndModalOpen(false); }}
        >
          <div className="w-full max-w-md rounded-2xl bg-slate-900 p-5 text-slate-100 shadow-2xl ring-1 ring-white/10">
            <h3 className="mb-1 text-lg font-semibold">🤖 Activer ma doublure</h3>
            <p className="mb-3 text-sm text-slate-400">
              Une IA à votre effigie répondra à votre place en proximité. Dites-lui quoi répondre / ce
              qu'elle doit savoir (laissez vide pour un simple « je suis absent, je prends le message »).
            </p>
            <textarea
              value={undNote}
              onChange={(e) => setUndNote(e.target.value)}
              rows={4}
              maxLength={2000}
              autoFocus
              placeholder={'Ex. : Je suis en réunion jusqu’à 15h, je rappelle après. Pour le projet Webinti, dis que c’est en cours de dev. Urgence → contacte Marc.'}
              className="w-full resize-y rounded-lg bg-slate-950 p-3 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setUndModalOpen(false)} className="rounded-lg bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600">Annuler</button>
              <button onClick={activateUnderstudy} className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400">Activer ma doublure</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
