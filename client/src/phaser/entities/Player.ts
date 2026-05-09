import Phaser from 'phaser';
import type { Direction } from '../../types';

const AVATAR_COLORS = [
  0xef4444, 0xf97316, 0xeab308, 0x22c55e, 0x06b6d4, 0x3b82f6, 0xa855f7, 0xec4899,
];

export class Player {
  scene: Phaser.Scene;
  sprite: Phaser.Physics.Arcade.Sprite | Phaser.Physics.Arcade.Image;
  label: Phaser.GameObjects.Text;
  direction: Direction = 'down';
  moving = false;
  speed = 160;
  hasSpritesheet: boolean;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    avatar: number,
    name: string,
    hasSpritesheet: boolean,
  ) {
    this.scene = scene;
    this.hasSpritesheet = hasSpritesheet;

    if (hasSpritesheet) {
      const sprite = scene.physics.add.sprite(x, y, 'avatars', avatar);
      sprite.setSize(24, 16).setOffset(4, 28);
      this.sprite = sprite;
    } else {
      const tex = `avatar_circle_${avatar}`;
      if (!scene.textures.exists(tex)) {
        const g = scene.make.graphics({ x: 0, y: 0 }, false);
        g.fillStyle(AVATAR_COLORS[avatar % AVATAR_COLORS.length], 1);
        g.fillCircle(16, 16, 14);
        g.lineStyle(2, 0x000000, 1);
        g.strokeCircle(16, 16, 14);
        g.generateTexture(tex, 32, 32);
        g.destroy();
      }
      const img = scene.physics.add.image(x, y, tex);
      img.setSize(24, 24);
      this.sprite = img;
    }

    this.sprite.setCollideWorldBounds(true);
    this.sprite.setDepth(10);

    this.label = scene.add
      .text(x, y - 28, name, {
        fontSize: '12px',
        color: '#ffffff',
        backgroundColor: '#0008',
        padding: { left: 4, right: 4, top: 1, bottom: 1 },
      })
      .setOrigin(0.5, 1)
      .setDepth(11);
  }

  update(cursors: {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
  }): boolean {
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    let vx = 0;
    let vy = 0;
    if (cursors.left) vx -= 1;
    if (cursors.right) vx += 1;
    if (cursors.up) vy -= 1;
    if (cursors.down) vy += 1;

    const len = Math.hypot(vx, vy);
    if (len > 0) {
      vx = (vx / len) * this.speed;
      vy = (vy / len) * this.speed;
    }
    body.setVelocity(vx, vy);

    const wasMoving = this.moving;
    const prevDir = this.direction;
    this.moving = vx !== 0 || vy !== 0;
    if (Math.abs(vx) > Math.abs(vy)) {
      this.direction = vx > 0 ? 'right' : vx < 0 ? 'left' : this.direction;
    } else if (vy !== 0) {
      this.direction = vy > 0 ? 'down' : 'up';
    }

    this.label.setPosition(this.sprite.x, this.sprite.y - 28);

    return this.moving !== wasMoving || this.direction !== prevDir || this.moving;
  }

  destroy(): void {
    this.sprite.destroy();
    this.label.destroy();
  }
}
