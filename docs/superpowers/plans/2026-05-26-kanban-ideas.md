# Kanban d'idées collaboratif — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tableau Kanban 3 colonnes (À faire / En cours / Terminé) accessible via un objet interactif sur la map, avec persistance JSON par room et permissions strictes (auteur sur sa carte, hôte pour valider terminé).

**Architecture:** Le serveur expose un `KanbanStore` par room (CRUD + persistance JSON atomique). Les mutations passent par Socket.IO (`kanban:create|update|move|delete`), la validation et les permissions sont serveur-side. Le serveur broadcast un full snapshot `kanban:state` après chaque mutation (et au join). Le client miroite l'état dans le `gameStore` Zustand existant, le rendu est un `KanbanModal` ouvert par interaction E sur un objet `type: 'kanban'` placé près du whiteboard. Drag-and-drop HTML5 natif, toasts au passage de cartes créées par les autres.

**Tech Stack:** TypeScript + Node 20 (server), React 18 + Zustand + Tailwind (client), Phaser 3 (objet interactif sur map), Socket.IO, Vitest (tests), `fs/promises` (persistance).

**Spec source:** `docs/superpowers/specs/2026-05-26-kanban-ideas-design.md`

---

## File structure overview

**Created**
- `server/src/kanban/KanbanStore.ts` — état + persistance + validation des permissions
- `server/src/kanban/KanbanStore.test.ts` — vitest unit tests
- `server/data/.gitkeep` — pour garder le dossier en git
- `client/src/react/components/KanbanModal.tsx` — UI complète
- `client/src/react/components/kanbanRelativeTime.ts` — helper isolé
- `client/src/react/components/kanbanRelativeTime.test.ts` — vitest
- `client/src/react/components/KanbanToasts.tsx` — file d'attente toasts
- `docs/superpowers/plans/2026-05-26-kanban-ideas.md` — ce plan

**Modified**
- `server/src/types.ts` — ajouter `KanbanColumn`, `KanbanCard`, `KanbanBoard`, étendre `InteractiveObject`
- `server/src/rooms/RoomManager.ts` — instancier `KanbanStore` par room, ajouter objet kanban par défaut
- `server/src/socket/handlers.ts` — handlers kanban + envoi state au join
- `.gitignore` — `server/data/*.json`
- `client/src/types.ts` — mirror types
- `client/src/stores/gameStore.ts` — `openKanbanId`, `kanbanCards`, setters
- `client/src/network/SocketManager.ts` — emit helpers + listener `kanban:state`
- `client/src/phaser/scenes/GameScene.ts` — visuel objet kanban, hint, open sur E
- `client/src/react/HUD.tsx` — monter `<KanbanModal />` + `<KanbanToasts />`

---

## Task 1: Server types (KanbanCard, KanbanBoard, InteractiveObject kanban variant)

**Files:**
- Modify: `server/src/types.ts:64-68`

- [ ] **Step 1: Add the types**

Open `server/src/types.ts`. Just before `export type InteractiveObject =`, add:

```ts
export type KanbanColumn = 'todo' | 'doing' | 'done';

export interface KanbanCard {
  id: string;
  title: string;
  description: string;
  authorId: string;
  authorName: string;
  column: KanbanColumn;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  completedBy: string | null;
  completedByName: string | null;
}

export interface KanbanBoard {
  cards: KanbanCard[];
}
```

Then extend the `InteractiveObject` union by adding one more variant at the end of the union (keep the existing variants untouched, just append `|`):

```ts
  | { id: string; type: 'kanban'; x: number; y: number; data: Record<string, never> };
```

- [ ] **Step 2: Type-check**

Run: `cd server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/types.ts
git commit -m "feat(server): add Kanban types + interactive-object variant"
```

---

## Task 2: KanbanStore — in-memory CRUD + permissions (TDD)

**Files:**
- Create: `server/src/kanban/KanbanStore.ts`
- Create: `server/src/kanban/KanbanStore.test.ts`

The persistence layer is added separately in Task 3. This task implements the pure in-memory store; persistence is opt-in via constructor.

- [ ] **Step 1: Write the failing tests first**

Create `server/src/kanban/KanbanStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { KanbanStore } from './KanbanStore.js';

const A = { id: 'pA', name: 'Alice' };
const B = { id: 'pB', name: 'Bob' };
const H = { id: 'pH', name: 'Host' };

describe('KanbanStore — create', () => {
  let s: KanbanStore;
  beforeEach(() => { s = new KanbanStore({ roomSlug: 'r1', persist: false }); });

  it('creates a card and returns true', () => {
    expect(s.create(A.id, A.name, 'Idea one', 'desc')).toBe(true);
    expect(s.getCards()).toHaveLength(1);
    expect(s.getCards()[0]).toMatchObject({
      title: 'Idea one', description: 'desc', authorId: A.id, authorName: A.name, column: 'todo',
    });
  });

  it('rejects empty title', () => {
    expect(s.create(A.id, A.name, '   ', 'desc')).toBe(false);
    expect(s.getCards()).toHaveLength(0);
  });

  it('rejects title > 80 chars', () => {
    expect(s.create(A.id, A.name, 'x'.repeat(81), '')).toBe(false);
  });

  it('truncates description > 500 chars instead of rejecting', () => {
    expect(s.create(A.id, A.name, 'ok', 'x'.repeat(600))).toBe(true);
    expect(s.getCards()[0]!.description).toHaveLength(500);
  });

  it('inserts new card at index 0 of todo', () => {
    s.create(A.id, A.name, 'first', '');
    s.create(B.id, B.name, 'second', '');
    expect(s.getCards()[0]!.title).toBe('second');
    expect(s.getCards()[1]!.title).toBe('first');
  });
});

describe('KanbanStore — update', () => {
  let s: KanbanStore;
  let cardId: string;
  beforeEach(() => {
    s = new KanbanStore({ roomSlug: 'r1', persist: false });
    s.create(A.id, A.name, 'orig', 'origdesc');
    cardId = s.getCards()[0]!.id;
  });

  it('author can update own card', () => {
    expect(s.update(A.id, cardId, { title: 'new', description: 'newdesc' })).toBe(true);
    expect(s.getCards()[0]).toMatchObject({ title: 'new', description: 'newdesc' });
  });

  it('non-author cannot update', () => {
    expect(s.update(B.id, cardId, { title: 'hack' })).toBe(false);
    expect(s.getCards()[0]!.title).toBe('orig');
  });

  it('rejects empty new title', () => {
    expect(s.update(A.id, cardId, { title: '  ' })).toBe(false);
  });

  it('bumps updatedAt', async () => {
    const before = s.getCards()[0]!.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    s.update(A.id, cardId, { description: 'changed' });
    expect(s.getCards()[0]!.updatedAt).toBeGreaterThan(before);
  });
});

describe('KanbanStore — delete', () => {
  let s: KanbanStore;
  let cardId: string;
  beforeEach(() => {
    s = new KanbanStore({ roomSlug: 'r1', persist: false });
    s.create(A.id, A.name, 't', '');
    cardId = s.getCards()[0]!.id;
  });

  it('author can delete own card', () => {
    expect(s.delete(A.id, cardId)).toBe(true);
    expect(s.getCards()).toHaveLength(0);
  });

  it('non-author cannot delete', () => {
    expect(s.delete(B.id, cardId)).toBe(false);
    expect(s.getCards()).toHaveLength(1);
  });
});

describe('KanbanStore — move + reorder', () => {
  let s: KanbanStore;
  let aCard: string;
  beforeEach(() => {
    s = new KanbanStore({ roomSlug: 'r1', persist: false });
    s.create(A.id, A.name, 'aCard', '');
    aCard = s.getCards()[0]!.id;
  });

  it('author can move own card todo → doing', () => {
    expect(s.move(A.id, false, aCard, 'doing', 0)).toBe(true);
    expect(s.getCards()[0]!.column).toBe('doing');
  });

  it('author CANNOT move own card to done', () => {
    expect(s.move(A.id, false, aCard, 'done', 0)).toBe(false);
    expect(s.getCards()[0]!.column).toBe('todo');
  });

  it('host can move any card to done', () => {
    expect(s.move(H.id, true, aCard, 'done', 0)).toBe(true);
    const c = s.getCards()[0]!;
    expect(c.column).toBe('done');
    expect(c.completedBy).toBe(H.id);
    expect(c.completedAt).not.toBeNull();
  });

  it('host can reactivate done card to doing (clears completion fields)', () => {
    s.move(H.id, true, aCard, 'done', 0);
    expect(s.move(H.id, true, aCard, 'doing', 0)).toBe(true);
    const c = s.getCards()[0]!;
    expect(c.column).toBe('doing');
    expect(c.completedAt).toBeNull();
    expect(c.completedBy).toBeNull();
  });

  it('non-host non-author cannot move others cards', () => {
    expect(s.move(B.id, false, aCard, 'doing', 0)).toBe(false);
  });

  it('intra-column reorder by author works', () => {
    s.create(A.id, A.name, 'card2', '');
    const c2 = s.getCards()[0]!.id;     // c2 inserted at top → index 0
    // move c2 from index 0 → index 1 in todo
    expect(s.move(A.id, false, c2, 'todo', 1)).toBe(true);
    expect(s.getCards()[1]!.id).toBe(c2);
  });

  it('intra-column reorder of others card rejected for non-host', () => {
    s.create(B.id, B.name, 'bCard', '');
    const bCard = s.getCards()[0]!.id;
    expect(s.move(A.id, false, bCard, 'todo', 1)).toBe(false);
  });

  it('host can reorder any card intra-column', () => {
    s.create(B.id, B.name, 'bCard', '');
    const bCard = s.getCards()[0]!.id;
    expect(s.move(H.id, true, bCard, 'todo', 1)).toBe(true);
    expect(s.getCards()[1]!.id).toBe(bCard);
  });

  it('clamps negative position to 0', () => {
    s.create(A.id, A.name, 'c2', '');
    const c2 = s.getCards()[0]!.id;
    expect(s.move(A.id, false, c2, 'todo', -5)).toBe(true);
    expect(s.getCards()[0]!.id).toBe(c2);
  });

  it('clamps position > length to end', () => {
    s.create(A.id, A.name, 'c2', '');
    const c2 = s.getCards()[0]!.id;
    expect(s.move(A.id, false, c2, 'todo', 999)).toBe(true);
    expect(s.getCards().at(-1)!.id).toBe(c2);
  });

  it('unknown cardId → false', () => {
    expect(s.move(A.id, false, 'nope', 'doing', 0)).toBe(false);
  });

  it('invalid column → false', () => {
    expect(s.move(A.id, false, aCard, 'banana' as never, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, expect ALL to fail (module not found)**

```bash
cd server && npx vitest run src/kanban/KanbanStore.test.ts
```

Expected: every test fails with `Cannot find module './KanbanStore.js'` or similar.

- [ ] **Step 3: Implement `KanbanStore`**

Create `server/src/kanban/KanbanStore.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { KanbanCard, KanbanColumn } from '../types.js';

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 500;
const VALID_COLUMNS: ReadonlySet<KanbanColumn> = new Set<KanbanColumn>(['todo', 'doing', 'done']);

export interface KanbanStoreOptions {
  roomSlug: string;
  persist: boolean;
  dataDir?: string;          // override for tests (Task 3 uses this)
}

export class KanbanStore {
  private cards: KanbanCard[] = [];
  protected readonly roomSlug: string;
  protected readonly persistEnabled: boolean;

  constructor(opts: KanbanStoreOptions) {
    this.roomSlug = opts.roomSlug;
    this.persistEnabled = opts.persist;
  }

  getCards(): KanbanCard[] {
    // Return a defensive copy; mutations must go through the store API.
    return this.cards.map((c) => ({ ...c }));
  }

  create(authorId: string, authorName: string, rawTitle: string, rawDescription: string): boolean {
    const title = (rawTitle ?? '').trim();
    if (title.length < 1 || title.length > TITLE_MAX) return false;
    const description = (rawDescription ?? '').slice(0, DESCRIPTION_MAX);
    const now = Date.now();
    const card: KanbanCard = {
      id: randomUUID(),
      title,
      description,
      authorId,
      authorName,
      column: 'todo',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      completedBy: null,
      completedByName: null,
    };
    // New cards land at the top of "todo" (index 0 overall — they're first in their column).
    this.cards.unshift(card);
    this.scheduleSave();
    return true;
  }

  update(actorId: string, cardId: string, patch: { title?: string; description?: string }): boolean {
    const card = this.cards.find((c) => c.id === cardId);
    if (!card) return false;
    if (card.authorId !== actorId) return false;
    let dirty = false;
    if (patch.title !== undefined) {
      const t = patch.title.trim();
      if (t.length < 1 || t.length > TITLE_MAX) return false;
      if (t !== card.title) { card.title = t; dirty = true; }
    }
    if (patch.description !== undefined) {
      const d = patch.description.slice(0, DESCRIPTION_MAX);
      if (d !== card.description) { card.description = d; dirty = true; }
    }
    if (dirty) {
      card.updatedAt = Date.now();
      this.scheduleSave();
    }
    return true;
  }

  delete(actorId: string, cardId: string): boolean {
    const idx = this.cards.findIndex((c) => c.id === cardId);
    if (idx === -1) return false;
    if (this.cards[idx]!.authorId !== actorId) return false;
    this.cards.splice(idx, 1);
    this.scheduleSave();
    return true;
  }

  move(actorId: string, isHost: boolean, cardId: string, column: KanbanColumn, position: number): boolean {
    if (!VALID_COLUMNS.has(column)) return false;
    const idx = this.cards.findIndex((c) => c.id === cardId);
    if (idx === -1) return false;
    const card = this.cards[idx]!;
    const sourceColumn = card.column;
    const isAuthor = card.authorId === actorId;

    // Permission table.
    if (column === 'done' || sourceColumn === 'done') {
      // Any move into or out of "done" requires host.
      if (!isHost) return false;
    } else {
      // todo↔doing and intra-todo / intra-doing reorder.
      if (sourceColumn !== column) {
        // Cross-column (todo↔doing): author only.
        if (!isAuthor) return false;
      } else {
        // Intra-column reorder: author OR host.
        if (!isAuthor && !isHost) return false;
      }
    }

    // Apply move.
    this.cards.splice(idx, 1);
    card.column = column;
    if (column === 'done' && sourceColumn !== 'done') {
      card.completedAt = Date.now();
      card.completedBy = actorId;
      // Note: completedByName is set by the caller in the socket layer
      // because the store doesn't know the host's display name.
      // We accept a host-name-less write here; the socket handler fills it.
    } else if (sourceColumn === 'done' && column !== 'done') {
      card.completedAt = null;
      card.completedBy = null;
      card.completedByName = null;
    }
    card.updatedAt = Date.now();

    // Compute insertion index in the global list so that the card lands at
    // `position` within the destination column.
    const insertIdx = this.computeInsertIndex(column, position);
    this.cards.splice(insertIdx, 0, card);
    this.scheduleSave();
    return true;
  }

  /**
   * Called by `move` after applying done-status changes. Lets the socket
   * layer attach the human-readable host name (the store has no notion
   * of player display names beyond what's already on each card).
   */
  setCompletedByName(cardId: string, name: string): void {
    const card = this.cards.find((c) => c.id === cardId);
    if (!card) return;
    if (card.column !== 'done') return;
    if (card.completedByName === name) return;
    card.completedByName = name;
    this.scheduleSave();
  }

  private computeInsertIndex(column: KanbanColumn, requestedPosition: number): number {
    // Indices of cards already in target column.
    const sameColumnIdx: number[] = [];
    for (let i = 0; i < this.cards.length; i++) {
      if (this.cards[i]!.column === column) sameColumnIdx.push(i);
    }
    if (sameColumnIdx.length === 0) {
      // Find first index whose card is in a "later" column to preserve order.
      // For simplicity we just append to the end of the array; in-column
      // ordering is preserved because all queries filter by column anyway.
      return this.cards.length;
    }
    const pos = Math.max(0, Math.min(sameColumnIdx.length, requestedPosition));
    if (pos === sameColumnIdx.length) {
      // After the last same-column card.
      return sameColumnIdx[sameColumnIdx.length - 1]! + 1;
    }
    return sameColumnIdx[pos]!;
  }

  // Hooks overridden by the persisting subclass in Task 3.
  protected scheduleSave(): void { /* no-op in base class */ }
}
```

- [ ] **Step 4: Run tests, expect ALL to pass**

```bash
cd server && npx vitest run src/kanban/KanbanStore.test.ts
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add server/src/kanban/KanbanStore.ts server/src/kanban/KanbanStore.test.ts
git commit -m "feat(server): KanbanStore in-memory CRUD + strict permissions"
```

---

## Task 3: KanbanStore — JSON persistence (TDD)

**Files:**
- Modify: `server/src/kanban/KanbanStore.ts`
- Modify: `server/src/kanban/KanbanStore.test.ts`

We extend the store with a `persist: true` path that reads on `load()` and writes atomically to `server/data/kanban-<slug>.json` after each mutation. Writes are debounced (50ms) and flushed on `flush()` for deterministic tests.

- [ ] **Step 1: Add persistence tests at the bottom of `KanbanStore.test.ts`**

```ts
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('KanbanStore — persistence', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kanban-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes an atomic JSON file on mutation', async () => {
    const s = new KanbanStore({ roomSlug: 'r1', persist: true, dataDir: dir });
    s.create(A.id, A.name, 'hello', '');
    await s.flush();
    const path = join(dir, 'kanban-r1.json');
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.version).toBe(1);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0].title).toBe('hello');
  });

  it('loads from existing JSON file on construction', async () => {
    const s = new KanbanStore({ roomSlug: 'r2', persist: true, dataDir: dir });
    s.create(A.id, A.name, 'first', '');
    await s.flush();

    const s2 = new KanbanStore({ roomSlug: 'r2', persist: true, dataDir: dir });
    await s2.load();
    expect(s2.getCards()).toHaveLength(1);
    expect(s2.getCards()[0]!.title).toBe('first');
  });

  it('starts empty + warns if file is corrupt', async () => {
    const path = join(dir, 'kanban-r3.json');
    require('node:fs').writeFileSync(path, '{not json');
    const s = new KanbanStore({ roomSlug: 'r3', persist: true, dataDir: dir });
    await s.load();
    expect(s.getCards()).toHaveLength(0);
  });

  it('starts empty if file does not exist (no throw)', async () => {
    const s = new KanbanStore({ roomSlug: 'r4', persist: true, dataDir: dir });
    await s.load();
    expect(s.getCards()).toHaveLength(0);
  });
});
```

Don't forget to import `afterEach` at the top of the test file:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
```

- [ ] **Step 2: Run, expect failures**

```bash
cd server && npx vitest run src/kanban/KanbanStore.test.ts
```

Expected: 4 new persistence tests fail (`s.flush is not a function` and similar).

- [ ] **Step 3: Add persistence to `KanbanStore.ts`**

Add imports at the top:

```ts
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DATA_DIR = (() => {
  // server/src/kanban/KanbanStore.ts → ../../data == server/data
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'data');
})();

const SAVE_DEBOUNCE_MS = 50;
const FILE_VERSION = 1;
```

Add private fields to the class:

```ts
  private readonly dataDir: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private savePending: Promise<void> | null = null;
```

In the constructor:

```ts
    this.dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
```

Replace the empty `scheduleSave` hook with the real implementation:

```ts
  protected scheduleSave(): void {
    if (!this.persistEnabled) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.savePending = this.saveNow().catch((err) => {
        console.warn('[kanban] save failed for', this.roomSlug, err);
      });
    }, SAVE_DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      await this.saveNow();
      return;
    }
    if (this.savePending) await this.savePending;
  }

  async load(): Promise<void> {
    if (!this.persistEnabled) return;
    const path = this.filePath();
    try {
      const raw = await fs.readFile(path, 'utf8');
      const parsed = JSON.parse(raw) as { version?: number; cards?: KanbanCard[] };
      if (parsed && Array.isArray(parsed.cards)) {
        // Strict-shape filter: drop entries that don't look like a card.
        this.cards = parsed.cards.filter((c) => isWellShapedCard(c));
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return; // first run, fine
      console.warn('[kanban] load failed for', this.roomSlug, '— starting empty', err);
      this.cards = [];
    }
  }

  private filePath(): string {
    return join(this.dataDir, `kanban-${this.roomSlug}.json`);
  }

  private async saveNow(): Promise<void> {
    const path = this.filePath();
    const tmp = `${path}.tmp`;
    await fs.mkdir(this.dataDir, { recursive: true });
    const payload = JSON.stringify({ version: FILE_VERSION, cards: this.cards });
    await fs.writeFile(tmp, payload, 'utf8');
    await fs.rename(tmp, path);
  }
```

Add this module-level helper at the bottom of the file (outside the class):

```ts
function isWellShapedCard(c: unknown): c is KanbanCard {
  if (typeof c !== 'object' || c === null) return false;
  const r = c as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.title === 'string' &&
    typeof r.description === 'string' &&
    typeof r.authorId === 'string' &&
    typeof r.authorName === 'string' &&
    (r.column === 'todo' || r.column === 'doing' || r.column === 'done') &&
    typeof r.createdAt === 'number' &&
    typeof r.updatedAt === 'number' &&
    (r.completedAt === null || typeof r.completedAt === 'number') &&
    (r.completedBy === null || typeof r.completedBy === 'string') &&
    (r.completedByName === null || typeof r.completedByName === 'string')
  );
}
```

- [ ] **Step 4: Run tests, expect all green**

```bash
cd server && npx vitest run src/kanban/KanbanStore.test.ts
```

Expected: all persistence tests pass, no regressions in earlier ones.

- [ ] **Step 5: Commit**

```bash
git add server/src/kanban/KanbanStore.ts server/src/kanban/KanbanStore.test.ts
git commit -m "feat(server): atomic JSON persistence for KanbanStore"
```

---

## Task 4: Wire KanbanStore into RoomManager + .gitignore + default object

**Files:**
- Modify: `server/src/rooms/RoomManager.ts`
- Modify: `server/src/types.ts` (extend `RoomState`)
- Modify: `.gitignore`
- Create: `server/data/.gitkeep`

- [ ] **Step 1: Extend RoomState with the store**

In `server/src/types.ts`, add a field to `RoomState`. After `interactiveObjects: InteractiveObject[];`:

```ts
  // Cards are owned by an in-memory store + JSON file per room — not embedded
  // in the InteractiveObject's `data` field. See server/src/kanban/KanbanStore.
  kanbanStore: import('../kanban/KanbanStore.js').KanbanStore;
```

(Yes, dynamic import-type lets us avoid a circular-import headache at type level.)

- [ ] **Step 2: Add default kanban interactive object**

In `server/src/rooms/RoomManager.ts`, inside `defaultInteractiveObjects()`, after the whiteboard entry, add:

```ts
    {
      id: 'kanban-ideas-1',
      type: 'kanban',
      x: 10 * 32,        // tile (10, 36) — 2 tiles east of the whiteboard
      y: 36 * 32,
      data: {},
    },
```

- [ ] **Step 3: Instantiate KanbanStore on room creation/get**

Find the place in `RoomManager.ts` where a `RoomState` is created (likely in `createRoom` and/or wherever a new room object is built). Add `kanbanStore` initialization. Example shape — adapt to the existing factory:

```ts
import { KanbanStore } from '../kanban/KanbanStore.js';
// ...
const kanbanStore = new KanbanStore({ roomSlug: slug, persist: true });
// fire-and-forget; getCards returns empty until load resolves
void kanbanStore.load();
const room: RoomState = {
  slug,
  name: cleanName,
  adminToken,
  players: new Map(),
  createdAt: Date.now(),
  chatHistory: [],
  interactiveObjects: defaultInteractiveObjects(),
  hostPlayerId: null,
  isRecording: false,
  kanbanStore,
};
```

If there are multiple creation sites, do the same in each.

- [ ] **Step 4: gitignore + .gitkeep**

```bash
mkdir -p server/data
touch server/data/.gitkeep
```

Append to `.gitignore`:

```
# Kanban persistent data — not committed (one file per room)
server/data/*.json
```

- [ ] **Step 5: Type-check + run server tests**

```bash
cd server && npx tsc --noEmit && npx vitest run
```

Expected: no type errors, all tests green.

- [ ] **Step 6: Commit**

```bash
git add server/src/types.ts server/src/rooms/RoomManager.ts server/data/.gitkeep .gitignore
git commit -m "feat(server): wire KanbanStore per room + default board placement"
```

---

## Task 5: Server socket handlers (create / update / move / delete / state)

**Files:**
- Modify: `server/src/socket/handlers.ts`

- [ ] **Step 1: Add the four handlers inside the `io.on('connection', ...)` block**

Pick a location near the existing whiteboard handlers in `handlers.ts`. Add:

```ts
    socket.on('kanban:create', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const player = room.players.get(session.playerId);
      if (!player) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const title = typeof p.title === 'string' ? p.title : '';
      const description = typeof p.description === 'string' ? p.description : '';
      if (!room.kanbanStore.create(player.playerId, player.name, title, description)) return;
      io.to(session.roomSlug).emit('kanban:state', { cards: room.kanbanStore.getCards() });
    });

    socket.on('kanban:update', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const cardId = typeof p.cardId === 'string' ? p.cardId : '';
      if (!cardId) return;
      const patch: { title?: string; description?: string } = {};
      if (typeof p.title === 'string') patch.title = p.title;
      if (typeof p.description === 'string') patch.description = p.description;
      if (!room.kanbanStore.update(session.playerId, cardId, patch)) return;
      io.to(session.roomSlug).emit('kanban:state', { cards: room.kanbanStore.getCards() });
    });

    socket.on('kanban:move', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const cardId = typeof p.cardId === 'string' ? p.cardId : '';
      const column = p.column;
      const position = typeof p.position === 'number' && Number.isFinite(p.position) ? Math.floor(p.position) : 0;
      if (!cardId) return;
      if (column !== 'todo' && column !== 'doing' && column !== 'done') return;
      const isHost = room.hostPlayerId === session.playerId;
      if (!room.kanbanStore.move(session.playerId, isHost, cardId, column, position)) return;
      // If we just promoted to 'done', stamp the host's display name.
      if (column === 'done') {
        const host = room.players.get(session.playerId);
        if (host) room.kanbanStore.setCompletedByName(cardId, host.name);
      }
      io.to(session.roomSlug).emit('kanban:state', { cards: room.kanbanStore.getCards() });
    });

    socket.on('kanban:delete', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const cardId = typeof p.cardId === 'string' ? p.cardId : '';
      if (!cardId) return;
      if (!room.kanbanStore.delete(session.playerId, cardId)) return;
      io.to(session.roomSlug).emit('kanban:state', { cards: room.kanbanStore.getCards() });
    });
```

- [ ] **Step 2: Send the initial board state on join**

Find the `socket.emit('room_state', ...)` block in the `join_room` handler. Right after that emit, add:

```ts
      socket.emit('kanban:state', { cards: room.kanbanStore.getCards() });
```

- [ ] **Step 3: Type-check**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/socket/handlers.ts
git commit -m "feat(server): socket handlers for kanban create/update/move/delete + state on join"
```

---

## Task 6: Client types mirror

**Files:**
- Modify: `client/src/types.ts`

- [ ] **Step 1: Add the same types client-side**

At the bottom of `client/src/types.ts`, after the existing `InteractiveObject` union, add:

```ts
export type KanbanColumn = 'todo' | 'doing' | 'done';

export interface KanbanCard {
  id: string;
  title: string;
  description: string;
  authorId: string;
  authorName: string;
  column: KanbanColumn;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  completedBy: string | null;
  completedByName: string | null;
}
```

Then extend the client's `InteractiveObject` union the same way as server (Task 1). The exact path will look like the server's union — add `| { id: string; type: 'kanban'; x: number; y: number; data: Record<string, never> };`.

- [ ] **Step 2: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/types.ts
git commit -m "feat(client): mirror Kanban types"
```

---

## Task 7: Client store slice (kanban state + openKanbanId)

**Files:**
- Modify: `client/src/stores/gameStore.ts`

- [ ] **Step 1: Add the state + setters**

Inside the `GameState` (or equivalent) interface, alongside `openWhiteboardId`, add:

```ts
  openKanbanId: string | null;
  setOpenKanban: (id: string | null) => void;
  kanbanCards: KanbanCard[];
  setKanbanCards: (cards: KanbanCard[]) => void;
```

Import the type at the top:

```ts
import type { KanbanCard } from '../types';
```

In the store implementation (the `create((set) => ({ ... }))` block), follow the same pattern as `openWhiteboardId`:

```ts
  openKanbanId: null,
  setOpenKanban: (id) =>
    set((s) => ({
      openKanbanId: id,
      inputFocused:
        id !== null ||
        s.openWhiteboardId !== null ||
        s.openNoteId !== null ||
        s.openLinkId !== null,
    })),
  kanbanCards: [],
  setKanbanCards: (cards) => set({ kanbanCards: cards }),
```

In the `reset()` action, add `openKanbanId: null, kanbanCards: []` alongside the existing `openWhiteboardId: null, openNoteId: null, openLinkId: null,`.

- [ ] **Step 2: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add client/src/stores/gameStore.ts
git commit -m "feat(client): gameStore — openKanbanId + kanbanCards slice"
```

---

## Task 8: Client SocketManager wiring (emits + state listener)

**Files:**
- Modify: `client/src/network/SocketManager.ts`

Look at how `SocketManager` exposes other emits (e.g. for whiteboard) and mirror the style.

- [ ] **Step 1: Add the emit helpers**

Inside the `SocketManager` class, alongside other emit methods:

```ts
  kanbanCreate(title: string, description: string): void {
    this.socket?.emit('kanban:create', { title, description });
  }
  kanbanUpdate(cardId: string, patch: { title?: string; description?: string }): void {
    this.socket?.emit('kanban:update', { cardId, ...patch });
  }
  kanbanMove(cardId: string, column: 'todo' | 'doing' | 'done', position: number): void {
    this.socket?.emit('kanban:move', { cardId, column, position });
  }
  kanbanDelete(cardId: string): void {
    this.socket?.emit('kanban:delete', { cardId });
  }
```

- [ ] **Step 2: Subscribe to `kanban:state` and push into the store**

In the place where the socket subscribes to inbound events (look for `socket.on('room_state', ...)` and similar in the same file), add:

```ts
    this.socket.on('kanban:state', (payload: { cards: KanbanCard[] }) => {
      if (!payload || !Array.isArray(payload.cards)) return;
      useGameStore.getState().setKanbanCards(payload.cards);
    });
```

Import `KanbanCard` from `../types` and `useGameStore` if not already imported.

- [ ] **Step 3: Type-check**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add client/src/network/SocketManager.ts
git commit -m "feat(client): SocketManager kanban emit helpers + state listener"
```

---

## Task 9: GameScene — kanban interactive object visual + E to open

**Files:**
- Modify: `client/src/phaser/scenes/GameScene.ts`

The codebase already routes E-key presses based on `obj.type` (look at the `eKey.on('down', ...)` handler). We extend it with one more branch and add a visual.

- [ ] **Step 1: Handle the E press**

Find the `eKey?.on('down', () => { ... })` handler. Alongside the existing branches for `'whiteboard'`, `'note'`, `'link'`, add:

```ts
      if (obj && obj.type === 'kanban') {
        store.setOpenKanban(obj.id);
        return;
      }
```

- [ ] **Step 2: Visual rendering for the kanban object**

Find the `refreshObject(obj: InteractiveObject)` function (the one that handles whiteboard/note/link visuals). At the same location it currently builds an icon for those types, add a branch for `'kanban'`:

```ts
      } else if (obj.type === 'kanban') {
        iconText = '📋';
        hintText = "Appuyer sur E — Tableau d'idées";
```

(Adapt names to whatever the existing function uses — look at the whiteboard branch right above and copy the structure exactly. The point is one visual emoji + the proximity hint text.)

- [ ] **Step 3: Type-check + smoke build**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add client/src/phaser/scenes/GameScene.ts
git commit -m "feat(client): GameScene renders kanban object + opens modal on E"
```

---

## Task 10: KanbanModal — read-only baseline (3 columns, list cards)

**Files:**
- Create: `client/src/react/components/KanbanModal.tsx`
- Modify: `client/src/react/HUD.tsx`

Baseline: render 3 columns, list all cards. No create/edit/delete/DnD yet. Mount unconditionally in HUD — the modal returns `null` when `openKanbanId` is falsy.

- [ ] **Step 1: Create the modal**

```tsx
import { useGameStore } from '../../stores/gameStore';
import type { KanbanCard, KanbanColumn } from '../../types';

const COLUMN_LABELS: Record<KanbanColumn, string> = {
  todo: 'À faire',
  doing: 'En cours',
  done: 'Terminé',
};

const COLUMN_ORDER: KanbanColumn[] = ['todo', 'doing', 'done'];

const COLUMN_BG: Record<KanbanColumn, string> = {
  todo: 'bg-amber-100/5 ring-amber-300/20',
  doing: 'bg-sky-100/5 ring-sky-300/20',
  done: 'bg-emerald-100/5 ring-emerald-300/20',
};

export function KanbanModal() {
  const openId = useGameStore((s) => s.openKanbanId);
  const setOpen = useGameStore((s) => s.setOpenKanban);
  const cards = useGameStore((s) => s.kanbanCards);
  if (!openId) return null;

  const byColumn: Record<KanbanColumn, KanbanCard[]> = { todo: [], doing: [], done: [] };
  for (const c of cards) byColumn[c.column].push(c);

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-full max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-slate-900 text-slate-100 ring-1 ring-white/10 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-lg font-semibold">Tableau d'idées</h2>
          <button
            onClick={() => setOpen(null)}
            className="rounded-md bg-white/10 px-3 py-1 text-sm hover:bg-white/20"
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        <div className="flex flex-1 gap-3 overflow-auto p-4">
          {COLUMN_ORDER.map((col) => (
            <div
              key={col}
              className={`flex w-1/3 min-w-[260px] flex-col gap-2 rounded-lg p-3 ring-1 ${COLUMN_BG[col]}`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide">{COLUMN_LABELS[col]}</h3>
                <span className="text-xs text-slate-400">{byColumn[col].length}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-auto">
                {byColumn[col].map((c) => (
                  <CardView key={c.id} card={c} />
                ))}
                {byColumn[col].length === 0 && (
                  <div className="rounded-md border border-dashed border-white/10 p-3 text-center text-xs text-slate-500">
                    Aucune carte
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CardView({ card }: { card: KanbanCard }) {
  return (
    <div className="rounded-md bg-slate-800/80 p-3 ring-1 ring-white/10">
      <div className="text-sm font-semibold">{card.title}</div>
      {card.description && (
        <div className="mt-1 whitespace-pre-wrap text-xs text-slate-300">{card.description}</div>
      )}
      <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">
        Par {card.authorName}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount in HUD**

In `client/src/react/HUD.tsx`, add the import alongside the other modal imports:

```tsx
import { KanbanModal } from './components/KanbanModal';
```

And mount the component near the other modals:

```tsx
      <KanbanModal />
```

- [ ] **Step 3: Type-check**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add client/src/react/components/KanbanModal.tsx client/src/react/HUD.tsx
git commit -m "feat(client): KanbanModal read-only baseline (3 columns + list)"
```

---

## Task 11: KanbanModal — create card form

**Files:**
- Modify: `client/src/react/components/KanbanModal.tsx`

- [ ] **Step 1: Add a creation form at the top of the "À faire" column**

At the top of `KanbanModal.tsx`, add the import:

```ts
import { useState } from 'react';
import { socketManager } from '../../network/SocketManager';
```

Add a `<CreateCardForm />` component:

```tsx
function CreateCardForm() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const submit = () => {
    const t = title.trim();
    if (t.length < 1 || t.length > 80) return;
    socketManager.kanbanCreate(t, description.slice(0, 500));
    setTitle('');
    setDescription('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-dashed border-white/20 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
      >
        + Nouvelle idée
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-md bg-slate-800/80 p-3 ring-1 ring-indigo-400/40">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 80))}
        placeholder="Titre de l'idée (max 80)"
        className="rounded bg-slate-900 px-2 py-1 text-sm outline-none ring-1 ring-white/10 focus:ring-indigo-400"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value.slice(0, 500))}
        placeholder="Description (optionnel, max 500)"
        rows={3}
        className="resize-none rounded bg-slate-900 px-2 py-1 text-xs outline-none ring-1 ring-white/10 focus:ring-indigo-400"
      />
      <div className="flex gap-2">
        <button
          disabled={title.trim().length < 1}
          onClick={submit}
          className="rounded bg-indigo-600 px-3 py-1 text-xs font-semibold hover:bg-indigo-500 disabled:opacity-40"
        >
          Ajouter
        </button>
        <button
          onClick={() => { setOpen(false); setTitle(''); setDescription(''); }}
          className="rounded bg-white/10 px-3 py-1 text-xs hover:bg-white/20"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
```

Mount it at the top of the "À faire" column body. In the `COLUMN_ORDER.map(...)` block, before rendering cards:

```tsx
              {col === 'todo' && <CreateCardForm />}
              {byColumn[col].map((c) => (
                <CardView key={c.id} card={c} />
              ))}
```

- [ ] **Step 2: Type-check**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add client/src/react/components/KanbanModal.tsx
git commit -m "feat(client): KanbanModal — create card form"
```

---

## Task 12: KanbanModal — edit + delete + host actions

**Files:**
- Modify: `client/src/react/components/KanbanModal.tsx`

- [ ] **Step 1: Add host detection helpers**

In `KanbanModal.tsx`, near the top (after imports):

```ts
function useIsHost(): boolean {
  return useGameStore((s) => s.hostPlayerId !== null && s.hostPlayerId === s.localPlayerId);
}
function useLocalPlayerId(): string | null {
  return useGameStore((s) => s.localPlayerId);
}
```

(If `hostPlayerId` isn't in `gameStore` yet, locate where it's stored — the spec mentions `room.hostPlayerId` in `room_state`. There should already be a `hostPlayerId` field in `gameStore`. If not, add it: it's needed by other admin features too, look at `HUD.tsx` admin panel for the existing pattern.)

- [ ] **Step 2: Replace `CardView` with an interactive version**

Replace the `function CardView({ card }: { card: KanbanCard })` from Task 10 with:

```tsx
function CardView({ card }: { card: KanbanCard }) {
  const isHost = useIsHost();
  const me = useLocalPlayerId();
  const isMine = me !== null && card.authorId === me;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);

  const submit = () => {
    const t = title.trim();
    if (t.length < 1 || t.length > 80) return;
    socketManager.kanbanUpdate(card.id, { title: t, description: description.slice(0, 500) });
    setEditing(false);
  };

  const confirmDelete = () => {
    if (!window.confirm('Supprimer cette carte ?')) return;
    socketManager.kanbanDelete(card.id);
  };

  const markDone = () => socketManager.kanbanMove(card.id, 'done', 0);
  const reactivate = () => socketManager.kanbanMove(card.id, 'doing', 0);

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-md bg-slate-800/80 p-3 ring-1 ring-indigo-400/40">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 80))}
          className="rounded bg-slate-900 px-2 py-1 text-sm outline-none ring-1 ring-white/10 focus:ring-indigo-400"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 500))}
          rows={3}
          className="resize-none rounded bg-slate-900 px-2 py-1 text-xs outline-none ring-1 ring-white/10 focus:ring-indigo-400"
        />
        <div className="flex gap-2">
          <button onClick={submit} className="rounded bg-indigo-600 px-3 py-1 text-xs font-semibold hover:bg-indigo-500">Enregistrer</button>
          <button onClick={() => { setEditing(false); setTitle(card.title); setDescription(card.description); }} className="rounded bg-white/10 px-3 py-1 text-xs hover:bg-white/20">Annuler</button>
        </div>
      </div>
    );
  }

  return (
    <div className="group rounded-md bg-slate-800/80 p-3 ring-1 ring-white/10">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold">{card.title}</div>
        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {isMine && card.column !== 'done' && (
            <>
              <button title="Éditer" onClick={() => setEditing(true)} className="rounded bg-white/10 px-1.5 text-xs hover:bg-white/20">✏️</button>
              <button title="Supprimer" onClick={confirmDelete} className="rounded bg-white/10 px-1.5 text-xs hover:bg-white/20">🗑</button>
            </>
          )}
          {isHost && card.column !== 'done' && (
            <button title="Marquer terminé" onClick={markDone} className="rounded bg-emerald-600/80 px-1.5 text-xs hover:bg-emerald-500">✓</button>
          )}
          {isHost && card.column === 'done' && (
            <button title="Réactiver" onClick={reactivate} className="rounded bg-white/10 px-1.5 text-xs hover:bg-white/20">↩</button>
          )}
        </div>
      </div>
      {card.description && (
        <div className="mt-1 whitespace-pre-wrap text-xs text-slate-300">{card.description}</div>
      )}
      <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">
        Par {card.authorName}
        {card.column === 'done' && card.completedByName && (
          <> · Terminé par {card.completedByName}</>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check + smoke test**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add client/src/react/components/KanbanModal.tsx
git commit -m "feat(client): KanbanModal — edit/delete (author), done/reactivate (host)"
```

---

## Task 13: Drag-and-drop — cross-column move (column-level drop)

**Files:**
- Modify: `client/src/react/components/KanbanModal.tsx`

For now: drop on a column body → card lands at the **end** of that column. Intra-column reorder via gap drops is Task 14.

- [ ] **Step 1: Permission-aware "can move" helper**

Near the top of `KanbanModal.tsx`:

```ts
function canMove(
  card: KanbanCard,
  targetColumn: KanbanColumn,
  isHost: boolean,
  me: string | null,
): boolean {
  if (me === null) return false;
  const isAuthor = card.authorId === me;
  if (targetColumn === 'done' || card.column === 'done') return isHost;
  if (card.column === targetColumn) return isAuthor || isHost;
  // todo ↔ doing cross-column move
  return isAuthor;
}
```

- [ ] **Step 2: Add drag state via React.useState in `KanbanModal`**

In `KanbanModal`:

```tsx
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<KanbanColumn | null>(null);
  const isHost = useIsHost();
  const me = useLocalPlayerId();
```

Pass `draggedId`, `setDraggedId`, `hoverColumn`, `setHoverColumn`, `isHost`, `me`, and `byColumn` to `CardView` (extend its props) and add a column-level drop handler.

The column wrapper:

```tsx
            <div
              key={col}
              onDragOver={(e) => {
                const card = cards.find((c) => c.id === draggedId);
                if (!card) return;
                if (!canMove(card, col, isHost, me)) {
                  setHoverColumn(null);
                  return; // do not preventDefault → cursor "not-allowed"
                }
                e.preventDefault();
                setHoverColumn(col);
              }}
              onDragLeave={() => {
                if (hoverColumn === col) setHoverColumn(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setHoverColumn(null);
                const card = cards.find((c) => c.id === draggedId);
                setDraggedId(null);
                if (!card) return;
                if (!canMove(card, col, isHost, me)) return;
                // Drop at end of target column.
                socketManager.kanbanMove(card.id, col, byColumn[col].length);
              }}
              className={`flex w-1/3 min-w-[260px] flex-col gap-2 rounded-lg p-3 ring-1 ${COLUMN_BG[col]} ${hoverColumn === col ? 'ring-2 ring-indigo-400' : ''}`}
            >
```

- [ ] **Step 3: Make CardView draggable when permitted**

Update `CardView` props:

```tsx
function CardView({
  card,
  isHost,
  me,
  draggedId,
  setDraggedId,
}: {
  card: KanbanCard;
  isHost: boolean;
  me: string | null;
  draggedId: string | null;
  setDraggedId: (id: string | null) => void;
}) {
```

The card is draggable iff there's any column it could be moved to (including its own for reorder):

```tsx
  const isMine = me !== null && card.authorId === me;
  const draggable = isMine || isHost; // simplified: anyone who can ever move it
  const isBeingDragged = draggedId === card.id;
```

Add to the outer card `<div>`:

```tsx
      draggable={draggable}
      onDragStart={() => setDraggedId(card.id)}
      onDragEnd={() => setDraggedId(null)}
      style={{ opacity: isBeingDragged ? 0.4 : 1, cursor: draggable ? 'grab' : 'default' }}
```

- [ ] **Step 4: Update the column body where CardView is rendered**

```tsx
                {byColumn[col].map((c) => (
                  <CardView
                    key={c.id}
                    card={c}
                    isHost={isHost}
                    me={me}
                    draggedId={draggedId}
                    setDraggedId={setDraggedId}
                  />
                ))}
```

- [ ] **Step 5: Type-check**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add client/src/react/components/KanbanModal.tsx
git commit -m "feat(client): KanbanModal — drag-and-drop cross-column move"
```

---

## Task 14: Drag-and-drop — gap drop targets (precise position + intra-column reorder)

**Files:**
- Modify: `client/src/react/components/KanbanModal.tsx`

We add thin drop zones between cards (and after the last one) that, when hovered, indicate "insert here" with a thin indigo line.

- [ ] **Step 1: Track a finer hover state**

In `KanbanModal`:

```tsx
  const [hoverGap, setHoverGap] = useState<{ column: KanbanColumn; index: number } | null>(null);
```

- [ ] **Step 2: Render a `<DropGap>` between cards and at the bottom**

Add inside `KanbanModal` (not a separate component):

```tsx
  function renderDropGap(col: KanbanColumn, index: number) {
    const dragged = cards.find((c) => c.id === draggedId);
    const active = hoverGap?.column === col && hoverGap.index === index;
    return (
      <div
        key={`gap-${col}-${index}`}
        onDragOver={(e) => {
          if (!dragged) return;
          if (!canMove(dragged, col, isHost, me)) return;
          e.preventDefault();
          e.stopPropagation();
          setHoverGap({ column: col, index });
        }}
        onDragLeave={() => {
          if (active) setHoverGap(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setHoverGap(null);
          setHoverColumn(null);
          if (!dragged) return;
          if (!canMove(dragged, col, isHost, me)) return;
          // Adjust index: if the dragged card already sits in this column at
          // index k and is being dropped at index > k, real insertion is at
          // index-1 (because removing it first shifts everything up).
          let pos = index;
          if (dragged.column === col) {
            const k = byColumn[col].findIndex((c) => c.id === dragged.id);
            if (k !== -1 && index > k) pos = index - 1;
          }
          socketManager.kanbanMove(dragged.id, col, pos);
          setDraggedId(null);
        }}
        className="h-2 transition-colors"
        style={{
          background: active ? 'rgba(99,102,241,0.7)' : 'transparent',
          borderRadius: 2,
        }}
      />
    );
  }
```

- [ ] **Step 3: Interleave gaps with cards**

In the column body, replace the simple `byColumn[col].map(...)` with:

```tsx
              {col === 'todo' && <CreateCardForm />}
              {renderDropGap(col, 0)}
              {byColumn[col].map((c, i) => (
                <Fragment key={c.id}>
                  <CardView
                    card={c}
                    isHost={isHost}
                    me={me}
                    draggedId={draggedId}
                    setDraggedId={setDraggedId}
                  />
                  {renderDropGap(col, i + 1)}
                </Fragment>
              ))}
              {byColumn[col].length === 0 && (
                <div className="rounded-md border border-dashed border-white/10 p-3 text-center text-xs text-slate-500">
                  Aucune carte
                </div>
              )}
```

Add `Fragment` to the React import: `import { useState, Fragment } from 'react';`.

- [ ] **Step 4: Type-check**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add client/src/react/components/KanbanModal.tsx
git commit -m "feat(client): KanbanModal — gap drop zones (precise position + intra-column reorder)"
```

---

## Task 15: Relative-time helper (TDD)

**Files:**
- Create: `client/src/react/components/kanbanRelativeTime.ts`
- Create: `client/src/react/components/kanbanRelativeTime.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { relativeTimeFr } from './kanbanRelativeTime';

describe('relativeTimeFr', () => {
  const NOW = new Date('2026-05-26T12:00:00Z').getTime();

  it('returns "à l\'instant" if < 60s', () => {
    expect(relativeTimeFr(NOW - 30_000, NOW)).toBe("à l'instant");
  });

  it('returns "il y a Xmin" if < 1h', () => {
    expect(relativeTimeFr(NOW - 5 * 60_000, NOW)).toBe('il y a 5min');
    expect(relativeTimeFr(NOW - 59 * 60_000, NOW)).toBe('il y a 59min');
  });

  it('returns "il y a Xh" if < 24h', () => {
    expect(relativeTimeFr(NOW - 2 * 3600_000, NOW)).toBe('il y a 2h');
  });

  it('returns "il y a Xj" if < 7d', () => {
    expect(relativeTimeFr(NOW - 3 * 86400_000, NOW)).toBe('il y a 3j');
  });

  it('returns ISO short date for >= 7d', () => {
    const t = NOW - 30 * 86400_000;
    expect(relativeTimeFr(t, NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Run, expect failures**

```bash
cd client && npx vitest run src/react/components/kanbanRelativeTime.test.ts
```

- [ ] **Step 3: Implement**

```ts
/**
 * Returns a French relative time label for a past timestamp.
 * Default `now` is `Date.now()`. Both args are ms epoch.
 */
export function relativeTimeFr(timestamp: number, now: number = Date.now()): string {
  const deltaSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (deltaSec < 60) return "à l'instant";
  if (deltaSec < 3600) return `il y a ${Math.floor(deltaSec / 60)}min`;
  if (deltaSec < 86400) return `il y a ${Math.floor(deltaSec / 3600)}h`;
  if (deltaSec < 7 * 86400) return `il y a ${Math.floor(deltaSec / 86400)}j`;
  return new Date(timestamp).toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run tests, expect green**

```bash
cd client && npx vitest run src/react/components/kanbanRelativeTime.test.ts
```

- [ ] **Step 5: Use it in CardView**

Open `client/src/react/components/KanbanModal.tsx`. Add import:

```ts
import { relativeTimeFr } from './kanbanRelativeTime';
```

In `CardView`, replace the meta footer block with:

```tsx
      <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">
        Par {card.authorName} · {relativeTimeFr(card.createdAt)}
        {card.column === 'done' && card.completedByName && card.completedAt && (
          <> · Terminé par {card.completedByName} {relativeTimeFr(card.completedAt)}</>
        )}
      </div>
```

- [ ] **Step 6: Commit**

```bash
git add client/src/react/components/kanbanRelativeTime.ts client/src/react/components/kanbanRelativeTime.test.ts client/src/react/components/KanbanModal.tsx
git commit -m "feat(client): relative-time helper + show in CardView"
```

---

## Task 16: Toast on new-card-by-another-user

**Files:**
- Create: `client/src/react/components/KanbanToasts.tsx`
- Modify: `client/src/react/HUD.tsx`

- [ ] **Step 1: Create the toast component**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';

interface Toast { id: number; text: string }

export function KanbanToasts() {
  const cards = useGameStore((s) => s.kanbanCards);
  const me = useGameStore((s) => s.localPlayerId);
  const seen = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  useEffect(() => {
    if (!initialized.current) {
      // First batch: just register IDs, don't toast for the existing state.
      for (const c of cards) seen.current.add(c.id);
      initialized.current = true;
      return;
    }
    const fresh: Toast[] = [];
    for (const c of cards) {
      if (seen.current.has(c.id)) continue;
      seen.current.add(c.id);
      if (c.authorId === me) continue; // don't toast our own creations
      fresh.push({ id: nextId.current++, text: `${c.authorName} a ajouté : ${c.title}` });
    }
    if (fresh.length > 0) {
      setToasts((prev) => [...prev, ...fresh].slice(-3));
    }
    // Also clean up IDs that disappeared (deletes), so a re-add gets a toast.
    const live = new Set(cards.map((c) => c.id));
    for (const id of seen.current) if (!live.has(id)) seen.current.delete(id);
  }, [cards, me]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts((prev) => prev.slice(1)), 4000);
    return () => clearTimeout(t);
  }, [toasts]);

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-20 z-30 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto rounded-md bg-indigo-600/95 px-3 py-2 text-xs text-white shadow-lg ring-1 ring-indigo-300/40"
        >
          💡 {t.text}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Mount in HUD**

In `HUD.tsx`:

```tsx
import { KanbanToasts } from './components/KanbanToasts';
// ...
      <KanbanToasts />
```

- [ ] **Step 3: Type-check**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add client/src/react/components/KanbanToasts.tsx client/src/react/HUD.tsx
git commit -m "feat(client): toast when another user creates a kanban card"
```

---

## Task 17: Build, smoke-test, deploy

**Files:** none (deploy step only)

- [ ] **Step 1: Run all tests**

```bash
cd /home/openclaw/projects/webinti-town/client && npx vitest run
cd /home/openclaw/projects/webinti-town/server && npx vitest run
```

Expected: all green (existing + new tests).

- [ ] **Step 2: Backup current dists (rollback safety net)**

```bash
cd /home/openclaw/projects/webinti-town
TS=$(date +%Y%m%d-%H%M%S)
cp -r client/dist client/dist.backup-${TS}
cp -r server/dist server/dist.backup-${TS}
echo "backups: client/dist.backup-${TS} server/dist.backup-${TS}"
```

- [ ] **Step 3: Build prod**

```bash
cd client && npm run build
cd ../server && npm run build
```

Expected: both succeed, no TS errors.

- [ ] **Step 4: Restart service**

```bash
sudo -n /bin/systemctl restart webinti-server
sleep 2
systemctl is-active webinti-server
journalctl -u webinti-server -n 10 --no-pager | tail -5
```

Expected: `active`, no error in the last 5 lines.

- [ ] **Step 5: Smoke test from the user's Mac**

Ask the user to:
1. Open https://live.webinti.com/?room=test-kanban (fresh room).
2. Walk to the post-it board next to the whiteboard.
3. Press E — modal opens with empty 3 columns.
4. Add a card — appears in À faire, persists after refresh.
5. As another participant: add a card → first user sees a toast.
6. Drag card todo→doing, drop in column → moves to end of En cours.
7. Drag card by its gap to reorder within a column.
8. As host: click ✓ on a card → moves to Terminé. Click ↩ → reactivates.
9. Restart the service: `sudo -n /bin/systemctl restart webinti-server`. Reopen the room → cards still there (loaded from `server/data/kanban-test-kanban.json`).

If any of step 4–9 fails, **rollback**:

```bash
cd /home/openclaw/projects/webinti-town
rm -rf client/dist server/dist
mv client/dist.backup-${TS} client/dist
mv server/dist.backup-${TS} server/dist
sudo -n /bin/systemctl restart webinti-server
```

- [ ] **Step 6: Final commit (if needed) + push**

If you have no working-tree changes left, you're done. Otherwise commit any remaining cleanup and (from the user's machine, since the VPS has no GitHub creds) `git push origin main`.

---

## Self-review (already done — see below)

Spec coverage:
- Persistance JSON par room ✅ Task 3 + Task 4 (.gitignore + .gitkeep)
- Modèle KanbanCard avec tous les champs ✅ Task 1 + Task 6
- Permissions strictes (table) ✅ Task 2 (tests) + Task 5 (host stamp)
- Protocole socket (create/update/move/delete/state) ✅ Task 5 + Task 8
- Drag-and-drop avec position précise ✅ Tasks 13 + 14
- Toast création par autre joueur ✅ Task 16
- Relative time ✅ Task 15
- Visuel sur map + accès E ✅ Task 9
- État partagé via gameStore ✅ Task 7
- Sauvegarde atomique (tmp + rename) ✅ Task 3
- Lecture lazy au démarrage / fichier absent OK ✅ Task 3 tests
- Tests vitest ✅ Tasks 2, 3, 15

Placeholder scan: no TBD/TODO. Each step shows full code.

Type consistency: `KanbanCard.completedByName` is set in two places — `move()` sets `null` on reactivation; `setCompletedByName()` is invoked from the socket handler after `move(...)` with target `'done'`. The store knows the actor's `playerId` (used for `completedBy`) but not the human name — that's why we pass it back through `setCompletedByName`. Consistent.
