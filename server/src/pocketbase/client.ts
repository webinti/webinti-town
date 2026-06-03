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

/** Returns true if any store is configured to use PocketBase. */
export function anyStoreUsesPocketBase(): boolean {
  return (
    config.kanbanBackend === 'pocketbase' ||
    config.dmBackend === 'pocketbase' ||
    config.workstationBackend === 'pocketbase'
  );
}
