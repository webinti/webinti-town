import Phaser from 'phaser';
import type { Appearance, Direction, Presence } from '../../types';
import { HAIR_COLOR_COUNT } from '../../types';
import { advanceWalkTick, animatedFrame } from './avatarFrames';
import { computeKartSpeed } from '../kartSpeed';
import { breathScaleY } from '../idleBreath';
import { applyBreath } from '../applyBreath';

const OUTFIT_FALLBACK_COLORS = [
  0xef4444, 0xf97316, 0xeab308, 0x22c55e, 0x14b8a6,
  0x3b82f6, 0x6366f1, 0xa855f7, 0xec4899, 0xf3f4f6,
];

// Variante de la planche `hair` (cheveux désormais directionnels + animés).
function hairVariant(a: Appearance): number {
  return a.hairStyle * HAIR_COLOR_COUNT + a.hairColor;
}

export class Player {
  scene: Phaser.Scene;
  sprite: Phaser.Physics.Arcade.Sprite | Phaser.Physics.Arcade.Image;
  outfitLayer?: Phaser.GameObjects.Sprite;
  hairLayer?: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  direction: Direction = 'down';
  moving = false;
  private idleMs = 0;
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
      // Frame 32x64, sprite centré : la boîte de collision est aux pieds.
      body.setSize(16, 12).setOffset(8, 48);
      body.setDepth(9.0);
      this.sprite = body;

      this.outfitLayer = scene.add
        .sprite(x, y, 'layer_outfit', animatedFrame(appearance.outfit, 'down', false, 0))
        .setDepth(9.1);
      this.hairLayer = scene.add
        .sprite(x, y, 'layer_hair', animatedFrame(hairVariant(appearance), 'down', false, 0))
        .setDepth(9.2);
    } else {
      const tex = `avatar_circle_${appearance.outfit}`;
      if (!scene.textures.exists(tex)) {
        const g = scene.make.graphics({ x: 0, y: 0 }, false);
        g.fillStyle(OUTFIT_FALLBACK_COLORS[appearance.outfit % OUTFIT_FALLBACK_COLORS.length], 1);
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
    if (this.outfitLayer) this.outfitLayer.setPosition(x, y);
    if (this.hairLayer) this.hairLayer.setPosition(x, y);
  }

  private updateAnimatedFrames(): void {
    if (!this.hasLayers) return;
    const dir = this.direction;
    // Sur un kart : on garde la frame idle (pas de cycle de marche par-dessus
    // le kart), mais l'avatar reste tourné dans la direction du déplacement.
    const moving = this.moving && this.kartId === null;
    const tick = this.walkTick;
    if (this.sprite instanceof Phaser.Physics.Arcade.Sprite) {
      this.sprite.setFrame(animatedFrame(this.appearance.skin, dir, moving, tick));
    }
    this.outfitLayer?.setFrame(animatedFrame(this.appearance.outfit, dir, moving, tick));
    this.hairLayer?.setFrame(animatedFrame(hairVariant(this.appearance), dir, moving, tick));
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

    // F11 — quand on est sur un kart, on bumpe TOUTES les couches de +1 pour
    // passer au-dessus du sprite kart (depth 8) tout en préservant les offsets
    // fractionnaires entre couches (9.0 body / 9.1 outfit / 9.2 hair) qui
    // contrôlent l'ordre de rendu.
    const bump = this.kartId !== null ? 1 : 0;
    this.sprite.setDepth(9.0 + bump);
    this.outfitLayer?.setDepth(9.1 + bump);
    this.hairLayer?.setDepth(9.2 + bump);

    // Respiration idle (procédurale) — n'affecte pas la physique (scaleY only).
    // `this.moving` est vrai pendant la danse, donc pas de cumul avec celle-ci.
    if (this.moving) {
      this.idleMs = 0;
      applyBreath(this, 1);
    } else {
      this.idleMs += dt;
      applyBreath(this, breathScaleY(this.idleMs));
    }

    return this.moving !== wasMoving || this.direction !== prevDir || this.moving;
  }

  setGhost(isGhost: boolean): void {
    if (this.isGhost === isGhost) return;
    this.isGhost = isGhost;
    const a = isGhost ? 0.5 : 1;
    this.sprite.setAlpha(a);
    this.outfitLayer?.setAlpha(a);
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
    this.outfitLayer?.destroy();
    this.hairLayer?.destroy();
    this.label.destroy();
    this.speakingPulseTween?.stop();
    this.speakingBubble?.destroy();
  }
}
