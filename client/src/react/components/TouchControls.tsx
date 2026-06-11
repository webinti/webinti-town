import { useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { setTouchMove, clearTouchMove, requestTouchInteract } from '../../phaser/touchInput';

// Contrôles tactiles (tablette / mobile) : joystick virtuel de déplacement
// (bas-gauche) + bouton d'action contextuel (bas-droite, équivalent touche E).
// Affiché uniquement sur appareil tactile (voir HUD).

const BASE = 132; // diamètre de la base du joystick (px)
const KNOB = 58;  // diamètre du pouce
const MAX = (BASE - KNOB) / 2; // débattement max du pouce

const OBJECT_ACTION: Record<string, { label: string; icon: string }> = {
  whiteboard: { label: 'Tableau', icon: '🖊️' },
  note: { label: 'Note', icon: '📝' },
  link: { label: 'Lien', icon: '🔗' },
  kanban: { label: 'Tâches', icon: '📋' },
};

export function TouchControls() {
  const baseRef = useRef<HTMLDivElement>(null);
  const activeId = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const localKartId = useGameStore((s) => s.localKartId);
  const nearbyKartId = useGameStore((s) => s.nearbyKartId);
  const nearbyObjectType = useGameStore((s) => s.nearbyObjectType);

  const track = (e: React.PointerEvent) => {
    if (activeId.current !== e.pointerId || !baseRef.current) return;
    const r = baseRef.current.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > MAX) { dx = (dx / len) * MAX; dy = (dy / len) * MAX; }
    setKnob({ x: dx, y: dy });
    setTouchMove(dx / MAX, dy / MAX);
  };
  const onDown = (e: React.PointerEvent) => {
    activeId.current = e.pointerId;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    track(e);
  };
  const onUp = (e: React.PointerEvent) => {
    if (activeId.current !== e.pointerId) return;
    activeId.current = null;
    setDragging(false);
    setKnob({ x: 0, y: 0 });
    clearTouchMove();
  };

  // Libellé du bouton d'action selon le contexte (priorité = handleInteract côté Phaser).
  let action: { label: string; icon: string } | null = null;
  if (localKartId) action = { label: 'Descendre', icon: '🛻' };
  else if (nearbyObjectType) action = OBJECT_ACTION[nearbyObjectType] ?? { label: 'Interagir', icon: '✋' };
  else if (nearbyKartId) action = { label: 'Monter', icon: '🛻' };

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 select-none"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Joystick — bas-gauche */}
      <div
        ref={baseRef}
        onPointerDown={onDown}
        onPointerMove={track}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="pointer-events-auto absolute bottom-6 left-5 touch-none rounded-full bg-slate-900/40 ring-1 ring-white/25 backdrop-blur-sm"
        style={{ width: BASE, height: BASE }}
        aria-label="Joystick de déplacement"
      >
        <div
          className="absolute rounded-full bg-white/85 shadow-lg ring-1 ring-black/10"
          style={{
            width: KNOB,
            height: KNOB,
            left: (BASE - KNOB) / 2 + knob.x,
            top: (BASE - KNOB) / 2 + knob.y,
            transition: dragging ? 'none' : 'all 0.12s ease-out',
          }}
        />
      </div>

      {/* Bouton d'action contextuel — bas-droite */}
      {action && (
        <button
          onPointerDown={(e) => { e.preventDefault(); requestTouchInteract(); }}
          className="pointer-events-auto absolute bottom-10 right-5 flex h-20 w-20 flex-col items-center justify-center rounded-full bg-indigo-600/90 text-white shadow-2xl ring-2 ring-white/30 transition active:scale-95"
          aria-label={action.label}
        >
          <span className="text-2xl leading-none">{action.icon}</span>
          <span className="mt-0.5 text-[11px] font-bold">{action.label}</span>
        </button>
      )}
    </div>
  );
}
