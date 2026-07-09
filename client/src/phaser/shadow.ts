import Phaser from 'phaser';

// Ombre portée « blob » sous les avatars/PNJ : ellipse douce (dégradé d'alpha
// concentrique, comme fx_dot) générée une seule fois. Sans elle, les
// personnages semblent flotter au-dessus du sol.
const KEY = 'fx_shadow';

export function ensureShadowTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(KEY)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  for (let r = 10; r >= 1; r--) {
    g.fillStyle(0x000000, 0.085);
    g.fillEllipse(12, 6, r * 2.2, r * 1.05);
  }
  g.generateTexture(KEY, 24, 12);
  g.destroy();
}

/**
 * Ajoute une ombre sous un personnage. `depth` juste sous les couches avatar
 * (9.0/9.1/9.2) mais au-dessus du sol/meubles bas.
 */
export function addShadow(
  scene: Phaser.Scene,
  x: number,
  y: number,
  depth = 8.9,
): Phaser.GameObjects.Image {
  ensureShadowTexture(scene);
  return scene.add.image(x, y, KEY).setDepth(depth).setAlpha(0.5);
}
