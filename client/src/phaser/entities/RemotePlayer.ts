import Phaser from 'phaser';
import type { PlayerState } from '../../types';

const AVATAR_COLORS = [
  0xef4444, 0xf97316, 0xeab308, 0x22c55e, 0x06b6d4, 0x3b82f6, 0xa855f7, 0xec4899,
];

export class RemotePlayer {
  scene: Phaser.Scene;
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
  hasSpritesheet: boolean;

  constructor(scene: Phaser.Scene, state: PlayerState, hasSpritesheet: boolean) {
    this.scene = scene;
    this.hasSpritesheet = hasSpritesheet;
    this.targetX = state.x;
    this.targetY = state.y;

    if (hasSpritesheet) {
      this.sprite = scene.add.sprite(state.x, state.y, 'avatars', state.avatar);
    } else {
      const tex = `avatar_circle_${state.avatar}`;
      if (!scene.textures.exists(tex)) {
        const g = scene.make.graphics({ x: 0, y: 0 }, false);
        g.fillStyle(AVATAR_COLORS[state.avatar % AVATAR_COLORS.length], 1);
        g.fillCircle(16, 16, 14);
        g.lineStyle(2, 0x000000, 1);
        g.strokeCircle(16, 16, 14);
        g.generateTexture(tex, 32, 32);
        g.destroy();
      }
      this.sprite = scene.add.image(state.x, state.y, tex);
    }
    this.sprite.setDepth(10);

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
    this.label.setPosition(this.sprite.x, this.sprite.y - 28);
  }

  destroy(): void {
    this.sprite.destroy();
    this.label.destroy();
  }
}
