import { useEffect } from 'react';
import { useGameStore } from './stores/gameStore';
import { useAuthStore } from './stores/authStore';
import { AuthScreen } from './react/AuthScreen';
import { JoinScreen } from './react/JoinScreen';
import { HUD } from './react/HUD';
import { PhaserGame } from './phaser/PhaserGame';

export default function App() {
  const ready = useAuthStore((s) => s.ready);
  const user = useAuthStore((s) => s.user);
  const joined = useGameStore((s) => s.joined);

  useEffect(() => {
    void useAuthStore.getState().init();
  }, []);

  // 1. Vérification du token en cours
  if (!ready) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-900 text-slate-400">
        Chargement…
      </div>
    );
  }
  // 2. Pas connecté → écran d'auth (compte obligatoire)
  if (!user) {
    return <AuthScreen />;
  }
  // 3. Connecté mais pas encore entré → choix avatar/pseudo
  if (!joined) {
    return <JoinScreen />;
  }
  // 4. En jeu
  return (
    <div className="relative h-full w-full bg-slate-900">
      <PhaserGame />
      <HUD />
    </div>
  );
}
