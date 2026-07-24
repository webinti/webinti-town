import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  LocalVideoTrack,
  RemoteAudioTrack,
  RemoteVideoTrack,
} from 'livekit-client';
import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';
import type { RemoteSnapshot } from '../../livekit/LiveKitManager';
import { ScreenViewer } from './ScreenViewer';
import { isTouchDevice } from '../../lib/isTouchDevice';
import { inCircuitZone } from '../../circuit';
import type { Presence, PlayerState } from '../../types';

// Vue mosaïque : réservée au desktop (sur mobile l'écran est trop petit).
const IS_TOUCH = isTouchDevice();

// Zone « micro ouvert » : les deux joueurs sur le circuit kart s'entendent à
// plein volume quelle que soit la distance (miroir de OPEN_MIC_ZONES côté
// serveur, qui maintient les abonnements aux pistes dans ce cas).
function bothInOpenMicZone(local: PlayerState, remote: PlayerState): boolean {
  return inCircuitZone(local.x, local.y) && inCircuitZone(remote.x, remote.y);
}

// Vrai si `remote` est à portée audible de `local` (mêmes règles que le volume) :
// zone micro ouvert (circuit), même poste/salle, ou < 8 tuiles en zone commune.
// Sert à n'afficher la tuile (caméra + audio) que dans ce cas — au-delà, son ET
// webcam coupés.
function inAudibleRange(
  local: PlayerState | undefined,
  remote: PlayerState | undefined,
): boolean {
  if (!local || !remote) return true; // pas d'info de position → on montre
  if (bothInOpenMicZone(local, remote)) return true;
  const localWs = local.workstationId ?? null;
  const remoteWs = remote.workstationId ?? null;
  if (localWs !== null || remoteWs !== null) {
    return localWs !== null && localWs === remoteWs;
  }
  const ZERO_PX = 8 * 32; // hors-portée au-delà de 8 tuiles (= silence)
  return Math.hypot(local.x - remote.x, local.y - remote.y) < ZERO_PX;
}

interface VideoBarProps {
  localCamTrack: LocalVideoTrack | null;
  localScreenTrack: LocalVideoTrack | null;
  localName: string;
  remotes: RemoteSnapshot[];
}

function ScreenViewers({
  localScreenTrack,
  localName,
  remoteScreens,
}: {
  localScreenTrack: LocalVideoTrack | null;
  localName: string;
  remoteScreens: RemoteSnapshot[];
}) {
  if (!localScreenTrack && remoteScreens.length === 0) return null;
  return createPortal(
    <>
      {localScreenTrack && (
        <ScreenViewer
          track={localScreenTrack}
          label={`${localName} (votre écran)`}
          index={0}
        />
      )}
      {remoteScreens.map((r, i) =>
        r.screenTrack ? (
          <ScreenViewer
            key={`screen-${r.identity}`}
            track={r.screenTrack}
            label={`${r.name} (écran partagé)`}
            index={(localScreenTrack ? 1 : 0) + i}
          />
        ) : null,
      )}
    </>,
    document.body,
  );
}

export function VideoBar({ localCamTrack, localScreenTrack, localName, remotes }: VideoBarProps) {
  const localPresence = useGameStore((s) => s.localPresence);
  const players = useGameStore((s) => s.players);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const local = localPlayerId ? players.get(localPlayerId) : undefined;
  // Vue mosaïque (desktop) : grands carreaux façon Meet quand on est 3+.
  const [grid, setGrid] = useState(false);

  // Une tuile (caméra + audio) n'est affichée QUE si la personne est à portée
  // audible (mêmes règles que le son : poste/conf ou < 8 tuiles). Au-delà, on
  // coupe son ET webcam. Le partage d'écran, lui, reste visible (présentation).
  const remoteScreens = remotes.filter((r) => r.screenTrack);
  const visibleRemotes = remotes.filter(
    (r) => (r.videoTrack || r.audioTrack) && inAudibleRange(local, players.get(r.identity)),
  );

  // ⚠ Hooks AVANT le early return (sinon « rendered more hooks » au 1er remote).
  // Échap ferme la mosaïque.
  useEffect(() => {
    if (!grid) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGrid(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [grid]);
  // Retour auto à la barre si la conversation retombe sous 3 personnes.
  useEffect(() => {
    if (grid && visibleRemotes.length < 2) setGrid(false);
  }, [grid, visibleRemotes.length]);

  const hasAnything =
    localCamTrack || localScreenTrack || visibleRemotes.length > 0 || remoteScreens.length > 0;
  if (!hasAnything) return null;

  // ── Vue mosaïque ─────────────────────────────────────────────────────────
  // Panneau central large qui laisse la barre de contrôles du bas accessible
  // (micro/cam/quitter). Les tuiles sont les MÊMES composants que la barre
  // (un seul attach audio). Échap ou « Réduire » pour revenir.
  if (grid) {
    const tileCount = 1 + visibleRemotes.length;
    const gridCols = tileCount <= 4 ? 'grid-cols-2' : tileCount <= 9 ? 'grid-cols-3' : 'grid-cols-4';
    return (
      <>
        <ScreenViewers
          localScreenTrack={localScreenTrack}
          localName={localName}
          remoteScreens={remoteScreens}
        />
        <div className="pointer-events-auto fixed bottom-24 left-1/2 top-12 z-30 flex w-[min(96vw,1400px)] -translate-x-1/2 flex-col rounded-2xl bg-slate-950/95 shadow-2xl ring-1 ring-white/10 backdrop-blur">
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-sm font-semibold text-slate-200">
              👥 {tileCount} en conversation
            </span>
            <button
              onClick={() => setGrid(false)}
              title="Réduire (Échap)"
              className="flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-sm font-medium text-slate-200 transition hover:bg-white/20"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M9 15l-6 6M3 15h6v6M15 9l6-6M15 3h6v6" />
              </svg>
              Réduire
            </button>
          </div>
          <div className={`grid flex-1 ${gridCols} auto-rows-fr gap-3 overflow-y-auto p-3 pt-0`}>
            {localCamTrack ? (
              <LocalTile
                large
                track={localCamTrack}
                name={localName}
                id={localPlayerId ?? 'local'}
                localPresence={localPresence}
              />
            ) : (
              /* Sans caméra locale : carreau placeholder avec l'initiale. */
              <div className="relative h-full min-h-[160px] w-full overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10">
                <Initial name={localName} id={localPlayerId ?? 'local'} />
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 text-xs text-white">
                  {localName} (vous)
                </div>
              </div>
            )}
            {visibleRemotes.map((r) => (
              <RemoteTile key={r.identity} remote={r} large />
            ))}
          </div>
        </div>
      </>
    );
  }

  // ── Barre compacte (mode normal) ─────────────────────────────────────────
  return (
    <div className="pointer-events-none absolute left-1/2 top-14 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
      <ScreenViewers
        localScreenTrack={localScreenTrack}
        localName={localName}
        remoteScreens={remoteScreens}
      />
      {(localCamTrack || visibleRemotes.length > 0) && (
        <div className="pointer-events-auto flex gap-2 rounded-xl bg-slate-900/70 p-2 ring-1 ring-white/10 backdrop-blur">
          {localCamTrack && (
            <LocalTile
              track={localCamTrack}
              name={localName}
              id={localPlayerId ?? 'local'}
              localPresence={localPresence}
            />
          )}
          {visibleRemotes.map((r) => (
            <RemoteTile key={r.identity} remote={r} />
          ))}
          {/* Vue mosaïque dispo dès 3 personnes en conversation (desktop). */}
          {!IS_TOUCH && visibleRemotes.length >= 2 && (
            <button
              onClick={() => setGrid(true)}
              title="Vue mosaïque — grands carreaux (3+ participants)"
              aria-label="Passer en vue mosaïque"
              className="flex w-10 items-center justify-center self-stretch rounded-lg bg-slate-800/80 text-slate-300 ring-1 ring-white/10 transition hover:bg-indigo-600 hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}


function presenceDot(presence: Presence | undefined): { dot: string; title: string } {
  switch (presence) {
    case 'away':     return { dot: '🟡', title: 'Absent' };
    case 'brb':      return { dot: '🟡', title: 'Je reviens' };
    case 'dnd':      return { dot: '🔴', title: 'Ne pas déranger' };
    case 'inactive': return { dot: '⚪', title: 'Inactif' };
    case 'available':
    default:         return { dot: '🟢', title: 'Disponible' };
  }
}

function colorFor(id: string): string {
  const palette = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length]!;
}

function Initial({ name, id }: { name: string; id: string }) {
  const ch = (name || '?').slice(0, 1).toUpperCase();
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-800">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-white"
        style={{ backgroundColor: colorFor(id) }}
      >
        {ch}
      </div>
    </div>
  );
}

function MicMutedBadge() {
  return (
    <div
      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 ring-1 ring-red-500/70"
      title="Micro coupé"
      aria-label="Micro coupé"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 text-red-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3a3 3 0 0 0-3 3v4.5" />
        <path d="M15 10.5V6a3 3 0 0 0-3-3" opacity="0.6" />
        <path d="M9 10.5V12a3 3 0 0 0 6 0v-1.5" />
        <path d="M5.5 11.5a6.5 6.5 0 0 0 6.5 6.5 6.5 6.5 0 0 0 6.5-6.5" />
        <path d="M12 18v3" />
        <line x1="3.5" y1="3.5" x2="20.5" y2="20.5" stroke="currentColor" />
      </svg>
    </div>
  );
}

function LocalTile({ track, name, id, localPresence, large }: {
  track: LocalVideoTrack;
  name: string;
  id: string;
  localPresence: Presence | undefined;
  /** true = grand carreau (vue mosaïque), sinon vignette de la barre. */
  large?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const camMirror = useGameStore((s) => s.camMirror);
  // Le track LiveKit peut être référencé mais muted/disposé (ex : setCameraEnabled(false)
  // qui mute au lieu d'unpublish). Dans ce cas, montrer l'Initial au lieu d'un cadre
  // noir résiduel. On s'abonne aux events muted/unmuted du track pour mettre à jour.
  const [isLive, setIsLive] = useState(() => {
    const mst = track.mediaStreamTrack;
    return !track.isMuted && (!mst || mst.readyState === 'live');
  });
  useEffect(() => {
    const mst = track.mediaStreamTrack;
    const recompute = () => {
      const m = track.mediaStreamTrack;
      setIsLive(!track.isMuted && (!m || m.readyState === 'live'));
    };
    recompute();
    const onMuted = () => setIsLive(false);
    const onUnmuted = () => recompute();
    const onEnded = () => setIsLive(false);
    track.on('muted', onMuted);
    track.on('unmuted', onUnmuted);
    mst?.addEventListener('ended', onEnded);
    return () => {
      track.off('muted', onMuted);
      track.off('unmuted', onUnmuted);
      mst?.removeEventListener('ended', onEnded);
    };
  }, [track]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !isLive) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track, isLive]);
  return (
    <div className={large
      ? 'relative h-full min-h-[160px] w-full overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10'
      : 'relative h-[112px] w-[150px] overflow-hidden rounded-lg bg-slate-900 ring-1 ring-white/10'}>
      {isLive ? (
        <video
          ref={ref}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover"
          style={camMirror ? { transform: 'scaleX(-1)' } : undefined}
        />
      ) : (
        <Initial name={name} id={id} />
      )}
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1 truncate bg-black/60 px-2 py-0.5 text-xs text-white">
        <span
          title={presenceDot(localPresence).title}
          aria-label={presenceDot(localPresence).title}
          className="shrink-0"
        >
          {presenceDot(localPresence).dot}
        </span>
        <span className="truncate">{name} (vous)</span>
      </div>
    </div>
  );
}

const RemoteTile = memo(function RemoteTile({ remote, large }: { remote: RemoteSnapshot; large?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // On NE s'abonne PAS à toute la Map players (qui change ~20×/s à chaque
  // déplacement de n'importe qui) : seulement à MON joueur et au joueur distant
  // de cette tuile. La tuile ne se re-render donc que quand l'un des deux bouge
  // (ce qui est exactement quand le volume de proximité doit changer).
  const localPlayer = useGameStore((s) => (s.localPlayerId ? s.players.get(s.localPlayerId) : undefined));
  const remotePlayer = useGameStore((s) => s.players.get(remote.identity));
  const presence = remotePlayer?.presence;
  const deafened = useGameStore((s) => s.deafened);
  const masterVolume = useGameStore((s) => s.masterVolume);

  useEffect(() => {
    const el = videoRef.current;
    const t = remote.videoTrack as RemoteVideoTrack | null;
    if (!el || !t) return;
    t.attach(el);
    return () => {
      t.detach(el);
    };
  }, [remote.videoTrack]);

  useEffect(() => {
    const el = audioRef.current;
    const t = remote.audioTrack as RemoteAudioTrack | null;
    if (!el || !t) return;
    t.attach(el);
    return () => {
      t.detach(el);
    };
  }, [remote.audioTrack]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    // Sourdine totale (bouton 🔇) : on coupe toute voix entrante, distance ignorée.
    if (deafened) {
      el.volume = 0;
      return;
    }
    // base = volume "proximité/poste" (0..1), puis × volume master (slider).
    let base: number;
    const local = localPlayer;
    if (!local || !remotePlayer) {
      base = 1;
    } else {
      // Règles audio :
      //  - Zone micro ouvert (circuit kart) : plein volume, distance ignorée.
      //  - Dans un poste/salle (workstation, dont 'salle-conf') : audio ISOLÉ au
      //    groupe → même workstationId seulement, distance ignorée.
      //  - Hors poste (zones communes) : PROXIMITÉ → décroît avec la distance.
      const localWs = local.workstationId ?? null;
      const remoteWs = remotePlayer.workstationId ?? null;
      if (bothInOpenMicZone(local, remotePlayer)) {
        base = 1;
      } else if (localWs !== null || remoteWs !== null) {
        base = localWs !== null && localWs === remoteWs ? 1 : 0;
      } else {
        const FULL_PX = 4 * 32; // volume plein en deçà de 4 tuiles
        const ZERO_PX = 8 * 32; // silence au-delà de 8 tuiles
        const dist = Math.hypot(local.x - remotePlayer.x, local.y - remotePlayer.y);
        base = dist <= FULL_PX ? 1 : dist >= ZERO_PX ? 0 : 1 - (dist - FULL_PX) / (ZERO_PX - FULL_PX);
      }
    }
    el.volume = base * masterVolume;
  }, [localPlayer, remotePlayer, remote.audioTrack, deafened, masterVolume]);

  return (
    <div className={large
      ? 'relative h-full min-h-[160px] w-full overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10'
      : 'relative h-[112px] w-[150px] overflow-hidden rounded-lg bg-slate-900 ring-1 ring-white/10'}>
      {remote.videoTrack ? (
        <video ref={videoRef} autoPlay playsInline className="h-full w-full object-cover" />
      ) : (
        <Initial name={remote.name} id={remote.identity} />
      )}
      <audio ref={audioRef} autoPlay className="hidden" />
      <button
        onClick={() => socketManager.knock(remote.identity)}
        title={`Faire signe à ${remote.name} (toc toc)`}
        aria-label={`Faire signe à ${remote.name}`}
        className="absolute left-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-sm ring-1 ring-white/15 transition hover:bg-indigo-600/80 active:scale-95"
      >
        👋
      </button>
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1 truncate bg-black/60 px-2 py-0.5 text-xs text-white">
        <span
          title={presenceDot(presence).title}
          aria-label={presenceDot(presence).title}
          className="shrink-0"
        >
          {presenceDot(presence).dot}
        </span>
        <span className="truncate">{remote.name}</span>
      </div>
      {remote.isMuted && <MicMutedBadge />}
    </div>
  );
});
