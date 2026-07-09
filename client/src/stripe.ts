// Helpers Stripe partagés entre la section « Mon compte » (SubscriptionSection)
// et le déclenchement automatique du checkout depuis une intention de plan
// (usePlanCheckoutRedirect). Centralise l'appel de création de session Checkout,
// la base d'API et la lecture du plan courant du user pour éviter de dupliquer.

import { pb } from './pocketbase';
import type { PlanIntent } from './planIntent';

// Plans payants (le plan `free` n'est pas vendable) — alias du type d'intention.
export type PaidPlan = PlanIntent;

// Base de l'API (même logique que SocketManager) : same-origin en prod,
// localhost:3001 en dev, surchargeable via VITE_SERVER_URL.
export const API_BASE =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  (import.meta.env.PROD ? '' : 'http://localhost:3001');

// Compte hôte : toujours Entreprise (comme côté serveur). Surchargeable via env.
const HOST_EMAIL = (
  (import.meta.env.VITE_HOST_EMAIL as string | undefined) ?? 'agence.webinti@gmail.com'
).toLowerCase();

// Rang des plans (croissant) : sert à savoir si un plan en couvre déjà un autre.
const PLAN_RANK: Record<string, number> = {
  free: 0,
  starter: 1,
  team: 2,
  enterprise: 3,
};

/** Code du plan du user : le champ `plan` PocketBase est PRIORITAIRE ; l'hôte
 *  n'est Entreprise que par défaut, si aucun plan n'est défini (permet de tester). */
export function planCode(user: unknown): string {
  const u = user as { plan?: string; email?: string } | null;
  if (u?.plan) return u.plan; // un plan défini en base gagne
  if (u?.email && u.email.toLowerCase() === HOST_EMAIL) return 'enterprise'; // défaut hôte
  return 'free';
}

/** true si le plan `current` couvre déjà `target` (égal ou supérieur) : dans ce
 *  cas inutile de rouvrir un checkout pour vendre le même palier (ou moins). */
export function planCovers(current: string, target: PaidPlan): boolean {
  return (PLAN_RANK[current] ?? 0) >= (PLAN_RANK[target] ?? 0);
}

/**
 * Crée une session Stripe Checkout pour le plan et renvoie l'URL de redirection.
 * Lève en cas d'échec (HTTP non-OK ou réponse sans url) : l'appelant décide de
 * l'affichage d'erreur.
 */
export async function createCheckoutSession(plan: PaidPlan): Promise<string> {
  const res = await fetch(`${API_BASE}/api/stripe/create-checkout-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(pb.authStore.token ? { Authorization: `Bearer ${pb.authStore.token}` } : {}),
    },
    body: JSON.stringify({ plan, token: pb.authStore.token }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error('no url');
  return data.url;
}
