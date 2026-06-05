// F12 — RaceManager : suivi des tours chronométrés, par room.
//
// Modèle (autoritaire serveur) : un joueur EN KART doit franchir les checkpoints
// du CIRCUIT dans l'ordre. Le checkpoint 0 est la ligne départ/arrivée.
//   - 1er passage sur 0 → démarre le chrono (lap_start).
//   - passages 1,2,…,n-1 dans l'ordre → checkpoint.
//   - retour sur 0 après le dernier → tour bouclé (lap), chrono = now - début,
//     puis un nouveau tour démarre immédiatement (tour lancé).
// Un checkpoint pris hors ordre est ignoré → impossible de couper la piste.
// Le suivi est réinitialisé quand le joueur descend du kart / se déconnecte.

import { CIRCUIT, pointInCheckpoint } from '../circuit.js';

export type RaceEvent =
  | { type: 'lap_start' }
  | { type: 'checkpoint'; index: number; total: number }
  | { type: 'lap'; ms: number; isBest: boolean; bestMs: number };

interface RaceProgress {
  nextIndex: number;          // checkpoint attendu ensuite (0..n-1)
  lapStartMs: number | null;  // null tant que la ligne de départ n'a pas été franchie
  insideIndex: number | null; // checkpoint où l'on se trouve (anti re-déclenchement)
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  ms: number;
}

export class RaceManager {
  private readonly progress = new Map<string, RaceProgress>();
  private readonly best = new Map<string, LeaderboardEntry>(); // meilleur tour par playerId
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Réinitialise le tour en cours (descente du kart, déconnexion). */
  reset(playerId: string): void {
    this.progress.delete(playerId);
  }

  /**
   * À appeler à chaque déplacement d'un joueur EN KART. Retourne les events à
   * émettre au pilote (vide la plupart du temps).
   */
  onMove(playerId: string, name: string, x: number, y: number): RaceEvent[] {
    const n = CIRCUIT.length;
    let p = this.progress.get(playerId);
    if (!p) {
      p = { nextIndex: 0, lapStartMs: null, insideIndex: null };
      this.progress.set(playerId, p);
    }

    // Dans quel checkpoint sommes-nous (le cas échéant) ?
    let inside: number | null = null;
    for (let i = 0; i < n; i++) {
      if (pointInCheckpoint(x, y, CIRCUIT[i]!)) {
        inside = i;
        break;
      }
    }

    if (inside === null) {
      p.insideIndex = null;
      return [];
    }
    // Déjà à l'intérieur de ce même checkpoint : ne pas re-déclencher.
    if (inside === p.insideIndex) return [];
    p.insideIndex = inside;

    // Seul le checkpoint attendu compte (anti-coupe).
    if (inside !== p.nextIndex) return [];

    const events: RaceEvent[] = [];
    if (inside === 0) {
      if (p.lapStartMs === null) {
        // Première fois sur la ligne → on lance le chrono.
        p.lapStartMs = this.now();
        p.nextIndex = 1;
        events.push({ type: 'lap_start' });
      } else {
        // Tour complet bouclé.
        const ms = this.now() - p.lapStartMs;
        const prev = this.best.get(playerId);
        const isBest = !prev || ms < prev.ms;
        if (isBest) this.best.set(playerId, { playerId, name, ms });
        const bestMs = this.best.get(playerId)!.ms;
        events.push({ type: 'lap', ms, isBest, bestMs });
        // Enchaîne sur un nouveau tour (tour lancé).
        p.lapStartMs = this.now();
        p.nextIndex = 1;
      }
    } else {
      // Checkpoint intermédiaire. Après le dernier, on attend de nouveau 0.
      p.nextIndex = (inside + 1) % n;
      events.push({ type: 'checkpoint', index: inside, total: n });
    }
    return events;
  }

  getLeaderboard(limit = 10): LeaderboardEntry[] {
    return [...this.best.values()].sort((a, b) => a.ms - b.ms).slice(0, limit);
  }

  /** Le client courant a-t-il déjà un meilleur tour ? (pour le HUD au join) */
  getBest(playerId: string): number | null {
    return this.best.get(playerId)?.ms ?? null;
  }

  /** Hydrate un meilleur tour depuis le stockage persistant (PocketBase). */
  seedBest(entry: LeaderboardEntry): void {
    const prev = this.best.get(entry.playerId);
    if (!prev || entry.ms < prev.ms) this.best.set(entry.playerId, entry);
  }
}
