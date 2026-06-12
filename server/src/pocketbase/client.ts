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
export async function verifyUserToken(token: string | undefined): Promise<string | null> {
  if (!token || typeof token !== 'string') return null;
  const doVerify = async (): Promise<string | null> => {
    try {
      const pb = new PocketBase(config.pocketbaseUrl);
      pb.autoCancellation(false);
      pb.authStore.save(token, null);
      if (!pb.authStore.isValid) return null; // JWT expiré/malformé (contrôle local)
      await pb.collection('users').authRefresh();
      const email = (pb.authStore.model as { email?: string } | null)?.email;
      return typeof email === 'string' ? email.toLowerCase() : null;
    } catch {
      return null;
    }
  };
  return Promise.race([
    doVerify(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ]);
}

/** Returns true if any store is configured to use PocketBase. */
export function anyStoreUsesPocketBase(): boolean {
  return (
    config.kanbanBackend === 'pocketbase' ||
    config.dmBackend === 'pocketbase' ||
    config.workstationBackend === 'pocketbase'
  );
}
