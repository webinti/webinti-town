import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KanbanCard, KanbanColumn } from '../types.js';

const DEFAULT_DATA_DIR = (() => {
  // server/src/kanban/KanbanStore.ts → ../../data == server/data
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'data');
})();

const SAVE_DEBOUNCE_MS = 50;
const FILE_VERSION = 1;

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
  private readonly dataDir: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private savePending: Promise<void> | null = null;

  constructor(opts: KanbanStoreOptions) {
    this.roomSlug = opts.roomSlug;
    this.persistEnabled = opts.persist;
    this.dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
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

  // Memoized load promise — load() est appelé plusieurs fois (au création
  // de la room ET au join de chaque joueur). On garde la même promesse pour
  // qu'on lise le fichier au plus une fois, et que les callers puissent attendre
  // la fin de la lecture avant de demander getCards().
  private loadPromise: Promise<void> | null = null;

  async load(): Promise<void> {
    if (!this.persistEnabled) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
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
    })();
    return this.loadPromise;
  }

  private filePath(): string {
    return join(this.dataDir, `kanban-${this.roomSlug}.json`);
  }

  private async saveNow(): Promise<void> {
    const path = this.filePath();
    const tmp = `${path}.tmp`;
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const payload = JSON.stringify({ version: FILE_VERSION, cards: this.cards });
      await fs.writeFile(tmp, payload, 'utf8');
      await fs.rename(tmp, path);
    } catch (err) {
      // Clean up the orphan .tmp file on any failure.
      try {
        await fs.unlink(tmp);
      } catch { /* ignore cleanup errors */ }
      throw err;
    }
  }
}

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
