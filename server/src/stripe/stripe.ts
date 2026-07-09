import Stripe from 'stripe';
import { config } from '../config.js';
import { getPocketBase } from '../pocketbase/client.js';

/**
 * Intégration Stripe (abonnements mensuels).
 *
 * Le client Stripe est instancié PARESSEUSEMENT et uniquement si Stripe est
 * configuré (`config.stripeEnabled`). Tant qu'aucune clé secrète n'est fournie,
 * aucun appel n'est tenté : les routes appelantes renvoient 503 en amont, et le
 * serveur démarre normalement (pas de crash en l'absence de clés).
 */

export type PlanId = 'starter' | 'team' | 'enterprise';

export const PLAN_IDS: readonly PlanId[] = ['starter', 'team', 'enterprise'] as const;

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

let stripeClient: Stripe | null = null;

/**
 * Retourne le client Stripe, en l'instanciant à la première utilisation.
 * Throw si Stripe n'est pas configuré (les routes vérifient `stripeEnabled`
 * avant d'appeler, donc en pratique ce throw ne se produit pas en prod).
 */
function getStripe(): Stripe {
  if (!config.stripeEnabled) {
    throw new Error('[stripe] non configuré (STRIPE_SECRET_KEY manquante)');
  }
  if (!stripeClient) {
    stripeClient = new Stripe(config.stripeSecretKey);
  }
  return stripeClient;
}

/**
 * Crée une session Stripe Checkout en mode abonnement et retourne son URL de
 * redirection. `email` identifie le compte PocketBase (sert aussi de clé pour
 * retrouver l'utilisateur dans le webhook).
 */
export async function createCheckoutSession(email: string, plan: PlanId): Promise<string> {
  const price = config.stripePrices[plan];
  if (!price) {
    throw new Error(`[stripe] price ID manquant pour le plan "${plan}" (env STRIPE_PRICE_*)`);
  }

  const stripe = getStripe();
  // Enterprise = droit au self-host : on tague la session ET l'abonnement avec
  // selfhost=true pour que le serveur de licence (licences.webinti.com) crée et
  // gère automatiquement la licence via le webhook.
  const metadata = { email, plan, ...(plan === 'enterprise' ? { selfhost: 'true' } : {}) };
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    customer_email: email,
    client_reference_id: email,
    metadata,
    subscription_data: { metadata },
    success_url: `${config.appBaseUrl}?checkout=success`,
    cancel_url: `${config.appBaseUrl}?checkout=cancel`,
  });

  if (!session.url) {
    throw new Error('[stripe] session Checkout créée sans URL de redirection');
  }
  return session.url;
}

/**
 * Crée une session du Portail client Stripe pour gérer/annuler un abonnement et
 * retourne son URL. On retrouve le customer Stripe par son email (renseigné à la
 * création de la session Checkout), donc inutile de stocker son ID.
 *
 * Retourne `null` si aucun customer Stripe n'existe pour cet email (ex. plan
 * `free` jamais passé par Checkout).
 *
 * Prérequis Stripe : le Portail client doit être activé une fois dans le
 * dashboard (Settings → Billing → Customer portal).
 */
export async function createPortalSession(email: string): Promise<string | null> {
  const stripe = getStripe();
  const customers = await stripe.customers.list({ email, limit: 1 });
  if (customers.data.length === 0) return null;
  const session = await stripe.billingPortal.sessions.create({
    customer: customers.data[0]!.id,
    return_url: config.appBaseUrl,
  });
  return session.url;
}

/**
 * Met à jour le champ `plan` d'un utilisateur PocketBase. Ne throw jamais :
 * logge clairement le succès ou l'échec (le webhook doit répondre 200 même si
 * la maj PB échoue, sinon Stripe retente en boucle).
 */
async function setUserPlan(email: string, plan: string): Promise<void> {
  try {
    const pb = await getPocketBase();
    const record = await pb.collection('users').getFirstListItem(`email="${email}"`);
    await pb.collection('users').update(record.id, { plan });
    console.log(`[stripe] plan mis à jour: ${email} → ${plan}`);
  } catch (err) {
    console.error(`[stripe] échec maj plan pour ${email} → ${plan}:`, err);
  }
}

/**
 * Vérifie la signature de l'event Stripe PUIS le traite.
 *
 * SÉCURITÉ : on ne traite JAMAIS un event non vérifié. `constructEvent` lève si
 * la signature est invalide ; on laisse l'erreur se propager (la route renvoie
 * alors 400). Cela exige le corps BRUT (Buffer) — voir le montage de la route
 * avec `express.raw` dans index.ts.
 */
export async function handleWebhookEvent(rawBody: Buffer, signature: string): Promise<void> {
  const stripe = getStripe();

  // Throw si la signature est invalide → la route renverra 400. Sécurité.
  const event = stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const email =
        session.metadata?.email ??
        session.client_reference_id ??
        session.customer_email ??
        undefined;
      const plan = session.metadata?.plan;
      if (!email || !plan) {
        console.error('[stripe] checkout.session.completed sans email/plan exploitable', {
          email,
          plan,
        });
        return;
      }
      await setUserPlan(email.toLowerCase(), plan);
      return;
    }

    case 'customer.subscription.deleted': {
      // Repasse l'utilisateur en 'free'. On retrouve l'email via le customer
      // Stripe (email renseigné à la création de la session).
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer?.id;
      if (!customerId) {
        console.warn('[stripe] subscription.deleted sans customer → skip (MVP)');
        return;
      }
      try {
        const customer = await stripe.customers.retrieve(customerId);
        // Un customer supprimé renvoie { deleted: true } sans email.
        const email =
          'deleted' in customer && customer.deleted ? undefined : customer.email ?? undefined;
        if (!email) {
          console.warn(
            `[stripe] subscription.deleted: pas d'email pour customer ${customerId} → skip (MVP)`,
          );
          return;
        }
        await setUserPlan(email.toLowerCase(), 'free');
      } catch (err) {
        console.error('[stripe] échec traitement subscription.deleted:', err);
      }
      return;
    }

    default:
      // Tous les autres types d'events sont ignorés proprement.
      return;
  }
}
