// Intention d'abonnement transportée depuis la landing (?plan=starter|team|enterprise).
//
// La landing envoie les prospects vers live.webinti.com/?plan=team : au chargement
// on capte ce paramètre, on le persiste en localStorage (pour survivre à la
// redirection Google OAuth) puis on nettoie l'URL. Dès que l'utilisateur est
// authentifié, l'intention est consommée pour lancer le checkout Stripe.
//
// Ce module reste volontairement SANS import (pas de PocketBase, pas d'env) pour
// être testable tel quel en environnement node (voir planIntent.test.ts).

// Plans payants acceptés en intention (le plan `free` n'est pas vendable).
export type PlanIntent = 'starter' | 'team' | 'enterprise';

const PLAN_INTENT_KEY = 'webinti-town:planIntent';
const VALID_PLANS: readonly string[] = ['starter', 'team', 'enterprise'];

/** Valide une valeur de plan brute : toute valeur inconnue = null. */
export function parsePlanIntent(value: string | null | undefined): PlanIntent | null {
  return value && VALID_PLANS.includes(value) ? (value as PlanIntent) : null;
}

/** Extrait le plan d'une query string (ex. '?plan=starter'). Pur, testable. */
export function parsePlanFromSearch(search: string): PlanIntent | null {
  try {
    return parsePlanIntent(new URLSearchParams(search).get('plan'));
  } catch {
    return null;
  }
}

/**
 * À appeler une fois au démarrage de l'app : lit ?plan= dans l'URL, le persiste
 * en localStorage (survit à la redirection OAuth) et retire le paramètre de l'URL
 * via history.replaceState pour ne pas re-capter au rechargement. No-op si aucun
 * plan valide n'est présent, pour ne rien changer au flux des visiteurs normaux.
 */
export function capturePlanIntentFromUrl(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const plan = parsePlanIntent(params.get('plan'));
    if (!plan) return;
    localStorage.setItem(PLAN_INTENT_KEY, plan);
    // Nettoie l'URL (même logique que le retour ?checkout=) pour ne pas re-capter.
    params.delete('plan');
    const qs = params.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
    window.history.replaceState(null, '', url);
  } catch {
    // localStorage indisponible (navigation privée stricte…) → on ignore.
  }
}

/** Intention de plan en attente (persistée), ou null. */
export function readPlanIntent(): PlanIntent | null {
  try {
    return parsePlanIntent(localStorage.getItem(PLAN_INTENT_KEY));
  } catch {
    return null;
  }
}

/** Efface l'intention : appelé AVANT toute redirection Stripe pour ne jamais boucler. */
export function clearPlanIntent(): void {
  try {
    localStorage.removeItem(PLAN_INTENT_KEY);
  } catch {
    // ignore
  }
}
