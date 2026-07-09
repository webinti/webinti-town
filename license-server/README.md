# Serveur de licence Webinti (kill-switch self-host)

Ce service tourne sur **ton** infra (à côté de Stripe). Il autorise les
instances Webinti Town auto-hébergées à rester allumées tant que l'abonnement
Enterprise (350 €/mois) est payé, et les dégrade progressivement sinon.

Le client self-host ne reçoit **jamais** ce dossier : il n'obtient que le build
Webinti (avec la clé *publique* compilée dedans) + une clé de licence.

## Principe en 20 secondes

```
Stripe (source de vérité)          Serveur de licence (ici)        Instance client
─────────────────────────          ─────────────────────────       ────────────────
abonnement payé   ───webhook──►  status = active
                                  /v1/activate  ◄───heartbeat 1×/j──  LICENSE_KEY
                                  jeton signé 7j  ─────────────────►  vérifie hors-ligne
abonnement annulé ───webhook──►  status = canceled
                                  refuse d'émettre ────────────────►  jeton expire → dégradation
```

La signature est **Ed25519**. La clé privée (ici) signe ; la clé publique
(dans le build client) ne fait que vérifier. Un client ne peut donc pas
fabriquer ni modifier un jeton.

## Mise en route

```bash
# 1. Générer la paire de clés (UNE SEULE FOIS pour toute la vie du produit)
node scripts/license-keygen.mjs
#    → license-server/keys/private-key.pem   (SECRET, reste ici)
#    → server/src/license/publicKey.ts        (compilé dans le build client)

# 2. Lancer le serveur de licence
LICENSE_ADMIN_TOKEN="un-secret-solide" node license-server/server.mjs
```

En prod : derrière HTTPS (Caddy/nginx) sur `https://licenses.webinti.com`,
en service systemd, comme le reste. Redémarre-le après un `git pull`.

## Créer une licence (à faire après un paiement Enterprise)

Pour l'instant à la main (le webhook Stripe automatisera ça au palier 1) :

```bash
curl -X POST https://licenses.webinti.com/admin/license \
  -H "authorization: Bearer $LICENSE_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"licenseKey":"LIC-ACME-0001","customer":"ACME Corp","maxUsers":100,"stripeSubId":"sub_..."}'
```

Puis tu livres au client : le build + `LICENSE_KEY=LIC-ACME-0001` dans son `.env`.

Suspendre / réactiver :

```bash
curl -X POST .../admin/license/LIC-ACME-0001/cancel   -H "authorization: Bearer $LICENSE_ADMIN_TOKEN"
curl -X POST .../admin/license/LIC-ACME-0001/activate -H "authorization: Bearer $LICENSE_ADMIN_TOKEN"
```

## Variables d'environnement

| Var | Défaut | Rôle |
|---|---|---|
| `LICENSE_PORT` | `8790` | port d'écoute |
| `LICENSE_ADMIN_TOKEN` | `dev-admin` | **à changer** — protège `/admin/*` |
| `LICENSE_TOKEN_TTL_MS` | 7 j | durée de validité d'un jeton émis (= la période où un client peut survivre hors-ligne) |
| `LICENSE_PRIVATE_KEY_PATH` | `keys/private-key.pem` | clé de signature |
| `LICENSE_STORE_PATH` | `licenses.json` | registre des licences |

## Automatisation Stripe (fait)

Le endpoint `POST /v1/stripe/webhook` crée/active/annule les licences tout seul.
La signature est vérifiée **sans le SDK Stripe** (HMAC maison, cf. `stripe-verify.mjs`).

Configuration côté Stripe :

1. Dashboard Stripe → Developers → Webhooks → **Add endpoint** dédié :
   `https://licenses.webinti.com/v1/stripe/webhook`
   Events : `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`.
2. Copie le **signing secret** (`whsec_…`) de CET endpoint dans l'env du serveur
   de licence : `LICENSE_STRIPE_WEBHOOK_SECRET=whsec_…`.
3. Sur le **Payment Link / Checkout** de l'offre Enterprise self-host, ajoute la
   metadata **`selfhost=true`** (sur la session ET `subscription_data.metadata`),
   et éventuellement `licenseKey=LIC-…` pour fixer la clé (sinon elle est
   générée automatiquement — récupère-la via `GET /admin/licenses`).

Seuls les abonnements marqués `selfhost=true` créent une licence : tes
abonnements SaaS classiques sont ignorés par ce webhook.

Mapping des statuts : `active`/`trialing` → licence **active** ; tout le reste
(`past_due`, `unpaid`, `canceled`, abonnement supprimé) → **canceled**.

Preuve : `node scripts/license-stripe-demo.mjs` (forge des webhooks signés et
vérifie création / coupure / réactivation / rejet de signature).

## Démo

```bash
npx tsx scripts/license-demo.ts   # prouve actif → grâce → restreint → expiré + anti-falsification
```
