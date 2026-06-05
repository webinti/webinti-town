import Phaser from 'phaser';
import { CIRCUIT, checkpointCenter } from '../circuit';

// F12 — Rendu des portiques du circuit. Les rectangles correspondent EXACTEMENT
// aux zones de détection serveur (circuit.ts partagé). Le portique 0 est la
// ligne départ/arrivée (🏁). Le prochain portique attendu est surligné en jaune.

export class CircuitOverlay {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly highlight: Phaser.GameObjects.Graphics;
  private readonly labels: Phaser.GameObjects.Text[] = [];
  private lastNext = -1;
  private lastActive = false;

  constructor(scene: Phaser.Scene) {
    this.gfx = scene.add.graphics().setDepth(1.4);
    this.highlight = scene.add.graphics().setDepth(1.5);
    this.drawGates(scene);
  }

  private drawGates(scene: Phaser.Scene): void {
    const g = this.gfx;
    g.clear();
    CIRCUIT.forEach((c, i) => {
      const isStart = i === 0;
      g.fillStyle(isStart ? 0xffffff : 0x38bdf8, isStart ? 0.16 : 0.12);
      g.fillRoundedRect(c.x, c.y, c.w, c.h, 8);
      g.lineStyle(2, isStart ? 0xffffff : 0x38bdf8, 0.55);
      g.strokeRoundedRect(c.x, c.y, c.w, c.h, 8);
      const ctr = checkpointCenter(c);
      const t = scene.add
        .text(ctr.x, ctr.y, isStart ? '🏁' : String(i), {
          fontFamily: 'sans-serif',
          fontSize: isStart ? '22px' : '16px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(1.6);
      this.labels.push(t);
    });
  }

  /** Surligne le prochain portique (index) si une course est en cours (active). */
  setNext(index: number, active: boolean): void {
    if (index === this.lastNext && active === this.lastActive) return;
    this.lastNext = index;
    this.lastActive = active;
    this.highlight.clear();
    if (!active) return;
    const c = CIRCUIT[index];
    if (!c) return;
    this.highlight.fillStyle(0xfacc15, 0.28);
    this.highlight.fillRoundedRect(c.x, c.y, c.w, c.h, 8);
    this.highlight.lineStyle(3, 0xfacc15, 0.95);
    this.highlight.strokeRoundedRect(c.x, c.y, c.w, c.h, 8);
  }

  destroy(): void {
    this.gfx.destroy();
    this.highlight.destroy();
    for (const t of this.labels) t.destroy();
    this.labels.length = 0;
  }
}
