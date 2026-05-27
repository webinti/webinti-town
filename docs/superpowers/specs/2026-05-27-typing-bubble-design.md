# Bulle d'écriture chat — Design (F7)

**Date** : 2026-05-27
**Statut** : design validé

## Objectif

Quand un joueur tape un message dans le chat, afficher une petite bulle « … » au-dessus de son avatar Phaser. Disparaît 2 s après la dernière touche, ou immédiatement à l'envoi du message.

## Modèle réseau

Nouvel event Socket.IO **bidirectionnel** :

```
client → server: 'typing_start' (payload vide)
server → room broadcast (excluding sender): 'typing_state' { playerId: string; typing: true; t: number }
```

Le client émet `typing_start` **au plus une fois par 500 ms** (throttle) tant que l'utilisateur tape. Pas d'event `typing_stop` — l'expiration est gérée par un timer côté receveurs (2 s sans nouvel event → masquer).

Pourquoi pas de `typing_stop` : moins d'events réseau, plus simple, le timeout naturel suffit.

## Permissions / Sanity

- Rate-limit serveur : `typing_start` à 5/sec/socket max (au-delà : drop silencieux).
- Le serveur n'a pas d'état persistant pour le typing — c'est purement événementiel.
- Pas de visibilité par proximité : tous les joueurs de la room voient la bulle (même pattern que les emotes).

## UX

- Petit bubble sprite Phaser (cercle gris-clair + 3 points « … » animés cycliquement).
- Position : au-dessus du label nom (offset y -42 par rapport au sprite).
- Apparaît dès la 1ère réception de `typing_state` pour ce playerId.
- Disparaît automatiquement après 2 s sans nouvel event, ou immédiatement si le serveur diffuse un `chat_message` du même playerId (= message envoyé).

## Architecture code

**Serveur** :
- `server/src/socket/handlers.ts` : nouveau handler `socket.on('typing_start')` qui throttle (5/sec) puis broadcast via `socket.to(roomSlug).emit('typing_state', { playerId, typing: true, t: Date.now() })`.

**Client** :
- `client/src/network/SocketManager.ts` : `sendTypingStart()` emit helper + listener `socket.on('typing_state', ...)` qui mémorise dans un Map<playerId, expiresAt> et notifie via callback (pattern existant `onPlayerUpdate`).
- `client/src/react/components/ChatPanel.tsx` : sur chaque keystroke dans le textarea, appeler `socketManager.sendTypingStart()` (throttled 500 ms via `useRef<number>`). Sur envoi du message, le timer interne est reset (pas besoin d'emit dédié).
- `client/src/phaser/entities/RemotePlayer.ts` : nouvelle méthode `setTyping(active: boolean)` qui (dé)montre un Phaser.GameObjects.Text « 💬 » (ou un petit bubble custom) au-dessus du label. L'auto-disappear est géré au niveau de la scène via le timestamp `t` reçu.
- `client/src/phaser/scenes/GameScene.ts` : abonné à `onTypingState`, met à jour les `RemotePlayer.setTyping(...)` et lance un timer 2 s par player.

## Tests

- `server/src/socket/typingRateLimit.test.ts` : 6 appels en 1 s → 5 acceptés, 1 droppé.
- Pas de test client (logique purement temporelle et visuelle).

## Hors scope (YAGNI)

- Liste « X is typing… » dans le panneau chat (à la Slack/Discord). Le visuel sur l'avatar suffit.
- Bulle pour soi-même (on sait déjà qu'on tape).
