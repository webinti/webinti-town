import type Phaser from 'phaser';

// Couches d'avatar partagées par Player et RemotePlayer.
export interface AvatarLayers {
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
  pantsLayer?: Phaser.GameObjects.Sprite;
  shirtLayer?: Phaser.GameObjects.Sprite;
  hairLayer?: Phaser.GameObjects.Sprite;
  hairBackLayer?: Phaser.GameObjects.Sprite;
}

// Applique un scaleY uniforme à toutes les couches présentes (scale -> rendu
// uniquement ; n'altère pas la position du corps).
export function applyBreath(a: AvatarLayers, scaleY: number): void {
  a.sprite.setScale(1, scaleY);
  a.pantsLayer?.setScale(1, scaleY);
  a.shirtLayer?.setScale(1, scaleY);
  a.hairLayer?.setScale(1, scaleY);
  a.hairBackLayer?.setScale(1, scaleY);
}
