import type { WorkstationState } from '../types.js';
import type { Workstation } from '../workstations.js';
import { workstationIdForPointIn } from '../workstations.js';
import { getPocketBase } from '../pocketbase/client.js';

export interface WorkstationManagerPocketBaseOptions {
  roomSlug: string;
}

/**
 * WorkstationManager variant qui persiste les claims dans la collection PB
 * `workstation_states` (un record par claim actif, identifié par
 * (roomSlug, workstationId)).
 *
 * Surface API identique à WorkstationManager (mutators retournent Promise<bool>
 * en PB mode, sync bool en JSON mode — la signature est élargie à
 * `boolean | Promise<boolean>` et les handlers await).
 */
export class WorkstationManagerPocketBase {
  private readonly workstations: readonly Workstation[];
  private readonly states = new Map<string, WorkstationState>();
  // Map workstationId → PB record id (pour update/delete)
  private readonly pbIdByWsId = new Map<string, string>();
  protected readonly roomSlug: string;
  protected readonly persistEnabled = true;
  private loadPromise: Promise<void> | null = null;
  private pendingWrites = new Set<Promise<unknown>>();

  constructor(workstations: readonly Workstation[], opts: WorkstationManagerPocketBaseOptions) {
    this.workstations = workstations;
    this.roomSlug = opts.roomSlug;
    for (const w of workstations) {
      this.states.set(w.id, {
        id: w.id,
        claimedBy: null,
        claimedByName: null,
        invitedPlayerIds: [],
        claimedAt: null,
        customName: null,
      });
    }
  }

  getState(workstationId: string): WorkstationState | undefined {
    return this.states.get(workstationId);
  }

  private isHidden(workstationId: string): boolean {
    return this.workstations.find((w) => w.id === workstationId)?.hidden === true;
  }

  getAllStates(): WorkstationState[] {
    return this.workstations.map((w) => ({ ...this.states.get(w.id)! }));
  }

  async claim(workstationId: string, playerId: string, playerName: string, x: number, y: number): Promise<boolean> {
    if (this.isHidden(workstationId)) return false;
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== null) return false;
    if (workstationIdForPointIn(this.workstations, x, y) !== workstationId) return false;
    ws.claimedBy = playerId;
    ws.claimedByName = playerName;
    ws.claimedAt = Date.now();
    try {
      const pb = await getPocketBase();
      const rec = await pb.collection('workstation_states').create(this.wsToRecord(ws));
      this.pbIdByWsId.set(workstationId, rec.id);
    } catch (err) {
      console.warn('[ws-pb] claim persist failed', err);
    }
    return true;
  }

  async release(workstationId: string, playerId: string): Promise<boolean> {
    if (this.isHidden(workstationId)) return false;
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== playerId) return false;
    ws.claimedBy = null;
    ws.claimedByName = null;
    ws.invitedPlayerIds = [];
    ws.claimedAt = null;
    ws.customName = null;
    await this.deletePbRecord(workstationId);
    return true;
  }

  async forceRelease(workstationId: string): Promise<boolean> {
    if (this.isHidden(workstationId)) return false;
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy === null) return false;
    ws.claimedBy = null;
    ws.claimedByName = null;
    ws.invitedPlayerIds = [];
    ws.claimedAt = null;
    ws.customName = null;
    await this.deletePbRecord(workstationId);
    return true;
  }

  async invite(workstationId: string, actorId: string, targetId: string): Promise<boolean> {
    if (this.isHidden(workstationId)) return false;
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== actorId) return false;
    if (ws.invitedPlayerIds.includes(targetId)) return false;
    ws.invitedPlayerIds.push(targetId);
    await this.upsertPbRecord(ws);
    return true;
  }

  async uninvite(workstationId: string, actorId: string, targetId: string): Promise<boolean> {
    if (this.isHidden(workstationId)) return false;
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== actorId) return false;
    const idx = ws.invitedPlayerIds.indexOf(targetId);
    if (idx === -1) return false;
    ws.invitedPlayerIds.splice(idx, 1);
    await this.upsertPbRecord(ws);
    return true;
  }

  canEnter(workstationId: string, playerId: string): boolean {
    if (this.isHidden(workstationId)) return true;
    const ws = this.states.get(workstationId);
    if (!ws) return true;
    if (ws.claimedBy === null) return true;
    if (ws.claimedBy === playerId) return true;
    return ws.invitedPlayerIds.includes(playerId);
  }

  async setCustomName(actorId: string, workstationId: string, customName: string | null): Promise<boolean> {
    if (this.isHidden(workstationId)) return false;
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== actorId) return false;
    if (customName === null) {
      ws.customName = null;
    } else {
      const trimmed = customName.trim().slice(0, 40);
      if (trimmed.length === 0) return false;
      ws.customName = trimmed;
    }
    await this.upsertPbRecord(ws);
    return true;
  }

  isInsideAnyLockedWorkstation(playerId: string, x: number, y: number): boolean {
    const wsId = workstationIdForPointIn(this.workstations, x, y);
    if (wsId === null) return false;
    return !this.canEnter(wsId, playerId);
  }

  // ──────────── PocketBase plumbing ────────────

  private wsToRecord(ws: WorkstationState): Record<string, unknown> {
    return {
      roomSlug: this.roomSlug,
      workstationId: ws.id,
      claimedBy: ws.claimedBy ?? '',
      claimedByName: ws.claimedByName ?? '',
      invitedPlayerIds: ws.invitedPlayerIds,
      claimedAt: ws.claimedAt,
      customName: ws.customName ?? '',
    };
  }

  private async upsertPbRecord(ws: WorkstationState): Promise<void> {
    try {
      const pb = await getPocketBase();
      const pbId = this.pbIdByWsId.get(ws.id);
      if (pbId) {
        await pb.collection('workstation_states').update(pbId, this.wsToRecord(ws));
      } else {
        const rec = await pb.collection('workstation_states').create(this.wsToRecord(ws));
        this.pbIdByWsId.set(ws.id, rec.id);
      }
    } catch (err) {
      console.warn('[ws-pb] upsert failed', ws.id, err);
    }
  }

  private async deletePbRecord(workstationId: string): Promise<void> {
    try {
      const pbId = this.pbIdByWsId.get(workstationId);
      if (!pbId) return;
      const pb = await getPocketBase();
      await pb.collection('workstation_states').delete(pbId);
      this.pbIdByWsId.delete(workstationId);
    } catch (err) {
      console.warn('[ws-pb] delete failed', workstationId, err);
    }
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
        const records = await pb.collection('workstation_states').getFullList({
          filter: `roomSlug = "${this.roomSlug.replace(/"/g, '\\"')}"`,
        });
        for (const r of records) {
          const wsId = String(r.workstationId ?? '');
          if (!this.states.has(wsId)) continue;
          if (this.isHidden(wsId)) continue;
          this.pbIdByWsId.set(wsId, r.id);
          this.states.set(wsId, {
            id: wsId,
            claimedBy: r.claimedBy ? String(r.claimedBy) : null,
            claimedByName: r.claimedByName ? String(r.claimedByName) : null,
            invitedPlayerIds: Array.isArray(r.invitedPlayerIds) ? r.invitedPlayerIds.map((x) => String(x)) : [],
            claimedAt: r.claimedAt === null || r.claimedAt === undefined ? null : Number(r.claimedAt),
            customName: r.customName ? String(r.customName) : null,
          });
        }
      } catch (err) {
        console.warn('[ws-pb] load failed for', this.roomSlug, err);
      }
    })();
    return this.loadPromise;
  }
}
