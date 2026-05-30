import Phaser from 'phaser';

export interface CollisionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Couche de collision dédiée. Construit un corps statique invisible par
 * rectangle (source de vérité unique pour ce qui bloque le joueur) et fournit
 * un overlay debug rouge togglable.
 */
export class CollisionLayer {
  readonly group: Phaser.Physics.Arcade.StaticGroup;
  private readonly scene: Phaser.Scene;
  private readonly rects: CollisionRect[];
  private debugGfx?: Phaser.GameObjects.Graphics;
  private debugOn = false;

  constructor(scene: Phaser.Scene, rects: CollisionRect[]) {
    this.scene = scene;
    this.rects = rects;
    this.group = scene.physics.add.staticGroup();
    for (const r of rects) {
      const rect = scene.add.rectangle(
        r.x + r.width / 2,
        r.y + r.height / 2,
        r.width,
        r.height,
      );
      rect.setVisible(false);
      scene.physics.add.existing(rect, true); // true = corps statique
      this.group.add(rect);
    }
  }

  toggleDebug(): void {
    if (this.debugOn) {
      this.debugOn = false;
      this.debugGfx?.setVisible(false);
      return;
    }
    this.debugOn = true;
    if (!this.debugGfx) this.debugGfx = this.scene.add.graphics().setDepth(1000);
    const g = this.debugGfx;
    g.clear();
    g.fillStyle(0xff0000, 0.35);
    g.lineStyle(1, 0xff0000, 0.9);
    for (const r of this.rects) {
      g.fillRect(r.x, r.y, r.width, r.height);
      g.strokeRect(r.x, r.y, r.width, r.height);
    }
    // Contour des limites du monde (vert).
    const b = this.scene.physics.world.bounds;
    g.lineStyle(2, 0x00ff00, 0.9);
    g.strokeRect(b.x, b.y, b.width, b.height);
    g.setVisible(true);
  }
}
