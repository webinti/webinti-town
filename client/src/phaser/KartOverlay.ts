import Phaser from 'phaser';
import type { Direction, KartState, PlayerState } from '../types';

// Fallback procedural style (used si l'asset 'kart' n'est pas chargé).
const FALLBACK_COLOR_BODY = 0xfacc15;
const FALLBACK_COLOR_EDGE = 0x000000;
const FALLBACK_COLOR_WHEEL = 0x111111;
const FALLBACK_W = 28;
const FALLBACK_H = 20;

// Image sprite: target render size in world pixels.
// Le sprite PNG est ~512×512 px; on l'affiche à 36×36 pour rester proche
// de l'AABB de collision (28×20) tout en restant lisible.
const SPRITE_DISPLAY_W = 36;
const SPRITE_DISPLAY_H = 36;

const DEPTH_KART = 8;

// Sprite top-down face "up" par défaut. Phaser.angle est en degrés,
// 0 = right (convention Phaser). Donc up = -90.
const DIRECTION_TO_ANGLE: Record<Direction, number> = {
  up:    -90,
  right:   0,
  down:   90,
  left:  180,
};

export class KartOverlay {
  private readonly scene: Phaser.Scene;
  private readonly hasSprite: boolean;
  private readonly gfx?: Phaser.GameObjects.Graphics;
  private readonly sprites = new Map<string, Phaser.GameObjects.Image>();
  // Mémoriser la dernière direction connue de chaque kart pour ne pas
  // "claquer" sur la rotation par défaut quand le conducteur s'arrête.
  private readonly lastDirection = new Map<string, Direction>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.hasSprite = scene.textures.exists('kart');
    if (!this.hasSprite) {
      // Fallback: on dessine le sprite procédural à chaque frame.
      this.gfx = scene.add.graphics().setDepth(DEPTH_KART);
    }
  }

  /**
   * @param karts   Map<kartId, KartState> du store
   * @param players Map<playerId, PlayerState> du store (pour récupérer
   *                la direction du conducteur et tourner le sprite)
   */
  update(karts: Map<string, KartState>, players: Map<string, PlayerState>): void {
    if (!this.hasSprite) {
      this.renderFallback(karts);
      this.pruneSprites(karts);  // no-op when no sprite, mais coût quasi nul
      return;
    }

    for (const k of karts.values()) {
      // Position : si quelqu'un conduit, c'est la position du joueur qui est
      // autoritative côté visuel (le serveur synchronise via move(), mais le
      // tick client est plus fluide quand on lit directement le PlayerState).
      let x = k.x;
      let y = k.y;
      let dir: Direction | undefined = this.lastDirection.get(k.id);
      if (k.driverId) {
        const driver = players.get(k.driverId);
        if (driver) {
          x = driver.x;
          y = driver.y;
          // On ne change l'angle QUE quand le joueur bouge, sinon le kart
          // pivote au moindre changement de facing pendant un arrêt.
          if (driver.isMoving) {
            dir = driver.direction;
            this.lastDirection.set(k.id, driver.direction);
          }
        }
      }
      let img = this.sprites.get(k.id);
      if (!img) {
        img = this.scene.add.image(x, y, 'kart').setDepth(DEPTH_KART);
        img.setDisplaySize(SPRITE_DISPLAY_W, SPRITE_DISPLAY_H);
        this.sprites.set(k.id, img);
      }
      img.setPosition(Math.round(x), Math.round(y));
      img.setAngle(DIRECTION_TO_ANGLE[dir ?? 'up']);
    }

    this.pruneSprites(karts);
  }

  /** Supprime les sprites dont l'id n'apparaît plus dans le store. */
  private pruneSprites(karts: Map<string, KartState>): void {
    for (const [id, img] of this.sprites) {
      if (!karts.has(id)) {
        img.destroy();
        this.sprites.delete(id);
        this.lastDirection.delete(id);
      }
    }
  }

  /** Ancien rendu procédural — uniquement si la PNG n'a pas chargé. */
  private renderFallback(karts: Map<string, KartState>): void {
    if (!this.gfx) return;
    this.gfx.clear();
    for (const k of karts.values()) {
      const x = Math.round(k.x);
      const y = Math.round(k.y);
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
