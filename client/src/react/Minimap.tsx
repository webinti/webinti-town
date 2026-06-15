import { useRef } from 'react';
import { useGameStore } from '../stores/gameStore';

const SIZE = 160;

export function Minimap() {
  const players = useGameStore((s) => s.players);
  const localId = useGameStore((s) => s.localPlayerId);
  const worldW = useGameStore((s) => s.worldW);
  const worldH = useGameStore((s) => s.worldH);
  const freeLook = useGameStore((s) => s.freeLook);
  const freeLookTarget = useGameStore((s) => s.freeLookTarget);
  const enterFreeLook = useGameStore((s) => s.enterFreeLook);
  const setFreeLookTarget = useGameStore((s) => s.setFreeLookTarget);
  const exitFreeLook = useGameStore((s) => s.exitFreeLook);

  const mapRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Coordonnées monde à partir d'un pointeur sur la minimap.
  const worldFromPointer = (clientX: number, clientY: number) => {
    const rect = mapRef.current!.getBoundingClientRect();
    const ox = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const oy = Math.min(Math.max(clientY - rect.top, 0), rect.height);
    return { x: (ox / rect.width) * worldW, y: (oy / rect.height) * worldH };
  };

  return (
    <div
      className="pointer-events-auto rounded-lg border border-white/10 bg-slate-900/80 p-2 shadow-xl backdrop-blur"
      style={{ width: SIZE + 16 }}
    >
      <div
        ref={mapRef}
        className="relative cursor-crosshair touch-none rounded-md bg-slate-800"
        style={{ width: SIZE, height: SIZE }}
        title="Cliquez/glissez pour explorer la map sans bouger"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const w = worldFromPointer(e.clientX, e.clientY);
          enterFreeLook(w.x, w.y);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const w = worldFromPointer(e.clientX, e.clientY);
          setFreeLookTarget(w.x, w.y);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
        {Array.from(players.values()).map((p) => {
          const px = (p.x / worldW) * SIZE;
          const py = (p.y / worldH) * SIZE;
          const isSelf = p.playerId === localId;
          return (
            <div
              key={p.playerId}
              className="pointer-events-none absolute rounded-full"
              style={{
                left: px - 3,
                top: py - 3,
                width: 6,
                height: 6,
                backgroundColor: isSelf ? '#fff' : '#6366f1',
                boxShadow: isSelf ? '0 0 6px #fff' : 'none',
              }}
            />
          );
        })}

        {/* Repère de la zone explorée en vue libre */}
        {freeLook && freeLookTarget && (
          <div
            className="pointer-events-none absolute rounded-full ring-2 ring-amber-400"
            style={{
              left: (freeLookTarget.x / worldW) * SIZE - 9,
              top: (freeLookTarget.y / worldH) * SIZE - 9,
              width: 18,
              height: 18,
              boxShadow: '0 0 8px rgba(251,191,36,.8)',
            }}
          />
        )}
      </div>

      {/* Bandeau « vue libre » + bouton revenir */}
      {freeLook && (
        <button
          onClick={() => exitFreeLook()}
          className="pointer-events-auto mt-1.5 flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-md bg-amber-500 px-2 py-1 text-[11px] font-bold text-slate-900 hover:bg-amber-400"
        >
          👁 Revenir à moi
        </button>
      )}
    </div>
  );
}
