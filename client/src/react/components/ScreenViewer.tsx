import { useEffect, useRef, useState } from 'react';
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client';
import {
  clampPan,
  nextViewerZoom,
  type Pan,
} from './screenViewerMath';

type Mode = 'windowed' | 'fullscreen' | 'minimized';

interface ScreenViewerProps {
  track: LocalVideoTrack | RemoteVideoTrack;
  label: string;
  index: number;
}

export function ScreenViewer({ track, label, index }: ScreenViewerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<Mode>('windowed');
  const [pos, setPos] = useState({ x: 80 + index * 32, y: 72 + index * 32 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });

  const dragWin = useRef<{ ox: number; oy: number } | null>(null);
  const dragPan = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  // Window drag (title bar)
  useEffect(() => {
    if (!dragWin.current && !dragPan.current) return;
    const onMove = (e: MouseEvent) => {
      if (dragWin.current) {
        setPos({ x: e.clientX - dragWin.current.ox, y: e.clientY - dragWin.current.oy });
      } else if (dragPan.current) {
        const body = bodyRef.current;
        const w = body?.clientWidth ?? 1;
        const h = body?.clientHeight ?? 1;
        const nx = dragPan.current.px + (e.clientX - dragPan.current.sx);
        const ny = dragPan.current.py + (e.clientY - dragPan.current.sy);
        setPan(clampPan({ x: nx, y: ny }, zoom, w, h));
      }
    };
    const onUp = () => {
      dragWin.current = null;
      dragPan.current = null;
      setTick((t) => t + 1);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  });
  // Force re-subscribe of the drag effect when a drag starts/ends.
  const [, setTick] = useState(0);

  const startWinDrag = (e: React.MouseEvent) => {
    if (mode !== 'windowed') return;
    dragWin.current = { ox: e.clientX - pos.x, oy: e.clientY - pos.y };
    setTick((t) => t + 1);
  };

  const startPan = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    dragPan.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
    setTick((t) => t + 1);
  };

  const applyZoom = (dir: 1 | -1) => {
    const nz = nextViewerZoom(zoom, dir);
    setZoom(nz);
    const body = bodyRef.current;
    setPan((p) => clampPan(p, nz, body?.clientWidth ?? 1, body?.clientHeight ?? 1));
  };

  const videoTransform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;

  const ZoomCluster = (
    <div className="pointer-events-auto absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/70 p-1 text-white ring-1 ring-white/15">
      <button
        onClick={() => applyZoom(-1)}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-base font-bold hover:bg-white/20"
        title="Dézoomer"
      >
        −
      </button>
      <span className="min-w-[3rem] text-center text-xs font-semibold">
        {Math.round(zoom * 100)}%
      </span>
      <button
        onClick={() => applyZoom(1)}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-base font-bold hover:bg-white/20"
        title="Zoomer"
      >
        +
      </button>
    </div>
  );

  const LiveBadge = (
    <span className="flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
      <span className="h-1.5 w-1.5 rounded-full bg-white" />
      En direct
    </span>
  );

  // Shared video body (one element across all modes for stable track attach).
  const VideoBody = (
    <div
      ref={bodyRef}
      className="relative h-full w-full overflow-hidden bg-black"
      onMouseDown={startPan}
      style={{ cursor: zoom > 1 ? 'grab' : 'default' }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="h-full w-full object-contain"
        style={{ transform: videoTransform, transformOrigin: 'center center' }}
      />
    </div>
  );

  if (mode === 'minimized') {
    return (
      <button
        onClick={() => setMode('windowed')}
        title="Restaurer le partage d'écran"
        className="pointer-events-auto fixed bottom-4 left-4 z-40 h-[120px] w-[200px] overflow-hidden rounded-lg bg-black ring-2 ring-indigo-400/60 shadow-2xl"
        style={{ marginBottom: index * 130 }}
      >
        {VideoBody}
        <span className="absolute left-1 top-1">{LiveBadge}</span>
        <span className="absolute bottom-0 left-0 right-0 truncate bg-black/70 px-2 py-0.5 text-[10px] text-white">
          {label}
        </span>
      </button>
    );
  }

  if (mode === 'fullscreen') {
    return (
      <div className="pointer-events-auto fixed inset-0 z-50 flex flex-col bg-black">
        <div className="flex items-center justify-between gap-2 bg-black/80 px-3 py-2 text-white">
          <div className="flex items-center gap-2">
            {LiveBadge}
            <span className="truncate text-sm">{label}</span>
          </div>
          <button
            onClick={() => setMode('windowed')}
            className="rounded-md bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20"
          >
            Fenêtré
          </button>
        </div>
        <div className="relative flex-1">
          {VideoBody}
          {ZoomCluster}
        </div>
      </div>
    );
  }

  // windowed
  return (
    <div
      className="pointer-events-auto fixed z-40 flex w-[70vw] flex-col overflow-hidden rounded-lg bg-slate-950 ring-2 ring-indigo-400/60 shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        onMouseDown={startWinDrag}
        className="flex cursor-move items-center justify-between gap-2 bg-slate-800 px-3 py-2 text-white"
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {LiveBadge}
          <span className="truncate text-sm">{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMode('fullscreen')}
            className="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold hover:bg-white/20"
          >
            Plein écran
          </button>
          <button
            onClick={() => setMode('minimized')}
            className="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold hover:bg-white/20"
          >
            Réduire
          </button>
        </div>
      </div>
      <div className="relative h-[60vh]">
        {VideoBody}
        {ZoomCluster}
      </div>
    </div>
  );
}
