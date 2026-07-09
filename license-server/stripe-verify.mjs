// Vérification de signature des webhooks Stripe — SANS le SDK Stripe.
//
// Stripe signe chaque webhook avec un HMAC-SHA256 sur `${timestamp}.${corps brut}`,
// posé dans l'en-tête `stripe-signature: t=...,v1=...`. On reproduit ce calcul
// avec node:crypto pour garder le serveur de licence sans dépendance npm.
// Réf : https://stripe.com/docs/webhooks/signatures
import { createHmac, timingSafeEqual } from 'node:crypto';

// Renvoie l'event JSON parsé si la signature est valide ; throw sinon.
// NB : `rawBody` DOIT être le corps brut (Buffer), pas un JSON re-sérialisé.
export function verifyStripeEvent(
  rawBody,
  sigHeader,
  secret,
  { toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000) } = {},
) {
  if (!secret) throw new Error('webhook secret manquant');
  if (typeof sigHeader !== 'string') throw new Error('en-tête stripe-signature manquant');

  // L'en-tête peut porter plusieurs v1 (rotation de secret) : on les collecte tous.
  let t = null;
  const v1s = [];
  for (const item of sigHeader.split(',')) {
    const [k, v] = item.trim().split('=');
    if (k === 't') t = Number(v);
    else if (k === 'v1') v1s.push(v);
  }
  if (!t || v1s.length === 0) throw new Error('signature malformée');
  if (Math.abs(nowSec - t) > toleranceSec) throw new Error('timestamp hors tolérance (rejeu ?)');

  const expected = createHmac('sha256', secret)
    .update(`${t}.${rawBody.toString('utf8')}`)
    .digest('hex');
  const expectedBuf = Buffer.from(expected);

  const ok = v1s.some((v1) => {
    const got = Buffer.from(v1);
    return got.length === expectedBuf.length && timingSafeEqual(got, expectedBuf);
  });
  if (!ok) throw new Error('signature invalide');

  return JSON.parse(rawBody.toString('utf8'));
}

// Petit utilitaire symétrique pour SIGNER un corps (utilisé par les tests /
// scripts de démo pour simuler un webhook Stripe sans le vrai Stripe).
export function signStripePayload(rawBody, secret, nowSec = Math.floor(Date.now() / 1000)) {
  const sig = createHmac('sha256', secret).update(`${nowSec}.${rawBody}`).digest('hex');
  return `t=${nowSec},v1=${sig}`;
}
