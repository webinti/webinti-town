import { useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { setTouchMove, clearTouchMove, requestTouchInteract } from '../../phaser/touchInput';

// Contrôles de jeu tactiles (tablette / mobile) : petit joystick de déplacement
// (bas-gauche, discret) + bouton d'action contextuel (bas-droite, = touche E).
// La barre micro/cam/chat/menu est gérée séparément par MobileBar.

const BASE = 104; // diamètre de la base du joystick (px) — volontairement compact
const KNOB = 46;
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
      {/* Joystick — bas-gauche, discret (s'éclaircit quand on l'utilise) */}
      <div
        ref={baseRef}
        onPointerDown={onDown}
        onPointerMove={track}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className={`pointer-events-auto absolute bottom-5 left-4 touch-none rounded-full ring-1 transition-colors ${
          dragging ? 'bg-white/10 ring-white/30' : 'bg-white/5 ring-white/15'
        }`}
        style={{ width: BASE, height: BASE }}
        aria-label="Joystick de déplacement"
      >
        <div
          className={`absolute rounded-full shadow-md ring-1 ring-black/10 ${
            dragging ? 'bg-white/90' : 'bg-white/55'
          }`}
          style={{
            width: KNOB,
            height: KNOB,
            left: (BASE - KNOB) / 2 + knob.x,
            top: (BASE - KNOB) / 2 + knob.y,
            transition: dragging ? 'none' : 'all 0.12s ease-out',
          }}
        />
      </div>

      {/* Bouton d'action contextuel — bas-droite, au-dessus de la barre de contrôles */}
      {action && (
        <button
          onPointerDown={(e) => { e.preventDefault(); requestTouchInteract(); }}
          className="pointer-events-auto absolute bottom-24 right-4 flex h-16 w-16 flex-col items-center justify-center rounded-full bg-indigo-600/95 text-white shadow-xl ring-2 ring-white/30 transition active:scale-95"
          aria-label={action.label}
        >
          <span className="text-xl leading-none">{action.icon}</span>
          <span className="mt-0.5 text-[10px] font-bold">{action.label}</span>
        </button>
      )}
    </div>
  );
}
