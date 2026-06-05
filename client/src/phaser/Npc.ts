import Phaser from 'phaser';
import type { Appearance, Direction } from '../types';
import { HAIR_COLOR_COUNT } from '../types';
import { animatedFrame } from './entities/avatarFrames';

// PNJ d'ambiance : avatar statique (3 couches LimeZu body/outfit/hair) posé à une
// position monde, avec un léger balancement vertical optionnel (taper au clavier,
// soulever des poids…). Pas de collision (décoratif). Réutilise les spritesheets
// d'avatar déjà chargées (layer_body/outfit/hair).

export class Npc {
  private readonly layers: Phaser.GameObjects.Sprite[] = [];
  private readonly scene: Phaser.Scene;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    appearance: Appearance,
    dir: Direction = 'down',
  ) {
    this.scene = scene;
    if (!scene.textures.exists('layer_body')) return; // avatars absents → no-op

    const hairVar = appearance.hairStyle * HAIR_COLOR_COUNT + appearance.hairColor;
    const defs: Array<[string, number, number]> = [
      ['layer_body', animatedFrame(appearance.skin, dir, false, 0), 9.0],
      ['layer_outfit', animatedFrame(appearance.outfit, dir, false, 0), 9.1],
      ['layer_hair', animatedFrame(hairVar, dir, false, 0), 9.2],
    ];
    for (const [key, frame, depth] of defs) {
      this.layers.push(scene.add.sprite(x, y, key, frame).setDepth(depth));
    }
  }

  /** Balancement vertical en boucle (amp px, durée ms). Ex : typing, lifting. */
  bob(amp = 3, durationMs = 360): this {
    if (this.layers.length === 0) return this;
    const baseY = this.layers[0]!.y;
    this.scene.tweens.add({
      targets: this.layers,
      y: baseY - amp,
      duration: durationMs,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
    return this;
  }

  destroy(): void {
    for (const l of this.layers) l.destroy();
    this.layers.length = 0;
  }
}
