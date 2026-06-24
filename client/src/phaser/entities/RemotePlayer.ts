import Phaser from 'phaser';
import type { Appearance, Direction, PlayerState, Presence } from '../../types';
import { HAIR_COLOR_COUNT } from '../../types';
import { advanceWalkTick, animatedFrame } from './avatarFrames';
import { breathScaleY } from '../idleBreath';
import { applyBreath } from '../applyBreath';

const OUTFIT_FALLBACK_COLORS = [
  0xef4444, 0xf97316, 0xeab308, 0x22c55e, 0x14b8a6,
  0x3b82f6, 0x6366f1, 0xa855f7, 0xec4899, 0xf3f4f6,
];

function hairVariant(a: Appearance): number {
  return a.hairStyle * HAIR_COLOR_COUNT + a.hairColor;
}

export class RemotePlayer {
  scene: Phaser.Scene;
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
  outfitLayer?: Phaser.GameObjects.Sprite;
  hairLayer?: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  private badgeLabel: Phaser.GameObjects.Text | null = null;
  private badgeText = '';
  private typingBubble: Phaser.GameObjects.Text | null = null;
  private speakingBubble: Phaser.GameObjects.Text | null = null;
  private speakingPulseTween: Phaser.Tweens.Tween | null = null;
  targetX: number;
  targetY: number;
  private idleMs = 0;
  hasLayers: boolean;
  appearance: Appearance;
  direction: Direction = 'down';
  isMoving = false;
  isGhost = false;
  kartId: string | null = null;
  boosting = false;

  private walkTick = 0;
  private walkAccumMs = 0;
  private lastFrameUpdateMs: number;
  private presenceSuffix = '';

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
      this.sprite = scene.add
        .sprite(state.x, state.y, 'layer_body', animatedFrame(a.skin, 'down', false, 0))
        .setDepth(9.0);
      this.outfitLayer = scene.add
        .sprite(state.x, state.y, 'layer_outfit', animatedFrame(a.outfit, 'down', false, 0))
        .setDepth(9.1);
      this.hairLayer = scene.add
        .sprite(state.x, state.y, 'layer_hair', animatedFrame(hairVariant(a), 'down', false, 0))
        .setDepth(9.2);
    } else {
      const tex = `avatar_circle_${a.outfit}`;
      if (!scene.textures.exists(tex)) {
        const g = scene.make.graphics({ x: 0, y: 0 }, false);
        g.fillStyle(OUTFIT_FALLBACK_COLORS[a.outfit % OUTFIT_FALLBACK_COLORS.length], 1);
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
    this.appearance = state.appearance; // maj live si le joueur change d'avatar
    this.setGhost(state.isGhost === true);
    this.setKart(state.kartId);
    this.setBoosting(state.boosting);
  }

  setKart(kartId: string | null): void {
    if (this.kartId === kartId) return;
    this.kartId = kartId;
    // F11 — bump +1 sur chaque couche en préservant les offsets fractionnaires
    // (body 9.0 / outfit 9.1 / hair 9.2) qui contrôlent l'ordre de rendu.
    const bump = kartId !== null ? 1 : 0;
    this.sprite.setDepth(9.0 + bump);
    this.outfitLayer?.setDepth(9.1 + bump);
    this.hairLayer?.setDepth(9.2 + bump);
  }

  setBoosting(b: boolean): void { this.boosting = b; }

  /**
   * Badge persistant sous le nom (ex. « En remplacement de Alice » pour une
   * doublure IA). null/'' = pas de badge. Couleur ambre pour se distinguer.
   */
  setBadge(text: string | null): void {
    const next = text ?? '';
    if (next === this.badgeText) return;
    this.badgeText = next;
    if (!next) {
      this.badgeLabel?.destroy();
      this.badgeLabel = null;
      return;
    }
    if (!this.badgeLabel) {
      this.badgeLabel = this.scene.add
        .text(this.sprite.x, this.sprite.y - 14, next, {
          fontSize: '10px',
          fontFamily: 'system-ui, sans-serif',
          color: '#0f172a',
          backgroundColor: '#f59e0b', // ambre
          padding: { left: 3, right: 3, top: 1, bottom: 1 },
        })
        .setOrigin(0.5, 1)
        .setDepth(12);
      if (this.isGhost) this.badgeLabel.setAlpha(0.5);
    } else {
      this.badgeLabel.setText(next);
    }
  }

  setGhost(isGhost: boolean): void {
    if (this.isGhost === isGhost) return;
    this.isGhost = isGhost;
    const a = isGhost ? 0.5 : 1;
    this.sprite.setAlpha(a);
    this.outfitLayer?.setAlpha(a);
    this.hairLayer?.setAlpha(a);
    this.label.setAlpha(a);
    this.badgeLabel?.setAlpha(a);
    this.typingBubble?.setAlpha(a);
    this.speakingBubble?.setAlpha(a);
  }

  setPresence(presence: Presence | undefined): void {
    switch (presence) {
      case 'inactive': this.presenceSuffix = ' · 💤'; break;
      case 'brb':      this.presenceSuffix = ' · ☕ BRB'; break;
      case 'dnd':      this.presenceSuffix = ' · 🚫 DND'; break;
      case 'away':     this.presenceSuffix = ' · 👋'; break;
      default:         this.presenceSuffix = ''; break;
    }
    // Le label est mis à jour immédiatement pour éviter un frame de retard.
    this.label.setText((this.label.text.split(' · ')[0]!) + this.presenceSuffix);
  }

  /**
   * Active ou désactive la bulle 💬 persistante au-dessus du joueur.
   * Appelée depuis deux sources :
   *   1. GameScene.update() — pour la persistance (workstationId + poste claimé).
   *   2. useSpeakerBubbles hook — pour animer (pulse + couleur indigo) quand parle.
   *
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
    // Sur un kart : frame idle (pas de marche par-dessus le kart).
    const moving = this.isMoving && this.kartId === null;
    const tick = this.walkTick;
    if (this.sprite instanceof Phaser.GameObjects.Sprite) {
      this.sprite.setFrame(animatedFrame(this.appearance.skin, dir, moving, tick));
    }
    this.outfitLayer?.setFrame(animatedFrame(this.appearance.outfit, dir, moving, tick));
    this.hairLayer?.setFrame(animatedFrame(hairVariant(this.appearance), dir, moving, tick));
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
    // Match the local Player hitbox (16x12 with offset 8,48 on a 32x64 frame)
    // when we have tall layered sprites; fall back to 24x24 otherwise.
    if (this.hasLayers) body.setSize(16, 12).setOffset(8, 48);
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
    // F11 — pas d'offset Y, vêtements alignés sur le body.
    if (this.outfitLayer) this.outfitLayer.setPosition(x, y);
    if (this.hairLayer) this.hairLayer.setPosition(x, y);
    this.label.setPosition(x, y - 28);
    if (this.badgeLabel) this.badgeLabel.setPosition(x, y - 14);
    if (this.typingBubble) this.typingBubble.setPosition(x, y - 42);
    if (this.speakingBubble) this.speakingBubble.setPosition(x, y - 54);

    const now = this.scene.time.now;
    const dt = now - this.lastFrameUpdateMs;
    this.lastFrameUpdateMs = now;
    const advanced = advanceWalkTick(this.walkTick, this.walkAccumMs, dt, this.isMoving);
    this.walkTick = advanced.walkTick;
    this.walkAccumMs = advanced.accumMs;

    this.updateAnimatedFrames();

    // Respiration idle (procédurale) — basée sur le flag réseau isMoving.
    if (this.isMoving) {
      this.idleMs = 0;
      applyBreath(this, 1);
    } else {
      this.idleMs += dt;
      applyBreath(this, breathScaleY(this.idleMs));
    }
  }

  destroy(): void {
    this.sprite.destroy();
    this.outfitLayer?.destroy();
    this.hairLayer?.destroy();
    this.label.destroy();
    this.badgeLabel?.destroy();
    this.typingBubble?.destroy();
    this.speakingPulseTween?.stop();
    this.speakingBubble?.destroy();
  }
}
