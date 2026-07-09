import Phaser from 'phaser';

// Cycle jour/nuit : teinte la map selon l'HEURE LOCALE réelle du navigateur.
// Un simple rectangle couvrant le monde, dont la couleur/alpha sont interpolées
// entre des points-clés horaires. Volontairement sobre (alpha ≤ 0.42) pour que
// la map reste lisible. Purement cosmétique, 100 % client.
//
// + Lumières nocturnes : des halos additifs (cheminée, écrans, lampes…)
// enregistrés via addLight(), dont l'intensité suit l'obscurité ambiante —
// invisibles en plein jour, ils s'allument au crépuscule et « percent » la
// teinte de nuit (depth 51 > rect 50). C'est ce qui rend la nuit vivante au
// lieu d'un simple filtre sombre.

interface DayKey { h: number; color: number; alpha: number }

const KEYS: DayKey[] = [
  { h: 0,  color: 0x0a1a3a, alpha: 0.42 }, // nuit profonde (bleu)
  { h: 6,  color: 0x122a4a, alpha: 0.34 },
  { h: 7,  color: 0xff9a4d, alpha: 0.20 }, // aube chaude
  { h: 9,  color: 0x000000, alpha: 0.0 },  // plein jour : aucune teinte
  { h: 17, color: 0x000000, alpha: 0.0 },
  { h: 19, color: 0xff7a3c, alpha: 0.18 }, // crépuscule chaud
  { h: 21, color: 0x0a1f44, alpha: 0.30 },
  { h: 24, color: 0x0a1a3a, alpha: 0.42 },
];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function lerpColor(c1: number, c2: number, t: number): number {
  const r = Math.round(lerp((c1 >> 16) & 0xff, (c2 >> 16) & 0xff, t));
  const g = Math.round(lerp((c1 >> 8) & 0xff, (c2 >> 8) & 0xff, t));
  const b = Math.round(lerp(c1 & 0xff, c2 & 0xff, t));
  return (r << 16) | (g << 8) | b;
}

function sampleHour(hour: number): { color: number; alpha: number } {
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i]!;
    const b = KEYS[i + 1]!;
    if (hour >= a.h && hour <= b.h) {
      const span = b.h - a.h || 1;
      const t = (hour - a.h) / span;
      return { color: lerpColor(a.color, b.color, t), alpha: lerp(a.alpha, b.alpha, t) };
    }
  }
  return { color: KEYS[0]!.color, alpha: KEYS[0]!.alpha };
}

const MAX_NIGHT_ALPHA = 0.42; // alpha du point-clé le plus sombre (nuit profonde)
const GLOW_TEX = 'fx_glow';

interface NightLight {
  img: Phaser.GameObjects.Image;
  intensity: number; // alpha à obscurité maximale
}

// Grand disque radial doux (128px) pour les halos : plus fin que fx_dot (16px)
// qui pixelise en gros scale.
function ensureGlowTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(GLOW_TEX)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  for (let r = 64; r >= 2; r -= 2) {
    g.fillStyle(0xffffff, 0.035);
    g.fillCircle(64, 64, r);
  }
  g.generateTexture(GLOW_TEX, 128, 128);
  g.destroy();
}

export class DayNightOverlay {
  private readonly scene: Phaser.Scene;
  private readonly rect: Phaser.GameObjects.Rectangle;
  private readonly timer: Phaser.Time.TimerEvent;
  private readonly lights: NightLight[] = [];

  constructor(scene: Phaser.Scene, worldW: number, worldH: number) {
    this.scene = scene;
    // Rectangle en espace-monde couvrant toute la map (depth 50 = au-dessus des
    // joueurs/déco). La caméra passe dessus, on voit la teinte sur la zone visible.
    this.rect = scene.add
      .rectangle(worldW / 2, worldH / 2, worldW, worldH, 0x000000, 0)
      .setDepth(50);
    this.apply();
    // La variation d'une minute à l'autre est imperceptible → recalcul /minute.
    this.timer = scene.time.addEvent({
      delay: 60_000,
      loop: true,
      callback: () => this.apply(),
    });
  }

  /**
   * Enregistre une source de lumière nocturne.
   * @param radius    rayon du halo en px monde
   * @param intensity alpha du halo à obscurité maximale (0..1)
   */
  addLight(x: number, y: number, color: number, radius: number, intensity: number): void {
    ensureGlowTexture(this.scene);
    const img = this.scene.add
      .image(x, y, GLOW_TEX)
      .setTint(color)
      .setScale((radius * 2) / 128)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(51)
      .setAlpha(0);
    this.lights.push({ img, intensity });
    this.applyToLight(this.lights[this.lights.length - 1]!, this.currentDarkness());
  }

  /** Obscurité ambiante 0 (plein jour) → 1 (nuit profonde). */
  private currentDarkness(): number {
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    const { alpha } = sampleHour(hour);
    return Math.min(1, alpha / MAX_NIGHT_ALPHA);
  }

  private applyToLight(l: NightLight, darkness: number): void {
    l.img.setAlpha(l.intensity * darkness);
    l.img.setVisible(darkness > 0.05);
  }

  private apply(): void {
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    const { color, alpha } = sampleHour(hour);
    this.rect.setFillStyle(color, alpha);
    const darkness = Math.min(1, alpha / MAX_NIGHT_ALPHA);
    for (const l of this.lights) this.applyToLight(l, darkness);
  }

  destroy(): void {
    this.timer.remove();
    this.rect.destroy();
    for (const l of this.lights) l.img.destroy();
    this.lights.length = 0;
  }
}
