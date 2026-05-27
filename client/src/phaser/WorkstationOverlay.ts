import Phaser from 'phaser';
import type { WorkstationState } from '../types';
import { WORKSTATIONS } from '../workstations';

// Couleurs par état du poste (format Phaser uint32 ARGB)
const COLOR_FREE   = 0x22c55e; // vert  — poste libre
const COLOR_MINE   = 0x3b82f6; // bleu  — revendiqué par moi
const COLOR_LOCKED = 0xef4444; // rouge — revendiqué par quelqu'un d'autre
const ALPHA_FILL   = 0.08;
const ALPHA_STROKE = 0.6;
const LINE_WIDTH   = 2;

export class WorkstationOverlay {
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    // Depth entre le sol (0) et les sprites joueurs (9).
    this.gfx = scene.add.graphics().setDepth(5);
  }

  /**
   * Appelé à chaque frame depuis GameScene.update().
   * @param workstations  Map<id, WorkstationState> du store.
   * @param localPlayerId Identifiant du joueur local (pour distinguer "mine").
   */
  update(workstations: Map<string, WorkstationState>, localPlayerId: string | null): void {
    this.gfx.clear();

    for (const def of WORKSTATIONS) {
      // Zones invisibles (salle conf etc.) : pas de contour dessiné.
      if (def.hidden) continue;
      const state = workstations.get(def.id);

      let color: number;
      if (!state || state.claimedBy === null) {
        color = COLOR_FREE;
      } else if (state.claimedBy === localPlayerId) {
        color = COLOR_MINE;
      } else {
        color = COLOR_LOCKED;
      }

      const w = def.maxX - def.minX;
      const h = def.maxY - def.minY;

      this.gfx.fillStyle(color, ALPHA_FILL);
      this.gfx.fillRect(def.minX, def.minY, w, h);

      this.gfx.lineStyle(LINE_WIDTH, color, ALPHA_STROKE);
      this.gfx.strokeRect(def.minX, def.minY, w, h);
    }
  }

  destroy(): void {
    this.gfx.destroy();
  }
}
