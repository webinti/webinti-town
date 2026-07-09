import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { readPlanIntent, clearPlanIntent } from '../planIntent';
import { planCode, planCovers, createCheckoutSession } from '../stripe';

// État visuel du déclenchement automatique de checkout depuis une intention de
// plan (venue de la landing ?plan=…).
//  - idle        : rien à faire (cas normal, aucun paramètre plan) ;
//  - redirecting : session Checkout en cours de création → redirection imminente ;
//  - error       : la création a échoué → message discret + retour à l'app.
export type PlanCheckoutStatus = 'idle' | 'redirecting' | 'error';

export interface PlanCheckoutRedirect {
  status: PlanCheckoutStatus;
  /** Referme l'erreur pour laisser l'utilisateur poursuivre dans l'app. */
  dismiss: () => void;
}

/**
 * Dès que l'utilisateur est authentifié (retour OAuth ou login/signup email), si
 * une intention de plan est en attente, lance le checkout Stripe de ce plan.
 *
 * Règles :
 *  - si le user a déjà ce plan (ou un plan supérieur) → on efface l'intention,
 *    aucun checkout (rien à revendre) ;
 *  - l'intention est effacée AVANT toute redirection (succès comme échec) pour
 *    ne JAMAIS boucler — un retour ?checkout=cancel ne re-déclenche donc rien ;
 *  - en cas d'échec réseau, on bascule en `error` (message discret) sans bloquer.
 *
 * Aucun effet pour les visiteurs sans intention (invités démo compris).
 */
export function usePlanCheckoutRedirect(): PlanCheckoutRedirect {
  const user = useAuthStore((s) => s.user);
  const [status, setStatus] = useState<PlanCheckoutStatus>('idle');
  // Garde-fou anti-relance (StrictMode double les effets, re-renders d'auth…).
  const startedRef = useRef(false);

  useEffect(() => {
    if (!user || startedRef.current) return;
    const plan = readPlanIntent();
    if (!plan) return; // flux normal : pas d'intention → on ne touche à rien
    startedRef.current = true;

    // Le user couvre déjà ce palier : rien à vendre, on oublie l'intention.
    if (planCovers(planCode(user), plan)) {
      clearPlanIntent();
      return;
    }

    // Efface AVANT la redirection : garantit qu'on ne boucle jamais, même si
    // l'utilisateur revient de Stripe avec ?checkout=cancel.
    clearPlanIntent();
    setStatus('redirecting');
    createCheckoutSession(plan)
      .then((url) => {
        // Départ vers Stripe Checkout (quitte l'app).
        window.location.href = url;
      })
      .catch(() => {
        setStatus('error');
      });
  }, [user]);

  return { status, dismiss: () => setStatus('idle') };
}
