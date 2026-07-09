// Preuve de l'automatisation Stripe → licence, SANS le vrai Stripe.
// On forge des events Stripe, on les signe avec le secret du webhook (même
// HMAC que Stripe), on les POST au serveur de licence, et on vérifie l'effet.
//
//   node scripts/license-stripe-demo.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signStripePayload } from '../license-server/stripe-verify.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const PORT = 8792;
const ADMIN = 'demo-admin';
const WHSEC = 'whsec_test_secret_123';
const SCRATCH = process.env.SCRATCH_DIR ?? '/tmp';
const STORE = path.join(SCRATCH, 'licenses.stripe-demo.json');
const BASE = `http://localhost:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const line = () => console.log('─'.repeat(64));
let failures = 0;
const check = (label, cond) => {
  console.log(`   ${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures++;
};

async function postWebhook(event, secret = WHSEC) {
  const raw = JSON.stringify(event);
  const res = await fetch(BASE + '/v1/stripe/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signStripePayload(raw, secret) },
    body: raw,
  });
  return res.status;
}
async function listLicenses() {
  const res = await fetch(BASE + '/admin/licenses', { headers: { authorization: `Bearer ${ADMIN}` } });
  return (await res.json()).licenses;
}

async function main() {
  // repartir d'un store vide
  const { writeFileSync } = await import('node:fs');
  writeFileSync(STORE, '{}');

  const srv = spawn('node', [path.join(root, 'license-server', 'server.mjs')], {
    env: { ...process.env, LICENSE_PORT: String(PORT), LICENSE_ADMIN_TOKEN: ADMIN,
           LICENSE_STORE_PATH: STORE, LICENSE_STRIPE_WEBHOOK_SECRET: WHSEC },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(BASE + '/health')).ok) break; } catch { /* pas prêt */ }
      await sleep(100);
    }

    line();
    console.log('① checkout.session.completed (self-host) → licence créée + active');
    await postWebhook({
      type: 'checkout.session.completed',
      data: { object: {
        mode: 'subscription', customer: 'cus_1', subscription: 'sub_ACME',
        customer_email: 'admin@acme.com',
        metadata: { selfhost: 'true', licenseKey: 'LIC-ACME-0001', maxUsers: '100' },
      } },
    });
    let lics = await listLicenses();
    check('LIC-ACME-0001 existe', !!lics['LIC-ACME-0001']);
    check('statut = active', lics['LIC-ACME-0001']?.status === 'active');
    check('lié à sub_ACME', lics['LIC-ACME-0001']?.stripeSubId === 'sub_ACME');

    line();
    console.log('② customer.subscription.updated status=past_due → licence coupée');
    await postWebhook({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_ACME', status: 'past_due', metadata: { selfhost: 'true' } } },
    });
    lics = await listLicenses();
    check('statut = canceled', lics['LIC-ACME-0001']?.status === 'canceled');

    line();
    console.log('③ customer.subscription.updated status=active → licence réactivée');
    await postWebhook({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_ACME', status: 'active', metadata: { selfhost: 'true' } } },
    });
    lics = await listLicenses();
    check('statut = active', lics['LIC-ACME-0001']?.status === 'active');

    line();
    console.log('④ Abonnement SaaS classique (sans selfhost) → IGNORÉ');
    await postWebhook({
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', customer: 'cus_2', subscription: 'sub_SAAS',
                        metadata: { plan: 'team' } } },
    });
    lics = await listLicenses();
    check('aucune licence créée pour sub_SAAS', !Object.values(lics).some((l) => l.stripeSubId === 'sub_SAAS'));

    line();
    console.log('⑤ checkout sans licenseKey → clé auto-générée (LIC-…)');
    await postWebhook({
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', customer: 'cus_3', subscription: 'sub_BETA',
                        customer_email: 'it@beta.com', metadata: { selfhost: 'true' } } },
    });
    lics = await listLicenses();
    const autoKey = Object.keys(lics).find((k) => lics[k].stripeSubId === 'sub_BETA');
    check('clé auto-générée présente', !!autoKey && autoKey.startsWith('LIC-'));

    line();
    console.log('⑥ Sécurité — mauvaise signature → 400 (rejeté)');
    const badStatus = await postWebhook(
      { type: 'checkout.session.completed', data: { object: { mode: 'subscription', metadata: { selfhost: 'true' } } } },
      'whsec_MAUVAIS_SECRET',
    );
    check('HTTP 400 sur signature invalide', badStatus === 400);

    line();
    console.log(failures === 0
      ? '✅ Automatisation Stripe → licence : tout est vert.'
      : `❌ ${failures} vérification(s) en échec.`);
  } finally {
    srv.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
