// Signature des jetons de licence (Ed25519) avec la clé privée Webinti.
import { sign as edSign } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// Émet un jeton compact `payloadB64.signatureB64`.
// Le jeton encode l'abonnement (plan, plafond d'utilisateurs) et une DATE
// D'EXPIRATION courte (ttlMs). Le serveur self-host le re-demande chaque jour
// tant que l'abonnement est actif ; dès qu'il ne l'est plus, on cesse d'en
// émettre et le dernier jeton finit par expirer.
export function issueToken(privateKey, { licenseKey, plan, maxUsers, ttlMs, nowMs }) {
  const payload = {
    v: 1,
    lk: licenseKey,
    plan,
    maxUsers,
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor((nowMs + ttlMs) / 1000),
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const signature = edSign(null, Buffer.from(payloadB64), privateKey);
  return `${payloadB64}.${b64url(signature)}`;
}
