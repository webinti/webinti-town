import Phaser from 'phaser';
import type { Direction, KartState } from '../types';

// Fallback procedural style (used si l'asset 'kart' n'est pas chargé).
const FALLBACK_COLOR_BODY = 0xfacc15;
const FALLBACK_COLOR_EDGE = 0x000000;
const FALLBACK_COLOR_WHEEL = 0x111111;
const FALLBACK_W = 28;
const FALLBACK_H = 20;

// Image sprite : taille de rendu en pixels monde.
// 56×56 → bien visible autour du joueur (sprite ~32×48), les roues et l'aileron
// dépassent largement du corps. On ne touche pas à l'AABB de collision côté
// serveur (28×20) — c'est purement visuel.
const SPRITE_DISPLAY_W = 56;
const SPRITE_DISPLAY_H = 56;

// Décalage vertical du kart sous le joueur. L'avatar (sprite 32×64 centré sur
// sa position) a les pieds vers le bas du cadre ; on descend le kart pour qu'il
// entoure le bas du corps (effet "assis dans le kart"). Ajuster si besoin.
const KART_Y_OFFSET = 12;

const DEPTH_KART = 8;

// Sprite top-down dessiné pointant vers le haut par défaut.
// setAngle rotate la texture depuis son orientation native (up). Sens horaire.
// Donc up = 0, right = 90, down = 180, left = -90.
const DIRECTION_TO_ANGLE: Record<Direction, number> = {
  up:      0,
  right:  90,
  down:  180,
  left:  -90,
};

/**
 * Renvoie la position et la direction visuelles du conducteur d'un kart.
 * GameScene fournit cette fonction depuis ses entités Phaser (Player +
 * RemotePlayer) plutôt que depuis le store, qui est laggué de quelques
 * dizaines de ms (rebroadcast serveur). Sans ça, le sprite kart traîne
 * derrière le joueur local.
 */
export type DriverStateResolver = (playerId: string) => {
  x: number;
  y: number;
  direction: Direction;
  isMoving: boolean;
} | null;

export class KartOverlay {
  private readonly scene: Phaser.Scene;
  private readonly hasSprite: boolean;
  private readonly gfx?: Phaser.GameObjects.Graphics;
  private readonly sprites = new Map<string, Phaser.GameObjects.Image>();
  // Mémoriser la dernière direction de mouvement de chaque kart pour ne pas
  // tourner sur place quand le conducteur s'arrête.
  private readonly lastDirection = new Map<string, Direction>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.hasSprite = scene.textures.exists('kart');
    if (!this.hasSprite) {
      this.gfx = scene.add.graphics().setDepth(DEPTH_KART);
    }
  }

  update(karts: Map<string, KartState>, getDriverState: DriverStateResolver): void {
    if (!this.hasSprite) {
      this.renderFallback(karts);
      return;
    }

    for (const k of karts.values()) {
      let x = k.x;
      let y = k.y;
      let dir: Direction = this.lastDirection.get(k.id) ?? 'up';

      if (k.driverId) {
        const ds = getDriverState(k.driverId);
        if (ds) {
          x = ds.x;
          y = ds.y;
          if (ds.isMoving) {
            dir = ds.direction;
            this.lastDirection.set(k.id, ds.direction);
          }
        }
      }

      let img = this.sprites.get(k.id);
      if (!img) {
        img = this.scene.add.image(x, y, 'kart').setDepth(DEPTH_KART);
        img.setDisplaySize(SPRITE_DISPLAY_W, SPRITE_DISPLAY_H);
        this.sprites.set(k.id, img);
      }
      img.setPosition(Math.round(x), Math.round(y + KART_Y_OFFSET));
      img.setAngle(DIRECTION_TO_ANGLE[dir]);
    }

    // Supprimer les sprites de karts qui n'existent plus dans le store.
    for (const [id, img] of this.sprites) {
      if (!karts.has(id)) {
        img.destroy();
        this.sprites.delete(id);
        this.lastDirection.delete(id);
      }
    }
  }

  private renderFallback(karts: Map<string, KartState>): void {
    if (!this.gfx) return;
    this.gfx.clear();
    for (const k of karts.values()) {
      const x = Math.round(k.x);
      const y = Math.round(k.y + KART_Y_OFFSET);
      this.gfx.fillStyle(FALLBACK_COLOR_BODY, 1);
      this.gfx.fillRect(x - FALLBACK_W / 2, y - FALLBACK_H / 2, FALLBACK_W, FALLBACK_H);
      this.gfx.lineStyle(1, FALLBACK_COLOR_EDGE, 1);
      this.gfx.strokeRect(x - FALLBACK_W / 2, y - FALLBACK_H / 2, FALLBACK_W, FALLBACK_H);
      this.gfx.fillStyle(FALLBACK_COLOR_WHEEL, 1);
      this.gfx.fillCircle(x - FALLBACK_W / 2 + 3, y - FALLBACK_H / 2 + 3, 2);
      this.gfx.fillCircle(x + FALLBACK_W / 2 - 3, y - FALLBACK_H / 2 + 3, 2);
      this.gfx.fillCircle(x - FALLBACK_W / 2 + 3, y + FALLBACK_H / 2 - 3, 2);
      this.gfx.fillCircle(x + FALLBACK_W / 2 - 3, y + FALLBACK_H / 2 - 3, 2);
      this.gfx.fillStyle(FALLBACK_COLOR_EDGE, 1);
      this.gfx.fillTriangle(x, y - FALLBACK_H / 2 - 3, x - 3, y - FALLBACK_H / 2 + 1, x + 3, y - FALLBACK_H / 2 + 1);
    }
  }

  destroy(): void {
    for (const img of this.sprites.values()) img.destroy();
    this.sprites.clear();
    this.lastDirection.clear();
    this.gfx?.destroy();
  }
}
