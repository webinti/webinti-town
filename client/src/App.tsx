import { lazy, Suspense, useEffect, useState } from 'react';
import { useGameStore } from './stores/gameStore';
import { useAuthStore } from './stores/authStore';
import { AuthScreen } from './react/AuthScreen';
import { JoinScreen } from './react/JoinScreen';
import { explicitRoomFromUrl, isGuestRoom } from './room';

// Phaser (~800 kB) et le HUD (qui tire LiveKit, ~490 kB) ne servent qu'une fois
// en jeu : on les charge en lazy pour que les écrans d'auth/join s'affichent
// instantanément, sans payer ces libs au premier rendu.
const PhaserGame = lazy(() =>
  import('./phaser/PhaserGame').then((m) => ({ default: m.PhaserGame })),
);
const HUD = lazy(() => import('./react/HUD').then((m) => ({ default: m.HUD })));

export default function App() {
  const ready = useAuthStore((s) => s.ready);
  const user = useAuthStore((s) => s.user);
  const joined = useGameStore((s) => s.joined);
  const [forceAuth, setForceAuth] = useState(false);

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
  // 2. Pas encore en jeu ET pas connecté (!joined crucial : un invité qui a rejoint
  //    n'a pas de user, il doit passer au jeu). Lien ?room=demo → invité ; sinon auth.
  if (!user && !joined) {
    if (!forceAuth && isGuestRoom(explicitRoomFromUrl())) {
      return <JoinScreen onRequestAuth={() => setForceAuth(true)} />;
    }
    return <AuthScreen />;
  }
  // 3. Connecté mais pas encore entré → choix avatar/pseudo
  if (!joined) {
    return <JoinScreen />;
  }
  // 4. En jeu
  return (
    <div className="relative h-full w-full bg-slate-900">
      <Suspense
        fallback={
          <div className="flex h-full w-full items-center justify-center bg-slate-900 text-slate-400">
            Chargement de la carte…
          </div>
        }
      >
        <PhaserGame />
        <HUD />
      </Suspense>
    </div>
  );
}
