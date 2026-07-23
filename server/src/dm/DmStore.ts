import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatAttachment, DmMessage } from '../types.js';

const DEFAULT_DATA_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'data');
})();

const SAVE_DEBOUNCE_MS = 50;
const FILE_VERSION = 1;
// Doit rester aligné avec MESSAGE_MAX_LEN (socket/handlers.ts).
const TEXT_MAX = 10000;
const PER_CONV_CAP = 200;
const CONVERSATIONS_CAP = 50;

export interface DmStoreOptions {
  roomSlug: string;
  persist: boolean;
  dataDir?: string;
}

/** Canonical pair key: alphabetically sorted "idA|idB" so it doesn't matter who initiated. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export class DmStore {
  private conversations: Map<string, DmMessage[]> = new Map();
  private readonly roomSlug: string;
  private readonly persistEnabled: boolean;
  private readonly dataDir: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private savePending: Promise<void> | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(opts: DmStoreOptions) {
    this.roomSlug = opts.roomSlug;
    this.persistEnabled = opts.persist;
    this.dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
  }

  /** Append a new DM. Returns the persisted message or null if validation failed. */
  append(from: string, to: string, rawText: string, attachment: ChatAttachment | null): DmMessage | null {
    if (!from || !to || from === to) return null;
    const text = (rawText ?? '').slice(0, TEXT_MAX);
    if (text.trim().length === 0 && !attachment) return null;

    const key = pairKey(from, to);
    let list = this.conversations.get(key);
    if (!list) {
      if (this.conversations.size >= CONVERSATIONS_CAP) {
        // Evict the conversation with the oldest last message
        let oldestKey: string | null = null;
        let oldestTs = Infinity;
        for (const [k, msgs] of this.conversations) {
          const last = msgs[msgs.length - 1];
          const ts = last?.ts ?? 0;
          if (ts < oldestTs) { oldestTs = ts; oldestKey = k; }
        }
        if (oldestKey) this.conversations.delete(oldestKey);
      }
      list = [];
      this.conversations.set(key, list);
    }

    const msg: DmMessage = {
      id: randomUUID(),
      from,
      to,
      text,
      attachment,
      ts: Date.now(),
      readBy: [from],
    };
    list.push(msg);
    if (list.length > PER_CONV_CAP) list.splice(0, list.length - PER_CONV_CAP);
    this.scheduleSave();
    return msg;
  }

  /**
   * Édite un DM. Seul l'auteur (from) peut modifier ; le texte ne peut être
   * vide que si le message porte une pièce jointe. Retourne une copie du
   * message à jour, ou null si introuvable/refusé.
   */
  edit(requesterId: string, messageId: string, rawText: string): DmMessage | null {
    const text = (rawText ?? '').slice(0, TEXT_MAX);
    for (const list of this.conversations.values()) {
      const msg = list.find((m) => m.id === messageId);
      if (!msg) continue;
      if (msg.from !== requesterId) return null;
      if (text.trim().length === 0 && !msg.attachment) return null;
      msg.text = text;
      msg.editedAt = Date.now();
      this.scheduleSave();
      return { ...msg, readBy: [...msg.readBy] };
    }
    return null;
  }

  /** Supprime un DM. Seul l'auteur (from) peut supprimer. Retourne le message supprimé ou null. */
  remove(requesterId: string, messageId: string): DmMessage | null {
    for (const [key, list] of this.conversations) {
      const idx = list.findIndex((m) => m.id === messageId);
      if (idx < 0) continue;
      const msg = list[idx]!;
      if (msg.from !== requesterId) return null;
      list.splice(idx, 1);
      if (list.length === 0) this.conversations.delete(key);
      this.scheduleSave();
      return msg;
    }
    return null;
  }

  /** Supprime les messages plus vieux que maxAgeMs (TTL). Vide les conversations devenues vides. */
  prune(maxAgeMs: number, now: number = Date.now()): void {
    const cutoff = now - maxAgeMs;
    let changed = false;
    for (const [key, list] of this.conversations) {
      const kept = list.filter((m) => m.ts >= cutoff);
      if (kept.length === list.length) continue;
      changed = true;
      if (kept.length === 0) this.conversations.delete(key);
      else this.conversations.set(key, kept);
    }
    if (changed) this.scheduleSave();
  }

  /** Mark all messages in the (reader, withPlayer) conversation as read by `reader`. */
  markRead(reader: string, withPlayer: string): void {
    const key = pairKey(reader, withPlayer);
    const list = this.conversations.get(key);
    if (!list) return;
    let changed = false;
    for (const m of list) {
      if (!m.readBy.includes(reader)) {
        m.readBy.push(reader);
        changed = true;
      }
    }
    if (changed) this.scheduleSave();
  }

  /** Returns conversations where playerId is involved, as a plain object keyed by *the other* player's id. */
  getConversationsFor(playerId: string): Record<string, DmMessage[]> {
    const result: Record<string, DmMessage[]> = {};
    for (const [key, msgs] of this.conversations) {
      const [a, b] = key.split('|');
      if (a !== playerId && b !== playerId) continue;
      const other = a === playerId ? b! : a!;
      result[other] = msgs.map((m) => ({ ...m, readBy: [...m.readBy] }));
    }
    return result;
  }

  private scheduleSave(): void {
    if (!this.persistEnabled) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.savePending = this.saveNow().catch((err) => {
        console.warn('[dm] save failed for', this.roomSlug, err);
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
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      const path = this.filePath();
      try {
        const raw = await fs.readFile(path, 'utf8');
        const parsed = JSON.parse(raw) as {
          version?: number;
          conversations?: Record<string, DmMessage[]>;
        };
        if (parsed && parsed.conversations && typeof parsed.conversations === 'object') {
          for (const [key, msgs] of Object.entries(parsed.conversations)) {
            if (!Array.isArray(msgs)) continue;
            const filtered = msgs.filter(isWellShapedDm);
            if (filtered.length > 0) this.conversations.set(key, filtered);
          }
        }
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return;
        console.warn('[dm] load failed for', this.roomSlug, '— starting empty', err);
        this.conversations = new Map();
      }
    })();
    return this.loadPromise;
  }

  private filePath(): string {
    return join(this.dataDir, `dm-${this.roomSlug}.json`);
  }

  private async saveNow(): Promise<void> {
    const path = this.filePath();
    const tmp = `${path}.tmp`;
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      const obj: Record<string, DmMessage[]> = {};
      for (const [k, v] of this.conversations) obj[k] = v;
      const payload = JSON.stringify({ version: FILE_VERSION, conversations: obj });
      await fs.writeFile(tmp, payload, 'utf8');
      await fs.rename(tmp, path);
    } catch (err) {
      try { await fs.unlink(tmp); } catch { /* ignore */ }
      throw err;
    }
  }
}

function isWellShapedDm(c: unknown): c is DmMessage {
  if (typeof c !== 'object' || c === null) return false;
  const r = c as Record<string, unknown>;
  const attachmentOk =
    r.attachment === null ||
    (typeof r.attachment === 'object' && r.attachment !== null);
  return (
    typeof r.id === 'string' &&
    typeof r.from === 'string' &&
    typeof r.to === 'string' &&
    typeof r.text === 'string' &&
    typeof r.ts === 'number' &&
    Array.isArray(r.readBy) &&
    attachmentOk
  );
}
