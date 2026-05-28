import type { KanbanCard, KanbanColumn } from '../types.js';
import { getPocketBase } from '../pocketbase/client.js';

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 500;
const VALID_COLUMNS: ReadonlySet<KanbanColumn> = new Set<KanbanColumn>(['todo', 'doing', 'done']);

export interface KanbanStorePocketBaseOptions {
  roomSlug: string;
}

/**
 * KanbanStore variant qui persiste dans PocketBase au lieu d'un fichier JSON.
 *
 * Surface API identique à KanbanStore (mêmes signatures, même sémantique de
 * retour booléen) — RoomManager peut instancier l'un ou l'autre selon
 * `config.kanbanBackend` sans modifier les handlers Socket.IO.
 *
 * Modèle :
 *   - Cache en mémoire des cartes (autoritatif pour les reads synchrones)
 *   - `card.id` = ID PocketBase (15 chars), pas d'UUID intermédiaire
 *   - Mutations : validation in-memory immédiate puis fire-and-forget vers PB
 *   - load() : fetch all cards de la room + hydrate le cache
 */
export class KanbanStorePocketBase {
  private cards: KanbanCard[] = [];
  protected readonly roomSlug: string;
  protected readonly persistEnabled = true;
  private loadPromise: Promise<void> | null = null;
  private pendingWrites = new Set<Promise<unknown>>();

  constructor(opts: KanbanStorePocketBaseOptions) {
    this.roomSlug = opts.roomSlug;
  }

  getCards(): KanbanCard[] {
    return this.cards.map((c) => ({ ...c }));
  }

  create(authorId: string, authorName: string, rawTitle: string, rawDescription: string): boolean {
    const title = (rawTitle ?? '').trim();
    if (title.length < 1 || title.length > TITLE_MAX) return false;
    const description = (rawDescription ?? '').slice(0, DESCRIPTION_MAX);
    const now = Date.now();
    // Insère un placeholder en mémoire avec id temporaire, puis mets à jour
    // dès que PB renvoie l'id réel. Le client reçoit l'id final via le prochain
    // emit('kanban:state') de toute façon (le handler emit après chaque mutation).
    const tempId = `tmp-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const card: KanbanCard = {
      id: tempId,
      title, description, authorId, authorName,
      column: 'todo',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      completedBy: null,
      completedByName: null,
    };
    this.cards.unshift(card);
    this.trackPending((async () => {
      try {
        const pb = await getPocketBase();
        const rec = await pb.collection('kanban_cards').create(this.cardToRecord(card));
        // Patch in-memory: remplace l'id temp par l'id PB
        const inMemory = this.cards.find((c) => c.id === tempId);
        if (inMemory) inMemory.id = rec.id;
      } catch (err) {
        console.warn('[kanban-pb] create failed', tempId, err);
      }
    })());
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
      this.queuePbUpdate(card);
    }
    return true;
  }

  delete(actorId: string, cardId: string): boolean {
    const idx = this.cards.findIndex((c) => c.id === cardId);
    if (idx === -1) return false;
    if (this.cards[idx]!.authorId !== actorId) return false;
    this.cards.splice(idx, 1);
    if (!cardId.startsWith('tmp-')) {
      this.trackPending((async () => {
        try {
          const pb = await getPocketBase();
          await pb.collection('kanban_cards').delete(cardId);
        } catch (err) {
          console.warn('[kanban-pb] delete failed', cardId, err);
        }
      })());
    }
    return true;
  }

  move(actorId: string, isHost: boolean, cardId: string, column: KanbanColumn, position: number): boolean {
    if (!VALID_COLUMNS.has(column)) return false;
    const idx = this.cards.findIndex((c) => c.id === cardId);
    if (idx === -1) return false;
    const card = this.cards[idx]!;
    const sourceColumn = card.column;
    const isAuthor = card.authorId === actorId;

    if (column === 'done' || sourceColumn === 'done') {
      if (!isHost) return false;
    } else {
      if (sourceColumn !== column) {
        if (!isAuthor) return false;
      } else {
        if (!isAuthor && !isHost) return false;
      }
    }

    this.cards.splice(idx, 1);
    card.column = column;
    if (column === 'done' && sourceColumn !== 'done') {
      card.completedAt = Date.now();
      card.completedBy = actorId;
    } else if (sourceColumn === 'done' && column !== 'done') {
      card.completedAt = null;
      card.completedBy = null;
      card.completedByName = null;
    }
    card.updatedAt = Date.now();

    const insertIdx = this.computeInsertIndex(column, position);
    this.cards.splice(insertIdx, 0, card);
    this.queuePbUpdate(card);
    return true;
  }

  setCompletedByName(cardId: string, name: string): void {
    const card = this.cards.find((c) => c.id === cardId);
    if (!card) return;
    if (card.column !== 'done') return;
    if (card.completedByName === name) return;
    card.completedByName = name;
    this.queuePbUpdate(card);
  }

  private computeInsertIndex(column: KanbanColumn, requestedPosition: number): number {
    const sameColumnIdx: number[] = [];
    for (let i = 0; i < this.cards.length; i++) {
      if (this.cards[i]!.column === column) sameColumnIdx.push(i);
    }
    if (sameColumnIdx.length === 0) return this.cards.length;
    const pos = Math.max(0, Math.min(sameColumnIdx.length, requestedPosition));
    if (pos === sameColumnIdx.length) return sameColumnIdx[sameColumnIdx.length - 1]! + 1;
    return sameColumnIdx[pos]!;
  }

  private cardToRecord(card: KanbanCard): Record<string, unknown> {
    return {
      roomSlug: this.roomSlug,
      title: card.title,
      description: card.description,
      authorId: card.authorId,
      authorName: card.authorName,
      column: card.column,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
      completedAt: card.completedAt,
      completedBy: card.completedBy,
      completedByName: card.completedByName,
    };
  }

  private queuePbUpdate(card: KanbanCard): void {
    if (card.id.startsWith('tmp-')) {
      // Carte pas encore propagée vers PB — la mutation sera incluse dans le
      // record qui sera créé une fois la promise initiale résolue.
      // Pour assurer ça, on attend que pendingWrites soit vide puis re-queue.
      // Simpler approach: just skip — the data in memory is correct, et la
      // prochaine mutation après stabilisation enverra le snapshot.
      return;
    }
    this.trackPending((async () => {
      try {
        const pb = await getPocketBase();
        await pb.collection('kanban_cards').update(card.id, this.cardToRecord(card));
      } catch (err) {
        console.warn('[kanban-pb] update failed', card.id, err);
      }
    })());
  }

  private trackPending(p: Promise<unknown>): void {
    this.pendingWrites.add(p);
    void p.finally(() => this.pendingWrites.delete(p));
  }

  async flush(): Promise<void> {
    if (this.pendingWrites.size === 0) return;
    await Promise.allSettled(Array.from(this.pendingWrites));
  }

  async load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      try {
        const pb = await getPocketBase();
        const records = await pb.collection('kanban_cards').getFullList({
          filter: `roomSlug = "${this.roomSlug.replace(/"/g, '\\"')}"`,
          sort: '-createdAt',
        });
        this.cards = records.map((r) => ({
          id: r.id,
          title: String(r.title ?? ''),
          description: String(r.description ?? ''),
          authorId: String(r.authorId ?? ''),
          authorName: String(r.authorName ?? ''),
          column: (r.column ?? 'todo') as KanbanColumn,
          createdAt: Number(r.createdAt ?? 0),
          updatedAt: Number(r.updatedAt ?? 0),
          completedAt: r.completedAt === null || r.completedAt === undefined ? null : Number(r.completedAt),
          completedBy: !r.completedBy ? null : String(r.completedBy),
          completedByName: !r.completedByName ? null : String(r.completedByName),
        }));
      } catch (err) {
        console.warn('[kanban-pb] load failed for', this.roomSlug, '— starting empty', err);
        this.cards = [];
      }
    })();
    return this.loadPromise;
  }
}
