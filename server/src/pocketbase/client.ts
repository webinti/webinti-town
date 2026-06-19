import PocketBase from 'pocketbase';
import { config } from '../config.js';

/**
 * Singleton PocketBase client (admin-authenticated).
 *
 * Re-authentifie automatiquement à l'expiration du token JWT (admin tokens
 * durent ~14 jours par défaut, mais on refresh préventivement toutes les 12h).
 */

let client: PocketBase | null = null;
let authPromise: Promise<void> | null = null;
let lastAuthAt = 0;
const AUTH_REFRESH_MS = 12 * 60 * 60 * 1000; // 12h

async function authenticate(pb: PocketBase): Promise<void> {
  if (!config.pocketbaseAdminEmail || !config.pocketbaseAdminPassword) {
    throw new Error('[pocketbase] POCKETBASE_ADMIN_EMAIL/PASSWORD env vars are required');
  }
  await pb.admins.authWithPassword(
    config.pocketbaseAdminEmail,
    config.pocketbaseAdminPassword,
  );
  lastAuthAt = Date.now();
}

/**
 * (Ré)authentifie si nécessaire en MUTUALISANT l'appel en cours. Sans ça, les
 * stores (kanban/DM/postes) qui appellent getPocketBase() en parallèle au
 * démarrage lançaient plusieurs authWithPassword concurrents → auto-annulation
 * du SDK → AbortError → 403 ensuite.
 */
function ensureAuth(pb: PocketBase): Promise<void> {
  if (lastAuthAt !== 0 && Date.now() - lastAuthAt <= AUTH_REFRESH_MS) {
    return Promise.resolve();
  }
  if (!authPromise) {
    authPromise = authenticate(pb).finally(() => {
      authPromise = null;
    });
  }
  return authPromise;
}

/**
 * Returns an authenticated PocketBase client.
 * Lazily auth on first call; refreshes after AUTH_REFRESH_MS.
 */
export async function getPocketBase(): Promise<PocketBase> {
  if (!client) {
    client = new PocketBase(config.pocketbaseUrl);
    // Évite l'AbortError sur des requêtes concurrentes (auth au démarrage).
    client.autoCancellation(false);
  }
  await ensureAuth(client);
  return client;
}

/**
 * Vérifie CÔTÉ SERVEUR un token d'auth utilisateur PocketBase envoyé par le
 * client, et retourne l'email vérifié (minuscule) si le token est valide, sinon
 * null. C'est le SEUL moyen de prouver l'identité : on ne fait jamais confiance
 * à un email envoyé en clair par le client (sinon n'importe qui se déclare hôte).
 *
 * On crée un client PB jetable porteur du token, on rejette d'abord localement
 * un JWT expiré/malformé (rapide), puis `authRefresh()` re-valide la signature
 * et l'existence du compte côté PocketBase. Un timeout évite de bloquer le join
 * si PocketBase est lent/injoignable (→ null = pas d'hôte, fail-safe).
 */
/** Plans d'abonnement reconnus (toute autre valeur retombe sur 'free'). */
const KNOWN_PLANS: ReadonlySet<string> = new Set(['free', 'starter', 'team', 'enterprise']);

/**
 * Cœur partagé de la vérification : crée un client PB jetable porteur du token,
 * rejette d'abord localement un JWT expiré/malformé, puis `authRefresh()`
 * re-valide la signature + l'existence du compte côté PocketBase. Retourne le
 * modèle user rafraîchi (champs custom inclus, dont `plan`) ou null. Ne throw
 * jamais. À envelopper dans un Promise.race(timeout) par les appelants.
 */
async function refreshUserModel(
  token: string,
): Promise<{ email?: string; plan?: unknown } | null> {
  try {
    const pb = new PocketBase(config.pocketbaseUrl);
    pb.autoCancellation(false);
    pb.authStore.save(token, null);
    if (!pb.authStore.isValid) return null; // JWT expiré/malformé (contrôle local)
    await pb.collection('users').authRefresh();
    return (pb.authStore.model as { email?: string; plan?: unknown } | null) ?? null;
  } catch {
    return null;
  }
}

/** Garde-fou anti-hang : résout sur `fallback` si le travail dépasse `ms`. */
function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const VERIFY_TIMEOUT_MS = 4000;

export async function verifyUserToken(token: string | undefined): Promise<string | null> {
  if (!token || typeof token !== 'string') return null;
  const doVerify = async (): Promise<string | null> => {
    const model = await refreshUserModel(token);
    const email = model?.email;
    return typeof email === 'string' ? email.toLowerCase() : null;
  };
  return withTimeout(doVerify(), VERIFY_TIMEOUT_MS, null);
}

/**
 * Comme `verifyUserToken`, mais retourne aussi le plan d'abonnement du compte.
 * Sert au plafonnement de capacité des rooms : le 1er compte authentifié qui
 * crée une room en devient propriétaire et fixe la capacité selon son plan.
 *
 * - `plan` = `model.plan` s'il s'agit d'un plan connu, sinon 'free'.
 * - Le compte hôte (`config.hostEmail`) est 'enterprise' par défaut, sauf si un plan est défini en base.
 * - Retourne null si token absent/invalide/timeout (jamais throw, jamais hang) →
 *   le join continue en mode anonyme/free.
 */
export async function getAccountFromToken(
  token: string | undefined,
): Promise<{ email: string; plan: string } | null> {
  if (!token || typeof token !== 'string') return null;
  const doVerify = async (): Promise<{ email: string; plan: string } | null> => {
    const model = await refreshUserModel(token);
    const rawEmail = model?.email;
    if (typeof rawEmail !== 'string') return null;
    const email = rawEmail.toLowerCase();
    // Le champ `plan` de PocketBase est PRIORITAIRE ; l'hôte n'est Entreprise
    // que par défaut, si aucun plan valide n'est défini.
    let plan =
      typeof model?.plan === 'string' && KNOWN_PLANS.has(model.plan) ? model.plan : '';
    if (!plan && email === config.hostEmail) plan = 'enterprise';
    if (!plan) plan = 'free';
    return { email, plan };
  };
  return withTimeout(doVerify(), VERIFY_TIMEOUT_MS, null);
}

/** Returns true if any store is configured to use PocketBase. */
export function anyStoreUsesPocketBase(): boolean {
  return (
    config.kanbanBackend === 'pocketbase' ||
    config.dmBackend === 'pocketbase' ||
    config.workstationBackend === 'pocketbase'
  );
}
