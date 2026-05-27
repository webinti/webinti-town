import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type {
  LocalVideoTrack,
  RemoteAudioTrack,
  RemoteVideoTrack,
} from 'livekit-client';
import { useGameStore } from '../../stores/gameStore';
import { isInConferenceZone } from '../../conferenceZone';
import type { RemoteSnapshot } from '../../livekit/LiveKitManager';
import { ScreenViewer } from './ScreenViewer';
import type { Presence } from '../../types';

interface VideoBarProps {
  localCamTrack: LocalVideoTrack | null;
  localScreenTrack: LocalVideoTrack | null;
  localName: string;
  remotes: RemoteSnapshot[];
}

function computeVolume(d: number): number {
  if (d <= 96) return 1;
  if (d >= 160) return 0;
  return 1 - (d - 96) / 64;
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
  const visibleRemotes = remotes.filter((r) => r.videoTrack || r.audioTrack || r.screenTrack);
  const remoteScreens = remotes.filter((r) => r.screenTrack);
  const hasAnything =
    localCamTrack || localScreenTrack || visibleRemotes.length > 0 || remoteScreens.length > 0;
  const localPresence = useGameStore((s) => s.localPresence);
  if (!hasAnything) return null;

  return (
    <div className="pointer-events-none absolute left-1/2 top-14 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
      <ScreenViewers
        localScreenTrack={localScreenTrack}
        localName={localName}
        remoteScreens={remoteScreens}
      />
      {(localCamTrack || visibleRemotes.length > 0) && (
        <div className="pointer-events-auto flex gap-2 rounded-xl bg-slate-900/70 p-2 ring-1 ring-white/10 backdrop-blur">
          {localCamTrack && <LocalTile track={localCamTrack} name={localName} localPresence={localPresence} />}
          {visibleRemotes.map((r) => (
            <RemoteTile key={r.identity} remote={r} />
          ))}
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

function LocalTile({ track, name, localPresence }: {
  track: LocalVideoTrack;
  name: string;
  localPresence: Presence | undefined;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return (
    <div className="relative h-[112px] w-[150px] overflow-hidden rounded-lg bg-slate-900 ring-1 ring-white/10">
      <video ref={ref} autoPlay muted playsInline className="h-full w-full object-cover" />
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

function RemoteTile({ remote }: { remote: RemoteSnapshot }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const players = useGameStore((s) => s.players);
  const remotePlayer = useGameStore((s) => s.players.get(remote.identity));
  const presence = remotePlayer?.presence;

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
    const local = localPlayerId ? players.get(localPlayerId) : undefined;
    const remotePlayer = players.get(remote.identity);
    if (!local || !remotePlayer) {
      el.volume = 1;
      return;
    }
    if (
      isInConferenceZone(local.x, local.y) &&
      isInConferenceZone(remotePlayer.x, remotePlayer.y)
    ) {
      el.volume = 1;
      return;
    }
    const dx = local.x - remotePlayer.x;
    const dy = local.y - remotePlayer.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    el.volume = computeVolume(d);
  }, [players, localPlayerId, remote.identity, remote.audioTrack]);

  return (
    <div className="relative h-[112px] w-[150px] overflow-hidden rounded-lg bg-slate-900 ring-1 ring-white/10">
      {remote.videoTrack ? (
        <video ref={videoRef} autoPlay playsInline className="h-full w-full object-cover" />
      ) : (
        <Initial name={remote.name} id={remote.identity} />
      )}
      <audio ref={audioRef} autoPlay className="hidden" />
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
}
