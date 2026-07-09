// Vérification HORS-LIGNE d'un jeton de licence.
//
// Le serveur self-host n'a besoin que de la clé PUBLIQUE (compilée dans le
// build) pour vérifier qu'un jeton a bien été signé par Webinti. Il n'y a donc
// aucun secret côté client, et un jeton ne peut pas être fabriqué ni modifié
// sans la clé privée qui, elle, reste sur l'infra Webinti.
import { verify as edVerify, createPublicKey } from 'node:crypto';
import { LICENSE_PUBLIC_KEY } from './publicKey.js';

const publicKey = createPublicKey(LICENSE_PUBLIC_KEY);

export interface LicensePayload {
  v: number;
  lk: string;       // clé de licence
  plan: string;     // ex. 'enterprise'
  maxUsers: number; // plafond d'utilisateurs simultanés
  iat: number;      // émis à (secondes epoch)
  exp: number;      // expire à (secondes epoch)
}

// Renvoie le payload si la signature est valide, sinon null.
// NB : ne juge PAS de l'expiration (c'est le rôle de la machine à états, qui
// applique une période de grâce). Ici on ne valide que l'authenticité.
export function verifyToken(token: string): LicensePayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  let signature: Buffer;
  try {
    signature = Buffer.from(sigB64, 'base64url');
  } catch {
    return null;
  }

  const authentic = edVerify(null, Buffer.from(payloadB64), publicKey, signature);
  if (!authentic) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (typeof payload?.exp !== 'number' || typeof payload?.lk !== 'string') return null;
    return payload as LicensePayload;
  } catch {
    return null;
  }
}
