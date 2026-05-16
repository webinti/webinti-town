import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  LocalVideoTrack,
  RemoteAudioTrack,
  RemoteVideoTrack,
} from 'livekit-client';
import { useGameStore } from '../../stores/gameStore';
import { inConferenceZone } from '../../conferenceZone';
import type { RemoteSnapshot } from '../../livekit/LiveKitManager';

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

interface ScreenSource {
  key: string;
  track: LocalVideoTrack | RemoteVideoTrack;
  name: string;
  isLocal: boolean;
}

type ViewerState = 'windowed' | 'fullscreen' | 'minimized';

export function VideoBar({ localCamTrack, localScreenTrack, localName, remotes }: VideoBarProps) {
  const visibleRemotes = remotes.filter((r) => r.videoTrack || r.audioTrack || r.screenTrack);
  const remoteScreens = remotes.filter((r) => r.screenTrack);

  const screenSources: ScreenSource[] = [];
  if (localScreenTrack) {
    screenSources.push({
      key: 'local-screen',
      track: localScreenTrack,
      name: localName,
      isLocal: true,
    });
  }
  for (const r of remoteScreens) {
    if (!r.screenTrack) continue;
    screenSources.push({
      key: `screen-${r.identity}`,
      track: r.screenTrack,
      name: r.name,
      isLocal: false,
    });
  }

  const hasAnything =
    localCamTrack || visibleRemotes.length > 0 || screenSources.length > 0;
  if (!hasAnything) return null;

  return (
    <>
      {screenSources.length > 0 && <ScreenViewerLayer sources={screenSources} />}
      {(localCamTrack || visibleRemotes.length > 0) && (
        <div className="pointer-events-none absolute left-1/2 top-14 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
          <div className="pointer-events-auto flex gap-2 rounded-xl bg-slate-900/70 p-2 ring-1 ring-white/10 backdrop-blur">
            {localCamTrack && <LocalTile track={localCamTrack} name={localName} />}
            {visibleRemotes.map((r) => (
              <RemoteTile key={r.identity} remote={r} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function ScreenViewerLayer({ sources }: { sources: ScreenSource[] }) {
  return (
    <>
      {sources.map((s, i) => (
        <ScreenViewer key={s.key} source={s} index={i} />
      ))}
    </>
  );
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

function ScreenViewer({ source, index }: { source: ScreenSource; index: number }) {
  const { track, name, isLocal } = source;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<ViewerState>('windowed');
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(16, window.innerWidth / 2 - 450 + index * 36),
    y: 72 + index * 36,
  }));
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track, state]);

  useEffect(() => {
    if (zoom <= 1) setPan({ x: 0, y: 0 });
  }, [zoom]);

  const startPanelDrag = useCallback(
    (e: React.MouseEvent) => {
      if (state !== 'windowed') return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const origin = { ...pos };
      const onMove = (ev: MouseEvent) => {
        const nx = origin.x + (ev.clientX - startX);
        const ny = origin.y + (ev.clientY - startY);
        const maxX = window.innerWidth - 120;
        const maxY = window.innerHeight - 80;
        setPos({
          x: Math.min(maxX, Math.max(-200, nx)),
          y: Math.min(maxY, Math.max(0, ny)),
        });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [state, pos],
  );

  const startVideoPan = useCallback(
    (e: React.MouseEvent) => {
      if (zoom <= 1) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const origin = { ...pan };
      const onMove = (ev: MouseEvent) => {
        setPan({
          x: origin.x + (ev.clientX - startX),
          y: origin.y + (ev.clientY - startY),
        });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [zoom, pan],
  );

  const changeZoom = (delta: number) => {
    setZoom((z) => {
      const next = Math.round((z + delta) * 100) / 100;
      return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    });
  };

  const title = isLocal ? `${name} (votre écran)` : name;

  if (state === 'minimized') {
    return (
      <button
        onClick={() => setState('windowed')}
        title={`Restaurer l'écran de ${name}`}
        style={{ bottom: 96 + index * 132 }}
        className="pointer-events-auto fixed left-4 z-30 flex h-[120px] w-[200px] flex-col overflow-hidden rounded-lg bg-black text-left ring-2 ring-indigo-400/60 shadow-2xl"
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-contain"
        />
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-black/70 px-2 py-1 text-[11px] text-white">
          <span className="truncate">Écran de {name}</span>
          <span aria-hidden className="ml-1">&#x2922;</span>
        </div>
      </button>
    );
  }

  const isFull = state === 'fullscreen';

  const containerStyle: React.CSSProperties = isFull
    ? {}
    : {
        left: pos.x,
        top: pos.y,
        width: 'min(70vw, 900px)',
      };

  const videoTransform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;

  return (
    <div
      style={containerStyle}
      className={
        isFull
          ? 'pointer-events-auto fixed inset-0 z-[60] flex flex-col bg-black'
          : 'pointer-events-auto fixed z-40 flex flex-col overflow-hidden rounded-lg bg-black ring-2 ring-indigo-400/60 shadow-2xl'
      }
    >
      <div
        onMouseDown={startPanelDrag}
        className={`flex items-center justify-between gap-2 bg-slate-900/90 px-3 py-2 text-sm text-white ${
          isFull ? '' : 'cursor-move'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
            En direct
          </span>
          <span className="truncate">{title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isFull ? (
            <button
              onClick={() => setState('windowed')}
              className="rounded bg-slate-700 px-2 py-1 text-xs font-semibold hover:bg-slate-600"
            >
              Fenêtré
            </button>
          ) : (
            <button
              onClick={() => setState('fullscreen')}
              className="rounded bg-slate-700 px-2 py-1 text-xs font-semibold hover:bg-slate-600"
            >
              Plein écran
            </button>
          )}
          <button
            onClick={() => setState('minimized')}
            className="rounded bg-slate-700 px-2 py-1 text-xs font-semibold hover:bg-slate-600"
          >
            Réduire
          </button>
        </div>
      </div>

      <div
        onMouseDown={startVideoPan}
        className={`relative flex-1 overflow-hidden bg-black ${
          zoom > 1 ? 'cursor-grab' : ''
        }`}
        style={isFull ? undefined : { height: 'min(56vh, 600px)' }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full select-none object-contain"
          style={{ transform: videoTransform, transformOrigin: 'center center' }}
        />
        <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-slate-900/80 px-2 py-1 text-xs text-white ring-1 ring-white/10">
          <button
            onClick={() => changeZoom(-ZOOM_STEP)}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 font-bold hover:bg-slate-600"
            title="Dézoomer"
          >
            &minus;
          </button>
          <span className="w-12 select-none text-center tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => changeZoom(ZOOM_STEP)}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 font-bold hover:bg-slate-600"
            title="Zoomer"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
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

function MicBadge({ muted }: { muted: boolean }) {
  return (
    <div className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[10px] text-white">
      {muted ? (
        <span className="relative">
          M
          <span className="absolute inset-0 -rotate-45 border-t border-red-400" />
        </span>
      ) : (
        <span>M</span>
      )}
    </div>
  );
}

function LocalTile({ track, name }: { track: LocalVideoTrack; name: string }) {
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
      <div className="absolute bottom-0 left-0 right-0 truncate bg-black/60 px-2 py-0.5 text-xs text-white">
        {name} (vous)
      </div>
    </div>
  );
}

function RemoteTile({ remote }: { remote: RemoteSnapshot }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const players = useGameStore((s) => s.players);

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
      inConferenceZone(local.x, local.y) &&
      inConferenceZone(remotePlayer.x, remotePlayer.y)
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
      <div className="absolute bottom-0 left-0 right-0 truncate bg-black/60 px-2 py-0.5 text-xs text-white">
        {remote.name}
      </div>
      <MicBadge muted={remote.isMuted} />
    </div>
  );
}
