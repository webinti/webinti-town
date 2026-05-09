import { useGameStore } from '../stores/gameStore';

const MAP_W = 50 * 32;
const MAP_H = 40 * 32;
const SIZE = 160;

export function Minimap() {
  const players = useGameStore((s) => s.players);
  const localId = useGameStore((s) => s.localPlayerId);

  return (
    <div
      className="pointer-events-auto rounded-lg border border-white/10 bg-slate-900/80 p-2 shadow-xl backdrop-blur"
      style={{ width: SIZE + 16, height: SIZE + 16 }}
    >
      <div
        className="relative rounded-md bg-slate-800"
        style={{ width: SIZE, height: SIZE }}
      >
        {Array.from(players.values()).map((p) => {
          const px = (p.x / MAP_W) * SIZE;
          const py = (p.y / MAP_H) * SIZE;
          const isSelf = p.id === localId;
          return (
            <div
              key={p.id}
              className="absolute rounded-full"
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
      </div>
    </div>
  );
}
