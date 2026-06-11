import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { liveKitManager } from '../../livekit/LiveKitManager';
import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';
import { AvControls } from './AvControls';
import { EmoteBar } from './EmoteBar';
import { RecordingControls } from './RecordingControls';

// Barre de contrôles mobile façon WorkAdventure : une pastille compacte
// (chat · micro · caméra · menu) en bas à droite, et un panneau « ☰ » qui
// remonte du bas avec TOUT le secondaire (présence, A/V, écran, emotes, avatar,
// admin, aide, enregistrement, zoom, quitter). Objectif : interface épurée.

const subscribe = (cb: () => void) => liveKitManager.subscribe(cb);
const getSnapshot = () => liveKitManager.getSnapshot();

type Presence = 'available' | 'away' | 'brb' | 'dnd';
const PRESENCE: Array<{ value: Presence; label: string; dot: string }> = [
  { value: 'available', label: 'Disponible', dot: 'bg-emerald-400' },
  { value: 'away', label: 'Absent', dot: 'bg-amber-400' },
  { value: 'brb', label: 'Je reviens', dot: 'bg-amber-400' },
  { value: 'dnd', label: 'Ne pas déranger', dot: 'bg-rose-500' },
];

interface Props {
  screenShareEnabled: boolean;
  onToggleScreenShare: () => void;
  onLeave: () => void;
  onOpenAvatar: () => void;
}

export function MobileBar({ screenShareEnabled, onToggleScreenShare, onLeave, onOpenAvatar }: Props) {
  const snap = useSyncExternalStore(subscribe, getSnapshot);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragY, setDragY] = useState(0);          // décalage vertical du glisser-pour-fermer
  const dragStart = useRef<number | null>(null);

  const closeMenu = () => { setMenuOpen(false); setDragY(0); dragStart.current = null; };

  // Glisser la poignée vers le bas pour fermer (comme une vraie bottom sheet).
  const onDragDown = (e: React.PointerEvent) => {
    dragStart.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (dragStart.current === null) return;
    setDragY(Math.max(0, e.clientY - dragStart.current));
  };
  const onDragEnd = () => {
    if (dragStart.current === null) return;
    const shouldClose = dragY > 90;
    dragStart.current = null;
    if (shouldClose) closeMenu();
    else setDragY(0);
  };

  const chatOpen = useGameStore((s) => s.chatPanelOpen);
  const toggleChat = useGameStore((s) => s.toggleChatPanel);
  const unread = useGameStore((s) => s.unreadChat);
  const unreadDmMap = useGameStore((s) => s.unreadDm);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const hostPlayerId = useGameStore((s) => s.hostPlayerId);
  const isHost = !!localPlayerId && localPlayerId === hostPlayerId;
  let unreadDm = 0;
  for (const n of unreadDmMap.values()) unreadDm += n;
  const totalUnread = unread + unreadDm;

  const closeAnd = (fn: () => void) => () => { closeMenu(); fn(); };

  return (
    <>
      {/* Pastille de contrôles — bas-droite */}
      <div
        className="pointer-events-none fixed bottom-5 right-4 z-30 flex items-center gap-1.5"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <PillButton
          onClick={toggleChat}
          active={chatOpen}
          label="Chat"
          badge={totalUnread > 0 ? (totalUnread > 9 ? '9+' : String(totalUnread)) : undefined}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
            <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z" />
          </svg>
        </PillButton>
        <PillButton
          onClick={() => void liveKitManager.setMicEnabled(!snap.localMicEnabled)}
          danger={!snap.localMicEnabled}
          label="Micro"
        >
          <span className="text-lg leading-none">🎤</span>
        </PillButton>
        <PillButton
          onClick={() => void liveKitManager.setCamEnabled(!snap.localCamEnabled)}
          danger={!snap.localCamEnabled}
          label="Caméra"
        >
          <span className="text-lg leading-none">🎥</span>
        </PillButton>
        <PillButton onClick={() => setMenuOpen(true)} label="Menu">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </PillButton>
      </div>

      {/* Panneau ☰ — remonte du bas (bottom sheet) */}
      {menuOpen && (
        <div className="pointer-events-auto fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeMenu}
          />
          <div
            className="relative max-h-[82vh] overflow-y-auto rounded-t-2xl bg-slate-900/97 p-4 text-slate-100 shadow-2xl ring-1 ring-white/10 backdrop-blur"
            style={{
              paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)',
              transform: `translateY(${dragY}px)`,
              transition: dragStart.current === null ? 'transform 0.2s ease-out' : 'none',
            }}
          >
            {/* Poignée de glissement (draggable) — séparée de la croix pour ne
                pas lui voler le clic via la capture du pointeur. */}
            <div
              className="-mt-2 cursor-grab touch-none select-none py-2"
              onPointerDown={onDragDown}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
            >
              <div className="mx-auto h-1.5 w-10 rounded-full bg-white/25" />
            </div>
            {/* Titre + croix (non draggable) */}
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-300">Menu</span>
              <button
                onClick={closeMenu}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-lg text-slate-200 active:bg-white/20"
                aria-label="Fermer le menu"
              >
                ✕
              </button>
            </div>

            {/* Présence */}
            <Section title="Statut">
              <div className="flex flex-wrap gap-2">
                {PRESENCE.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => { useGameStore.getState().setLocalPresence(p.value); socketManager.sendPresenceSet(p.value); }}
                    className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-sm ring-1 ring-white/10 active:bg-white/10"
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${p.dot}`} />
                    {p.label}
                  </button>
                ))}
              </div>
            </Section>

            {/* Réglages audio / vidéo (micro/caméra/périph./volume/miroir) */}
            <Section title="Audio & vidéo">
              <AvControls />
            </Section>

            {/* Emotes */}
            <Section title="Réactions">
              <div className="flex flex-wrap gap-2">
                <EmoteBar />
              </div>
            </Section>

            {/* Actions */}
            <Section title="Actions">
              <Row icon="🖥️" label={screenShareEnabled ? 'Arrêter le partage' : "Partager l'écran"} onClick={closeAnd(onToggleScreenShare)} active={screenShareEnabled} />
              <Row icon="🧑" label="Mon avatar" onClick={closeAnd(onOpenAvatar)} />
              {isHost && <Row icon="👥" label="Panneau admin" onClick={closeAnd(() => useGameStore.getState().setAdminPanelOpen(true))} />}
              <Row icon="❓" label="Aide & raccourcis" onClick={closeAnd(() => useGameStore.getState().setHelpOpen(true))} />
              <div className="my-2"><RecordingControls /></div>
              <ZoomRow />
              <Row icon="🚪" label="Quitter" onClick={closeAnd(onLeave)} danger />
            </Section>
          </div>
        </div>
      )}
    </>
  );
}

function PillButton({
  children, onClick, label, active, danger, badge,
}: {
  children: ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
  danger?: boolean;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`pointer-events-auto relative flex h-12 w-12 items-center justify-center rounded-full ring-1 backdrop-blur transition active:scale-95 ${
        danger
          ? 'bg-red-500/90 text-white ring-red-300/40'
          : active
          ? 'bg-indigo-500 text-white ring-indigo-300/40'
          : 'bg-slate-900/80 text-slate-100 ring-white/10'
      }`}
    >
      {children}
      {badge && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white ring-2 ring-slate-900">
          {badge}
        </span>
      )}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      {children}
    </div>
  );
}

function Row({
  icon, label, onClick, active, danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition active:bg-white/10 ${
        danger ? 'text-rose-300' : active ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-100'
      }`}
    >
      <span className="text-lg leading-none">{icon}</span>
      <span className="font-medium">{label}</span>
    </button>
  );
}

function ZoomRow() {
  const mapZoom = useGameStore((s) => s.mapZoom);
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2">
      <span className="text-lg leading-none">🔍</span>
      <span className="flex-1 text-sm font-medium text-slate-100">Zoom</span>
      <button
        onClick={() => useGameStore.getState().setMapZoom(mapZoom - 0.25)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-lg font-bold active:bg-slate-600"
      >
        −
      </button>
      <span className="w-12 text-center text-xs font-semibold text-slate-300">{Math.round(mapZoom * 100)}%</span>
      <button
        onClick={() => useGameStore.getState().setMapZoom(mapZoom + 0.25)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-lg font-bold active:bg-slate-600"
      >
        +
      </button>
    </div>
  );
}
