# Webinti Town — installation self-host (Enterprise)

Bundle Docker Compose pour héberger Webinti Town sur ton propre serveur.
Réservé aux clients **Enterprise** : nécessite une `LICENSE_KEY` fournie par
Webinti (l'instance se désactive proprement si l'abonnement n'est plus payé).

## Prérequis

- Un serveur Linux avec **Docker** + **Docker Compose** (VPS 2 vCPU / 4 Go conseillé).
- Un **nom de domaine** avec un enregistrement **DNS A** → IP du serveur
  (HTTPS obligatoire pour la caméra/micro).
- **Ports ouverts** : `80/tcp` et `443/tcp`.
- Pour l'audio/vidéo, un compte **LiveKit Cloud** gratuit (mode par défaut) —
  ou, en mode avancé, un 2e sous-domaine + `7881/tcp` & `7882/udp` ouverts.

## Installation express (recommandée)

```bash
cd selfhost
./install.sh            # pose quelques questions, génère le .env, peut tout lancer
```

L'installeur vérifie Docker, génère les secrets, te fait choisir le mode A/V,
écrit le `.env` et (si tu veux) démarre les conteneurs.

## Installation manuelle

```bash
cd selfhost
cp .env.example .env
nano .env                       # domaine, LICENSE_KEY, LiveKit, admin…
docker compose up -d --build
```

Caddy obtient les certificats HTTPS automatiquement (quelques secondes).
Vérifie : `docker compose ps` et `docker compose logs -f server`.

## Les deux modes audio/vidéo

L'A/V passe par LiveKit. Deux options, choisies dans le `.env` :

**Mode 1 — LiveKit Cloud (par défaut, le plus simple).** Crée un projet gratuit
sur https://cloud.livekit.io, colle `LIVEKIT_URL` / `LIVEKIT_API_KEY` /
`LIVEKIT_API_SECRET`. Rien à héberger, aucun port UDP à ouvrir.

**Mode 2 — SFU auto-hébergé (avancé).** Décommente le bloc « SFU LOCAL » du
`.env` (crée un 2e DNS A `livekit.exemple.com`, ouvre `7881/tcp` & `7882/udp`).
Le SFU tourne alors dans le bundle (profil compose `local-livekit`). Sur des
réseaux d'entreprise très fermés (UDP bloqué), il faut en plus un **TURN**
(coturn) — dans ce cas, préférer LiveKit Cloud.

## Premier démarrage (une fois)

1. Ouvre `https://TON_DOMAINE/pb/_/` → crée le **compte admin PocketBase**
   (identifiants du `.env`).
2. Initialise le schéma :
   ```bash
   docker compose exec server node dist/pocketbase/migrate.js
   ```
3. Redémarre le serveur pour qu'il crée ses collections avec le compte admin
   fraîchement créé (avant ça, les logs affichent des avertissements d'auth
   inoffensifs) :
   ```bash
   docker compose restart server
   ```
4. Ouvre `https://TON_DOMAINE`, crée ton compte avec l'email `HOST_EMAIL` :
   ce compte devient l'**hôte/admin** de l'espace.

## Mise à jour

```bash
docker compose pull            # images livekit/pocketbase
docker compose up -d --build   # rebuild client + serveur
```

## Licence & désactivation

Au démarrage, le serveur logue son état : `édition self-host — licence: active`.
États : `active` → `grace` → `restricted` → `expired`. En `expired`, l'app
affiche un écran « Accès suspendu » ; **les données restent intactes** et
l'accès revient automatiquement dès la régularisation de l'abonnement.

## Architecture (mode Cloud par défaut)

```
                 ┌────────── Caddy (HTTPS auto) ──────────┐
  navigateur ───►│  /            → client statique (SPA)  │
                 │  /api /socket.io → server:3001         │
                 │  /pb          → pocketbase:8090         │
                 └─────────────────────────────────────────┘
  navigateur ──── wss://…livekit.cloud ───────────► LiveKit Cloud (A/V)

  server ──► pocketbase (auth/db)   server ──► licenses.webinti.com (heartbeat)
```
