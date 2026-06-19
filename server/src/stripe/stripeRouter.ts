import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { getAccountFromToken } from '../pocketbase/client.js';
import { createCheckoutSession, handleWebhookEvent, isPlanId } from './stripe.js';

/**
 * Routes Stripe, montées sous `/api/stripe`.
 *
 * IMPORTANT — corps brut du webhook : ce router NE doit PAS être traversé par
 * `express.json()`. Le montage dans index.ts applique `express.raw()` à la route
 * webhook AVANT le json parser global ; les autres handlers ici lisent un JSON
 * déjà parsé (create-checkout-session est traversé par le json global).
 */

export const stripeRouter: Router = Router();

/** Extrait le token PocketBase depuis le header Authorization Bearer ou le body. */
function extractToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  const body = req.body as { token?: unknown } | undefined;
  if (typeof body?.token === 'string') return body.token;
  return undefined;
}

// POST /api/stripe/create-checkout-session
// Crée une session Checkout pour le plan demandé et renvoie son URL.
stripeRouter.post('/create-checkout-session', async (req: Request, res: Response) => {
  if (!config.stripeEnabled) {
    return res.status(503).json({ error: 'Stripe non configuré' });
  }

  const token = extractToken(req);
  const account = await getAccountFromToken(token);
  if (!account) {
    return res.status(401).json({ error: 'authentification requise' });
  }

  const body = req.body as { plan?: unknown } | undefined;
  const plan = body?.plan;
  if (!isPlanId(plan)) {
    return res.status(400).json({ error: 'plan invalide (demarrage | equipe | entreprise)' });
  }

  try {
    const url = await createCheckoutSession(account.email, plan);
    return res.json({ url });
  } catch (err) {
    console.error('[stripe] create-checkout-session a échoué:', err);
    return res.status(500).json({ error: 'création de la session de paiement impossible' });
  }
});

// POST /api/stripe/webhook
// Reçoit les events Stripe. Monté avec express.raw() dans index.ts → req.body
// est un Buffer (corps brut, indispensable à la vérif de signature).
stripeRouter.post('/webhook', async (req: Request, res: Response) => {
  if (!config.stripeEnabled) {
    return res.status(503).json({ error: 'Stripe non configuré' });
  }

  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string') {
    return res.status(400).json({ error: 'signature Stripe manquante' });
  }

  try {
    // req.body est un Buffer brut (express.raw). NE PAS le re-sérialiser.
    await handleWebhookEvent(req.body as Buffer, signature);
    return res.json({ received: true });
  } catch (err) {
    // Signature invalide ou corps illisible → 400 (Stripe retentera).
    console.error('[stripe] webhook rejeté:', err);
    return res.status(400).json({ error: 'webhook invalide' });
  }
});
