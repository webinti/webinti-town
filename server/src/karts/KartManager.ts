import type { KartDef } from '../karts.js';

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
}
