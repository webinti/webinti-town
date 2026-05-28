# Authentification optionnelle — Design

> Spec créée le 2026-05-28 (fin session migration PocketBase). Implémentation reportée à une session suivante (5-7h de focus estimées).

## Goal

Permettre aux utilisateurs de créer un compte pour que leur **avatar, pseudo, bureaux revendiqués et historique des rooms visitées** persistent entre devices/browsers/sessions, sans casser l'usage anonyme actuel.

## Décisions

| Question | Choix |
|---|---|
| Auth obligatoire ? | **Optionnelle** — anonyme reste possible partout |
| Méthodes login | **Email+password** ET **Magic link** (pas d'OAuth pour l'instant) |
| Identité anonyme au login | **Liée** : le clientKey courant est attaché au compte, les contributions anonymes deviennent celles du compte |
| Données persistées | Avatar, pseudo (réservé/unique), workstation revendiqué, historique des rooms |

## Architecture

### Collection `users` (existante, à étendre)

PocketBase fournit déjà la collection `users` (type `auth`) avec email/password. Ajouter :
- `name` (text, max 20, **unique** insensible à la casse)
- `appearance` (json) — `{skin, hairStyle, hairColor, shirt, pants}`
- `presencePreference` (text, optionnel — last manual presence choice)
- `linkedClientKeys` (json array of strings) — clientKey anonymes fusionnés dans ce compte

### Nouvelle collection `room_visits`

| Field | Type | Notes |
|---|---|---|
| userId | relation → users | required |
| roomSlug | text, max 50 | required |
| roomName | text, max 60 | snapshot |
| lastVisitedAt | number | ms epoch |
| visitCount | number | incrémenté à chaque join |

Unique index `(userId, roomSlug)`.

### Impact `workstation_states`

`claimedBy` peut désormais être soit un `clientKey` (UUID localStorage) soit un `userId` PocketBase. Permission `canEnter` teste les deux.

**Migration des claims existants** : quand un user anonyme se connecte pour la première fois, le serveur cherche les `workstation_states.claimedBy === <clientKey>` et les patch en `<userId>`.

## Flow utilisateur

### Signup

1. Bouton **"Se connecter"** dans HUD (top-bar, à côté du pseudo)
2. Modal avec onglet "Créer un compte"
3. Form : email + password (min 8 chars) + pseudo
4. Server vérifie unicité du pseudo (case-insensitive)
5. PocketBase crée le record + envoie email de vérification
6. User clique sur le lien → compte vérifié → auto-login

### Login email+pwd

1. Onglet "Se connecter" du modal
2. Form email + password
3. Server retourne JWT token (durée ~14 jours)
4. Client stocke en localStorage `webinti.authToken`
5. **Au join_room suivant** : socket envoie `{ clientKey, authToken }`. Server vérifie le token, charge le user, link le clientKey courant si pas déjà.

### Login magic link

1. Onglet "Magic link"
2. Form : juste email
3. Server demande à PocketBase d'envoyer un OTP par email
4. User reçoit lien `https://live.webinti.com/auth?otp=XXX&email=...`
5. Route SPA dédiée : valide OTP avec PB, récupère JWT, stocke, redirect home

### Logout

- Bouton dans menu profil
- Clear `webinti.authToken` localStorage
- Reload → revient en mode anonyme avec nouveau clientKey (fresh)

### Au join_room après login

```
client: emit('join_room', { roomSlug, playerName, appearance, clientKey, authToken })
server:
  if authToken valid:
    user = pb.users.getOne(token.userId)
    playerId = user.id
    appearance = user.appearance  // override prop client
    playerName = user.name  // override prop client
    if not user.linkedClientKeys.includes(clientKey):
      user.linkedClientKeys.push(clientKey)
      // migrate orphan claims/cards/dms from clientKey → user.id
      await migrateAnonymousOwnership(clientKey, user.id)
    // record visit
    await upsertRoomVisit(user.id, roomSlug, roomName)
  else:
    playerId = clientKey (existing behavior)
```

### `migrateAnonymousOwnership(clientKey, userId)`

Server-side, fire-and-forget :
1. `pb.kanban_cards.getList({ filter: 'authorId = "<clientKey>"' })` → update `authorId = userId`
2. `pb.dm_messages.getList({ filter: 'fromId = "<clientKey>" || toId = "<clientKey>"' })` → update IDs
3. `pb.workstation_states.getList({ filter: 'claimedBy = "<clientKey>"' })` → update `claimedBy = userId`

## UI

### Top-bar HUD

```
┌───────────────┐
│ [👤 Pseudo] [👋 Disponible ▾]      …    [se connecter] │
└───────────────┘
```

Si connecté :
```
[👤 Pseudo ✓] [👋 ▾]    …    [Profil ▾]
                                  ├ Mes rooms
                                  ├ Modifier avatar
                                  ├ Changer mot de passe
                                  └ Déconnexion
```

### Modal signup/login

Tabs en haut : "Se connecter" / "Créer un compte" / "Magic link". Form classique.

### Page "Mes rooms" (modal ou page dédiée)

Liste triée par `lastVisitedAt` desc, chaque ligne = lien vers la room.

## SMTP

PocketBase doit envoyer des emails (verify, magic link, reset password). Options :
- **Gmail SMTP** : simple, 500/jour gratuit, app password obligatoire (2FA-only)
- **Resend** : 3k/mois gratuit, propre API
- **Brevo** : 300/jour gratuit
- **Postfix local** : déjà installé sur le VPS (vu dans `ufw` : règle `25/tcp ALLOW 172.18.0.0/16`) — réutilisable

Décision SMTP : à trancher en début d'implémentation. Le VPS a déjà Postfix avec GoTrue (Supabase Academy). Préférable de réutiliser.

## Sécurité

- Password min 8 chars, hashing par PocketBase (bcrypt)
- JWT token signé par PocketBase, validation server-side sur join_room
- Rate-limit login : 5 essais / 15 min / IP côté nginx
- Email verify obligatoire avant accès aux features "compte" (avatar persisté etc.)
- HTTPS obligatoire (déjà en place)
- Pas de stockage password côté client autre que JWT (lui-même expirable)

## Implémentation par étapes (pour planification future)

1. **SMTP config** (PocketBase settings + test envoi) — 30 min
2. **Étendre collection users + créer room_visits** — 15 min
3. **API client : PocketBase client browser SDK** — 30 min
4. **Modal signup/login UI** — 1.5h
5. **Server : auth verify au join_room + load user** — 1h
6. **migrateAnonymousOwnership server-side** — 1h
7. **Top-bar HUD : bouton login + menu profil** — 1h
8. **Page Mes rooms** — 30 min
9. **Tests + déploiement progressif** — 1h

Total estimé : **~6h** de focus.

## Risques connus

- **Pseudo unicité race** : si 2 users tentent le même pseudo en même temps, PB unique index résout côté DB → erreur claire à propager au client.
- **Migration ownership lent** : si user anonyme avait 1000+ cartes, migrate prend du temps. Solution : batcher ou async.
- **clientKey collision après migration** : si user se connecte sur 2 devices, le 2ème clientKey est aussi ajouté à linkedClientKeys. OK.
- **Email phishing magic link** : standard PocketBase. Tokens à durée courte (15 min).

## Reste hors-scope (autre session)

- OAuth Google (peut être ajouté plus tard sans refactor)
- 2FA TOTP
- Réinitialisation password en self-service (PB le fournit par défaut quand SMTP OK)
- Suppression de compte (RGPD — à prévoir si production)
