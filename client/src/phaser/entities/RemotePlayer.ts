import Phaser from 'phaser';
import type { Appearance, PlayerState } from '../../types';

const SHIRT_FALLBACK_COLORS = [
  0xef4444, 0xf97316, 0xeab308, 0x22c55e, 0x14b8a6,
  0x3b82f6, 0x6366f1, 0xa855f7, 0xec4899, 0xf3f4f6,
];

const HAIR_COLS = 6;

function hairFrame(appearance: Appearance): number {
  return appearance.hairColor * HAIR_COLS + appearance.hairStyle;
}

export class RemotePlayer {
  scene: Phaser.Scene;
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
  pantsLayer?: Phaser.GameObjects.Sprite;
  shirtLayer?: Phaser.GameObjects.Sprite;
  hairLayer?: Phaser.GameObjects.Sprite;
  hairBackLayer?: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
  hasLayers: boolean;

  constructor(scene: Phaser.Scene, state: PlayerState, hasLayers: boolean) {
    this.scene = scene;
    this.hasLayers = hasLayers;
    this.targetX = state.x;
    this.targetY = state.y;
    const a = state.appearance;

    if (hasLayers) {
      this.hairBackLayer = scene.add.sprite(state.x, state.y, 'layer_hair_back', hairFrame(a)).setDepth(8.9);
      this.sprite = scene.add.sprite(state.x, state.y, 'layer_body', a.skin).setDepth(9.0);
      this.pantsLayer = scene.add.sprite(state.x, state.y, 'layer_pants', a.pants).setDepth(9.1);
      this.shirtLayer = scene.add.sprite(state.x, state.y, 'layer_shirt', a.shirt).setDepth(9.2);
      this.hairLayer = scene.add.sprite(state.x, state.y, 'layer_hair', hairFrame(a)).setDepth(9.3);
    } else {
      const tex = `avatar_circle_${a.shirt}`;
      if (!scene.textures.exists(tex)) {
        const g = scene.make.graphics({ x: 0, y: 0 }, false);
        g.fillStyle(SHIRT_FALLBACK_COLORS[a.shirt % SHIRT_FALLBACK_COLORS.length], 1);
        g.fillCircle(16, 16, 14);
        g.lineStyle(2, 0x000000, 1);
        g.strokeCircle(16, 16, 14);
        g.generateTexture(tex, 32, 32);
        g.destroy();
      }
      this.sprite = scene.add.image(state.x, state.y, tex);
      this.sprite.setDepth(10);
    }

    this.label = scene.add
      .text(state.x, state.y - 28, state.name, {
        fontSize: '12px',
        color: '#ffffff',
        backgroundColor: '#0008',
        padding: { left: 4, right: 4, top: 1, bottom: 1 },
      })
      .setOrigin(0.5, 1)
      .setDepth(11);
  }

  setTarget(state: PlayerState): void {
    this.targetX = state.x;
    this.targetY = state.y;
  }

  update(): void {
    const lerp = 0.2;
    this.sprite.x = Phaser.Math.Linear(this.sprite.x, this.targetX, lerp);
    this.sprite.y = Phaser.Math.Linear(this.sprite.y, this.targetY, lerp);
    const x = this.sprite.x;
    const y = this.sprite.y;
    if (this.hairBackLayer) this.hairBackLayer.setPosition(x, y);
    if (this.pantsLayer) this.pantsLayer.setPosition(x, y);
    if (this.shirtLayer) this.shirtLayer.setPosition(x, y);
    if (this.hairLayer) this.hairLayer.setPosition(x, y);
    this.label.setPosition(x, y - 28);
  }

  destroy(): void {
    this.sprite.destroy();
    this.hairBackLayer?.destroy();
    this.pantsLayer?.destroy();
    this.shirtLayer?.destroy();
    this.hairLayer?.destroy();
    this.label.destroy();
  }
}
