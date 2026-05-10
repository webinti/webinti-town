import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';
import type { InteractiveObject, WhiteboardStroke } from '../../types';

const COLORS = [
  '#1a1a1a',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#f3f4f6',
];
const SIZES: Array<{ label: string; size: 2 | 4 | 8 }> = [
  { label: 'S', size: 2 },
  { label: 'M', size: 4 },
  { label: 'L', size: 8 },
];

const CANVAS_W = 880;
const CANVAS_H = 520;
const ERASE_COLOR = '#ffffff';
const MIN_POINT_DIST_PX = 2;
const MAX_POINT_RATE_HZ = 60;

function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: WhiteboardStroke,
  width: number,
  height: number,
): void {
  if (stroke.points.length === 0) return;
  ctx.beginPath();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.isErase ? ERASE_COLOR : stroke.color;
  ctx.lineWidth = stroke.size;
  const first = stroke.points[0]!;
  ctx.moveTo(first.x * width, first.y * height);
  if (stroke.points.length === 1) {
    ctx.lineTo(first.x * width + 0.01, first.y * height + 0.01);
  } else {
    for (let i = 1; i < stroke.points.length; i++) {
      const pt = stroke.points[i]!;
      ctx.lineTo(pt.x * width, pt.y * height);
    }
  }
  ctx.stroke();
}

export function WhiteboardModal() {
  const openId = useGameStore((s) => s.openWhiteboardId);
  const setOpen = useGameStore((s) => s.setOpenWhiteboard);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const objects = useGameStore((s) => s.interactiveObjects);
  const appendStroke = useGameStore((s) => s.appendWhiteboardStroke);

  const board = useMemo<InteractiveObject | null>(() => {
    if (!openId) return null;
    return objects.find((o) => o.id === openId) ?? null;
  }, [openId, objects]);

  const strokes = useMemo<WhiteboardStroke[]>(() => {
    if (!board || board.type !== 'whiteboard') return [];
    return board.data.strokes;
  }, [board]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<{ stroke: WhiteboardStroke; lastSentAt: number } | null>(null);
  const [color, setColor] = useState<string>(COLORS[0]!);
  const [size, setSize] = useState<2 | 4 | 8>(4);
  const [isErase, setIsErase] = useState<boolean>(false);
  const [tick, setTick] = useState(0);

  const isOpen = openId !== null && board !== null && board.type === 'whiteboard';

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, setOpen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) {
      drawStroke(ctx, s, canvas.width, canvas.height);
    }
    const active = drawingRef.current?.stroke;
    if (active) drawStroke(ctx, active, canvas.width, canvas.height);
  }, [strokes, tick, isOpen]);

  if (!isOpen || !board || board.type !== 'whiteboard' || !openId) return null;

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!localPlayerId) return;
    e.preventDefault();
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const pt = getPoint(e);
    if (!pt) return;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    drawingRef.current = {
      stroke: {
        id,
        playerId: localPlayerId,
        color,
        size,
        points: [pt],
        isErase,
      },
      lastSentAt: 0,
    };
    setTick((t) => t + 1);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const draft = drawingRef.current;
    if (!draft) return;
    const now = performance.now();
    if (now - draft.lastSentAt < 1000 / MAX_POINT_RATE_HZ) return;
    const pt = getPoint(e);
    if (!pt) return;
    const last = draft.stroke.points[draft.stroke.points.length - 1]!;
    const canvas = canvasRef.current;
    const w = canvas?.width ?? CANVAS_W;
    const h = canvas?.height ?? CANVAS_H;
    const dx = (pt.x - last.x) * w;
    const dy = (pt.y - last.y) * h;
    if (dx * dx + dy * dy < MIN_POINT_DIST_PX * MIN_POINT_DIST_PX) return;
    draft.stroke.points.push(pt);
    draft.lastSentAt = now;
    setTick((t) => t + 1);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const draft = drawingRef.current;
    drawingRef.current = null;
    if (!draft) return;
    try {
      (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    appendStroke(openId, draft.stroke);
    socketManager.sendWhiteboardStroke(openId, draft.stroke);
    setTick((t) => t + 1);
  };

  const handleClear = () => {
    socketManager.sendWhiteboardClear(openId);
  };

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(null);
      }}
    >
      <div
        className="flex w-[960px] max-w-[95vw] flex-col rounded-2xl bg-slate-900 p-4 text-slate-100 shadow-2xl ring-1 ring-white/10"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Tableau blanc</h2>
          <button
            onClick={() => setOpen(null)}
            className="rounded-md bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600"
          >
            Fermer
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setColor(c);
                  setIsErase(false);
                }}
                className={`h-7 w-7 rounded-full ring-2 transition ${
                  color === c && !isErase ? 'ring-indigo-400' : 'ring-transparent'
                }`}
                style={{ backgroundColor: c }}
                aria-label={`Couleur ${c}`}
              />
            ))}
          </div>
          <div className="mx-1 h-6 w-px bg-white/10" />
          <div className="flex items-center gap-1">
            {SIZES.map((s) => (
              <button
                key={s.size}
                onClick={() => setSize(s.size)}
                className={`rounded-md px-2 py-1 text-xs font-semibold ${
                  size === s.size ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="mx-1 h-6 w-px bg-white/10" />
          <button
            onClick={() => setIsErase((v) => !v)}
            className={`rounded-md px-3 py-1 text-xs font-semibold ${
              isErase ? 'bg-amber-500 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
            }`}
          >
            Gomme
          </button>
          <div className="flex-1" />
          <button
            onClick={handleClear}
            className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500"
          >
            Effacer tout
          </button>
        </div>

        <div className="rounded-md bg-white p-1">
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            className="block touch-none"
            style={{ width: '100%', height: 'auto', cursor: isErase ? 'cell' : 'crosshair' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>

        <div className="mt-2 text-center text-xs text-slate-400">Esc pour fermer</div>
      </div>
    </div>
  );
}
