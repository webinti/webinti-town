import Phaser from 'phaser';
import type { Appearance, Direction, Presence } from '../../types';
import { advanceWalkTick, animatedFrame } from './avatarFrames';
import { computeKartSpeed } from '../kartSpeed';

const SHIRT_FALLBACK_COLORS = [
  0xef4444, 0xf97316, 0xeab308, 0x22c55e, 0x14b8a6,
  0x3b82f6, 0x6366f1, 0xa855f7, 0xec4899, 0xf3f4f6,
];

const HAIR_COLS = 6;

function hairFrame(appearance: Appearance): number {
  return appearance.hairColor * HAIR_COLS + appearance.hairStyle;
}

export class Player {
  scene: Phaser.Scene;
  sprite: Phaser.Physics.Arcade.Sprite | Phaser.Physics.Arcade.Image;
  pantsLayer?: Phaser.GameObjects.Sprite;
  shirtLayer?: Phaser.GameObjects.Sprite;
  hairLayer?: Phaser.GameObjects.Sprite;
  hairBackLayer?: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  direction: Direction = 'down';
  moving = false;
  speed = 160;
  kartId: string | null = null;
  boosting = false;
  hasLayers: boolean;
  appearance: Appearance;
  isGhost = false;

  // Walk-cycle state
  private walkTick = 0;
  private walkAccumMs = 0;
  private lastFrameUpdateMs: number;

  // Dance state: when active and no real movement keys are pressed,
  // we force the walk animation in place and rotate the facing direction
  // to produce a "dancing" effect (matches the look of being stuck on a wall).
  private danceAccumMs = 0;
  private static readonly DANCE_DIRS: Direction[] = ['down', 'left', 'up', 'right'];
  private static readonly DANCE_ROTATE_MS = 180;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    appearance: Appearance,
    name: string,
    hasLayers: boolean,
  ) {
    this.scene = scene;
    this.hasLayers = hasLayers;
    this.appearance = appearance;
    this.lastFrameUpdateMs = scene.time.now;

    if (hasLayers) {
      const body = scene.physics.add.sprite(
        x,
        y,
        'layer_body',
        animatedFrame(appearance.skin, 'down', false, 0),
      );
      body.setSize(24, 16).setOffset(4, 28);
      body.setDepth(9.0);
      this.sprite = body;

      this.hairBackLayer = scene.add
        .sprite(x, y, 'layer_hair_back', hairFrame(appearance))
        .setDepth(8.9);
      this.pantsLayer = scene.add
        .sprite(x, y, 'layer_pants', animatedFrame(appearance.pants, 'down', false, 0))
        .setDepth(9.1);
      this.shirtLayer = scene.add
        .sprite(x, y, 'layer_shirt', animatedFrame(appearance.shirt, 'down', false, 0))
        .setDepth(9.2);
      this.hairLayer = scene.add
        .sprite(x, y, 'layer_hair', hairFrame(appearance))
        .setDepth(9.3);
    } else {
      const tex = `avatar_circle_${appearance.shirt}`;
      if (!scene.textures.exists(tex)) {
        const g = scene.make.graphics({ x: 0, y: 0 }, false);
        g.fillStyle(SHIRT_FALLBACK_COLORS[appearance.shirt % SHIRT_FALLBACK_COLORS.length], 1);
        g.fillCircle(16, 16, 14);
        g.lineStyle(2, 0x000000, 1);
        g.strokeCircle(16, 16, 14);
        g.generateTexture(tex, 32, 32);
        g.destroy();
      }
      const img = scene.physics.add.image(x, y, tex);
      img.setSize(24, 24);
      img.setDepth(10);
      this.sprite = img;
    }

    this.sprite.setCollideWorldBounds(true);

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

  private syncLayers(): void {
    const x = this.sprite.x;
    const y = this.sprite.y;
    if (this.hairBackLayer) this.hairBackLayer.setPosition(x, y);
    if (this.pantsLayer) this.pantsLayer.setPosition(x, y);
    if (this.shirtLayer) this.shirtLayer.setPosition(x, y);
    if (this.hairLayer) this.hairLayer.setPosition(x, y);
  }

  private updateAnimatedFrames(): void {
    if (!this.hasLayers) return;
    const dir = this.direction;
    const moving = this.moving;
    const tick = this.walkTick;
    if (this.sprite instanceof Phaser.Physics.Arcade.Sprite) {
      this.sprite.setFrame(animatedFrame(this.appearance.skin, dir, moving, tick));
    }
    this.pantsLayer?.setFrame(animatedFrame(this.appearance.pants, dir, moving, tick));
    this.shirtLayer?.setFrame(animatedFrame(this.appearance.shirt, dir, moving, tick));
    // hair / hair_back are static (front-facing) -- no per-direction update needed.
  }

  update(cursors: {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
    dance?: boolean;
  }): boolean {
    this.speed = computeKartSpeed({ onKart: this.kartId !== null, boosting: this.boosting });
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

    // Advance walk cycle
    const now = this.scene.time.now;
    const dt = now - this.lastFrameUpdateMs;
    this.lastFrameUpdateMs = now;

    // Dance mode: when Z is held and no real movement is happening, force
    // the walk animation in place and rotate facing direction so it reads
    // as a dance. Real movement always takes priority.
    const dancing = !!cursors.dance && !this.moving;
    if (dancing) {
      this.moving = true;
      this.danceAccumMs += dt;
      const idx = Math.floor(this.danceAccumMs / Player.DANCE_ROTATE_MS) % Player.DANCE_DIRS.length;
      this.direction = Player.DANCE_DIRS[idx]!;
    } else {
      this.danceAccumMs = 0;
    }
    const advanced = advanceWalkTick(this.walkTick, this.walkAccumMs, dt, this.moving);
    this.walkTick = advanced.walkTick;
    this.walkAccumMs = advanced.accumMs;

    this.updateAnimatedFrames();
    this.syncLayers();
    this.label.setPosition(this.sprite.x, this.sprite.y - 28);
    if (this.speakingBubble) this.speakingBubble.setPosition(this.sprite.x, this.sprite.y - 54);

    // F11 — quand on est sur un kart, le sprite joueur passe au-dessus du kart.
    // Pas d'offset Y : décaler uniquement les couches vêtements détacherait les
    // habits du corps (le body sprite est lié au physics et ne peut pas bouger).
    // Le kart étant plus large que le joueur, le rendu donne l'impression d'être assis dedans.
    const onKart = this.kartId !== null;
    const targetDepth = onKart ? 10 : 9;
    this.sprite.setDepth(targetDepth);
    this.pantsLayer?.setDepth(targetDepth);
    this.shirtLayer?.setDepth(targetDepth);
    this.hairLayer?.setDepth(targetDepth);
    this.hairBackLayer?.setDepth(targetDepth);

    return this.moving !== wasMoving || this.direction !== prevDir || this.moving;
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
    this.speakingBubble?.setAlpha(a);
  }

  private presenceSuffix = '';
  private speakingBubble: Phaser.GameObjects.Text | null = null;
  private speakingPulseTween: Phaser.Tweens.Tween | null = null;

  setPresence(presence: Presence | undefined): void {
    switch (presence) {
      case 'inactive': this.presenceSuffix = ' · 💤'; break;
      case 'brb':      this.presenceSuffix = ' · ☕ BRB'; break;
      case 'dnd':      this.presenceSuffix = ' · 🚫 DND'; break;
      case 'away':     this.presenceSuffix = ' · 👋'; break;
      default:         this.presenceSuffix = ''; break;
    }
    this.label.setText((this.label.text.split(' · ')[0]!) + this.presenceSuffix);
  }

  /**
   * Active ou désactive la bulle 💬 persistante au-dessus du joueur.
   * @param active       true = afficher, false = masquer
   * @param speaking     true = joueur en train de parler (pulse)
   */
  setSpeaking(active: boolean, speaking = false): void {
    if (active) {
      if (!this.speakingBubble) {
        this.speakingBubble = this.scene.add
          .text(this.sprite.x, this.sprite.y - 54, '\u{1F4AC}', {
            fontSize: '18px',
            fontFamily: 'system-ui, sans-serif',
          })
          .setOrigin(0.5, 1)
          .setDepth(12);
        if (this.isGhost) this.speakingBubble.setAlpha(0.5);
      }

      // Pulse quand parle — tween scale 1.0 → 1.3 → 1.0 toutes les 600ms
      if (speaking && !this.speakingPulseTween) {
        this.speakingPulseTween = this.scene.tweens.add({
          targets: this.speakingBubble,
          scaleX: 1.3,
          scaleY: 1.3,
          duration: 300,
          ease: 'Sine.easeInOut',
          yoyo: true,
          repeat: -1,
        });
        this.speakingBubble.setStyle({ color: '#818cf8' }); // indigo-400
      } else if (!speaking && this.speakingPulseTween) {
        this.speakingPulseTween.stop();
        this.speakingPulseTween = null;
        this.speakingBubble?.setScale(1).setStyle({ color: '#ffffff' });
      }
    } else {
      if (!this.speakingBubble) return;
      this.speakingPulseTween?.stop();
      this.speakingPulseTween = null;
      this.speakingBubble.destroy();
      this.speakingBubble = null;
    }
  }

  destroy(): void {
    this.sprite.destroy();
    this.hairBackLayer?.destroy();
    this.pantsLayer?.destroy();
    this.shirtLayer?.destroy();
    this.hairLayer?.destroy();
    this.label.destroy();
    this.speakingPulseTween?.stop();
    this.speakingBubble?.destroy();
  }
}
