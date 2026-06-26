import { getPocketBase } from '../pocketbase/client.js';
import type { AiAgentRecord, Appearance } from '../types.js';
import { DEFAULT_APPEARANCE } from '../types.js';
import { buildEmployeePersona } from './AgentRegistry.js';

/**
 * Persistance PocketBase des IA « embauchées » (kind = 'employee'), pour
 * qu'elles survivent à un redémarrage serveur. Marie (réceptionniste) n'est PAS
 * persistée ici — elle est recréée d'office à chaque room.
 *
 * Design (même esprit que KanbanStorePocketBase) :
 *   - `room.agents` (en mémoire) reste autoritatif ; ce store ne fait que MIRRORER.
 *   - `agentId` (« ai-emp-<uuid> ») est l'identifiant stable (champ PB), généré
 *     côté serveur SANS dépendre de PB → aucune régression si PB est indisponible.
 *   - Toutes les écritures sont best-effort (try/catch + warn) : si PB tombe,
 *     l'embauche fonctionne quand même, juste sans persistance pour la session.
 *   - La collection `ai_employees` est auto-créée si absente (idempotent).
 */

const COLLECTION = 'ai_employees';

function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(min, Math.min(max, n));
}
function toAppearance(raw: unknown): Appearance {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    skin: clampInt(o.skin, 0, 8, DEFAULT_APPEARANCE.skin),
    outfit: clampInt(o.outfit, 0, 12, DEFAULT_APPEARANCE.outfit),
    hairStyle: clampInt(o.hairStyle, 0, 7, DEFAULT_APPEARANCE.hairStyle),
    hairColor: clampInt(o.hairColor, 0, 3, DEFAULT_APPEARANCE.hairColor),
  };
}
function num(v: unknown, def = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : def;
}
function esc(s: string): string {
  return s.replace(/"/g, '\\"');
}
function errMsg(err: unknown): string {
  return (err as { message?: string })?.message ?? String(err);
}

// ── Auto-création best-effort de la collection (une seule fois par process) ──
let ensured: Promise<void> | null = null;
function ensureCollection(): Promise<void> {
  if (ensured) return ensured;
  ensured = (async () => {
    try {
      const pb = await getPocketBase();
      try {
        await pb.collections.getOne(COLLECTION);
        return; // existe déjà
      } catch {
        /* n'existe pas → on tente de la créer */
      }
      await pb.collections.create({
        name: COLLECTION,
        type: 'base',
        schema: [
          { name: 'roomSlug', type: 'text', required: true, options: {} },
          { name: 'agentId', type: 'text', required: true, options: {} },
          { name: 'name', type: 'text', options: {} },
          { name: 'role', type: 'text', options: {} },
          { name: 'knowledge', type: 'text', options: { max: 7000 } },
          { name: 'appearance', type: 'json', options: { maxSize: 20000 } },
          { name: 'x', type: 'number', options: {} },
          { name: 'y', type: 'number', options: {} },
          { name: 'createdAt', type: 'number', options: {} },
        ],
      });
      console.log('[ai-employees] collection PocketBase « ai_employees » créée');
    } catch (err) {
      console.warn('[ai-employees] ensureCollection échec — persistance dégradée :', errMsg(err));
    }
  })();
  return ensured;
}

export class EmployeeStore {
  private readonly roomSlug: string;
  private readonly pbIds = new Map<string, string>(); // agentId → id de record PB
  private loadPromise: Promise<void> | null = null;

  constructor(roomSlug: string) {
    this.roomSlug = roomSlug;
  }

  /**
   * Charge (UNE seule fois) les employés persistés de la room et les injecte
   * dans la map d'agents fournie (sans écraser ceux déjà présents). Mémoïsé :
   * appelable à la création de room ET au join sans double-chargement.
   */
  loadInto(agents: Map<string, AiAgentRecord>): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      try {
        await ensureCollection();
        const pb = await getPocketBase();
        const records = await pb.collection(COLLECTION).getFullList({
          filter: `roomSlug = "${esc(this.roomSlug)}"`,
        });
        for (const r of records) {
          const agentId = String(r.agentId ?? '');
          if (!agentId) continue;
          this.pbIds.set(agentId, r.id);
          if (agents.has(agentId)) continue;
          const name = String(r.name ?? 'IA');
          const role = String(r.role ?? '');
          agents.set(agentId, {
            agentId,
            name,
            role,
            appearance: toAppearance(r.appearance),
            x: num(r.x),
            y: num(r.y),
            direction: 'down',
            kind: 'employee',
            badge: null,
            ownerPlayerId: null,
            persona: buildEmployeePersona(name, role),
            knowledge: String(r.knowledge ?? ''),
            createdAt: num(r.createdAt, Date.now()),
          });
        }
      } catch (err) {
        console.warn('[ai-employees] load échec pour', this.roomSlug, '— en mémoire seulement :', errMsg(err));
      }
    })();
    return this.loadPromise;
  }

  /** Persiste un nouvel employé (best-effort, non bloquant). */
  create(rec: AiAgentRecord): void {
    void (async () => {
      try {
        await ensureCollection();
        const pb = await getPocketBase();
        const created = await pb.collection(COLLECTION).create({
          roomSlug: this.roomSlug,
          agentId: rec.agentId,
          name: rec.name,
          role: rec.role,
          knowledge: rec.knowledge,
          appearance: rec.appearance,
          x: rec.x,
          y: rec.y,
          createdAt: rec.createdAt,
        });
        this.pbIds.set(rec.agentId, created.id);
      } catch (err) {
        console.warn('[ai-employees] create échec', rec.agentId, ':', errMsg(err));
      }
    })();
  }

  /** Met à jour un employé persisté (best-effort). Upsert si le record manque. */
  update(rec: AiAgentRecord): void {
    void (async () => {
      try {
        await ensureCollection();
        const pb = await getPocketBase();
        const data = {
          name: rec.name,
          role: rec.role,
          knowledge: rec.knowledge,
          appearance: rec.appearance,
          x: rec.x,
          y: rec.y,
        };
        let pbId = this.pbIds.get(rec.agentId);
        if (!pbId) {
          const found = await pb
            .collection(COLLECTION)
            .getFirstListItem(`roomSlug = "${esc(this.roomSlug)}" && agentId = "${esc(rec.agentId)}"`)
            .catch(() => null);
          if (found) {
            pbId = found.id;
            this.pbIds.set(rec.agentId, found.id);
          }
        }
        if (pbId) {
          await pb.collection(COLLECTION).update(pbId, data);
        } else {
          const created = await pb.collection(COLLECTION).create({
            roomSlug: this.roomSlug,
            agentId: rec.agentId,
            createdAt: rec.createdAt,
            ...data,
          });
          this.pbIds.set(rec.agentId, created.id);
        }
      } catch (err) {
        console.warn('[ai-employees] update échec', rec.agentId, ':', errMsg(err));
      }
    })();
  }

  /** Supprime un employé persisté (best-effort). */
  remove(agentId: string): void {
    const known = this.pbIds.get(agentId);
    this.pbIds.delete(agentId);
    void (async () => {
      try {
        const pb = await getPocketBase();
        let id = known;
        if (!id) {
          const found = await pb
            .collection(COLLECTION)
            .getFirstListItem(`roomSlug = "${esc(this.roomSlug)}" && agentId = "${esc(agentId)}"`)
            .catch(() => null);
          id = found?.id;
        }
        if (id) await pb.collection(COLLECTION).delete(id);
      } catch (err) {
        console.warn('[ai-employees] remove échec', agentId, ':', errMsg(err));
      }
    })();
  }
}
