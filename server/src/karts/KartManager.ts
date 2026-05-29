import type { KartDef } from '../karts.js';
import { MOUNT_DISTANCE, KART_IDLE_RETURN_MS } from '../karts.js';
import type { KartState } from '../types.js';

export class KartManager {
  private readonly defs: readonly KartDef[];
  private readonly states = new Map<string, KartState>();
  private readonly now: () => number;

  constructor(defs: readonly KartDef[], now: () => number = Date.now) {
    this.defs = defs;
    this.now = now;
    const t = now();
    for (const d of defs) {
      this.states.set(d.id, {
        id: d.id,
        x: d.parkingX,
        y: d.parkingY,
        parkingX: d.parkingX,
        parkingY: d.parkingY,
        driverId: null,
        lastMovedAt: t,
      });
    }
  }

  getState(id: string): KartState | undefined {
    return this.states.get(id);
  }

  getAllStates(): KartState[] {
    return this.defs.map((d) => ({ ...this.states.get(d.id)! }));
  }

  mount(kartId: string, playerId: string, playerX: number, playerY: number): boolean {
    const k = this.states.get(kartId);
    if (!k) return false;
    if (k.driverId !== null) return false;
    const dx = playerX - k.x;
    const dy = playerY - k.y;
    if (Math.hypot(dx, dy) > MOUNT_DISTANCE) return false;
    k.driverId = playerId;
    k.lastMovedAt = this.now();
    return true;
  }

  getKartByDriver(playerId: string): KartState | undefined {
    for (const k of this.states.values()) {
      if (k.driverId === playerId) return k;
    }
    return undefined;
  }

  move(playerId: string, x: number, y: number): boolean {
    const k = this.getKartByDriver(playerId);
    if (!k) return false;
    k.x = x;
    k.y = y;
    k.lastMovedAt = this.now();
    return true;
  }

  dismount(playerId: string): boolean {
    const k = this.getKartByDriver(playerId);
    if (!k) return false;
    k.driverId = null;
    k.lastMovedAt = this.now();
    return true;
  }

  /**
   * Repositionne au parking les karts libres + immobiles depuis > KART_IDLE_RETURN_MS.
   * Retourne la liste des ids déplacés (pour broadcast côté handler).
   */
  sweepIdle(): string[] {
    const now = this.now();
    const moved: string[] = [];
    for (const k of this.states.values()) {
      if (k.driverId !== null) continue;
      if (k.x === k.parkingX && k.y === k.parkingY) continue;
      if (now - k.lastMovedAt <= KART_IDLE_RETURN_MS) continue;
      k.x = k.parkingX;
      k.y = k.parkingY;
      k.lastMovedAt = now;
      moved.push(k.id);
    }
    return moved;
  }
}
