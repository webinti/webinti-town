import { useGameStore } from './stores/gameStore';
import { JoinScreen } from './react/JoinScreen';
import { HUD } from './react/HUD';
import { PhaserGame } from './phaser/PhaserGame';

export default function App() {
  const joined = useGameStore((s) => s.joined);

  if (!joined) {
    return <JoinScreen />;
  }

  return (
    <div className="relative h-full w-full bg-slate-900">
      <PhaserGame />
      <HUD />
    </div>
  );
}
