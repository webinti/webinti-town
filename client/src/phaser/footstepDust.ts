import type Phaser from 'phaser';

// Petits nuages de poussière aux pieds pendant la marche. Partagé par
// Player et RemotePlayer. Réutilise la texture fx_dot (créée par
// AmbientLayer) — no-op tant qu'elle n'existe pas encore.
const DUST_INTERVAL_MS = 270;

/**
 * À appeler chaque frame. Retourne le nouvel accumulateur (remis à zéro
 * quand un nuage est émis ou que le personnage s'arrête).
 */
export function emitFootstepDust(
  scene: Phaser.Scene,
  x: number,
  y: number,
  active: boolean,
  accumMs: number,
  dtMs: number,
): number {
  if (!active) return 0;
  const acc = accumMs + dtMs;
  if (acc < DUST_INTERVAL_MS) return acc;
  if (!scene.textures.exists('fx_dot')) return 0;
  const puff = scene.add
    .image(x + (Math.random() * 8 - 4), y, 'fx_dot')
    .setDepth(8.8)
    .setAlpha(0.22)
    .setScale(0.45)
    .setTint(0xcbd5e1);
  scene.tweens.add({
    targets: puff,
    alpha: 0,
    scaleX: 1.0,
    scaleY: 1.0,
    y: puff.y - 3,
    duration: 340,
    ease: 'Sine.Out',
    onComplete: () => puff.destroy(),
  });
  return 0;
}
