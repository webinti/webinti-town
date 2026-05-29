import { randomUUID } from 'node:crypto';
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
const TITLE_MAX = 80;
const DESCRIPTION_MAX = 500;
const VALID_COLUMNS = new Set(['todo', 'doing', 'done']);
export class KanbanStore {
    cards = [];
    roomSlug;
    persistEnabled;
    dataDir;
    saveTimer = null;
    savePending = null;
    constructor(opts) {
        this.roomSlug = opts.roomSlug;
        this.persistEnabled = opts.persist;
        this.dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
    }
    getCards() {
        // Return a defensive copy; mutations must go through the store API.
        return this.cards.map((c) => ({ ...c }));
    }
    create(authorId, authorName, rawTitle, rawDescription) {
        const title = (rawTitle ?? '').trim();
        if (title.length < 1 || title.length > TITLE_MAX)
            return false;
        const description = (rawDescription ?? '').slice(0, DESCRIPTION_MAX);
        const now = Date.now();
        const card = {
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
    update(actorId, cardId, patch) {
        const card = this.cards.find((c) => c.id === cardId);
        if (!card)
            return false;
        if (card.authorId !== actorId)
            return false;
        let dirty = false;
        if (patch.title !== undefined) {
            const t = patch.title.trim();
            if (t.length < 1 || t.length > TITLE_MAX)
                return false;
            if (t !== card.title) {
                card.title = t;
                dirty = true;
            }
        }
        if (patch.description !== undefined) {
            const d = patch.description.slice(0, DESCRIPTION_MAX);
            if (d !== card.description) {
                card.description = d;
                dirty = true;
            }
        }
        if (dirty) {
            card.updatedAt = Date.now();
            this.scheduleSave();
        }
        return true;
    }
    delete(actorId, cardId) {
        const idx = this.cards.findIndex((c) => c.id === cardId);
        if (idx === -1)
            return false;
        if (this.cards[idx].authorId !== actorId)
            return false;
        this.cards.splice(idx, 1);
        this.scheduleSave();
        return true;
    }
    move(actorId, isHost, cardId, column, position) {
        if (!VALID_COLUMNS.has(column))
            return false;
        const idx = this.cards.findIndex((c) => c.id === cardId);
        if (idx === -1)
            return false;
        const card = this.cards[idx];
        const sourceColumn = card.column;
        const isAuthor = card.authorId === actorId;
        // Permission table.
        if (column === 'done' || sourceColumn === 'done') {
            // Any move into or out of "done" requires host.
            if (!isHost)
                return false;
        }
        else {
            // todo↔doing and intra-todo / intra-doing reorder.
            if (sourceColumn !== column) {
                // Cross-column (todo↔doing): author only.
                if (!isAuthor)
                    return false;
            }
            else {
                // Intra-column reorder: author OR host.
                if (!isAuthor && !isHost)
                    return false;
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
        }
        else if (sourceColumn === 'done' && column !== 'done') {
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
    setCompletedByName(cardId, name) {
        const card = this.cards.find((c) => c.id === cardId);
        if (!card)
            return;
        if (card.column !== 'done')
            return;
        if (card.completedByName === name)
            return;
        card.completedByName = name;
        this.scheduleSave();
    }
    computeInsertIndex(column, requestedPosition) {
        // Indices of cards already in target column.
        const sameColumnIdx = [];
        for (let i = 0; i < this.cards.length; i++) {
            if (this.cards[i].column === column)
                sameColumnIdx.push(i);
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
            return sameColumnIdx[sameColumnIdx.length - 1] + 1;
        }
        return sameColumnIdx[pos];
    }
    scheduleSave() {
        if (!this.persistEnabled)
            return;
        if (this.saveTimer)
            clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.savePending = this.saveNow().catch((err) => {
                console.warn('[kanban] save failed for', this.roomSlug, err);
            });
        }, SAVE_DEBOUNCE_MS);
    }
    async flush() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
            await this.saveNow();
            return;
        }
        if (this.savePending)
            await this.savePending;
    }
    async load() {
        if (!this.persistEnabled)
            return;
        const path = this.filePath();
        try {
            const raw = await fs.readFile(path, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.cards)) {
                // Strict-shape filter: drop entries that don't look like a card.
                this.cards = parsed.cards.filter((c) => isWellShapedCard(c));
            }
        }
        catch (err) {
            const code = err.code;
            if (code === 'ENOENT')
                return; // first run, fine
            console.warn('[kanban] load failed for', this.roomSlug, '— starting empty', err);
            this.cards = [];
        }
    }
    filePath() {
        return join(this.dataDir, `kanban-${this.roomSlug}.json`);
    }
    async saveNow() {
        const path = this.filePath();
        const tmp = `${path}.tmp`;
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            const payload = JSON.stringify({ version: FILE_VERSION, cards: this.cards });
            await fs.writeFile(tmp, payload, 'utf8');
            await fs.rename(tmp, path);
        }
        catch (err) {
            // Clean up the orphan .tmp file on any failure.
            try {
                await fs.unlink(tmp);
            }
            catch { /* ignore cleanup errors */ }
            throw err;
        }
    }
}
function isWellShapedCard(c) {
    if (typeof c !== 'object' || c === null)
        return false;
    const r = c;
    return (typeof r.id === 'string' &&
        typeof r.title === 'string' &&
        typeof r.description === 'string' &&
        typeof r.authorId === 'string' &&
        typeof r.authorName === 'string' &&
        (r.column === 'todo' || r.column === 'doing' || r.column === 'done') &&
        typeof r.createdAt === 'number' &&
        typeof r.updatedAt === 'number' &&
        (r.completedAt === null || typeof r.completedAt === 'number') &&
        (r.completedBy === null || typeof r.completedBy === 'string') &&
        (r.completedByName === null || typeof r.completedByName === 'string'));
}
//# sourceMappingURL=KanbanStore.js.map