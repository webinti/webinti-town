import type { KartDef } from '../karts.js';
import { MOUNT_DISTANCE } from '../karts.js';

export interface KartState {
  id: string;
  x: number;
  y: number;
  parkingX: number;
  parkingY: number;
  driverId: string | null;
  lastMovedAt: number;
}

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
}
