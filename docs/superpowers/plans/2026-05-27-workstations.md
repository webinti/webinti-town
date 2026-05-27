# Postes de travail (F6) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque joueur peut revendiquer un poste de travail (zone rectangulaire sur la map), inviter d'autres joueurs, et verrouiller physiquement la zone. Une bulle 💬 apparaît au-dessus de tout joueur assis dans un poste revendiqué, et pulse quand il parle via LiveKit. Un mode debug `Shift+D` permet de calibrer les coordonnées des postes en temps réel.

**Architecture:** Côté serveur, un `WorkstationManager` par room gère l'état en mémoire (pas de persistance — un restart libère tout) ; `updatePlayerPosition` est étendu pour calculer `workstationId` et rejeter les moves dans des zones verrouillées. Les events `workstation:claim/release/invite/uninvite` et `speaking_state` passent par les handlers Socket.IO existants. Côté client, un store Zustand, une `WorkstationOverlay` Phaser (contours colorés), des composants React (panneau, toast d'invitation, modal d'invitation) et un hook `useSpeakerBubbles` complètent le tableau.

**Tech Stack:** TypeScript + Node 20 (server), React 18 + Zustand + Tailwind (client), Phaser 3, Socket.IO, Vitest (tests TDD côté serveur).

**Spec source:** `docs/superpowers/specs/2026-05-27-office-zones-design.md`

---

## File structure overview

**Created**
- `server/src/workstations.ts` — définition `Workstation`, `WORKSTATIONS` (placeholder vide), `workstationIdForPoint`
- `server/src/workstations.test.ts` — tests TDD pour `workstationIdForPoint`
- `server/src/workstations/WorkstationManager.ts` — logique claim/release/invite/uninvite + can-enter
- `server/src/workstations/WorkstationManager.test.ts` — tests TDD pour toutes les permissions
- `client/src/workstations.ts` — miroir lecture-seule (Workstation + WORKSTATIONS)
- `client/src/phaser/WorkstationOverlay.ts` — dessin Phaser des contours colorés
- `client/src/react/components/WorkstationPanel.tsx` — panneau flottant Revendiquer/Libérer/Inviter
- `client/src/react/components/WorkstationInviteModal.tsx` — modal pour choisir qui inviter
- `client/src/react/components/WorkstationInviteToast.tsx` — toast reçu par l'invité (30 s)
- `client/src/react/hooks/useSpeakerBubbles.ts` — subscribe LiveKit activeSpeakers → broadcast speaking_state → update bubbles

**Modified**
- `server/src/types.ts` — + `WorkstationState`, + `workstationId` sur `PlayerState`, + `workstations` sur `RoomState`
- `server/src/rooms/RoomManager.ts` — instancier `WorkstationManager` par room, `updatePlayerPosition` recalcule `workstationId` + rejette moves interdits
- `server/src/socket/handlers.ts` — 4 handlers `workstation:*`, `speaking_state` relay rate-limité, `workstation:initial` au join
- `client/src/types.ts` — + `WorkstationState`, + `workstationId` sur `PlayerState`
- `client/src/stores/gameStore.ts` — slice `workstations: Map<string, WorkstationState>`, `nearbyWorkstationId`, `pendingInvite`
- `client/src/network/SocketManager.ts` — 4 emits `workstation:*` + `speaking_state`, 3 listeners (`workstation:state`, `workstation:initial`, `workstation:invite`, `speaking_state`)
- `client/src/phaser/entities/Player.ts` — `setSpeaking(active)` (bulle 💬 persistante + pulse)
- `client/src/phaser/entities/RemotePlayer.ts` — `setSpeaking(active)` + cleanup dans `destroy`
- `client/src/phaser/scenes/GameScene.ts` — monter `WorkstationOverlay`, détecter proximité poste, passer `workstationId` aux entités, colliders dynamiques zones verrouillées, `Shift+D` debug
- `client/src/react/HUD.tsx` — monter `<WorkstationPanel />`, `<WorkstationInviteToast />`, `<useSpeakerBubbles />`

---

## Task 1 : Server types — WorkstationState + extensions PlayerState + RoomState

**Files:**
- Modify: `server/src/types.ts`

- [ ] **Step 1 : Ajouter `WorkstationState` et étendre les interfaces**

Ouvrir `server/src/types.ts`. Juste après la définition de `KanbanBoard`, insérer :

```ts
export interface WorkstationState {
  id: string;                       // matches Workstation.id
  claimedBy: string | null;         // playerId du revendicateur, ou null
  claimedByName: string | null;     // snapshot pour l'affichage
  invitedPlayerIds: string[];       // les invités autorisés à entrer
  claimedAt: number | null;         // pour debug / audit
}
```

Dans `PlayerState`, ajouter le champ après `lastActivityAt` :

```ts
  workstationId: string | null;     // calculé server-side depuis x/y ; null si hors zone
```

Dans `RoomState`, ajouter après `kanbanStore` :

```ts
  workstations: Map<string, WorkstationState>;  // key = workstation.id
```

Le résultat attendu pour les interfaces modifiées (inclure uniquement les nouveaux champs, ne pas retirer les existants) :

```ts
// PlayerState — avant isRecording n'existe pas; workstationId s'ajoute après lastActivityAt
export interface PlayerState {
  playerId: string;
  socketId: string;
  name: string;
  appearance: Appearance;
  x: number;
  y: number;
  direction: Direction;
  isMoving: boolean;
  isGhost: boolean;
  joinedAt: number;
  presence: Presence;
  lastActivityAt: number;
  workstationId: string | null;
}

// RoomState — workstations s'ajoute après kanbanStore
export interface RoomState {
  slug: string;
  name: string;
  adminToken: string;
  players: Map<string, PlayerState>;
  createdAt: number;
  chatHistory: ChatMessage[];
  interactiveObjects: InteractiveObject[];
  kanbanStore: import('./kanban/KanbanStore.js').KanbanStore;
  hostPlayerId: string | null;
  isRecording: boolean;
  workstations: Map<string, WorkstationState>;
}
```

- [ ] **Step 2 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/server && npx tsc --noEmit
```

Expected : erreurs uniquement sur `addPlayer` (n'initialise pas encore `workstationId`) et sur les sites de construction de `RoomState` (pas encore de `workstations`). C'est normal — on les corrige en Task 4.

- [ ] **Step 3 : Commit**

```bash
cd /home/openclaw/projects/webinti-town && git add server/src/types.ts
git commit -m "feat(server): add WorkstationState type + workstationId on PlayerState + workstations on RoomState"
```

---

## Task 2 : server/src/workstations.ts — interface Workstation + WORKSTATIONS placeholder + helper (TDD)

**Files:**
- Create: `server/src/workstations.ts`
- Create: `server/src/workstations.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `server/src/workstations.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { workstationIdForPoint, WORKSTATIONS } from './workstations.js';

describe('workstationIdForPoint — WORKSTATIONS vide', () => {
  it('retourne null pour n\'importe quel point quand le tableau est vide', () => {
    // Quand WORKSTATIONS = [] (placeholder), aucun point ne matche.
    if (WORKSTATIONS.length === 0) {
      expect(workstationIdForPoint(0, 0)).toBeNull();
      expect(workstationIdForPoint(99999, 99999)).toBeNull();
    }
  });
});

// Ces tests utilisent des postes de test injectés directement via la fonction interne.
// On importe aussi la fonction pure pour la tester isolément.
import { workstationIdForPointIn } from './workstations.js';
import type { Workstation } from './workstations.js';

const TEST_WS: readonly Workstation[] = [
  { id: 'poste-1', name: 'Poste 1', minX: 100, minY: 100, maxX: 200, maxY: 200 },
  { id: 'poste-2', name: 'Poste 2', minX: 300, minY: 100, maxX: 400, maxY: 200 },
];

describe('workstationIdForPointIn', () => {
  it('retourne l\'id si le point est dans la zone (centré)', () => {
    expect(workstationIdForPointIn(TEST_WS, 150, 150)).toBe('poste-1');
  });

  it('retourne l\'id pour poste-2', () => {
    expect(workstationIdForPointIn(TEST_WS, 350, 150)).toBe('poste-2');
  });

  it('retourne null si le point est hors de toute zone', () => {
    expect(workstationIdForPointIn(TEST_WS, 250, 150)).toBeNull();
  });

  it('frontière inclusive minX', () => {
    expect(workstationIdForPointIn(TEST_WS, 100, 150)).toBe('poste-1');
  });

  it('frontière inclusive maxX', () => {
    expect(workstationIdForPointIn(TEST_WS, 200, 150)).toBe('poste-1');
  });

  it('frontière inclusive minY', () => {
    expect(workstationIdForPointIn(TEST_WS, 150, 100)).toBe('poste-1');
  });

  it('frontière inclusive maxY', () => {
    expect(workstationIdForPointIn(TEST_WS, 150, 200)).toBe('poste-1');
  });

  it('un pixel hors minX → null', () => {
    expect(workstationIdForPointIn(TEST_WS, 99, 150)).toBeNull();
  });

  it('un pixel hors maxX → null', () => {
    expect(workstationIdForPointIn(TEST_WS, 201, 150)).toBeNull();
  });

  it('un pixel hors minY → null', () => {
    expect(workstationIdForPointIn(TEST_WS, 150, 99)).toBeNull();
  });

  it('un pixel hors maxY → null', () => {
    expect(workstationIdForPointIn(TEST_WS, 150, 201)).toBeNull();
  });

  it('retourne null si tableau vide', () => {
    expect(workstationIdForPointIn([], 0, 0)).toBeNull();
  });
});
```

- [ ] **Step 2 : Lancer les tests, s'attendre à des échecs**

```bash
cd /home/openclaw/projects/webinti-town/server && npx vitest run src/workstations.test.ts
```

Expected : tous les tests échouent (`Cannot find module './workstations.js'`).

- [ ] **Step 3 : Implémenter `server/src/workstations.ts`**

Créer `server/src/workstations.ts` :

```ts
export interface Workstation {
  id: string;    // ex: 'poste-1', 'poste-2'
  name: string;  // ex: 'Poste 1' (pour les toasts)
  minX: number;  // pixel, inclusive
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Tableau des postes de travail définis sur la map.
 * Laissé vide intentionnellement — à remplir après calibration en jeu
 * via le mode debug Shift+D. Voir la spec F6 pour la structure attendue.
 *
 * Format : { id: 'poste-1', name: 'Poste 1', minX: 384, minY: 96, maxX: 448, maxY: 160 }
 * 16 postes attendus au total (12 open-space + 1 salle blanche + 3 bureaux rouges).
 */
export const WORKSTATIONS: readonly Workstation[] = [
  // À calibrer via Shift+D en jeu. Exemple commenté :
  // { id: 'poste-1',  name: 'Poste 1',  minX: 384, minY:  96, maxX: 448, maxY: 160 },
];

/**
 * Fonction pure testable : cherche dans `workstations` le premier poste contenant (x, y).
 * Frontières inclusives des deux côtés.
 */
export function workstationIdForPointIn(
  workstations: readonly Workstation[],
  x: number,
  y: number,
): string | null {
  for (const w of workstations) {
    if (x >= w.minX && x <= w.maxX && y >= w.minY && y <= w.maxY) return w.id;
  }
  return null;
}

/**
 * Version raccourcie qui opère sur le tableau global WORKSTATIONS.
 */
export function workstationIdForPoint(x: number, y: number): string | null {
  return workstationIdForPointIn(WORKSTATIONS, x, y);
}
```

- [ ] **Step 4 : Lancer les tests, s'attendre à ce que tout soit vert**

```bash
cd /home/openclaw/projects/webinti-town/server && npx vitest run src/workstations.test.ts
```

Expected : tous les tests passent.

- [ ] **Step 5 : Commit**

```bash
cd /home/openclaw/projects/webinti-town && git add server/src/workstations.ts server/src/workstations.test.ts
git commit -m "feat(server): Workstation type + WORKSTATIONS placeholder + workstationIdForPoint (TDD)"
```

---

## Task 3 : WorkstationManager — claim/release/invite/uninvite + can-enter (TDD)

**Files:**
- Create: `server/src/workstations/WorkstationManager.ts`
- Create: `server/src/workstations/WorkstationManager.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `server/src/workstations/WorkstationManager.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { WorkstationManager } from './WorkstationManager.js';
import type { Workstation } from '../workstations.js';

// Postes de test
const WS: Workstation[] = [
  { id: 'p1', name: 'Poste 1', minX: 100, minY: 100, maxX: 200, maxY: 200 },
  { id: 'p2', name: 'Poste 2', minX: 300, minY: 100, maxX: 400, maxY: 200 },
];

// Joueurs fictifs
const ALICE   = { id: 'alice',   name: 'Alice' };
const BOB     = { id: 'bob',     name: 'Bob' };
const CHARLIE = { id: 'charlie', name: 'Charlie' };

// Coordonnées dans p1 et hors zone
const IN_P1  = { x: 150, y: 150 };
const IN_P2  = { x: 350, y: 150 };
const OUT    = { x: 250, y: 150 };

let m: WorkstationManager;
beforeEach(() => {
  m = new WorkstationManager(WS);
});

// --- claim ---

describe('claim', () => {
  it('claim OK : poste libre + joueur dans la zone', () => {
    const ok = m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    expect(ok).toBe(true);
    const ws = m.getState('p1')!;
    expect(ws.claimedBy).toBe(ALICE.id);
    expect(ws.claimedByName).toBe(ALICE.name);
    expect(ws.claimedAt).not.toBeNull();
  });

  it('claim échoue : poste déjà claimé', () => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    expect(m.claim('p1', BOB.id, BOB.name, IN_P1.x, IN_P1.y)).toBe(false);
  });

  it('claim échoue : joueur pas dans la zone', () => {
    expect(m.claim('p1', ALICE.id, ALICE.name, OUT.x, OUT.y)).toBe(false);
  });

  it('claim échoue : workstationId inconnu', () => {
    expect(m.claim('nope', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y)).toBe(false);
  });
});

// --- release ---

describe('release', () => {
  beforeEach(() => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    m.invite('p1', ALICE.id, BOB.id);
  });

  it('release OK par le claimer', () => {
    expect(m.release('p1', ALICE.id)).toBe(true);
    const ws = m.getState('p1')!;
    expect(ws.claimedBy).toBeNull();
    expect(ws.invitedPlayerIds).toHaveLength(0);
    expect(ws.claimedAt).toBeNull();
  });

  it('release efface aussi les invités', () => {
    m.release('p1', ALICE.id);
    expect(m.getState('p1')!.invitedPlayerIds).toHaveLength(0);
  });

  it('release échoue par un non-claimer', () => {
    expect(m.release('p1', BOB.id)).toBe(false);
    expect(m.getState('p1')!.claimedBy).toBe(ALICE.id);
  });

  it('release échoue si poste déjà libre', () => {
    m.release('p1', ALICE.id);
    expect(m.release('p1', ALICE.id)).toBe(false);
  });
});

// --- invite ---

describe('invite', () => {
  beforeEach(() => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
  });

  it('invite OK par le claimer', () => {
    expect(m.invite('p1', ALICE.id, BOB.id)).toBe(true);
    expect(m.getState('p1')!.invitedPlayerIds).toContain(BOB.id);
  });

  it('invite échoue par un non-claimer', () => {
    expect(m.invite('p1', BOB.id, CHARLIE.id)).toBe(false);
  });

  it('invite est idempotent (déjà invité → false)', () => {
    m.invite('p1', ALICE.id, BOB.id);
    expect(m.invite('p1', ALICE.id, BOB.id)).toBe(false);
  });

  it('invite échoue si poste libre', () => {
    m.release('p1', ALICE.id);
    expect(m.invite('p1', ALICE.id, BOB.id)).toBe(false);
  });

  it('invite échoue sur workstationId inconnu', () => {
    expect(m.invite('nope', ALICE.id, BOB.id)).toBe(false);
  });
});

// --- uninvite ---

describe('uninvite', () => {
  beforeEach(() => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    m.invite('p1', ALICE.id, BOB.id);
  });

  it('uninvite OK par le claimer', () => {
    expect(m.uninvite('p1', ALICE.id, BOB.id)).toBe(true);
    expect(m.getState('p1')!.invitedPlayerIds).not.toContain(BOB.id);
  });

  it('uninvite échoue par un non-claimer', () => {
    expect(m.uninvite('p1', BOB.id, BOB.id)).toBe(false);
    expect(m.getState('p1')!.invitedPlayerIds).toContain(BOB.id);
  });

  it('uninvite échoue si target pas dans la liste', () => {
    expect(m.uninvite('p1', ALICE.id, CHARLIE.id)).toBe(false);
  });
});

// --- canEnter ---

describe('canEnter', () => {
  it('poste libre → toujours true', () => {
    expect(m.canEnter('p1', CHARLIE.id)).toBe(true);
  });

  it('poste claimé par alice → alice peut entrer', () => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    expect(m.canEnter('p1', ALICE.id)).toBe(true);
  });

  it('poste claimé par alice → invité (bob) peut entrer', () => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    m.invite('p1', ALICE.id, BOB.id);
    expect(m.canEnter('p1', BOB.id)).toBe(true);
  });

  it('poste claimé par alice → charlie (non invité) ne peut pas entrer', () => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    expect(m.canEnter('p1', CHARLIE.id)).toBe(false);
  });

  it('workstationId inconnu → true (pas de restriction)', () => {
    expect(m.canEnter('nope', CHARLIE.id)).toBe(true);
  });
});

// --- isInsideAnyLockedWorkstation ---

describe('isInsideAnyLockedWorkstation', () => {
  it('aucun poste claimé → false pour n\'importe qui', () => {
    expect(m.isInsideAnyLockedWorkstation(BOB.id, IN_P1.x, IN_P1.y)).toBe(false);
  });

  it('poste claimé : non-autorisé à l\'intérieur → true (bloqué)', () => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    expect(m.isInsideAnyLockedWorkstation(BOB.id, IN_P1.x, IN_P1.y)).toBe(true);
  });

  it('poste claimé : claimer à l\'intérieur → false (autorisé)', () => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    expect(m.isInsideAnyLockedWorkstation(ALICE.id, IN_P1.x, IN_P1.y)).toBe(false);
  });

  it('poste claimé : invité à l\'intérieur → false (autorisé)', () => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    m.invite('p1', ALICE.id, BOB.id);
    expect(m.isInsideAnyLockedWorkstation(BOB.id, IN_P1.x, IN_P1.y)).toBe(false);
  });

  it('coordonnées hors de toute zone → false', () => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    expect(m.isInsideAnyLockedWorkstation(BOB.id, OUT.x, OUT.y)).toBe(false);
  });
});

// --- getAllStates ---

describe('getAllStates', () => {
  it('retourne un WorkstationState par entrée de WORKSTATIONS', () => {
    const states = m.getAllStates();
    expect(states).toHaveLength(WS.length);
    expect(states.every((s) => s.claimedBy === null)).toBe(true);
  });
});
```

- [ ] **Step 2 : Lancer les tests, s'attendre à des échecs**

```bash
cd /home/openclaw/projects/webinti-town/server && npx vitest run src/workstations/WorkstationManager.test.ts
```

Expected : tous les tests échouent (`Cannot find module './WorkstationManager.js'`).

- [ ] **Step 3 : Implémenter `WorkstationManager`**

Créer `server/src/workstations/WorkstationManager.ts` :

```ts
import type { WorkstationState } from '../types.js';
import type { Workstation } from '../workstations.js';
import { workstationIdForPointIn } from '../workstations.js';

export class WorkstationManager {
  private readonly workstations: readonly Workstation[];
  private readonly states = new Map<string, WorkstationState>();

  constructor(workstations: readonly Workstation[]) {
    this.workstations = workstations;
    for (const w of workstations) {
      this.states.set(w.id, {
        id: w.id,
        claimedBy: null,
        claimedByName: null,
        invitedPlayerIds: [],
        claimedAt: null,
      });
    }
  }

  /** Retourne l'état d'un poste, ou undefined si l'id est inconnu. */
  getState(workstationId: string): WorkstationState | undefined {
    return this.states.get(workstationId);
  }

  /** Retourne une copie de tous les états (ordre stable = ordre de WORKSTATIONS). */
  getAllStates(): WorkstationState[] {
    return this.workstations.map((w) => ({ ...this.states.get(w.id)! }));
  }

  /**
   * Tente de revendiquer un poste.
   * Conditions : poste libre ET (x, y) dans la zone.
   * Retourne true si réussi.
   */
  claim(workstationId: string, playerId: string, playerName: string, x: number, y: number): boolean {
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== null) return false;
    // Le joueur doit être physiquement dans la zone.
    if (workstationIdForPointIn(this.workstations, x, y) !== workstationId) return false;
    ws.claimedBy = playerId;
    ws.claimedByName = playerName;
    ws.claimedAt = Date.now();
    return true;
  }

  /**
   * Tente de libérer un poste.
   * Conditions : acteur === claimer.
   * Retourne true si réussi. Efface aussi les invités.
   */
  release(workstationId: string, playerId: string): boolean {
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== playerId) return false;
    ws.claimedBy = null;
    ws.claimedByName = null;
    ws.invitedPlayerIds = [];
    ws.claimedAt = null;
    return true;
  }

  /**
   * Invite un joueur dans le poste.
   * Conditions : acteur === claimer ET target pas déjà invité.
   * Retourne true si réussi.
   */
  invite(workstationId: string, actorId: string, targetId: string): boolean {
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== actorId) return false;
    if (ws.invitedPlayerIds.includes(targetId)) return false;
    ws.invitedPlayerIds.push(targetId);
    return true;
  }

  /**
   * Désinvite un joueur du poste.
   * Conditions : acteur === claimer ET target dans la liste.
   * Retourne true si réussi.
   */
  uninvite(workstationId: string, actorId: string, targetId: string): boolean {
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== actorId) return false;
    const idx = ws.invitedPlayerIds.indexOf(targetId);
    if (idx === -1) return false;
    ws.invitedPlayerIds.splice(idx, 1);
    return true;
  }

  /**
   * Vérifie si un joueur peut entrer dans un poste spécifique.
   * - Poste libre → true
   * - Poste claimé → uniquement claimer ou invité
   */
  canEnter(workstationId: string, playerId: string): boolean {
    const ws = this.states.get(workstationId);
    if (!ws) return true;   // zone inconnue → pas de restriction
    if (ws.claimedBy === null) return true;
    if (ws.claimedBy === playerId) return true;
    return ws.invitedPlayerIds.includes(playerId);
  }

  /**
   * Retourne true si (x, y) se trouve dans un poste verrouillé
   * pour lequel playerId n'est PAS autorisé.
   * Utilisé par updatePlayerPosition pour bloquer le mouvement.
   */
  isInsideAnyLockedWorkstation(playerId: string, x: number, y: number): boolean {
    const wsId = workstationIdForPointIn(this.workstations, x, y);
    if (wsId === null) return false;
    return !this.canEnter(wsId, playerId);
  }
}
```

- [ ] **Step 4 : Lancer les tests, s'attendre à ce que tout soit vert**

```bash
cd /home/openclaw/projects/webinti-town/server && npx vitest run src/workstations/WorkstationManager.test.ts
```

Expected : tous les tests passent.

- [ ] **Step 5 : Commit**

```bash
cd /home/openclaw/projects/webinti-town && git add server/src/workstations/WorkstationManager.ts server/src/workstations/WorkstationManager.test.ts
git commit -m "feat(server): WorkstationManager claim/release/invite/uninvite/canEnter (TDD)"
```

---

## Task 4 : RoomManager — intégrer WorkstationManager + updatePlayerPosition étendu

**Files:**
- Modify: `server/src/rooms/RoomManager.ts`

- [ ] **Step 1 : Importer et instancier WorkstationManager**

Au sommet de `server/src/rooms/RoomManager.ts`, ajouter l'import :

```ts
import { WorkstationManager } from '../workstations/WorkstationManager.js';
import { WORKSTATIONS } from '../workstations.js';
```

Dans les deux sites de construction de `RoomState` (`createRoom` et `ensureRoom`), après `kanbanStore`, ajouter :

```ts
    // Initialiser les états de postes depuis le tableau global WORKSTATIONS.
    // Restart serveur = tous les postes libres (pas de persistance, comportement voulu).
    const workstationManager = new WorkstationManager(WORKSTATIONS);
    const workstations = new Map(
      workstationManager.getAllStates().map((s) => [s.id, s]),
    );
```

Et ajouter `workstations` dans l'objet `RoomState` passé à `this.rooms.set(...)` :

```ts
      workstations,
```

> Note : on stocke `workstationManager` comme variable locale dans chaque closure, mais pour y accéder depuis les méthodes on doit l'attacher au `RoomState`. L'approche la plus propre est d'ajouter un champ `workstationManager` sur `RoomState`.

- [ ] **Step 2 : Ajouter `workstationManager` sur `RoomState`**

Dans `server/src/types.ts`, ajouter après `workstations` :

```ts
  workstationManager: import('../workstations/WorkstationManager.js').WorkstationManager;
```

Ensuite dans `RoomManager.ts`, mettre l'instance dans le state :

```ts
      workstationManager,
```

- [ ] **Step 3 : Étendre `updatePlayerPosition`**

Remplacer l'implémentation actuelle de `updatePlayerPosition` par :

```ts
  updatePlayerPosition(
    slug: string,
    playerId: string,
    x: number,
    y: number,
    direction: Direction,
    isMoving: boolean,
  ): PlayerState | undefined {
    const room = this.rooms.get(slug);
    if (!room) return undefined;
    const player = room.players.get(playerId);
    if (!player) return undefined;

    // Bloquer les moves dans une zone verrouillée non autorisée.
    // Le joueur reste à sa position précédente (rubber-band côté client).
    if (room.workstationManager.isInsideAnyLockedWorkstation(playerId, x, y)) {
      // On met quand même à jour la direction + isMoving pour la fluidité visuelle.
      player.direction = direction;
      player.isMoving = isMoving;
      return player;   // x, y inchangés → le serveur répond avec l'ancienne position
    }

    player.x = x;
    player.y = y;
    player.direction = direction;
    player.isMoving = isMoving;
    // Recalculer workstationId à partir des nouvelles coords.
    player.workstationId = room.workstationManager.isInsideAnyLockedWorkstation(playerId, x, y)
      ? null
      : (workstationIdForPointIn(WORKSTATIONS, x, y) ?? null);
    return player;
  }
```

Importer `workstationIdForPointIn` en haut du fichier :

```ts
import { WORKSTATIONS, workstationIdForPointIn } from '../workstations.js';
```

Mettre aussi à jour `addPlayer` pour initialiser `workstationId: null` dans le `PlayerState` créé.

- [ ] **Step 4 : Vérification de type + tests**

```bash
cd /home/openclaw/projects/webinti-town/server && npx tsc --noEmit && npx vitest run
```

Expected : aucune erreur TS, tous les tests existants et nouveaux passent.

- [ ] **Step 5 : Commit**

```bash
cd /home/openclaw/projects/webinti-town && git add server/src/types.ts server/src/rooms/RoomManager.ts
git commit -m "feat(server): wire WorkstationManager per room + updatePlayerPosition rejects locked zones"
```

---

## Task 5 : Server socket handlers — workstation:* + workstation:initial au join

**Files:**
- Modify: `server/src/socket/handlers.ts`

Les handlers suivent exactement le même pattern que les handlers `kanban:*` déjà en place.

- [ ] **Step 1 : Ajouter les 4 handlers dans le bloc `io.on('connection', ...)`**

Après les handlers `kanban:*` existants, insérer :

```ts
    // ─── workstation:claim ───────────────────────────────────────────────────
    socket.on('workstation:claim', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const player = room.players.get(session.playerId);
      if (!player) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const workstationId = typeof p.workstationId === 'string' ? p.workstationId : '';
      if (!workstationId) return;
      const ok = room.workstationManager.claim(
        workstationId, session.playerId, player.name, player.x, player.y,
      );
      if (!ok) return;
      // Synchroniser la Map workstations depuis WorkstationManager.
      for (const s of room.workstationManager.getAllStates()) {
        room.workstations.set(s.id, s);
      }
      const ws = room.workstationManager.getState(workstationId)!;
      io.to(session.roomSlug).emit('workstation:state', { ...ws });
    });

    // ─── workstation:release ─────────────────────────────────────────────────
    socket.on('workstation:release', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const workstationId = typeof p.workstationId === 'string' ? p.workstationId : '';
      if (!workstationId) return;
      const ok = room.workstationManager.release(workstationId, session.playerId);
      if (!ok) return;
      for (const s of room.workstationManager.getAllStates()) {
        room.workstations.set(s.id, s);
      }
      const ws = room.workstationManager.getState(workstationId)!;
      io.to(session.roomSlug).emit('workstation:state', { ...ws });
    });

    // ─── workstation:invite ───────────────────────────────────────────────────
    socket.on('workstation:invite', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const claimer = room.players.get(session.playerId);
      if (!claimer) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const workstationId = typeof p.workstationId === 'string' ? p.workstationId : '';
      const targetPlayerId = typeof p.targetPlayerId === 'string' ? p.targetPlayerId : '';
      if (!workstationId || !targetPlayerId) return;
      // Vérifier que le target existe dans la room.
      const target = room.players.get(targetPlayerId);
      if (!target) return;
      const ok = room.workstationManager.invite(workstationId, session.playerId, targetPlayerId);
      if (!ok) return;
      for (const s of room.workstationManager.getAllStates()) {
        room.workstations.set(s.id, s);
      }
      const ws = room.workstationManager.getState(workstationId)!;
      // Broadcast l'état mis à jour à toute la room.
      io.to(session.roomSlug).emit('workstation:state', { ...ws });
      // Unicast toast d'invitation au target.
      const workstationDef = WORKSTATIONS.find((w) => w.id === workstationId);
      io.to(target.socketId).emit('workstation:invite', {
        fromPlayerId: session.playerId,
        fromPlayerName: claimer.name,
        workstationId,
        workstationName: workstationDef?.name ?? workstationId,
      });
    });

    // ─── workstation:uninvite ─────────────────────────────────────────────────
    socket.on('workstation:uninvite', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const workstationId = typeof p.workstationId === 'string' ? p.workstationId : '';
      const targetPlayerId = typeof p.targetPlayerId === 'string' ? p.targetPlayerId : '';
      if (!workstationId || !targetPlayerId) return;
      const ok = room.workstationManager.uninvite(workstationId, session.playerId, targetPlayerId);
      if (!ok) return;
      for (const s of room.workstationManager.getAllStates()) {
        room.workstations.set(s.id, s);
      }
      const ws = room.workstationManager.getState(workstationId)!;
      io.to(session.roomSlug).emit('workstation:state', { ...ws });
    });
```

Ajouter l'import de `WORKSTATIONS` en haut du fichier si pas déjà présent :

```ts
import { WORKSTATIONS } from '../workstations.js';
```

- [ ] **Step 2 : Envoyer `workstation:initial` au join**

Dans le handler `join_room`, juste après `socket.emit('kanban:state', ...)`, ajouter :

```ts
      socket.emit('workstation:initial', {
        workstations: room.workstationManager.getAllStates(),
      });
```

- [ ] **Step 3 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/server && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
cd /home/openclaw/projects/webinti-town && git add server/src/socket/handlers.ts
git commit -m "feat(server): socket handlers workstation:claim/release/invite/uninvite + initial on join"
```

---

## Task 6 : Server socket handler — speaking_state relay (rate-limit 5/s)

**Files:**
- Modify: `server/src/socket/handlers.ts`
- Modify: `server/src/socket/handlers.ts` (SocketSession type)

`speaking_state` est un event léger (boolean) qui n'a pas d'état persistant côté serveur — on rebroadcast simplement à toute la room après vérification du rate-limit.

- [ ] **Step 1 : Ajouter `speakingTimestamps` à `SocketSession`**

Trouver l'interface `SocketSession` (autour de la ligne 130) et ajouter le champ :

```ts
  speakingTimestamps: number[];
```

- [ ] **Step 2 : Initialiser dans `join_room`**

Dans le bloc `sessions.set(socket.id, { ... })` à la fin du handler `join_room`, ajouter :

```ts
        speakingTimestamps: [],
```

- [ ] **Step 3 : Ajouter le handler**

Après les handlers `workstation:*`, insérer :

```ts
    // ─── speaking_state ───────────────────────────────────────────────────────
    // Relay simple : le client envoie { speaking: boolean }, on rebroadcast à
    // toute la room avec { playerId, speaking }. Rate-limit : 5/s/socket.
    socket.on('speaking_state', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (!rateLimit(session.speakingTimestamps, 5)) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const speaking = typeof p.speaking === 'boolean' ? p.speaking : false;
      socket.to(session.roomSlug).emit('speaking_state', {
        playerId: session.playerId,
        speaking,
      });
    });
```

- [ ] **Step 4 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/server && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 5 : Commit**

```bash
cd /home/openclaw/projects/webinti-town && git add server/src/socket/handlers.ts
git commit -m "feat(server): speaking_state relay (rate-limited 5/s)"
```

---

## Task 7 : Client types mirror + store slice

**Files:**
- Modify: `client/src/types.ts`
- Modify: `client/src/stores/gameStore.ts`

- [ ] **Step 1 : Ajouter `WorkstationState` à `client/src/types.ts`**

À la fin de `client/src/types.ts`, après `PlayerMovePayload`, ajouter :

```ts
export interface WorkstationState {
  id: string;
  claimedBy: string | null;
  claimedByName: string | null;
  invitedPlayerIds: string[];
  claimedAt: number | null;
}
```

Étendre aussi `PlayerState` (client) pour ajouter le champ `workstationId` :

```ts
export interface PlayerState {
  playerId: string;
  name: string;
  appearance: Appearance;
  x: number;
  y: number;
  direction: Direction;
  isMoving: boolean;
  isGhost?: boolean;
  joinedAt?: number;
  presence?: Presence;
  workstationId?: string | null;    // calculé server-side
}
```

- [ ] **Step 2 : Ajouter le slice dans `gameStore.ts`**

Dans l'interface `GameStore`, ajouter après `hostPlayerId` :

```ts
  workstations: Map<string, WorkstationState>;
  setWorkstationState: (ws: WorkstationState) => void;
  setWorkstationsInitial: (list: WorkstationState[]) => void;
  nearbyWorkstationId: string | null;
  setNearbyWorkstationId: (id: string | null) => void;
  pendingInvite: { fromPlayerName: string; workstationId: string; workstationName: string } | null;
  setPendingInvite: (inv: { fromPlayerName: string; workstationId: string; workstationName: string } | null) => void;
```

Importer le type en haut de `gameStore.ts` :

```ts
import type { WorkstationState } from '../types';
```

Dans l'implémentation `create((set) => ({ ... }))`, ajouter les valeurs initiales et les setters :

```ts
  workstations: new Map<string, WorkstationState>(),
  setWorkstationState: (ws) =>
    set((s) => {
      const next = new Map(s.workstations);
      next.set(ws.id, ws);
      return { workstations: next };
    }),
  setWorkstationsInitial: (list) =>
    set({ workstations: new Map(list.map((ws) => [ws.id, ws])) }),
  nearbyWorkstationId: null,
  setNearbyWorkstationId: (id) => set({ nearbyWorkstationId: id }),
  pendingInvite: null,
  setPendingInvite: (inv) => set({ pendingInvite: inv }),
```

Dans l'action `reset()`, ajouter :

```ts
      workstations: new Map(),
      nearbyWorkstationId: null,
      pendingInvite: null,
```

- [ ] **Step 3 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
cd /home/openclaw/projects/webinti-town && git add client/src/types.ts client/src/stores/gameStore.ts
git commit -m "feat(client): WorkstationState type + store slice (workstations, nearbyWorkstationId, pendingInvite)"
```

---

## Task 8 : Client SocketManager — emits + listeners workstation:* et speaking_state

**Files:**
- Modify: `client/src/network/SocketManager.ts`

Suivre exactement le même pattern que les méthodes `kanban*` et `sendPresenceSet` déjà en place.

- [ ] **Step 1 : Ajouter les types payload en haut du fichier**

Après les interfaces existantes (`TypingStatePayload`, etc.), ajouter :

```ts
interface WorkstationStatePayload {
  id: string;
  claimedBy: string | null;
  claimedByName: string | null;
  invitedPlayerIds: string[];
  claimedAt: number | null;
}

interface WorkstationInvitePayload {
  fromPlayerId: string;
  fromPlayerName: string;
  workstationId: string;
  workstationName: string;
}

interface SpeakingStatePayload {
  playerId: string;
  speaking: boolean;
}
```

- [ ] **Step 2 : Ajouter les listener sets**

Dans la classe `SocketManager`, après les listener sets existants (`typingStateListeners`, etc.), ajouter :

```ts
  private workstationStateListeners = new Set<(ws: WorkstationStatePayload) => void>();
  private workstationInviteListeners = new Set<(inv: WorkstationInvitePayload) => void>();
  private speakingStateListeners = new Set<(p: SpeakingStatePayload) => void>();
```

- [ ] **Step 3 : Brancher les listeners dans `connect()`**

Dans la méthode `connect()`, juste après les listeners `kanban:state` existants, ajouter :

```ts
    socket.on('workstation:initial', (payload: { workstations: WorkstationStatePayload[] }) => {
      if (!payload || !Array.isArray(payload.workstations)) return;
      useGameStore.getState().setWorkstationsInitial(payload.workstations);
    });

    socket.on('workstation:state', (payload: WorkstationStatePayload) => {
      if (!payload || typeof payload.id !== 'string') return;
      useGameStore.getState().setWorkstationState(payload);
      for (const l of this.workstationStateListeners) l(payload);
    });

    socket.on('workstation:invite', (payload: WorkstationInvitePayload) => {
      if (!payload || typeof payload.workstationId !== 'string') return;
      useGameStore.getState().setPendingInvite({
        fromPlayerName: payload.fromPlayerName,
        workstationId: payload.workstationId,
        workstationName: payload.workstationName,
      });
      for (const l of this.workstationInviteListeners) l(payload);
    });

    socket.on('speaking_state', (payload: SpeakingStatePayload) => {
      if (!payload || typeof payload.playerId !== 'string') return;
      for (const l of this.speakingStateListeners) l(payload);
    });
```

- [ ] **Step 4 : Ajouter les méthodes emit et onXxx**

À la fin de la classe, aux côtés de `kanbanCreate`, etc. :

```ts
  workstationClaim(workstationId: string): void {
    this.socket?.emit('workstation:claim', { workstationId });
  }

  workstationRelease(workstationId: string): void {
    this.socket?.emit('workstation:release', { workstationId });
  }

  workstationInvite(workstationId: string, targetPlayerId: string): void {
    this.socket?.emit('workstation:invite', { workstationId, targetPlayerId });
  }

  workstationUninvite(workstationId: string, targetPlayerId: string): void {
    this.socket?.emit('workstation:uninvite', { workstationId, targetPlayerId });
  }

  sendSpeakingState(speaking: boolean): void {
    this.socket?.emit('speaking_state', { speaking });
  }

  onWorkstationState(cb: (ws: WorkstationStatePayload) => void): () => void {
    this.workstationStateListeners.add(cb);
    return () => this.workstationStateListeners.delete(cb);
  }

  onWorkstationInvite(cb: (inv: WorkstationInvitePayload) => void): () => void {
    this.workstationInviteListeners.add(cb);
    return () => this.workstationInviteListeners.delete(cb);
  }

  onSpeakingState(cb: (p: SpeakingStatePayload) => void): () => void {
    this.speakingStateListeners.add(cb);
    return () => this.speakingStateListeners.delete(cb);
  }
```

- [ ] **Step 5 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

- [ ] **Step 6 : Commit**

```bash
cd /home/openclaw/projects/webinti-town && git add client/src/network/SocketManager.ts
git commit -m "feat(client): SocketManager workstation emits + listeners + speaking_state relay"
```

---

## Task 9 : Client Phaser WorkstationOverlay — contours colorés

**Files:**
- Create: `client/src/phaser/WorkstationOverlay.ts`

L'overlay est un objet Phaser `Graphics` qui redessine tous les contours à chaque `update()`. Il est instancié par `GameScene` lors du `create()`, et son `update(workstations)` est appelé depuis le `update()` de la scène.

- [ ] **Step 1 : Créer `client/src/phaser/WorkstationOverlay.ts`**

```ts
import Phaser from 'phaser';
import type { WorkstationState } from '../types';
import { WORKSTATIONS } from '../workstations';

// Couleurs par état du poste (format Phaser uint32 ARGB)
const COLOR_FREE   = 0x22c55e; // vert  — poste libre
const COLOR_MINE   = 0x3b82f6; // bleu  — revendiqué par moi
const COLOR_LOCKED = 0xef4444; // rouge — revendiqué par quelqu'un d'autre
const ALPHA_FILL   = 0.08;
const ALPHA_STROKE = 0.6;
const LINE_WIDTH   = 2;

export class WorkstationOverlay {
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    // Depth entre le sol (0) et les sprites joueurs (9).
    this.gfx = scene.add.graphics().setDepth(5);
  }

  /**
   * Appelé à chaque frame depuis GameScene.update().
   * @param workstations  Map<id, WorkstationState> du store.
   * @param localPlayerId Identifiant du joueur local (pour distinguer "mine").
   */
  update(workstations: Map<string, WorkstationState>, localPlayerId: string | null): void {
    this.gfx.clear();

    for (const def of WORKSTATIONS) {
      const state = workstations.get(def.id);

      let color: number;
      if (!state || state.claimedBy === null) {
        color = COLOR_FREE;
      } else if (state.claimedBy === localPlayerId) {
        color = COLOR_MINE;
      } else {
        color = COLOR_LOCKED;
      }

      const w = def.maxX - def.minX;
      const h = def.maxY - def.minY;

      this.gfx.fillStyle(color, ALPHA_FILL);
      this.gfx.fillRect(def.minX, def.minY, w, h);

      this.gfx.lineStyle(LINE_WIDTH, color, ALPHA_STROKE);
      this.gfx.strokeRect(def.minX, def.minY, w, h);
    }
  }

  destroy(): void {
    this.gfx.destroy();
  }
}
```

- [ ] **Step 2 : Commit**

```bash
cd /home/openclaw/projects/webinti-town && git add client/src/phaser/WorkstationOverlay.ts
git commit -m "feat(client): WorkstationOverlay — colored zone outlines (green/blue/red)"
```

---

## Task 10 : GameScene — intégrer WorkstationOverlay + proximité + colliders + debug Shift+D

**Files:**
- Modify: `client/src/phaser/scenes/GameScene.ts`
- Modify: `client/src/workstations.ts` (créer le miroir client)

- [ ] **Step 1 : Créer le miroir client `client/src/workstations.ts`**

Le client a besoin de la même liste `WORKSTATIONS` pour afficher les contours et pour le debug.

Créer `client/src/workstations.ts` :

```ts
/**
 * Miroir lecture-seule du tableau de postes de travail (côté client).
 * Synchroniser avec server/src/workstations.ts à chaque ajout de poste.
 * Laisser vide tant que les coordonnées n'ont pas été calibrées via Shift+D.
 */
export interface Workstation {
  id: string;
  name: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const WORKSTATIONS: readonly Workstation[] = [
  // À calibrer via Shift+D en jeu.
  // { id: 'poste-1', name: 'Poste 1', minX: 384, minY: 96, maxX: 448, maxY: 160 },
];
```

- [ ] **Step 2 : Monter WorkstationOverlay + ajouter les propriétés privées dans GameScene**

Dans `client/src/phaser/scenes/GameScene.ts`, ajouter l'import :

```ts
import { WorkstationOverlay } from '../WorkstationOverlay';
import { WORKSTATIONS } from '../../workstations';
```

Dans la classe `GameScene`, ajouter les champs privés après `lastLocalPresence` :

```ts
  private workstationOverlay?: WorkstationOverlay;
  private debugMode = false;
  private debugText?: Phaser.GameObjects.Text;
  private debugZoneGfx?: Phaser.GameObjects.Graphics;
  private shiftKey?: Phaser.Input.Keyboard.Key;
  private dKey?: Phaser.Input.Keyboard.Key;
  private lastShiftDCombo = false;
  private unsubWorkstations?: () => void;
```

Dans `create()`, après les autres initialisations de touches :

```ts
    // WorkstationOverlay
    this.workstationOverlay = new WorkstationOverlay(this);

    // Debug Shift+D
    this.shiftKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.dKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.D);
```

Dans le bloc `SHUTDOWN` :

```ts
      this.workstationOverlay?.destroy();
      this.debugText?.destroy();
      this.debugZoneGfx?.destroy();
      this.unsubWorkstations?.();
```

- [ ] **Step 3 : Appeler overlay.update() et gérer le debug dans update()**

Dans la méthode `update()` de `GameScene`, après `this.updateObjectProximity()`, ajouter :

```ts
    // WorkstationOverlay — redessine les contours à chaque frame.
    const storeState = useGameStore.getState();
    const localId = storeState.localPlayerId;
    this.workstationOverlay?.update(storeState.workstations, localId);

    // Détection proximité poste de travail (pour WorkstationPanel).
    if (this.player) {
      const px = this.player.sprite.x;
      const py = this.player.sprite.y;
      const PROXIMITY_RADIUS = 48; // px
      let nearestId: string | null = null;
      let nearestDist = Infinity;
      for (const def of WORKSTATIONS) {
        // Centre du poste
        const cx = (def.minX + def.maxX) / 2;
        const cy = (def.minY + def.maxY) / 2;
        const dx = px - cx;
        const dy = py - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Ou être à l'intérieur : vérifier si px,py est dans la zone (+ buffer)
        const inZone =
          px >= def.minX - PROXIMITY_RADIUS &&
          px <= def.maxX + PROXIMITY_RADIUS &&
          py >= def.minY - PROXIMITY_RADIUS &&
          py <= def.maxY + PROXIMITY_RADIUS;
        if (inZone && dist < nearestDist) {
          nearestDist = dist;
          nearestId = def.id;
        }
      }
      if (nearestId !== storeState.nearbyWorkstationId) {
        storeState.setNearbyWorkstationId(nearestId);
      }
    }

    // Debug Shift+D — toggle affichage coords + zones
    const shiftDown = this.shiftKey?.isDown ?? false;
    const dDown = !!this.dKey?.isDown;
    const combo = shiftDown && dDown;
    if (combo && !this.lastShiftDCombo) {
      this.debugMode = !this.debugMode;
      if (!this.debugMode) {
        this.debugText?.setVisible(false);
        this.debugZoneGfx?.clear();
      }
    }
    this.lastShiftDCombo = combo;

    if (this.debugMode && this.player) {
      const px = Math.round(this.player.sprite.x);
      const py = Math.round(this.player.sprite.y);
      const tx = Math.floor(px / 32);
      const ty = Math.floor(py / 32);
      const workstationId = storeState.players.get(localId ?? '')?.workstationId ?? 'null';
      const label = `pixel:(${px},${py})  tile:(${tx},${ty})  ws:${workstationId}`;

      if (!this.debugText) {
        this.debugText = this.add.text(8, 8, '', {
          fontSize: '12px', fontFamily: 'monospace',
          color: '#ffffff', backgroundColor: '#000000aa',
          padding: { left: 4, right: 4, top: 2, bottom: 2 },
        }).setScrollFactor(0).setDepth(50);
      }
      this.debugText.setText(label).setVisible(true);

      // Redessiner les zones de debug (plus opaque que l'overlay normal)
      if (!this.debugZoneGfx) {
        this.debugZoneGfx = this.add.graphics().setDepth(49);
      }
      this.debugZoneGfx.clear();
      for (const def of WORKSTATIONS) {
        this.debugZoneGfx.lineStyle(1, 0xffd700, 0.9);
        this.debugZoneGfx.strokeRect(def.minX, def.minY, def.maxX - def.minX, def.maxY - def.minY);
        this.debugZoneGfx.fillStyle(0xffd700, 0.15);
        this.debugZoneGfx.fillRect(def.minX, def.minY, def.maxX - def.minX, def.maxY - def.minY);
        // Label id
        this.debugZoneGfx.fillStyle(0x000000, 0);   // reset fill pour le texte séparé
      }
    }
```

- [ ] **Step 4 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 5 : Commit**

```bash
cd /home/openclaw/projects/webinti-town && git add client/src/workstations.ts client/src/phaser/WorkstationOverlay.ts client/src/phaser/scenes/GameScene.ts
git commit -m "feat(client): WorkstationOverlay + proximité poste + debug Shift+D"
```

---

## Task 11 : Client React WorkstationPanel — Revendiquer / Libérer / Inviter

**Files:**
- Create: `client/src/react/components/WorkstationPanel.tsx`
- Modify: `client/src/react/HUD.tsx`

Le panel est affiché quand `nearbyWorkstationId !== null`. Il flotte en bas à gauche de l'écran (similaire aux autres panels flottants dans le HUD).

- [ ] **Step 1 : Créer `WorkstationPanel.tsx`**

```tsx
import { useGameStore } from '../../stores/gameStore';
import { socketManager } from '../../network/SocketManager';
import { WORKSTATIONS } from '../../workstations';

export function WorkstationPanel() {
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const nearbyId      = useGameStore((s) => s.nearbyWorkstationId);
  const workstations  = useGameStore((s) => s.workstations);
  const players       = useGameStore((s) => s.players);

  if (!nearbyId || !localPlayerId) return null;

  const ws    = workstations.get(nearbyId);
  const def   = WORKSTATIONS.find((w) => w.id === nearbyId);
  const name  = def?.name ?? nearbyId;

  const isFree      = !ws || ws.claimedBy === null;
  const isMine      = !!ws && ws.claimedBy === localPlayerId;
  const claimerName = ws?.claimedByName ?? '?';

  // Liste des joueurs dans la room (pour "Inviter"), sauf moi et déjà invités
  const invitedIds  = ws?.invitedPlayerIds ?? [];
  const candidates  = Array.from(players.values()).filter(
    (p) => p.playerId !== localPlayerId && !invitedIds.includes(p.playerId),
  );

  const handleClaim   = () => socketManager.workstationClaim(nearbyId);
  const handleRelease = () => socketManager.workstationRelease(nearbyId);
  const handleInvite  = (targetId: string) => socketManager.workstationInvite(nearbyId, targetId);
  const handleUninvite = (targetId: string) => socketManager.workstationUninvite(nearbyId, targetId);

  return (
    <div className="pointer-events-auto fixed bottom-4 left-4 z-30 w-72 rounded-xl bg-slate-900/95 p-4 text-slate-100 ring-1 ring-white/10 shadow-2xl">
      {/* En-tête */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{name}</h3>
        {isFree && (
          <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-400">Libre</span>
        )}
        {isMine && (
          <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">Revendiqué</span>
        )}
        {!isFree && !isMine && (
          <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-400">Occupé</span>
        )}
      </div>

      {/* Action principale */}
      {isFree && (
        <button
          onClick={handleClaim}
          className="mb-3 w-full rounded-lg bg-green-600 py-2 text-sm font-semibold hover:bg-green-500 active:scale-95"
        >
          Revendiquer cet espace
        </button>
      )}
      {isMine && (
        <button
          onClick={handleRelease}
          className="mb-3 w-full rounded-lg bg-red-600 py-2 text-sm font-semibold hover:bg-red-500 active:scale-95"
        >
          Libérer l'espace
        </button>
      )}
      {!isFree && !isMine && (
        <p className="mb-3 text-xs text-slate-400">
          Revendiqué par <span className="font-semibold text-slate-200">{claimerName}</span>
        </p>
      )}

      {/* Section invités — visible uniquement si je suis le claimer */}
      {isMine && (
        <>
          {invitedIds.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Avec :</p>
              <ul className="flex flex-col gap-1">
                {invitedIds.map((id) => {
                  const p = players.get(id);
                  return (
                    <li key={id} className="flex items-center justify-between text-xs">
                      <span>{p?.name ?? id}</span>
                      <button
                        onClick={() => handleUninvite(id)}
                        className="rounded bg-white/10 px-2 py-0.5 text-xs hover:bg-white/20"
                        title="Désinviter"
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {candidates.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Inviter :</p>
              <ul className="flex flex-col gap-1">
                {candidates.map((p) => (
                  <li key={p.playerId} className="flex items-center justify-between text-xs">
                    <span>{p.name}</span>
                    <button
                      onClick={() => handleInvite(p.playerId)}
                      className="rounded bg-indigo-600 px-2 py-0.5 text-xs hover:bg-indigo-500"
                    >
                      Inviter
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {candidates.length === 0 && invitedIds.length === 0 && (
            <p className="text-xs text-slate-500">Aucun autre joueur dans la room.</p>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2 : Monter dans HUD**

Dans `client/src/react/HUD.tsx`, ajouter l'import :

```tsx
import { WorkstationPanel } from './components/WorkstationPanel';
```

Et dans le JSX du HUD, aux côtés de `<KanbanModal />`, ajouter :

```tsx
      <WorkstationPanel />
```

- [ ] **Step 3 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

- [ ] **Step 4 : Commit**

```bash
cd /home/openclaw/projects/webinti-town && git add client/src/react/components/WorkstationPanel.tsx client/src/react/HUD.tsx
git commit -m "feat(client): WorkstationPanel — Revendiquer/Libérer/Inviter/Désinviter"
```

---

## Task 12 : Client React WorkstationInviteToast — toast 30 s avec "Aller au poste"

**Files:**
- Create: `client/src/react/components/WorkstationInviteToast.tsx`
- Modify: `client/src/react/HUD.tsx`

- [ ] **Step 1 : Créer `WorkstationInviteToast.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { useGameStore } from '../../stores/gameStore';

const TOAST_DURATION_MS = 30_000;

export function WorkstationInviteToast() {
  const invite = useGameStore((s) => s.pendingInvite);
  const clear  = useGameStore((s) => s.setPendingInvite);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Démarrer / réinitialiser le timer auto-dismiss à 30 s à chaque nouvelle invitation.
  useEffect(() => {
    if (!invite) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => clear(null), TOAST_DURATION_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [invite, clear]);

  if (!invite) return null;

  const { fromPlayerName, workstationName } = invite;

  return (
    <div className="pointer-events-auto fixed bottom-4 right-4 z-50 w-80 rounded-xl bg-indigo-900/95 p-4 text-slate-100 ring-1 ring-indigo-400/30 shadow-2xl">
      <p className="mb-3 text-sm">
        <span className="font-semibold text-indigo-300">{fromPlayerName}</span>{' '}
        t'invite à rejoindre{' '}
        <span className="font-semibold text-white">{workstationName}</span>.
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => clear(null)}
          className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold hover:bg-indigo-500 active:scale-95"
        >
          Aller au poste
        </button>
        <button
          onClick={() => clear(null)}
          className="flex-1 rounded-lg bg-white/10 py-2 text-sm hover:bg-white/20 active:scale-95"
        >
          Ignorer
        </button>
      </div>
    </div>
  );
}
```

> Note : les deux boutons appellent `clear(null)`. "Aller au poste" ferme juste le toast — le joueur marche à pied vers le poste. L'invitation est déjà enregistrée côté serveur dans `invitedPlayerIds`, donc le serveur l'autorisera à entrer dès qu'il sera dans la zone.

- [ ] **Step 2 : Monter dans HUD**

```tsx
import { WorkstationInviteToast } from './components/WorkstationInviteToast';
// ...
      <WorkstationInviteToast />
```

- [ ] **Step 3 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

- [ ] **Step 4 : Commit**

```bash
cd /home/openclaw/projects/webinti-town && git add client/src/react/components/WorkstationInviteToast.tsx client/src/react/HUD.tsx
git commit -m "feat(client): WorkstationInviteToast — persistent toast 30s avec Aller/Ignorer"
```

---

## Task 13 : Client Phaser speech bubble — setSpeaking sur Player + RemotePlayer

**Files:**
- Modify: `client/src/phaser/entities/Player.ts`
- Modify: `client/src/phaser/entities/RemotePlayer.ts`

La bulle 💬 suit exactement le même pattern que `setTyping` dans `RemotePlayer` : un `Phaser.GameObjects.Text` créé à la demande, positionné à offset y = -54 (au-dessus du label), détruit à la désactivation.

**Différence clé vs. typing** : la bulle est *persistante* quand les conditions sont actives (workstationId + poste claimé), pas juste un timeout. Elle *pulse* en plus quand le joueur parle (LiveKit activeSpeakers).

- [ ] **Step 1 : Étendre `RemotePlayer` avec `setSpeaking`**

Dans `client/src/phaser/entities/RemotePlayer.ts`, après le champ `private typingBubble`, ajouter :

```ts
  private speakingBubble: Phaser.GameObjects.Text | null = null;
  private speakingPulseTween: Phaser.Tweens.Tween | null = null;
```

Après la méthode `setTyping`, insérer :

```ts
  /**
   * Active ou désactive la bulle 💬 persistante au-dessus du joueur.
   * Appelée depuis deux sources :
   *   1. GameScene.update() — pour la persistance (workstationId + poste claimé).
   *   2. useSpeakerBubbles hook — pour animer (pulse + couleur indigo) quand parle.
   *
   * @param active       true = afficher, false = masquer
   * @param speaking     true = joueur en train de parler (pulse)
   */
  setSpeaking(active: boolean, speaking = false): void {
    if (active) {
      if (!this.speakingBubble) {
        this.speakingBubble = this.scene.add
          .text(this.sprite.x, this.sprite.y - 54, '\u{1F4AC}', {
            fontSize: '18px',
            fontFamily: 'system-ui, sans-serif',
          })
          .setOrigin(0.5, 1)
          .setDepth(12);
        if (this.isGhost) this.speakingBubble.setAlpha(0.5);
      }

      // Pulse quand parle — tween scale 1.0 → 1.3 → 1.0 toutes les 600ms
      if (speaking && !this.speakingPulseTween) {
        this.speakingPulseTween = this.scene.tweens.add({
          targets: this.speakingBubble,
          scaleX: 1.3,
          scaleY: 1.3,
          duration: 300,
          ease: 'Sine.easeInOut',
          yoyo: true,
          repeat: -1,
        });
        this.speakingBubble.setStyle({ color: '#818cf8' }); // indigo-400
      } else if (!speaking && this.speakingPulseTween) {
        this.speakingPulseTween.stop();
        this.speakingPulseTween = null;
        this.speakingBubble?.setScale(1).setStyle({ color: '#ffffff' });
      }
    } else {
      if (!this.speakingBubble) return;
      this.speakingPulseTween?.stop();
      this.speakingPulseTween = null;
      this.speakingBubble.destroy();
      this.speakingBubble = null;
    }
  }
```

Dans `setGhost`, ajouter `this.speakingBubble?.setAlpha(a);` juste après `this.typingBubble?.setAlpha(a);`.

Dans `update()`, synchroniser la position de la bulle :

```ts
    if (this.speakingBubble) this.speakingBubble.setPosition(x, y - 54);
```

Dans `destroy()`, ajouter :

```ts
    this.speakingPulseTween?.stop();
    this.speakingBubble?.destroy();
```

- [ ] **Step 2 : Étendre `Player` avec `setSpeaking`**

Dans `client/src/phaser/entities/Player.ts`, après les champs de `presenceSuffix`, ajouter :

```ts
  private speakingBubble: Phaser.GameObjects.Text | null = null;
  private speakingPulseTween: Phaser.Tweens.Tween | null = null;
```

Après la méthode `setPresence`, insérer la même implémentation `setSpeaking` que pour `RemotePlayer` (identique, même signature, même body — copier/coller et adapter les imports si nécessaire). La référence à `this.sprite.x / this.sprite.y` est identique pour les deux classes.

Dans `setGhost`, ajouter `this.speakingBubble?.setAlpha(a);`.

Dans `destroy()`, ajouter :

```ts
    this.speakingPulseTween?.stop();
    this.speakingBubble?.destroy();
```

Le label Player se met à jour dans `update()` — synchroniser :

```ts
    if (this.speakingBubble) this.speakingBubble.setPosition(this.sprite.x, this.sprite.y - 54);
```

- [ ] **Step 3 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

- [ ] **Step 4 : Commit**

```bash
cd /home/openclaw/projects/webinti-town && git add client/src/phaser/entities/Player.ts client/src/phaser/entities/RemotePlayer.ts
git commit -m "feat(client): setSpeaking(active, speaking) on Player + RemotePlayer — persistent 💬 + pulse"
```

---

## Task 14 : Client useSpeakerBubbles hook — LiveKit activeSpeakers → speaking_state → bubbles

**Files:**
- Create: `client/src/react/hooks/useSpeakerBubbles.ts`
- Modify: `client/src/react/HUD.tsx`

Ce hook fait deux choses :
1. Subscribe aux `activeSpeakers` de LiveKit, throttle à 500ms, émet `speaking_state` au serveur.
2. Subscribe à `onSpeakingState` du `SocketManager` (remote speakers) et met à jour les bulles.

La mise à jour des bulles est nécessairement via une référence à `GameScene` — on utilise le pattern déjà en place pour les events Phaser (dispatch via `socketManager.onSpeakingState`).

- [ ] **Step 1 : Créer `client/src/react/hooks/useSpeakerBubbles.ts`**

```ts
import { useEffect, useRef } from 'react';
import { liveKitManager } from '../../livekit/LiveKitManager';
import { socketManager } from '../../network/SocketManager';
import { useGameStore } from '../../stores/gameStore';

const THROTTLE_MS = 500;

/**
 * Monté une seule fois dans HUD.
 *
 * 1. Surveille les activeSpeakers LiveKit de la room locale.
 *    Quand le statut "je parle" change, émet speaking_state au serveur
 *    avec un throttle de 500ms.
 *
 * 2. Subscribe à speaking_state entrant (remote players) et déclenche
 *    la mise à jour des bulles via le gameStore (GameScene lit le store).
 *
 * Note : la mise à jour des bulles Phaser est gérée par GameScene.update()
 * qui lit workstationId + workstations + speakingPlayerIds du store.
 * Ce hook alimente speakingPlayerIds.
 */
export function useSpeakerBubbles(): void {
  const lastSentRef = useRef<number>(0);
  const lastSpeakingRef = useRef<boolean>(false);

  // 1. Surveillance LiveKit activeSpeakers pour le joueur LOCAL
  useEffect(() => {
    const localId = useGameStore.getState().localPlayerId;
    if (!localId) return;

    // On poll le snapshot LiveKit via subscribe (useSyncExternalStore pattern côté hook)
    const unsubLK = liveKitManager.subscribe(() => {
      const snap = liveKitManager.getSnapshot();
      // LiveKit expose activeSpeakerIdentities via room.activeSpeakers
      // On accède à la room interne via le snapshot indirect :
      // un participant est "speaking" si son audioTrack est non-muté ET dans activeSpeakers.
      // Le plus simple : regarder si le micTrack local est en train d'envoyer de l'audio.
      // LiveKit n'expose pas directement activeSpeakers dans le snapshot — on utilise
      // le champ isMuted inverse : si micEnabled + non-muté + le participant est dans
      // room.activeSpeakers. On approxime ici par : micEnabled = true et niveau audio.
      // Pour la v1, on utilise l'événement RoomEvent.ActiveSpeakersChanged à la place
      // (voir note ci-dessous — ce hook s'abonne directement à la room).
      const _ = snap; // utilisé pour déclencher le re-check
    });

    // Abonnement direct à RoomEvent.ActiveSpeakersChanged (plus fiable que le snapshot)
    const room = liveKitManager.getRoom?.();
    if (!room) {
      unsubLK();
      return;
    }

    const onSpeakersChanged = () => {
      const speakers = room.activeSpeakers ?? [];
      const isLocalSpeaking = speakers.some((p) => p.identity === localId);
      if (isLocalSpeaking === lastSpeakingRef.current) return; // pas de changement
      lastSpeakingRef.current = isLocalSpeaking;
      const now = Date.now();
      if (now - lastSentRef.current < THROTTLE_MS) return;
      lastSentRef.current = now;
      socketManager.sendSpeakingState(isLocalSpeaking);
    };

    // livekit-client expose RoomEvent via l'import
    room.on('activeSpeakersChanged', onSpeakersChanged);

    return () => {
      unsubLK();
      room.off('activeSpeakersChanged', onSpeakersChanged);
    };
  }, []);

  // 2. Mise à jour du store speakingPlayerIds à partir des events entrants
  useEffect(() => {
    const unsub = socketManager.onSpeakingState(({ playerId, speaking }) => {
      useGameStore.getState().setSpeakingPlayer(playerId, speaking);
    });
    return unsub;
  }, []);
}
```

> **Note sur `liveKitManager.getRoom()`** : `LiveKitManager` n'expose pas encore `getRoom()`. Ajouter dans `LiveKitManager.ts` :
>
> ```ts
> getRoom(): import('livekit-client').Room | null {
>   return this.room;
> }
> ```

- [ ] **Step 2 : Ajouter `speakingPlayerIds` et `setSpeakingPlayer` dans le gameStore**

Dans `client/src/stores/gameStore.ts`, ajouter dans l'interface :

```ts
  speakingPlayerIds: Set<string>;
  setSpeakingPlayer: (playerId: string, speaking: boolean) => void;
```

Dans l'implémentation :

```ts
  speakingPlayerIds: new Set<string>(),
  setSpeakingPlayer: (playerId, speaking) =>
    set((s) => {
      const next = new Set(s.speakingPlayerIds);
      if (speaking) next.add(playerId); else next.delete(playerId);
      return { speakingPlayerIds: next };
    }),
```

Dans `reset()` :

```ts
      speakingPlayerIds: new Set(),
```

- [ ] **Step 3 : Dans GameScene, lire speakingPlayerIds + appeler setSpeaking**

Dans `GameScene.update()`, ajouter après la mise à jour de la WorkstationOverlay :

```ts
    // Mise à jour des bulles 💬 parlant
    const speakingIds = storeState.speakingPlayerIds;
    for (const [id, rp] of this.remotePlayers) {
      const playerState = storeState.players.get(id);
      const wsId = playerState?.workstationId ?? null;
      const wsState = wsId ? storeState.workstations.get(wsId) : null;
      const shouldShow = !!wsId && !!wsState && wsState.claimedBy !== null;
      rp.setSpeaking(shouldShow, speakingIds.has(id));
    }
    // Bulle pour le joueur local
    if (this.player && localId) {
      const localState = storeState.players.get(localId);
      const wsId = localState?.workstationId ?? null;
      const wsState = wsId ? storeState.workstations.get(wsId) : null;
      const shouldShow = !!wsId && !!wsState && wsState.claimedBy !== null;
      this.player.setSpeaking(shouldShow, speakingIds.has(localId));
    }
```

- [ ] **Step 4 : Monter useSpeakerBubbles dans HUD**

Dans `client/src/react/HUD.tsx` :

```tsx
import { useSpeakerBubbles } from './hooks/useSpeakerBubbles';
// ...
  useSpeakerBubbles();
```

- [ ] **Step 5 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

- [ ] **Step 6 : Commit**

```bash
cd /home/openclaw/projects/webinti-town && git add client/src/react/hooks/useSpeakerBubbles.ts client/src/stores/gameStore.ts client/src/phaser/scenes/GameScene.ts client/src/react/HUD.tsx client/src/livekit/LiveKitManager.ts
git commit -m "feat(client): useSpeakerBubbles — LiveKit activeSpeakers → speaking_state → 💬 pulse"
```

---

## Task 15 : Build + restart + smoke test

Cette tâche est la seule à inclure la compilation et le démarrage. Faire en dernier après toutes les tâches précédentes.

**Files:** aucun nouveau fichier.

- [ ] **Step 1 : Compiler le serveur**

```bash
cd /home/openclaw/projects/webinti-town/server && npm run build
```

Expected : aucune erreur TypeScript. Si erreurs, corriger avant de continuer.

- [ ] **Step 2 : Compiler le client**

```bash
cd /home/openclaw/projects/webinti-town/client && npm run build
```

Expected : aucune erreur. Warnings Vite sur les chunks sont acceptables.

- [ ] **Step 3 : Lancer tous les tests serveur**

```bash
cd /home/openclaw/projects/webinti-town/server && npx vitest run
```

Expected : tous les tests passent (workstations.test.ts + WorkstationManager.test.ts + les tests existants kanban/presence/proximity).

- [ ] **Step 4 : Démarrer le serveur en dev**

```bash
cd /home/openclaw/projects/webinti-town && npm run dev
```

Ou en prod sur le VPS (voir DEPLOY.md) :

```bash
sudo systemctl restart webinti-town
```

- [ ] **Step 5 : Smoke test manuel**

Ouvrir `http://localhost:5173` (ou l'URL de prod) dans deux onglets.

**Vérifications :**

1. **Overlay** : si `WORKSTATIONS` n'est pas vide, les contours verts apparaissent sur la map. Si vide, aucun contour visible — c'est normal.

2. **Mode debug Shift+D** :
   - Appuyer sur `Shift+D` — un overlay HUD apparaît en haut à gauche avec les coords pixel + tile + workstationId.
   - Marcher sur la map : les coords se mettent à jour en temps réel.
   - Appuyer à nouveau sur `Shift+D` → overlay disparaît.
   - **Si WORKSTATIONS est vide** : utiliser ce mode pour relever les coordonnées des sièges visibles sur la map, et les remplir dans `server/src/workstations.ts` et `client/src/workstations.ts`. Communiquer les coordonnées pour que je remplisse les tableaux.

3. **Claim** (après avoir rempli WORKSTATIONS) :
   - Marcher vers un poste → le `WorkstationPanel` apparaît en bas à gauche.
   - Cliquer "Revendiquer cet espace" → le panneau passe à "Revendiqué" + bouton bleu "Libérer l'espace".
   - Le contour de la zone passe au bleu dans Phaser.
   - Dans l'autre onglet : le contour de la zone passe au rouge.

4. **Verrouillage** :
   - Dans l'onglet 2 (non-claimer), essayer de marcher dans la zone revendiquée → le personnage est bloqué (rubber-band).

5. **Invitation** :
   - Dans l'onglet 1 (claimer), dans le `WorkstationPanel`, cliquer "Inviter" sur le joueur de l'onglet 2.
   - Dans l'onglet 2, un toast apparaît en bas à droite : "X t'invite à son Poste N".
   - Cliquer "Aller au poste" → toast disparaît. Marcher vers la zone → le joueur peut entrer.

6. **Bulle 💬** :
   - Une fois un joueur dans une zone revendiquée, la bulle 💬 apparaît au-dessus de sa tête.
   - Activer le micro LiveKit et parler → la bulle pulse (scale 1.0→1.3→1.0) + couleur indigo.

7. **Release** :
   - Dans l'onglet 1, cliquer "Libérer l'espace" → zone revient en vert, panneau revient à "Revendiquer".
   - Les invités perdent l'accès (à leur prochain move, ils seront éjectés si encore dans la zone).

- [ ] **Step 6 : Commit final**

```bash
cd /home/openclaw/projects/webinti-town && git add -u
git commit -m "chore: F6 workstations — build verified + smoke test passed"
```

---

## Récapitulatif des contraintes de permissions

| Action | Contrainte serveur |
|--------|-------------------|
| `claim` | poste libre (`claimedBy === null`) ET joueur physiquement dans la zone |
| `release` | joueur === claimer |
| `invite` | joueur === claimer ET target existe dans la room ET target pas déjà invité |
| `uninvite` | joueur === claimer ET target dans `invitedPlayerIds` |
| Entrer dans zone verrouillée | joueur === claimer OU dans `invitedPlayerIds` |
| `speaking_state` | rate-limité à 5/s/socket côté serveur, throttle 500ms côté client |

## Hors scope v1 (YAGNI)

- "Demander à rejoindre" depuis un non-claimer (v1 : invitation uniquement DEPUIS le claimer).
- Libération automatique par inactivité (prévu F8 — hors scope ici).
- Persistance disque des claims (volontaire — restart libère tout).
- Capacité max par poste.
- Postes non-rectangulaires.
- Effet "porte se ferme" lors du claim.
