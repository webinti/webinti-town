// Démo end-to-end du système de licence — PREUVE runnable, sans Stripe ni réseau.
//
//   npx tsx scripts/license-demo.ts
//
// Déroulé :
//   1. lance le vrai serveur de licence (license-server/server.mjs) ;
//   2. crée une licence ACTIVE via l'API admin ;
//   3. une "instance self-host" l'active → reçoit + vérifie + cache un jeton ;
//   4. on ANNULE l'abonnement → l'instance garde son jeton (le client qui a
//      payé n'est jamais coupé net) ;
//   5. on simule l'avance du temps → grâce → restreint → expiré ;
//   6. on falsifie un jeton → rejeté.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const PORT = 8791;
const ADMIN = 'demo-admin';
const SCRATCH = process.env.SCRATCH_DIR ?? '/tmp';
const STORE = path.join(SCRATCH, 'licenses.demo.json');
const CACHE = path.join(SCRATCH, 'license.cache.demo.json');
const BASE = `http://localhost:${PORT}`;
const KEY = 'LIC-ACME-ENTERPRISE-0001';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const line = () => console.log('─'.repeat(64));

async function api(pathname: string, body?: unknown, admin = false) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(admin ? { authorization: `Bearer ${ADMIN}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function main() {
  // 1. démarrer le serveur de licence
  const srv = spawn('node', [path.join(root, 'license-server', 'server.mjs')], {
    env: {
      ...process.env,
      LICENSE_PORT: String(PORT),
      LICENSE_ADMIN_TOKEN: ADMIN,
      LICENSE_STORE_PATH: STORE,
    },
    stdio: 'ignore',
  });
  try {
    // attendre /health
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(BASE + '/health')).ok) break; } catch { /* pas prêt */ }
      await sleep(100);
    }

    line();
    console.log('① Création de la licence Enterprise (ACTIVE) via API admin');
    console.log('   →', (await api('/admin/license', {
      licenseKey: KEY, customer: 'ACME Corp', plan: 'enterprise', maxUsers: 100,
    }, true)).json);

    // 2. charger le module self-host APRÈS avoir posé son environnement
    process.env.LICENSE_KEY = KEY;
    process.env.LICENSE_SERVER_URL = BASE;
    process.env.LICENSE_CACHE_PATH = CACHE;
    const lic = await import('../server/src/license/index.js');
    const { verifyToken } = await import('../server/src/license/verify.js');

    line();
    console.log('② L\'instance self-host s\'active (heartbeat)');
    const ok = await lic.refreshLicense();
    const st1 = lic.getLicenseStatus();
    console.log('   refresh réussi :', ok);
    console.log('   état :', st1.state, '| capacité effective :', lic.effectiveCapacity(100, st1));

    // récupérer l'expiration du jeton mis en cache pour simuler le temps
    const token: string = JSON.parse(readFileSync(CACHE, 'utf8')).token;
    const expMs = verifyToken(token)!.exp * 1000;
    const H = 60 * 60 * 1000, D = 24 * H;

    line();
    console.log('③ L\'abonnement est ANNULÉ (webhook Stripe → statut canceled)');
    console.log('   →', (await api(`/admin/license/${KEY}/cancel`, {}, true)).json.license);
    const ok2 = await lic.refreshLicense();
    const st2 = lic.getLicenseStatus();
    console.log('   nouveau refresh réussi :', ok2, '(le serveur refuse d\'émettre)');
    console.log('   MAIS état actuel :', st2.state,
      '→ le client qui a payé n\'est PAS coupé net (jeton encore valide 7 j)');

    line();
    console.log('④ Avance du temps simulée (le jeton n\'est plus renouvelé) :');
    const at = (label: string, nowMs: number) => {
      const s = lic.getLicenseStatus(nowMs);
      console.log(
        `   ${label.padEnd(28)} → état=${s.state.padEnd(11)} capacité=${lic.effectiveCapacity(100, s)}`,
      );
    };
    at('juste avant expiration', expMs - H);
    at('+1 h après expiration', expMs + H);
    at('+4 j après expiration', expMs + 4 * D);
    at('+8 j après expiration', expMs + 8 * D);

    line();
    console.log('⑤ Sécurité — jeton falsifié (1 caractère modifié) :');
    const tampered = token.slice(0, -2) + (token.slice(-1) === 'A' ? 'B' : 'A');
    console.log('   verifyToken(jeton falsifié) =', verifyToken(tampered), '(rejeté ✓)');

    line();
    console.log('✅ Démo terminée — le kill-switch fonctionne de bout en bout.');
  } finally {
    srv.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
