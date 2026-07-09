import { lazy, Suspense, useEffect, useState } from 'react';
import { useGameStore } from './stores/gameStore';
import { useAuthStore } from './stores/authStore';
import { AuthScreen } from './react/AuthScreen';
import { JoinScreen } from './react/JoinScreen';
import { LicenseBlockedScreen } from './react/LicenseBlockedScreen';
import { PlanRedirectOverlay } from './react/PlanRedirectOverlay';
import { usePlanCheckoutRedirect } from './react/usePlanCheckoutRedirect';
import { capturePlanIntentFromUrl } from './planIntent';
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
  const licenseBlock = useGameStore((s) => s.licenseBlock);
  // Un invité peut demander l'écran d'auth (bouton « Créer un compte »).
  const [forceAuth, setForceAuth] = useState(false);

  // NB : ce useEffect est déclaré AVANT usePlanCheckoutRedirect pour que la
  // capture de l'intention s'exécute avant que le hook ne lise localStorage
  // (les effets de montage tournent dans l'ordre d'enregistrement) — sinon un
  // user déjà connecté arrivant via ?plan= ne verrait jamais le checkout.
  useEffect(() => {
    // Capte ?plan= AVANT tout : persiste l'intention (survit à l'OAuth) et
    // nettoie l'URL. No-op sans paramètre → flux inchangé pour les autres.
    capturePlanIntentFromUrl();
    void useAuthStore.getState().init();
  }, []);

  // Intention d'abonnement (landing ?plan=…) : après auth → checkout Stripe.
  const planCheckout = usePlanCheckoutRedirect();

  // 0. Blocage de licence (self-host) : prioritaire sur tout le reste.
  if (licenseBlock) {
    return <LicenseBlockedScreen />;
  }
  // 1. Vérification du token en cours
  if (!ready) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-900 text-slate-400">
        Chargement…
      </div>
    );
  }
  // 1bis. Intention de plan en cours (déclenchée dès l'authentification) : on
  //       affiche l'overlay de redirection avant tout autre écran pour ne pas
  //       faire clignoter le choix d'avatar. `status` n'est non-idle que si un
  //       user est authentifié, donc aucun impact sur les visiteurs sans plan.
  if (planCheckout.status === 'redirecting') {
    return <PlanRedirectOverlay />;
  }
  if (planCheckout.status === 'error') {
    return <PlanRedirectOverlay error onDismiss={planCheckout.dismiss} />;
  }
  // 2. Pas encore en jeu ET pas connecté (le `!joined` est crucial : un invité qui
  //    A rejoint n'a pas de `user` → il doit passer au jeu, pas rester bloqué ici) :
  //    - lien explicite ?room=demo (invité autorisé) → entrée directe SANS compte ;
  //    - sinon (site nu, autre room) → écran d'auth (compte obligatoire).
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
