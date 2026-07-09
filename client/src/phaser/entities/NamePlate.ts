import Phaser from 'phaser';

// Pastille de nom façon Gather : fond arrondi + petite flèche pointant vers
// l'avatar. Phaser Text ne gère pas le border-radius sur son backgroundColor,
// d'où ce Container { Graphics, Text }. L'API reprend celle utilisée avant
// (setText / setPosition / setAlpha / text) pour un remplacement transparent.
export class NamePlate {
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly textObj: Phaser.GameObjects.Text;
  private readonly color: number;
  private readonly bgAlpha: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    opts: { color?: number; alpha?: number; fontSize?: string } = {},
  ) {
    this.color = opts.color ?? 0x4338ca; // indigo-700 (comme l'ancien fond)
    this.bgAlpha = opts.alpha ?? 0.95;
    this.textObj = scene.add
      .text(0, 0, text, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: opts.fontSize ?? '12px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0.5);
    this.bg = scene.add.graphics();
    this.container = scene.add.container(x, y, [this.bg, this.textObj]);
    this.redraw();
  }

  get text(): string {
    return this.textObj.text;
  }

  setText(t: string): this {
    if (t !== this.textObj.text) {
      this.textObj.setText(t);
      this.redraw();
    }
    return this;
  }

  setPosition(x: number, y: number): this {
    this.container.setPosition(x, y);
    return this;
  }

  setAlpha(a: number): this {
    this.container.setAlpha(a);
    return this;
  }

  setDepth(d: number): this {
    this.container.setDepth(d);
    return this;
  }

  // Le point d'ancrage (x,y) est la POINTE de la flèche (équivalent de
  // l'ancien setOrigin(0.5, 1) du Text) : la bulle se dessine au-dessus.
  private redraw(): void {
    const w = this.textObj.width + 14;
    const h = this.textObj.height + 7;
    const r = Math.min(h / 2, 8);
    this.bg.clear();
    this.bg.fillStyle(this.color, this.bgAlpha);
    this.bg.fillRoundedRect(-w / 2, -h - 4, w, h, r);
    this.bg.fillTriangle(-3.5, -4.5, 3.5, -4.5, 0, -0.5);
    this.textObj.setPosition(0, -4 - h / 2);
  }

  destroy(): void {
    this.container.destroy(true); // détruit aussi bg + textObj
  }
}
