import type { ChatAttachment, DmMessage } from '../types.js';
import { getPocketBase } from '../pocketbase/client.js';
import { pairKey } from './DmStore.js';

// Doit rester aligné avec MESSAGE_MAX_LEN (socket/handlers.ts).
const TEXT_MAX = 10000;
const PER_CONV_CAP = 200;

export interface DmStorePocketBaseOptions {
  roomSlug: string;
}

/**
 * DmStore variant qui persiste les DM dans la collection PocketBase
 * `dm_messages`. API identique à DmStore.
 *
 *   - Cache en mémoire des conversations groupées par pairKey
 *   - Chaque message = un record PB ; id = PB record id
 *   - append() await PB create → garantie d'id stable avant emit
 *   - markRead() update PB silencieusement (best-effort, pas critique)
 */
export class DmStorePocketBase {
  private conversations: Map<string, DmMessage[]> = new Map();
  protected readonly roomSlug: string;
  protected readonly persistEnabled = true;
  private loadPromise: Promise<void> | null = null;
  private pendingWrites = new Set<Promise<unknown>>();

  constructor(opts: DmStorePocketBaseOptions) {
    this.roomSlug = opts.roomSlug;
  }

  async append(from: string, to: string, rawText: string, attachment: ChatAttachment | null): Promise<DmMessage | null> {
    if (!from || !to || from === to) return null;
    const text = (rawText ?? '').slice(0, TEXT_MAX);
    if (text.trim().length === 0 && !attachment) return null;

    const key = pairKey(from, to);
    try {
      const pb = await getPocketBase();
      const ts = Date.now();
      const rec = await pb.collection('dm_messages').create({
        roomSlug: this.roomSlug,
        fromId: from,
        toId: to,
        text,
        attachment,
        ts,
        readBy: [from],
      });
      const msg: DmMessage = {
        id: rec.id,
        from, to, text, attachment, ts,
        readBy: [from],
      };
      let list = this.conversations.get(key);
      if (!list) { list = []; this.conversations.set(key, list); }
      list.push(msg);
      if (list.length > PER_CONV_CAP) list.splice(0, list.length - PER_CONV_CAP);
      return msg;
    } catch (err) {
      console.warn('[dm-pb] append failed', err);
      return null;
    }
  }

  markRead(reader: string, withPlayer: string): void {
    const key = pairKey(reader, withPlayer);
    const list = this.conversations.get(key);
    if (!list) return;
    const toUpdate: Array<{ pbId: string; readBy: string[] }> = [];
    for (const m of list) {
      if (!m.readBy.includes(reader)) {
        m.readBy.push(reader);
        toUpdate.push({ pbId: m.id, readBy: [...m.readBy] });
      }
    }
    if (toUpdate.length === 0) return;
    this.trackPending((async () => {
      try {
        const pb = await getPocketBase();
        await Promise.allSettled(
          toUpdate.map((u) => pb.collection('dm_messages').update(u.pbId, { readBy: u.readBy })),
        );
      } catch (err) {
        console.warn('[dm-pb] markRead failed', err);
      }
    })());
  }

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

  async flush(): Promise<void> {
    if (this.pendingWrites.size === 0) return;
    await Promise.allSettled(Array.from(this.pendingWrites));
  }

  /** Supprime les messages plus vieux que maxAgeMs (mémoire + PocketBase). */
  async prune(maxAgeMs: number, now: number = Date.now()): Promise<void> {
    const cutoff = now - maxAgeMs;
    for (const [key, list] of this.conversations) {
      const kept = list.filter((m) => m.ts >= cutoff);
      if (kept.length === 0) this.conversations.delete(key);
      else if (kept.length !== list.length) this.conversations.set(key, kept);
    }
    try {
      const pb = await getPocketBase();
      const old = await pb.collection('dm_messages').getFullList({
        filter: `roomSlug = ${JSON.stringify(this.roomSlug)} && ts < ${cutoff}`,
      });
      for (const r of old) {
        await pb.collection('dm_messages').delete(r.id).catch(() => { /* ignore */ });
      }
    } catch (err) {
      console.warn('[dm-pb] prune failed for', this.roomSlug, err);
    }
  }

  async load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      try {
        const pb = await getPocketBase();
        const records = await pb.collection('dm_messages').getFullList({
          filter: `roomSlug = "${this.roomSlug.replace(/"/g, '\\"')}"`,
          sort: 'ts',
        });
        const map = new Map<string, DmMessage[]>();
        for (const r of records) {
          const from = String(r.fromId ?? '');
          const to = String(r.toId ?? '');
          if (!from || !to) continue;
          const key = pairKey(from, to);
          let list = map.get(key);
          if (!list) { list = []; map.set(key, list); }
          list.push({
            id: r.id,
            from, to,
            text: String(r.text ?? ''),
            attachment: (r.attachment as ChatAttachment | null) ?? null,
            ts: Number(r.ts ?? 0),
            readBy: Array.isArray(r.readBy) ? r.readBy.map((x) => String(x)) : [],
          });
        }
        // Apply per-conv cap
        for (const list of map.values()) {
          if (list.length > PER_CONV_CAP) list.splice(0, list.length - PER_CONV_CAP);
        }
        this.conversations = map;
      } catch (err) {
        console.warn('[dm-pb] load failed for', this.roomSlug, '— starting empty', err);
        this.conversations = new Map();
      }
    })();
    return this.loadPromise;
  }

  private trackPending(p: Promise<unknown>): void {
    this.pendingWrites.add(p);
    void p.finally(() => this.pendingWrites.delete(p));
  }
}
