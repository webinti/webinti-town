import Phaser from 'phaser';
import type { PlayerState } from '../types';
import { WORKSTATIONS } from '../workstations';

// « Portes intelligentes » : un badge de statut au-dessus de chaque bureau/salle,
// calculé CÔTÉ CLIENT à partir de la zone (workstationId) où se trouvent les
// joueurs. Masqué si la zone est vide. Aucun changement serveur nécessaire.
//   1-2 présents → « Occupé » (orange)
//   3+ présents  → « En réunion » (rouge)

const BG_BUSY = '#d97706e0';   // ambre
const BG_MEETING = '#dc2626e0'; // rouge

export class OfficeStatusOverlay {
  private readonly labels = new Map<string, Phaser.GameObjects.Text>();
  private lastSig = '';

  constructor(scene: Phaser.Scene) {
    for (const def of WORKSTATIONS) {
      const cx = (def.minX + def.maxX) / 2;
      const label = scene.add
        .text(cx, def.minY - 4, '', {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '12px',
          color: '#ffffff',
          fontStyle: 'bold',
          padding: { x: 6, y: 2 },
        })
        .setOrigin(0.5, 1)
        .setDepth(60) // au-dessus du calque jour/nuit (50) pour rester lisible
        .setVisible(false);
      this.labels.set(def.id, label);
    }
  }

  /** Appelé depuis GameScene.update() ; dirty-check interne (occupation rare). */
  update(players: Map<string, PlayerState>): void {
    const counts = new Map<string, number>();
    for (const p of players.values()) {
      if (p.workstationId) counts.set(p.workstationId, (counts.get(p.workstationId) ?? 0) + 1);
    }

    // Signature pour ne rien retoucher si l'occupation n'a pas changé.
    let sig = '';
    for (const def of WORKSTATIONS) {
      const n = counts.get(def.id) ?? 0;
      sig += n >= 3 ? '2' : n >= 1 ? '1' : '0';
    }
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    for (const def of WORKSTATIONS) {
      const n = counts.get(def.id) ?? 0;
      const label = this.labels.get(def.id)!;
      if (n >= 3) {
        label.setText('En réunion').setBackgroundColor(BG_MEETING).setVisible(true);
      } else if (n >= 1) {
        label.setText('Occupé').setBackgroundColor(BG_BUSY).setVisible(true);
      } else {
        label.setVisible(false);
      }
    }
  }

  destroy(): void {
    for (const label of this.labels.values()) label.destroy();
    this.labels.clear();
  }
}
