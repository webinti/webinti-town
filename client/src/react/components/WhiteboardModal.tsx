import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';
import type { InteractiveObject, WhiteboardStroke, WhiteboardText } from '../../types';

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
const TEXT_MAX_LEN = 1000;
const LINE_HEIGHT_RATIO = 1.3;

type Mode = 'pen' | 'eraser' | 'text' | 'select';

function fontPxForSize(size: 2 | 4 | 8): number {
  if (size === 2) return 14;
  if (size === 4) return 20;
  return 32;
}

function normalizeSize(s: number): 2 | 4 | 8 {
  return (s === 2 || s === 4 || s === 8 ? s : 4) as 2 | 4 | 8;
}

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

function drawText(
  ctx: CanvasRenderingContext2D,
  t: WhiteboardText,
  width: number,
  height: number,
): void {
  const size = normalizeSize(t.size);
  const fontPx = fontPxForSize(size);
  const lineHeight = fontPx * LINE_HEIGHT_RATIO;
  ctx.fillStyle = t.color;
  ctx.font = `${fontPx}px sans-serif`;
  ctx.textBaseline = 'top';
  const lines = t.text.split('\n');
  const baseX = t.x * width;
  const baseY = t.y * height;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, baseX, baseY + i * lineHeight);
  }
}

function measureTextBox(
  ctx: CanvasRenderingContext2D,
  t: WhiteboardText,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const size = normalizeSize(t.size);
  const fontPx = fontPxForSize(size);
  const lineHeight = fontPx * LINE_HEIGHT_RATIO;
  ctx.font = `${fontPx}px sans-serif`;
  const lines = t.text.split('\n');
  let maxW = 0;
  for (const line of lines) {
    const m = ctx.measureText(line || ' ').width;
    if (m > maxW) maxW = m;
  }
  return {
    x: t.x * width,
    y: t.y * height,
    w: Math.max(maxW, 8),
    h: Math.max(lines.length * lineHeight, lineHeight),
  };
}

export function WhiteboardModal() {
  const openId = useGameStore((s) => s.openWhiteboardId);
  const setOpen = useGameStore((s) => s.setOpenWhiteboard);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const objects = useGameStore((s) => s.interactiveObjects);
  const appendStroke = useGameStore((s) => s.appendWhiteboardStroke);
  const appendText = useGameStore((s) => s.appendWhiteboardText);
  const updateText = useGameStore((s) => s.updateWhiteboardText);
  const removeText = useGameStore((s) => s.removeWhiteboardText);

  const board = useMemo<InteractiveObject | null>(() => {
    if (!openId) return null;
    return objects.find((o) => o.id === openId) ?? null;
  }, [openId, objects]);

  const strokes = useMemo<WhiteboardStroke[]>(() => {
    if (!board || board.type !== 'whiteboard') return [];
    return board.data.strokes;
  }, [board]);

  const texts = useMemo<WhiteboardText[]>(() => {
    if (!board || board.type !== 'whiteboard') return [];
    return board.data.texts ?? [];
  }, [board]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const drawingRef = useRef<{ stroke: WhiteboardStroke; lastSentAt: number } | null>(null);
  const draggingRef = useRef<{ textId: string; dx: number; dy: number; moved: boolean } | null>(null);
  const [color, setColor] = useState<string>(COLORS[0]!);
  const [size, setSize] = useState<2 | 4 | 8>(4);
  const [mode, setMode] = useState<Mode>('pen');
  const [tick, setTick] = useState(0);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [hoverTextId, setHoverTextId] = useState<string | null>(null);
  const [textInput, setTextInput] = useState<{
    nx: number;
    ny: number;
    pxLeft: number;
    pxTop: number;
    value: string;
  } | null>(null);

  const isOpen = openId !== null && board !== null && board.type === 'whiteboard';

  const changeMode = (m: Mode) => {
    setMode(m);
    if (m !== 'select') setSelectedTextId(null);
  };

  // hit-test helper that needs an offscreen ctx for measuring
  const measureCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const getMeasureCtx = (): CanvasRenderingContext2D | null => {
    if (measureCtxRef.current) return measureCtxRef.current;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    if (ctx) measureCtxRef.current = ctx;
    return ctx;
  };

  const hitTest = (px: number, py: number, w: number, h: number): WhiteboardText | null => {
    const ctx = getMeasureCtx();
    if (!ctx) return null;
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i]!;
      const box = measureTextBox(ctx, t, w, h);
      if (px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) {
        return t;
      }
    }
    return null;
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (textInput) {
          setTextInput(null);
          return;
        }
        if (selectedTextId) {
          setSelectedTextId(null);
          return;
        }
        setOpen(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedTextId && !textInput && openId) {
        const tgt = e.target as HTMLElement | null;
        const tag = tgt?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        removeText(openId, selectedTextId);
        socketManager.sendWhiteboardTextDelete(openId, selectedTextId);
        setSelectedTextId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, setOpen, textInput, selectedTextId, openId, removeText]);

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
    for (const t of texts) {
      drawText(ctx, t, canvas.width, canvas.height);
    }
    const active = drawingRef.current?.stroke;
    if (active) drawStroke(ctx, active, canvas.width, canvas.height);

    if (mode === 'select' && selectedTextId) {
      const sel = texts.find((t) => t.id === selectedTextId);
      if (sel) {
        const box = measureTextBox(ctx, sel, canvas.width, canvas.height);
        const pad = 4;
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 2;
        ctx.strokeRect(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2);
        ctx.setLineDash([]);
        ctx.fillStyle = '#6366f1';
        const dotR = 3;
        const corners: Array<[number, number]> = [
          [box.x - pad, box.y - pad],
          [box.x + box.w + pad, box.y - pad],
          [box.x - pad, box.y + box.h + pad],
          [box.x + box.w + pad, box.y + box.h + pad],
        ];
        for (const [cx, cy] of corners) {
          ctx.beginPath();
          ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }, [strokes, texts, tick, isOpen, mode, selectedTextId]);

  useEffect(() => {
    if (textInput && textAreaRef.current) {
      textAreaRef.current.focus();
      // place caret at end
      const len = textAreaRef.current.value.length;
      textAreaRef.current.setSelectionRange(len, len);
    }
  }, [textInput]);

  // auto-grow textarea
  useEffect(() => {
    const ta = textAreaRef.current;
    if (!ta || !textInput) return;
    ta.style.height = 'auto';
    const fontPx = fontPxForSize(size);
    const lineH = fontPx * LINE_HEIGHT_RATIO;
    const maxH = lineH * 10 + 8;
    ta.style.height = `${Math.min(ta.scrollHeight, maxH)}px`;
  }, [textInput, size]);

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

  const finalizeText = () => {
    if (!textInput || !localPlayerId) {
      setTextInput(null);
      return;
    }
    // preserve internal newlines but trim only outer whitespace
    const trimmed = textInput.value.replace(/^\s+|\s+$/g, '').slice(0, TEXT_MAX_LEN);
    if (!trimmed) {
      setTextInput(null);
      return;
    }
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    const t: WhiteboardText = {
      id,
      playerId: localPlayerId,
      x: textInput.nx,
      y: textInput.ny,
      text: trimmed,
      color,
      size,
    };
    appendText(openId, t);
    socketManager.sendWhiteboardText(openId, t);
    setTextInput(null);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!localPlayerId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    if (mode === 'select') {
      e.preventDefault();
      const px = nx * canvas.width;
      const py = ny * canvas.height;
      const hit = hitTest(px, py, canvas.width, canvas.height);
      if (hit) {
        setSelectedTextId(hit.id);
        draggingRef.current = {
          textId: hit.id,
          dx: nx - hit.x,
          dy: ny - hit.y,
          moved: false,
        };
        (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
      } else {
        setSelectedTextId(null);
      }
      return;
    }

    if (mode === 'text') {
      e.preventDefault();
      const pxLeft = nx * rect.width;
      const pxTop = ny * rect.height;
      if (textInput) {
        finalizeText();
      }
      setTextInput({ nx, ny, pxLeft, pxTop, value: '' });
      return;
    }
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
        isErase: mode === 'eraser',
      },
      lastSentAt: 0,
    };
    setTick((t) => t + 1);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;

    if (mode === 'select') {
      const drag = draggingRef.current;
      if (drag && canvas) {
        const rect = canvas.getBoundingClientRect();
        const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        const newX = Math.max(0, Math.min(1, nx - drag.dx));
        const newY = Math.max(0, Math.min(1, ny - drag.dy));
        drag.moved = true;
        updateText(openId, drag.textId, newX, newY);
      } else if (canvas) {
        // hover detection for cursor
        const rect = canvas.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
        const py = ((e.clientY - rect.top) / rect.height) * canvas.height;
        const hit = hitTest(px, py, canvas.width, canvas.height);
        setHoverTextId(hit ? hit.id : null);
      }
      return;
    }

    const draft = drawingRef.current;
    if (!draft) return;
    const now = performance.now();
    if (now - draft.lastSentAt < 1000 / MAX_POINT_RATE_HZ) return;
    const pt = getPoint(e);
    if (!pt) return;
    const last = draft.stroke.points[draft.stroke.points.length - 1]!;
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
    if (mode === 'select') {
      const drag = draggingRef.current;
      draggingRef.current = null;
      try {
        (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      if (drag && drag.moved) {
        const t = texts.find((tt) => tt.id === drag.textId);
        if (t) {
          socketManager.sendWhiteboardTextUpdate(openId, drag.textId, t.x, t.y);
        }
      }
      return;
    }
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

  let canvasCursor = 'crosshair';
  if (mode === 'eraser') canvasCursor = 'cell';
  else if (mode === 'text') canvasCursor = 'text';
  else if (mode === 'select') {
    if (draggingRef.current) canvasCursor = 'grabbing';
    else if (hoverTextId) canvasCursor = 'move';
    else canvasCursor = 'default';
  }

  const fontPx = fontPxForSize(size);
  const lineH = fontPx * LINE_HEIGHT_RATIO;

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
                  if (mode === 'eraser') changeMode('pen');
                }}
                className={`h-7 w-7 rounded-full ring-2 transition ${
                  color === c && mode !== 'eraser' ? 'ring-indigo-400' : 'ring-transparent'
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
            onClick={() => changeMode('pen')}
            className={`rounded-md px-3 py-1 text-xs font-semibold ${
              mode === 'pen' ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
            }`}
          >
            Stylo
          </button>
          <button
            onClick={() => changeMode('eraser')}
            className={`rounded-md px-3 py-1 text-xs font-semibold ${
              mode === 'eraser' ? 'bg-amber-500 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
            }`}
          >
            Gomme
          </button>
          <button
            onClick={() => changeMode('text')}
            className={`rounded-md px-3 py-1 text-xs font-semibold ${
              mode === 'text' ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
            }`}
            aria-label="Texte"
          >
            T
          </button>
          <button
            onClick={() => changeMode('select')}
            className={`rounded-md px-3 py-1 text-xs font-semibold ${
              mode === 'select' ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
            }`}
            aria-label="Déplacer"
            title="Déplacer / Supprimer un texte"
          >
            Déplacer
          </button>
          <div className="flex-1" />
          <button
            onClick={handleClear}
            className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500"
          >
            Effacer tout
          </button>
        </div>

        <div className="relative rounded-md bg-white p-1">
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            className="block touch-none"
            style={{ width: '100%', height: 'auto', cursor: canvasCursor }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          {textInput ? (
            <textarea
              ref={textAreaRef}
              value={textInput.value}
              maxLength={TEXT_MAX_LEN}
              rows={1}
              onChange={(e) => {
                const v = e.target.value;
                setTextInput((prev) => (prev ? { ...prev, value: v } : prev));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  finalizeText();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setTextInput(null);
                }
              }}
              onBlur={() => {
                finalizeText();
              }}
              className="whiteboard-text-input"
              style={{
                position: 'absolute',
                left: `${textInput.pxLeft + 4}px`,
                top: `${textInput.pxTop + 4}px`,
                color,
                fontSize: `${fontPx}px`,
                fontFamily: 'sans-serif',
                lineHeight: LINE_HEIGHT_RATIO,
                background: '#ffffff',
                border: '1px dashed #94a3b8',
                outline: 'none',
                padding: '0 2px',
                minWidth: '60px',
                minHeight: `${lineH}px`,
                maxHeight: `${lineH * 10 + 8}px`,
                overflowY: 'auto',
                resize: 'none',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            />
          ) : null}
        </div>

        <div className="mt-2 text-center text-xs text-slate-400">
          Esc pour fermer  Cmd/Ctrl+Entrée pour valider le texte  Suppr pour effacer la sélection
        </div>
      </div>
    </div>
  );
}
