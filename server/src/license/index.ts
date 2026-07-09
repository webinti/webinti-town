// Module de licence du serveur self-host Webinti.
//
// Rôle : garder l'instance « allumée » tant que l'abonnement Enterprise est
// payé, et la dégrader progressivement (jamais destructivement) s'il ne l'est
// plus. Le point d'application est le SERVEUR (pas le navigateur) : on refuse
// les connexions socket au-delà de la capacité effective.
//
// Cycle de vie :
//   • au démarrage puis 1×/jour, refreshLicense() appelle le serveur de licence
//     Webinti et met en cache (disque) le dernier jeton signé valide ;
//   • getLicenseStatus() lit le cache, vérifie la signature hors-ligne et
//     calcule l'état à partir de l'expiration + périodes de grâce.
//
// Résultat : une coupure réseau (ou une panne du serveur de licence) ne coupe
// JAMAIS un client qui paie — le dernier jeton reste valable jusqu'à 7 jours.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { verifyToken } from './verify.js';

export type LicenseState =
  | 'active'      // jeton valide → pleine capacité
  | 'grace'       // jeton expiré depuis peu → marche encore + bandeau d'alerte
  | 'restricted'  // grâce dépassée → capacité plafonnée (quasi lecture seule)
  | 'expired'     // verrou → page maintenance (données intactes)
  | 'unlicensed'; // aucune clé configurée

export interface LicenseStatus {
  state: LicenseState;
  plan: string | null;
  maxUsers: number | null;
  expiresAt: number | null; // ms epoch
}

// ── Réglages (surchargeables par env) ──
// Après expiration du jeton : d'abord une fenêtre « grâce » (tout marche, on
// prévient), puis « restricted » (dégradé), puis « expired » (verrou).
const GRACE_WARN_MS = Number(process.env.LICENSE_GRACE_WARN_MS ?? 3 * 24 * 60 * 60 * 1000);
const GRACE_LOCK_MS = Number(process.env.LICENSE_GRACE_LOCK_MS ?? 7 * 24 * 60 * 60 * 1000);
const RESTRICTED_CAPACITY = Number(process.env.LICENSE_RESTRICTED_CAPACITY ?? 2);

const LICENSE_KEY = process.env.LICENSE_KEY ?? '';
const LICENSE_SERVER_URL = process.env.LICENSE_SERVER_URL ?? 'https://licenses.webinti.com';
const CACHE_PATH = process.env.LICENSE_CACHE_PATH
  ?? path.resolve(process.cwd(), 'data', 'license.json');

let cachedToken: string | null = loadCachedToken();

function loadCachedToken(): string | null {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    const { token } = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    return typeof token === 'string' ? token : null;
  } catch {
    return null;
  }
}

function saveCachedToken(token: string): void {
  try {
    mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify({ token, savedAt: Date.now() }, null, 2));
  } catch {
    /* cache best-effort : si l'écriture échoue on garde le jeton en mémoire */
  }
}

// Appelle le serveur de licence Webinti et met à jour le cache si un jeton
// valide est renvoyé. Renvoie true si le jeton a été rafraîchi.
// Un échec (réseau, 403 abonnement annulé…) NE vide PAS le cache : on continue
// sur le dernier jeton connu jusqu'à sa propre expiration.
export async function refreshLicense(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!LICENSE_KEY) return false;
  try {
    const res = await fetchImpl(`${LICENSE_SERVER_URL}/v1/activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ licenseKey: LICENSE_KEY }),
    });
    if (!res.ok) return false;
    const { token } = await res.json();
    if (typeof token !== 'string' || !verifyToken(token)) return false;
    cachedToken = token;
    saveCachedToken(token);
    return true;
  } catch {
    return false;
  }
}

// État courant de la licence. `nowMs` injectable pour les tests.
export function getLicenseStatus(nowMs: number = Date.now()): LicenseStatus {
  if (!LICENSE_KEY && !cachedToken) {
    return { state: 'unlicensed', plan: null, maxUsers: null, expiresAt: null };
  }
  const payload = cachedToken ? verifyToken(cachedToken) : null;
  if (!payload) {
    // pas de jeton, ou jeton falsifié → verrou
    return { state: 'expired', plan: null, maxUsers: null, expiresAt: null };
  }

  const expMs = payload.exp * 1000;
  const delta = nowMs - expMs; // >0 = expiré depuis `delta`

  let state: LicenseState;
  if (delta < 0) state = 'active';
  else if (delta < GRACE_WARN_MS) state = 'grace';
  else if (delta < GRACE_LOCK_MS) state = 'restricted';
  else state = 'expired';

  return { state, plan: payload.plan, maxUsers: payload.maxUsers, expiresAt: expMs };
}

// Capacité effective à appliquer dans la couche socket/room selon l'état.
// C'est LE point d'enforcement : brancher ceci sur le plafond de présents.
export function effectiveCapacity(
  baseCapacity: number,
  status: LicenseStatus = getLicenseStatus(),
): number {
  switch (status.state) {
    case 'active':
    case 'grace':
      return status.maxUsers ?? baseCapacity;
    case 'restricted':
      return RESTRICTED_CAPACITY;
    case 'expired':
    case 'unlicensed':
      return 0; // bloque les nouvelles connexions ; l'app peut afficher une page maintenance
  }
}

// À appeler au démarrage du serveur : premier refresh + planification quotidienne.
export function startLicenseHeartbeat(): void {
  void refreshLicense();
  const DAY = 24 * 60 * 60 * 1000;
  setInterval(() => void refreshLicense(), DAY).unref();
}
