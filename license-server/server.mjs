// Serveur de licence Webinti — tourne sur TON infra, à côté de Stripe.
// Il ne quitte jamais chez toi. Il fait deux choses :
//
//   1. /v1/activate  — appelé ~1×/jour par chaque instance self-host avec sa
//      clé de licence. Si l'abonnement est actif, renvoie un JETON SIGNÉ de
//      courte durée (7 j par défaut). Sinon, refuse (403).
//
//   2. /admin/*      — tu crées / annules / réactives une licence (à câbler
//      sur les webhooks Stripe ; en attendant, appelable à la main).
//
// Source de vérité = le statut d'abonnement dans `licenses.json` (que le
// webhook Stripe met à jour). Aucune donnée client ne transite ici.

import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createPrivateKey, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueToken } from './sign.mjs';
import { verifyStripeEvent } from './stripe-verify.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.LICENSE_PORT ?? 8790);
const TOKEN_TTL_MS = Number(process.env.LICENSE_TOKEN_TTL_MS ?? 7 * 24 * 60 * 60 * 1000);
const ADMIN_TOKEN = process.env.LICENSE_ADMIN_TOKEN ?? 'dev-admin';
const KEY_PATH = process.env.LICENSE_PRIVATE_KEY_PATH ?? path.join(__dirname, 'keys', 'private-key.pem');
const STORE_PATH = process.env.LICENSE_STORE_PATH ?? path.join(__dirname, 'licenses.json');
// Secret du webhook Stripe DÉDIÉ au serveur de licence (distinct de celui de
// l'app SaaS). Vide ⇒ endpoint webhook désactivé (503).
const STRIPE_WEBHOOK_SECRET = process.env.LICENSE_STRIPE_WEBHOOK_SECRET ?? '';

const privateKey = createPrivateKey(readFileSync(KEY_PATH));

// { [licenseKey]: { customer, plan, maxUsers, status:'active'|'canceled', stripeSubId } }
let store = loadStore();

function loadStore() {
  if (!existsSync(STORE_PATH)) return {};
  try { return JSON.parse(readFileSync(STORE_PATH, 'utf8')); } catch { return {}; }
}
function saveStore() {
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}
async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

// ── Mapping Stripe → statut de licence ───────────────────────────────────────
function mapStripeStatus(s) {
  // Actif tant que l'abonnement est payé (ou en essai) ; sinon on coupe.
  return s === 'active' || s === 'trialing' ? 'active' : 'canceled';
}
function genLicenseKey() {
  return `LIC-${randomBytes(4).toString('hex').toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
}
function findKeyBySubId(subId) {
  if (!subId) return null;
  for (const [key, lic] of Object.entries(store)) if (lic.stripeSubId === subId) return key;
  return null;
}
// Ne gère une licence QUE pour les abonnements self-host, marqués par
// `metadata.selfhost = 'true'` (à poser sur la Checkout Session ET sur
// subscription_data). Les abonnements SaaS classiques sont ignorés ici.
function isSelfHost(obj) {
  const md = obj?.metadata ?? {};
  return md.selfhost === 'true' || md.selfhost === true;
}

// Traite un event Stripe DÉJÀ vérifié. Ne throw jamais (le webhook doit
// répondre 200, sinon Stripe retente en boucle).
function handleStripeEvent(event) {
  const obj = event?.data?.object ?? {};
  switch (event?.type) {
    case 'checkout.session.completed': {
      if (obj.mode !== 'subscription' || !isSelfHost(obj)) return;
      const key = obj.metadata?.licenseKey || genLicenseKey();
      store[key] = {
        customer: obj.customer_email ?? obj.customer_details?.email ?? '',
        plan: 'enterprise',
        maxUsers: Number(obj.metadata?.maxUsers ?? 100),
        status: 'active',
        stripeSubId: typeof obj.subscription === 'string' ? obj.subscription : '',
        stripeCustomerId: typeof obj.customer === 'string' ? obj.customer : '',
      };
      saveStore();
      console.log(`[license] ACTIVÉE via Stripe : ${key} (${store[key].customer})`);
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      if (!isSelfHost(obj)) return;
      const key = findKeyBySubId(obj.id) ?? obj.metadata?.licenseKey;
      if (!key) return; // pas encore de licence : checkout.session.completed la créera
      store[key] = {
        ...(store[key] ?? { customer: '', plan: 'enterprise', maxUsers: 100, stripeCustomerId: '' }),
        maxUsers: Number(store[key]?.maxUsers ?? obj.metadata?.maxUsers ?? 100),
        stripeSubId: obj.id,
        status: mapStripeStatus(obj.status),
      };
      saveStore();
      console.log(`[license] ${key} → ${store[key].status} (sub ${obj.id})`);
      return;
    }
    case 'customer.subscription.deleted': {
      const key = findKeyBySubId(obj.id);
      if (!key) return;
      store[key].status = 'canceled';
      saveStore();
      console.log(`[license] ${key} → canceled (abonnement supprimé)`);
      return;
    }
    default:
      return; // autres events ignorés proprement
  }
}
function requireAdmin(req, res) {
  if ((req.headers['authorization'] ?? '') !== `Bearer ${ADMIN_TOKEN}`) {
    json(res, 401, { error: 'unauthorized' });
    return false;
  }
  return true;
}

// État d'un service systemd via `systemctl is-active` (lecture seule, sans sudo).
// Renvoie 'active' | 'inactive' | 'failed' | 'activating' | 'unknown'.
const MONITORED_SERVICES = ['webinti-license', 'webinti-server', 'livekit-server', 'pocketbase'];
function serviceState(name) {
  return new Promise((resolve) => {
    execFile('systemctl', ['is-active', name], { timeout: 3000 }, (_err, stdout) => {
      resolve((stdout || '').trim() || 'unknown');
    });
  });
}

const ADMIN_HTML_PATH = path.join(__dirname, 'admin.html');

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  // ─── Interface d'admin (page HTML, sans token : tout est gated côté API) ──
  if (req.method === 'GET' && (pathname === '/admin' || pathname === '/admin/')) {
    try {
      const html = readFileSync(ADMIN_HTML_PATH, 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch {
      return json(res, 500, { error: 'admin_ui_indisponible' });
    }
  }

  // ─── Admin : état des services + compteur de licences ────────────────────
  if (req.method === 'GET' && pathname === '/admin/status') {
    if (!requireAdmin(req, res)) return;
    const states = await Promise.all(MONITORED_SERVICES.map(serviceState));
    return json(res, 200, {
      services: MONITORED_SERVICES.map((name, i) => ({ name, state: states[i] })),
      licenseCount: Object.keys(store).length,
      now: Date.now(),
    });
  }

  // ─── Instance self-host : demande un jeton ───────────────────────────────
  if (req.method === 'POST' && pathname === '/v1/activate') {
    const { licenseKey } = await readBody(req);
    const lic = store[licenseKey];
    if (!lic) return json(res, 404, { error: 'unknown_license' });
    if (lic.status !== 'active') return json(res, 403, { error: 'inactive', status: lic.status });
    const token = issueToken(privateKey, {
      licenseKey, plan: lic.plan, maxUsers: lic.maxUsers,
      ttlMs: TOKEN_TTL_MS, nowMs: Date.now(),
    });
    return json(res, 200, { token, ttlMs: TOKEN_TTL_MS });
  }

  // ─── Admin : créer / mettre à jour une licence (merge : ne perd rien) ─────
  if (req.method === 'POST' && pathname === '/admin/license') {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    if (!body.licenseKey) return json(res, 400, { error: 'missing_licenseKey' });
    const prev = store[body.licenseKey] ?? {};
    store[body.licenseKey] = {
      customer: body.customer ?? prev.customer ?? '',
      plan: body.plan ?? prev.plan ?? 'enterprise',
      maxUsers: body.maxUsers ?? prev.maxUsers ?? 100,
      status: body.status ?? prev.status ?? 'active',
      stripeSubId: body.stripeSubId ?? prev.stripeSubId ?? '',
    };
    saveStore();
    return json(res, 200, { ok: true, license: store[body.licenseKey] });
  }

  // ─── Admin : annuler / réactiver ─────────────────────────────────────────
  {
    const m = pathname.match(/^\/admin\/license\/([^/]+)\/(cancel|activate)$/);
    if (req.method === 'POST' && m) {
      if (!requireAdmin(req, res)) return;
      const [, key, action] = m;
      if (!store[key]) return json(res, 404, { error: 'unknown_license' });
      store[key].status = action === 'cancel' ? 'canceled' : 'active';
      saveStore();
      return json(res, 200, { ok: true, license: store[key] });
    }
  }

  // ─── Admin : supprimer une licence ───────────────────────────────────────
  {
    const m = pathname.match(/^\/admin\/license\/([^/]+)$/);
    if (req.method === 'DELETE' && m) {
      if (!requireAdmin(req, res)) return;
      const key = m[1];
      if (!store[key]) return json(res, 404, { error: 'unknown_license' });
      delete store[key];
      saveStore();
      return json(res, 200, { ok: true, deleted: key });
    }
  }

  // ─── Admin : lister les licences (retrouver une clé auto-générée) ─────────
  if (req.method === 'GET' && pathname === '/admin/licenses') {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, { licenses: store });
  }

  // ─── Webhook Stripe : crée/active/annule les licences automatiquement ─────
  if (req.method === 'POST' && pathname === '/v1/stripe/webhook') {
    if (!STRIPE_WEBHOOK_SECRET) return json(res, 503, { error: 'webhook_stripe_non_configuré' });
    let event;
    try {
      const raw = await readRaw(req);
      event = verifyStripeEvent(raw, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.warn('[license] webhook Stripe rejeté :', err.message);
      return json(res, 400, { error: 'signature_invalide' });
    }
    handleStripeEvent(event);
    return json(res, 200, { received: true });
  }

  if (pathname === '/health') return json(res, 200, { ok: true });
  return json(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => console.log(`license-server écoute sur :${PORT}`));
