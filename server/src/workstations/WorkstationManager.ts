import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkstationState } from '../types.js';
import type { Workstation } from '../workstations.js';
import { workstationIdForPointIn } from '../workstations.js';

const DEFAULT_DATA_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'data');
})();

const SAVE_DEBOUNCE_MS = 50;
const FILE_VERSION = 1;

export interface WorkstationManagerOptions {
  roomSlug?: string;     // si présent + persist, active la persistance
  persist?: boolean;
  dataDir?: string;
}

export class WorkstationManager {
  private readonly workstations: readonly Workstation[];
  private readonly states = new Map<string, WorkstationState>();
  private readonly persistEnabled: boolean;
  private readonly roomSlug: string;
  private readonly dataDir: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private savePending: Promise<void> | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(workstations: readonly Workstation[], opts: WorkstationManagerOptions = {}) {
    this.workstations = workstations;
    this.persistEnabled = !!(opts.persist && opts.roomSlug);
    this.roomSlug = opts.roomSlug ?? '';
    this.dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
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

  /** Retourne l'état d'un poste, ou undefined si l'id est inconnu. */
  getState(workstationId: string): WorkstationState | undefined {
    return this.states.get(workstationId);
  }

  /**
   * Une zone "hidden" (ex: salle de conférence) ne supporte pas les
   * mutations utilisateur (claim/release/invite/rename). Elle sert
   * uniquement à grouper l'audio des occupants.
   */
  private isHidden(workstationId: string): boolean {
    return this.workstations.find((w) => w.id === workstationId)?.hidden === true;
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
    if (this.isHidden(workstationId)) return false;
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== null) return false;
    if (workstationIdForPointIn(this.workstations, x, y) !== workstationId) return false;
    ws.claimedBy = playerId;
    ws.claimedByName = playerName;
    ws.claimedAt = Date.now();
    this.scheduleSave();
    return true;
  }

  release(workstationId: string, playerId: string): boolean {
    if (this.isHidden(workstationId)) return false;
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== playerId) return false;
    ws.claimedBy = null;
    ws.claimedByName = null;
    ws.invitedPlayerIds = [];
    ws.claimedAt = null;
    ws.customName = null;
    this.scheduleSave();
    return true;
  }

  /**
   * Force release (admin/host) — pas de check claimer. À utiliser
   * pour libérer un poste laissé par un joueur qui ne reviendra pas.
   */
  forceRelease(workstationId: string): boolean {
    if (this.isHidden(workstationId)) return false;
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy === null) return false;
    ws.claimedBy = null;
    ws.claimedByName = null;
    ws.invitedPlayerIds = [];
    ws.claimedAt = null;
    ws.customName = null;
    this.scheduleSave();
    return true;
  }

  invite(workstationId: string, actorId: string, targetId: string): boolean {
    if (this.isHidden(workstationId)) return false;
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== actorId) return false;
    if (ws.invitedPlayerIds.includes(targetId)) return false;
    ws.invitedPlayerIds.push(targetId);
    this.scheduleSave();
    return true;
  }

  uninvite(workstationId: string, actorId: string, targetId: string): boolean {
    if (this.isHidden(workstationId)) return false;
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== actorId) return false;
    const idx = ws.invitedPlayerIds.indexOf(targetId);
    if (idx === -1) return false;
    ws.invitedPlayerIds.splice(idx, 1);
    this.scheduleSave();
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

  setCustomName(actorId: string, workstationId: string, customName: string | null): boolean {
    if (this.isHidden(workstationId)) return false;
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== actorId) return false;
    if (customName === null) {
      ws.customName = null;
      this.scheduleSave();
      return true;
    }
    const trimmed = customName.trim().slice(0, 40);
    if (trimmed.length === 0) return false;
    ws.customName = trimmed;
    this.scheduleSave();
    return true;
  }

  isInsideAnyLockedWorkstation(playerId: string, x: number, y: number): boolean {
    const wsId = workstationIdForPointIn(this.workstations, x, y);
    if (wsId === null) return false;
    return !this.canEnter(wsId, playerId);
  }

  // ────────────────────── Persistance ──────────────────────

  private scheduleSave(): void {
    if (!this.persistEnabled) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.savePending = this.saveNow().catch((err) => {
        console.warn('[workstations] save failed for', this.roomSlug, err);
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
          states?: WorkstationState[];
        };
        if (parsed && Array.isArray(parsed.states)) {
          for (const s of parsed.states) {
            if (!isWellShapedState(s)) continue;
            // Ne restaurer que si le workstation id existe encore dans WORKSTATIONS
            if (!this.states.has(s.id)) continue;
            // Filtrer les workstations cachées (les hidden ne devraient jamais
            // avoir un state claimé, par sécurité on les ignore)
            if (this.isHidden(s.id)) continue;
            this.states.set(s.id, {
              id: s.id,
              claimedBy: s.claimedBy,
              claimedByName: s.claimedByName,
              invitedPlayerIds: Array.isArray(s.invitedPlayerIds) ? [...s.invitedPlayerIds] : [],
              claimedAt: s.claimedAt,
              customName: s.customName,
            });
          }
        }
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return;
        console.warn('[workstations] load failed for', this.roomSlug, '— starting empty', err);
      }
    })();
    return this.loadPromise;
  }

  private filePath(): string {
    return join(this.dataDir, `workstations-${this.roomSlug}.json`);
  }

  private async saveNow(): Promise<void> {
    const path = this.filePath();
    const tmp = `${path}.tmp`;
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      // Ne persister que les states qui ont un claim actif (économie d'espace,
      // et permet d'ignorer proprement les workstations supprimées du code).
      const claimed = this.getAllStates().filter((s) => s.claimedBy !== null);
      const payload = JSON.stringify({ version: FILE_VERSION, states: claimed });
      await fs.writeFile(tmp, payload, 'utf8');
      await fs.rename(tmp, path);
    } catch (err) {
      try { await fs.unlink(tmp); } catch { /* ignore */ }
      throw err;
    }
  }
}

function isWellShapedState(s: unknown): s is WorkstationState {
  if (typeof s !== 'object' || s === null) return false;
  const r = s as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    (r.claimedBy === null || typeof r.claimedBy === 'string') &&
    (r.claimedByName === null || typeof r.claimedByName === 'string') &&
    Array.isArray(r.invitedPlayerIds) &&
    (r.claimedAt === null || typeof r.claimedAt === 'number') &&
    (r.customName === null || typeof r.customName === 'string')
  );
}
