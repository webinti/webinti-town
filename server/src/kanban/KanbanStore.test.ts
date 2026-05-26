import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
