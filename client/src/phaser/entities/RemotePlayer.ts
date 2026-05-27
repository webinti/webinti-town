import Phaser from 'phaser';
import type { Appearance, Direction, PlayerState } from '../../types';
import { advanceWalkTick, animatedFrame } from './avatarFrames';

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
  private typingBubble: Phaser.GameObjects.Text | null = null;
  targetX: number;
  targetY: number;
  hasLayers: boolean;
  appearance: Appearance;
  direction: Direction = 'down';
  isMoving = false;
  isGhost = false;

  private walkTick = 0;
  private walkAccumMs = 0;
  private lastFrameUpdateMs: number;

  constructor(scene: Phaser.Scene, state: PlayerState, hasLayers: boolean) {
    this.scene = scene;
    this.hasLayers = hasLayers;
    this.targetX = state.x;
    this.targetY = state.y;
    this.appearance = state.appearance;
    this.direction = state.direction;
    this.isMoving = state.isMoving;
    this.lastFrameUpdateMs = scene.time.now;
    const a = state.appearance;

    if (hasLayers) {
      this.hairBackLayer = scene.add
        .sprite(state.x, state.y, 'layer_hair_back', hairFrame(a))
        .setDepth(8.9);
      this.sprite = scene.add
        .sprite(state.x, state.y, 'layer_body', animatedFrame(a.skin, 'down', false, 0))
        .setDepth(9.0);
      this.pantsLayer = scene.add
        .sprite(state.x, state.y, 'layer_pants', animatedFrame(a.pants, 'down', false, 0))
        .setDepth(9.1);
      this.shirtLayer = scene.add
        .sprite(state.x, state.y, 'layer_shirt', animatedFrame(a.shirt, 'down', false, 0))
        .setDepth(9.2);
      this.hairLayer = scene.add
        .sprite(state.x, state.y, 'layer_hair', hairFrame(a))
        .setDepth(9.3);
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

    if (state.isGhost === true) this.setGhost(true);
  }

  setTarget(state: PlayerState): void {
    this.targetX = state.x;
    this.targetY = state.y;
    this.direction = state.direction;
    this.isMoving = state.isMoving;
    this.setGhost(state.isGhost === true);
  }

  setGhost(isGhost: boolean): void {
    if (this.isGhost === isGhost) return;
    this.isGhost = isGhost;
    const a = isGhost ? 0.5 : 1;
    this.sprite.setAlpha(a);
    this.hairBackLayer?.setAlpha(a);
    this.pantsLayer?.setAlpha(a);
    this.shirtLayer?.setAlpha(a);
    this.hairLayer?.setAlpha(a);
    this.label.setAlpha(a);
    this.typingBubble?.setAlpha(a);
  }

  setTyping(active: boolean): void {
    if (active) {
      if (this.typingBubble) return; // déjà visible — ne rien faire
      this.typingBubble = this.scene.add
        .text(this.sprite.x, this.sprite.y - 42, '\u{1F4AC}', {
          fontSize: '18px',
          fontFamily: 'system-ui, sans-serif',
        })
        .setOrigin(0.5, 1)
        .setDepth(12);
      // Appliquer l'alpha ghost si nécessaire.
      if (this.isGhost) this.typingBubble.setAlpha(0.5);
    } else {
      if (!this.typingBubble) return; // déjà masqué — ne rien faire
      this.typingBubble.destroy();
      this.typingBubble = null;
    }
  }

  private updateAnimatedFrames(): void {
    if (!this.hasLayers) return;
    const dir = this.direction;
    const moving = this.isMoving;
    const tick = this.walkTick;
    if (this.sprite instanceof Phaser.GameObjects.Sprite) {
      this.sprite.setFrame(animatedFrame(this.appearance.skin, dir, moving, tick));
    }
    this.pantsLayer?.setFrame(animatedFrame(this.appearance.pants, dir, moving, tick));
    this.shirtLayer?.setFrame(animatedFrame(this.appearance.shirt, dir, moving, tick));
  }

  /**
   * Enable a physics body on this remote so the local player can collide
   * with it. The body is immovable and `moves = false` because the remote's
   * position is driven by network lerp, not physics velocity — Phaser still
   * keeps the body synced to the sprite each step, so collisions work.
   */
  enableCollisionBody(group: Phaser.Physics.Arcade.Group): void {
    if (!(this.sprite instanceof Phaser.GameObjects.Sprite || this.sprite instanceof Phaser.GameObjects.Image)) return;
    this.scene.physics.add.existing(this.sprite);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body | null;
    if (!body) return;
    body.setAllowGravity(false);
    body.setImmovable(true);
    body.moves = false;
    // Match the local Player hitbox (24x16 with offset 4,28) when we have
    // tall layered sprites; fall back to the circle's natural 24x24 otherwise.
    if (this.hasLayers) body.setSize(24, 16).setOffset(4, 28);
    else body.setSize(24, 24);
    this.sprite.setData('remote', this);
    group.add(this.sprite);
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
    if (this.typingBubble) this.typingBubble.setPosition(x, y - 42);

    const now = this.scene.time.now;
    const dt = now - this.lastFrameUpdateMs;
    this.lastFrameUpdateMs = now;
    const advanced = advanceWalkTick(this.walkTick, this.walkAccumMs, dt, this.isMoving);
    this.walkTick = advanced.walkTick;
    this.walkAccumMs = advanced.accumMs;

    this.updateAnimatedFrames();
  }

  destroy(): void {
    this.sprite.destroy();
    this.hairBackLayer?.destroy();
    this.pantsLayer?.destroy();
    this.shirtLayer?.destroy();
    this.hairLayer?.destroy();
    this.label.destroy();
    this.typingBubble?.destroy();
  }
}
