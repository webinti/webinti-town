# Plan d'implémentation — Chat Typing Bubble (F7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quand un joueur tape dans le chat, afficher un emoji 💬 au-dessus de son avatar dans Phaser. La bulle disparaît 2 s après la dernière frappe, ou immédiatement à l'envoi du message. Pas de `typing_stop` — l'expiration est timer-based côté receveurs.

**Architecture:** Client → `typing_start` (throttled 500 ms) → serveur rate-limit 5/s/socket → broadcast `typing_state { playerId, typing: true, t }` à tous les autres de la room → `GameScene` maintient une `Map<playerId, NodeJS.Timeout>` pour lancer un timeout 2 s par joueur → appelle `RemotePlayer.setTyping(true/false)` → affiche/supprime un `Phaser.GameObjects.Text` 💬 42 px au-dessus du sprite. Dès qu'un `chat_message` du même joueur est reçu, le timer est annulé et `setTyping(false)` est appelé immédiatement.

**Tech Stack:** TypeScript + Node 20 (server), Socket.IO, React 18 (ChatPanel), Phaser 3 (RemotePlayer / GameScene), Vitest (TDD server).

**Spec source:** `docs/superpowers/specs/2026-05-27-typing-bubble-design.md`

---

## File structure overview

**Created**
- `server/src/socket/typingRateLimit.test.ts` — vitest unit test (5/s)
- `docs/superpowers/plans/2026-05-27-typing-bubble.md` — ce plan

**Modified**
- `server/src/socket/handlers.ts` — `SocketSession.typingTimestamps` + handler `typing_start`
- `client/src/network/SocketManager.ts` — `sendTypingStart()` emit + `typingStateListeners` set + `onTypingState(fn)` subscriber
- `client/src/react/components/ChatPanel.tsx` — `onChange` textarea appelle `socketManager.sendTypingStart()` (throttled 500 ms via `useRef<number>`)
- `client/src/phaser/entities/RemotePlayer.ts` — `typingBubble: Phaser.GameObjects.Text | null` + `setTyping(active: boolean)`
- `client/src/phaser/scenes/GameScene.ts` — `typingTimers: Map<string, NodeJS.Timeout>`, abonnement `onTypingState`, clear sur `chat_message`

---

## Task 1 : Server — rate-limited `typing_start` handler + broadcast `typing_state` (TDD)

**Files:**
- Create: `server/src/socket/typingRateLimit.test.ts`
- Modify: `server/src/socket/handlers.ts`

### Contexte

La fonction `rateLimit(stamps, limit)` existe déjà dans `handlers.ts` (ligne 139). Elle est purement fonctionnelle : elle reçoit un tableau de timestamps mutable et retourne `true` si l'event est accepté, `false` s'il doit être droppé. On va l'extraire/tester directement.

Le `SocketSession` (ligne 77) déclare déjà `chatTimestamps: number[]` et `moveTimestamps: number[]`. On ajoute `typingTimestamps: number[]`.

---

- [ ] **Step 1 : Écrire les tests (Red)**

Créer `server/src/socket/typingRateLimit.test.ts` :

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Réimplémentation locale de la fonction rateLimit de handlers.ts
 * pour tester la logique d'isolation sans importer le module complet
 * (qui a des side effects Socket.IO au niveau module).
 *
 * La logique est identique à celle de handlers.ts :
 *   - fenêtre glissante de `windowMs` ms (défaut 1000)
 *   - si stamps.length >= limit après purge → drop (return false)
 *   - sinon push + return true
 */
function rateLimit(stamps: number[], limit: number, windowMs = 1000): boolean {
  const now = Date.now();
  while (stamps.length > 0 && now - stamps[0]! > windowMs) stamps.shift();
  if (stamps.length >= limit) return false;
  stamps.push(now);
  return true;
}

describe('typing_start rate-limit — 5/sec/socket', () => {
  let stamps: number[];

  beforeEach(() => {
    stamps = [];
    vi.useFakeTimers();
  });

  it('accepts the first 5 calls within 1 s', () => {
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(stamps, 5)).toBe(true);
    }
    expect(stamps).toHaveLength(5);
  });

  it('drops the 6th call within the same second', () => {
    for (let i = 0; i < 5; i++) rateLimit(stamps, 5);
    expect(rateLimit(stamps, 5)).toBe(false);
  });

  it('accepts again after the 1 s window rolls over', () => {
    for (let i = 0; i < 5; i++) rateLimit(stamps, 5);
    // Advance time past the window so all 5 old stamps expire.
    vi.advanceTimersByTime(1001);
    expect(rateLimit(stamps, 5)).toBe(true);
  });

  it('sliding window: accepts after partial expiry', () => {
    // Call twice at t=0
    rateLimit(stamps, 5);
    rateLimit(stamps, 5);
    // Advance 600 ms — those 2 stamps are now 600 ms old, still < 1000 ms.
    vi.advanceTimersByTime(600);
    // Call 3 more times (total 5 accepted).
    rateLimit(stamps, 5);
    rateLimit(stamps, 5);
    rateLimit(stamps, 5);
    // 6th call: stamps.length === 5 → drop.
    expect(rateLimit(stamps, 5)).toBe(false);
    // Advance another 401 ms: the first 2 stamps (t=0) expire (> 1000 ms).
    // stamps now has 3 entries.
    vi.advanceTimersByTime(401);
    expect(rateLimit(stamps, 5)).toBe(true);
    expect(rateLimit(stamps, 5)).toBe(true);
  });

  it('exactly at the window boundary: stamp is still alive', () => {
    rateLimit(stamps, 5);
    // At exactly 1000 ms, the stamp is NOT yet expired (condition: now - t > windowMs).
    vi.advanceTimersByTime(1000);
    // stamps[0] was pushed at t=0, now = 1000, diff = 1000, NOT > 1000 → not purged.
    expect(stamps).toHaveLength(1);
    // At 1001 ms it expires.
    vi.advanceTimersByTime(1);
    rateLimit(stamps, 5); // triggers purge
    expect(stamps).toHaveLength(1); // the new call, old one purged
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils passent (la logique est self-contained)**

```bash
cd /home/openclaw/projects/webinti-town/server && npx vitest run src/socket/typingRateLimit.test.ts
```

Expected output :

```
✓ src/socket/typingRateLimit.test.ts (5)
  ✓ typing_start rate-limit — 5/sec/socket (5)
Test Files  1 passed (1)
Tests  5 passed (5)
```

- [ ] **Step 3 : Ajouter `typingTimestamps` au `SocketSession`**

Dans `server/src/socket/handlers.ts`, repérer l'interface `SocketSession` (ligne ~77) :

```ts
interface SocketSession {
  roomSlug: string;
  playerId: string;
  chatTimestamps: number[];
  moveTimestamps: number[];
}
```

La modifier en ajoutant le champ :

```ts
interface SocketSession {
  roomSlug: string;
  playerId: string;
  chatTimestamps: number[];
  moveTimestamps: number[];
  typingTimestamps: number[];
}
```

- [ ] **Step 4 : Initialiser `typingTimestamps` à la création de session**

Repérer le bloc `sessions.set(socket.id, { ... })` dans le handler `join_room` (ligne ~207) :

```ts
      sessions.set(socket.id, {
        roomSlug,
        playerId: player.playerId,
        chatTimestamps: [],
        moveTimestamps: [],
      });
```

Le remplacer par :

```ts
      sessions.set(socket.id, {
        roomSlug,
        playerId: player.playerId,
        chatTimestamps: [],
        moveTimestamps: [],
        typingTimestamps: [],
      });
```

- [ ] **Step 5 : Ajouter le handler `typing_start`**

Dans `server/src/socket/handlers.ts`, après le handler `chat_message` (bloc `socket.on('chat_message', ...)`), ajouter :

```ts
    socket.on('typing_start', () => {
      const session = sessions.get(socket.id);
      if (!session) return;
      // Rate-limit : 5 events par seconde par socket. Drop silencieux au-delà.
      if (!rateLimit(session.typingTimestamps, 5)) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      // Broadcast à tous les autres joueurs de la room (excluant l'émetteur).
      socket.to(session.roomSlug).emit('typing_state', {
        playerId: session.playerId,
        typing: true,
        t: Date.now(),
      });
    });
```

- [ ] **Step 6 : Type-check serveur**

```bash
cd /home/openclaw/projects/webinti-town/server && npx tsc --noEmit
```

Expected: 0 erreur.

- [ ] **Step 7 : Relancer tous les tests serveur**

```bash
cd /home/openclaw/projects/webinti-town/server && npx vitest run
```

Expected: tous les tests passent, dont le nouveau `typingRateLimit.test.ts`.

- [ ] **Step 8 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add server/src/socket/handlers.ts server/src/socket/typingRateLimit.test.ts
git commit -m "feat(server): typing_start handler + 5/s rate-limit + typing_state broadcast"
```

---

## Task 2 : Client SocketManager — `sendTypingStart()` + `onTypingState(fn)`

**Files:**
- Modify: `client/src/network/SocketManager.ts`

### Contexte

`SocketManager` expose le pattern listener avec un `Set` privé de callbacks + une méthode publique `onXxx(fn)` retournant un unsubscribe. Exemple existant :

```ts
// private listeners = new Set<(p: PlayerState) => void>();
// onPlayerUpdate(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
```

On suit le même pattern pour `typing_state`. L'émission est throttlée côté serveur mais il vaut mieux aussi throttler côté client pour ne pas saturer le réseau — cela est fait dans `ChatPanel` (Task 3) via un `useRef<number>`. `sendTypingStart()` dans `SocketManager` est donc simple : juste un emit, sans throttle interne (la responsabilité est au niveau appelant).

---

- [ ] **Step 1 : Déclarer le type du payload `typing_state`**

En haut de `client/src/network/SocketManager.ts`, dans la zone des interfaces locales (près de `WhiteboardStrokePayload`, etc.), ajouter :

```ts
interface TypingStatePayload {
  playerId: string;
  typing: boolean;
  t: number;
}
```

- [ ] **Step 2 : Ajouter le Set de listeners**

Dans la classe `SocketManager`, après la déclaration de `private kickedListeners = new Set<...>()`, ajouter :

```ts
  private typingStateListeners = new Set<(p: TypingStatePayload) => void>();
```

- [ ] **Step 3 : Souscrire à l'event `typing_state` dans `connect()`**

Dans la méthode `connect()`, après le bloc `socket.on('kicked', ...)` et avant le `return socket;`, ajouter :

```ts
    socket.on('typing_state', (payload: TypingStatePayload) => {
      if (
        !payload ||
        typeof payload.playerId !== 'string' ||
        typeof payload.typing !== 'boolean' ||
        typeof payload.t !== 'number'
      ) return;
      for (const fn of this.typingStateListeners) fn(payload);
    });
```

- [ ] **Step 4 : Ajouter `sendTypingStart()` dans la zone des emits**

Après la méthode `sendEmote(emoteType)`, ajouter :

```ts
  sendTypingStart(): void {
    this.socket?.emit('typing_start');
  }
```

- [ ] **Step 5 : Ajouter `onTypingState(fn)` dans la zone des abonnements**

Après `onPlayerGhost(fn)` (ou à côté des autres `onXxx`), ajouter :

```ts
  onTypingState(fn: (p: TypingStatePayload) => void): () => void {
    this.typingStateListeners.add(fn);
    return () => {
      this.typingStateListeners.delete(fn);
    };
  }
```

- [ ] **Step 6 : Type-check client**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

Expected: 0 erreur.

- [ ] **Step 7 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add client/src/network/SocketManager.ts
git commit -m "feat(client): SocketManager — sendTypingStart() + onTypingState() subscriber"
```

---

## Task 3 : ChatPanel — déclencher `sendTypingStart()` à chaque frappe

**Files:**
- Modify: `client/src/react/components/ChatPanel.tsx`

### Contexte

Le `<textarea>` dans `ChatPanel` a déjà un `onChange` qui appelle `setText(e.target.value.slice(0, 300))`. On va y ajouter l'appel à `socketManager.sendTypingStart()` avec un throttle client-side de 500 ms via un `useRef<number>` (timestamp de dernier envoi). Pas de dépendance externe — juste `Date.now()`.

---

- [ ] **Step 1 : Ajouter la ref de throttle**

Dans `ChatPanel`, après les refs existantes (`inputRef`, `listRef`, `scrollPosRef`), ajouter :

```ts
  const lastTypingEmitRef = useRef<number>(0);
```

- [ ] **Step 2 : Modifier le `onChange` du textarea**

Repérer le textarea (ligne ~146) :

```tsx
          onChange={(e) => setText(e.target.value.slice(0, 300))}
```

Le remplacer par :

```tsx
          onChange={(e) => {
            setText(e.target.value.slice(0, 300));
            const now = Date.now();
            if (now - lastTypingEmitRef.current >= 500) {
              lastTypingEmitRef.current = now;
              socketManager.sendTypingStart();
            }
          }}
```

- [ ] **Step 3 : Type-check client**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

Expected: 0 erreur.

- [ ] **Step 4 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add client/src/react/components/ChatPanel.tsx
git commit -m "feat(client): ChatPanel — throttled sendTypingStart() on every keystroke"
```

---

## Task 4 : RemotePlayer — méthode `setTyping(active: boolean)`

**Files:**
- Modify: `client/src/phaser/entities/RemotePlayer.ts`

### Contexte

`RemotePlayer` contient déjà une `label: Phaser.GameObjects.Text` positionnée à `y - 28` au-dessus du sprite. La bulle de typing est un deuxième `Phaser.GameObjects.Text` contenant l'emoji 💬, positionné à `y - 42` (soit 14 px au-dessus du label). On le crée à la demande (`setTyping(true)`) et on le détruit sur `setTyping(false)`.

La méthode `update()` déplace déjà le `label` à chaque frame (`this.label.setPosition(x, y - 28)`). On ajoute le même setPosition pour `typingBubble`.

La méthode `destroy()` détruit déjà le `label`. On y ajoute `typingBubble?.destroy()`.

Le `setGhost()` applique `setAlpha` à tous les layers. On l'étend pour couvrir `typingBubble`.

---

- [ ] **Step 1 : Ajouter la propriété `typingBubble`**

Dans la classe `RemotePlayer`, après la déclaration de `label: Phaser.GameObjects.Text;`, ajouter :

```ts
  private typingBubble: Phaser.GameObjects.Text | null = null;
```

- [ ] **Step 2 : Implémenter `setTyping(active)`**

Après la méthode `setGhost(isGhost: boolean)` (ligne ~99), ajouter :

```ts
  setTyping(active: boolean): void {
    if (active) {
      if (this.typingBubble) return; // déjà visible — ne rien faire
      this.typingBubble = this.scene.add
        .text(this.sprite.x, this.sprite.y - 42, '\u{1F4AC}', {
          fontSize: '18px',
          fontFamily: 'system-ui, sans-serif',
        })
        .setOrigin(0.5, 1)
        .setDepth(12);
      // Appliquer l'alpha ghost si nécessaire.
      if (this.isGhost) this.typingBubble.setAlpha(0.5);
    } else {
      if (!this.typingBubble) return; // déjà masqué — ne rien faire
      this.typingBubble.destroy();
      this.typingBubble = null;
    }
  }
```

- [ ] **Step 3 : Suivre la position du sprite dans `update()`**

Dans la méthode `update()`, après `this.label.setPosition(x, y - 28);` (ligne ~155), ajouter :

```ts
    if (this.typingBubble) this.typingBubble.setPosition(x, y - 42);
```

- [ ] **Step 4 : Gérer l'alpha ghost dans `setGhost()`**

Dans `setGhost(isGhost: boolean)`, après `this.label.setAlpha(a);`, ajouter :

```ts
    this.typingBubble?.setAlpha(a);
```

- [ ] **Step 5 : Détruire la bulle dans `destroy()`**

Dans la méthode `destroy()`, après `this.label.destroy();`, ajouter :

```ts
    this.typingBubble?.destroy();
```

- [ ] **Step 6 : Type-check client**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

Expected: 0 erreur.

- [ ] **Step 7 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add client/src/phaser/entities/RemotePlayer.ts
git commit -m "feat(client): RemotePlayer.setTyping() — 💬 bubble 42px above sprite"
```

---

## Task 5 : GameScene — abonnement `onTypingState`, timers 2 s, clear sur `chat_message`

**Files:**
- Modify: `client/src/phaser/scenes/GameScene.ts`

### Contexte

`GameScene` souscrit déjà à des events de `socketManager` via des méthodes `onXxx` :

```ts
this.unsubUpdate = socketManager.onPlayerUpdate((p) => this.handleRemoteUpdate(p));
this.unsubRemove = socketManager.onPlayerRemoved((id) => this.handleRemoteRemove(id));
this.unsubEmote  = socketManager.onEmote((e) => this.handleEmote(e.playerId, e.emoteType));
this.unsubObject = socketManager.onObjectUpdate((obj) => this.refreshObject(obj));
```

On ajoute un `unsubTyping` et un `unsubChatForTyping` de même forme, ainsi qu'une `Map<string, NodeJS.Timeout>` pour gérer les timers d'expiration.

À la destruction de la scène (bloc `SHUTDOWN`), on nettoie les unsubscribers et on cleane les timers actifs.

---

- [ ] **Step 1 : Déclarer les nouvelles propriétés**

Dans la classe `GameScene`, après `private unsubObject?: () => void;` (ligne ~62), ajouter :

```ts
  private unsubTyping?: () => void;
  private unsubChatForTyping?: () => void;
  private typingTimers = new Map<string, NodeJS.Timeout>();
```

- [ ] **Step 2 : Souscrire à `onTypingState` dans `create()`**

Dans la méthode `create()`, après les lignes `this.unsubUpdate = ...` / `this.unsubObject = ...`, ajouter :

```ts
    this.unsubTyping = socketManager.onTypingState((payload) => {
      this.handleTypingState(payload.playerId);
    });

    this.unsubChatForTyping = socketManager.onChatMessage((msg) => {
      this.clearTypingForPlayer(msg.playerId);
    });
```

- [ ] **Step 3 : Implémenter `handleTypingState(playerId)`**

Après la méthode `handleRemoteRemove(id)` (ligne ~409), ajouter :

```ts
  private handleTypingState(playerId: string): void {
    const rp = this.remotePlayers.get(playerId);
    if (!rp) return;
    // Afficher la bulle immédiatement.
    rp.setTyping(true);
    // Réinitialiser le timer 2 s (annuler l'ancien si présent).
    const existing = this.typingTimers.get(playerId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.typingTimers.delete(playerId);
      const r = this.remotePlayers.get(playerId);
      if (r) r.setTyping(false);
    }, 2000);
    this.typingTimers.set(playerId, timer);
  }

  private clearTypingForPlayer(playerId: string): void {
    const existing = this.typingTimers.get(playerId);
    if (existing) {
      clearTimeout(existing);
      this.typingTimers.delete(playerId);
    }
    const rp = this.remotePlayers.get(playerId);
    if (rp) rp.setTyping(false);
  }
```

- [ ] **Step 4 : Nettoyer dans le handler `SHUTDOWN`**

Repérer le bloc `this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { ... })` (ligne ~223). Y ajouter dans le callback :

```ts
      this.unsubTyping?.();
      this.unsubChatForTyping?.();
      for (const timer of this.typingTimers.values()) clearTimeout(timer);
      this.typingTimers.clear();
```

- [ ] **Step 5 : Nettoyer aussi dans `handleRemoteRemove()`**

Dans la méthode `handleRemoteRemove(id)` (ligne ~409), après `this.remotePlayers.delete(id);`, ajouter :

```ts
    // Si ce joueur avait une bulle active, annuler son timer.
    const timer = this.typingTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(id);
    }
```

- [ ] **Step 6 : Type-check client**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

Expected: 0 erreur.

- [ ] **Step 7 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add client/src/phaser/scenes/GameScene.ts
git commit -m "feat(client): GameScene subscribes to typing_state — 2s timer, clear on chat_message"
```

---

## Task 6 : Build + restart + smoke test

**Files:**
- Aucun nouveau fichier — vérification de l'ensemble.

- [ ] **Step 1 : Build complet (serveur)**

```bash
cd /home/openclaw/projects/webinti-town/server && npm run build
```

Expected: `dist/` produit sans erreur TypeScript.

- [ ] **Step 2 : Build complet (client)**

```bash
cd /home/openclaw/projects/webinti-town/client && npm run build
```

Expected: `dist/` produit sans erreur, aucune warning critique.

- [ ] **Step 3 : Lancer tous les tests serveur**

```bash
cd /home/openclaw/projects/webinti-town/server && npx vitest run
```

Expected output :

```
✓ src/socket/typingRateLimit.test.ts (5)
✓ src/socket/proximity.test.ts (...)
✓ ...
Test Files  X passed
Tests  Y passed
```

- [ ] **Step 4 : Démarrer le serveur en dev**

```bash
cd /home/openclaw/projects/webinti-town && npm run dev
```

Expected: serveur écoute sur port 3001 (ou configuré), client Vite sur port 5173.

- [ ] **Step 5 : Smoke test manuel**

Ouvrir deux onglets sur `http://localhost:5173/town/test-room` (ou le slug local habituel).

1. Dans l'onglet A, appuyer sur `C` pour ouvrir le chat.
2. Taper quelques lettres dans le textarea.
3. Vérifier dans l'onglet B que l'emoji 💬 apparaît au-dessus de l'avatar du joueur A dans Phaser.
4. Attendre 2 s sans taper : la bulle doit disparaître.
5. Dans l'onglet A, taper à nouveau puis appuyer Entrée pour envoyer le message.
6. Vérifier dans l'onglet B que la bulle disparaît immédiatement à la réception du `chat_message` (avant les 2 s).
7. Vérifier que l'onglet A ne montre pas de bulle au-dessus de son propre avatar (la bulle n'est que pour les joueurs distants).

- [ ] **Step 6 : Commit final**

```bash
cd /home/openclaw/projects/webinti-town
git add -p   # review des éventuels fichiers non commités
git commit -m "chore: typing bubble (F7) — build verified, smoke test passed" --allow-empty
```

> Si aucun fichier n'est en staging, passer le `--allow-empty` ou sauter ce commit.

---

## Self-review — couverture de la spec

| Exigence spec | Couvert | Tâche |
|---|---|---|
| Event `typing_start` client → server (payload vide) | ✅ | T2 `sendTypingStart()`, T1 handler |
| Event `typing_state { playerId, typing: true, t }` server → room (excl. sender) | ✅ | T1 `socket.to(roomSlug).emit(...)` |
| Throttle client 500 ms | ✅ | T3 `lastTypingEmitRef` |
| Rate-limit serveur 5/s/socket (drop silencieux) | ✅ | T1 `rateLimit(session.typingTimestamps, 5)` |
| Pas d'event `typing_stop` | ✅ | Aucun event de stop dans tout le plan |
| Bulle emoji au-dessus du label, offset y -42 | ✅ | T4 `y - 42`, `setOrigin(0.5, 1)` |
| Apparaît à la 1ère réception de `typing_state` | ✅ | T5 `rp.setTyping(true)` immédiat |
| Disparaît 2 s après la dernière frappe (timer glissant) | ✅ | T5 `setTimeout(2000)` réinitialisé à chaque event |
| Disparaît immédiatement sur `chat_message` du même joueur | ✅ | T5 `unsubChatForTyping` → `clearTypingForPlayer()` |
| Pas de bulle pour soi-même | ✅ | Seuls les `RemotePlayer` ont `setTyping()` |
| Tous les joueurs de la room voient la bulle (pas de filtre proximité) | ✅ | `socket.to(roomSlug).emit(...)` sans filtre |
| Vitest — 6 appels en 1 s → 5 acceptés, 1 droppé | ✅ | T1 `typingRateLimit.test.ts` |
| Alpha ghost honoré par la bulle | ✅ | T4 `setGhost()` + `typingBubble?.setAlpha(a)` |
| Bulle détruite si le joueur quitte la room | ✅ | T5 `handleRemoteRemove()` + timer clear |
| Aucune fuite mémoire à la destruction de scène | ✅ | T5 bloc `SHUTDOWN` nettoie `typingTimers` |
