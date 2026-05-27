import type { WorkstationState } from '../types.js';
import type { Workstation } from '../workstations.js';
import { workstationIdForPointIn } from '../workstations.js';

export class WorkstationManager {
  private readonly workstations: readonly Workstation[];
  private readonly states = new Map<string, WorkstationState>();

  constructor(workstations: readonly Workstation[]) {
    this.workstations = workstations;
    for (const w of workstations) {
      this.states.set(w.id, {
        id: w.id,
        claimedBy: null,
        claimedByName: null,
        invitedPlayerIds: [],
        claimedAt: null,
        customName: null,
      });
    }
  }

  /** Retourne l'état d'un poste, ou undefined si l'id est inconnu. */
  getState(workstationId: string): WorkstationState | undefined {
    return this.states.get(workstationId);
  }

  /**
   * Une zone "hidden" (ex: salle de conférence) ne supporte pas les
   * mutations utilisateur (claim/release/invite/rename). Elle sert
   * uniquement à grouper l'audio des occupants.
   */
  private isHidden(workstationId: string): boolean {
    return this.workstations.find((w) => w.id === workstationId)?.hidden === true;
  }

  /** Retourne une copie de tous les états (ordre stable = ordre de WORKSTATIONS). */
  getAllStates(): WorkstationState[] {
    return this.workstations.map((w) => ({ ...this.states.get(w.id)! }));
  }

  /**
   * Tente de revendiquer un poste.
   * Conditions : poste libre ET (x, y) dans la zone.
   * Retourne true si réussi.
   */
  claim(workstationId: string, playerId: string, playerName: string, x: number, y: number): boolean {
    if (this.isHidden(workstationId)) return false;
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== null) return false;
    // Le joueur doit être physiquement dans la zone.
    if (workstationIdForPointIn(this.workstations, x, y) !== workstationId) return false;
    ws.claimedBy = playerId;
    ws.claimedByName = playerName;
    ws.claimedAt = Date.now();
    return true;
  }

  /**
   * Tente de libérer un poste.
   * Conditions : acteur === claimer.
   * Retourne true si réussi. Efface aussi les invités.
   */
  release(workstationId: string, playerId: string): boolean {
    if (this.isHidden(workstationId)) return false;
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== playerId) return false;
    ws.claimedBy = null;
    ws.claimedByName = null;
    ws.invitedPlayerIds = [];
    ws.claimedAt = null;
    ws.customName = null;
    return true;
  }

  /**
   * Invite un joueur dans le poste.
   * Conditions : acteur === claimer ET target pas déjà invité.
   * Retourne true si réussi.
   */
  invite(workstationId: string, actorId: string, targetId: string): boolean {
    if (this.isHidden(workstationId)) return false;
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== actorId) return false;
    if (ws.invitedPlayerIds.includes(targetId)) return false;
    ws.invitedPlayerIds.push(targetId);
    return true;
  }

  /**
   * Désinvite un joueur du poste.
   * Conditions : acteur === claimer ET target dans la liste.
   * Retourne true si réussi.
   */
  uninvite(workstationId: string, actorId: string, targetId: string): boolean {
    if (this.isHidden(workstationId)) return false;
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== actorId) return false;
    const idx = ws.invitedPlayerIds.indexOf(targetId);
    if (idx === -1) return false;
    ws.invitedPlayerIds.splice(idx, 1);
    return true;
  }

  /**
   * Vérifie si un joueur peut entrer dans un poste spécifique.
   * - Poste libre → true
   * - Poste claimé → uniquement claimer ou invité
   */
  canEnter(workstationId: string, playerId: string): boolean {
    // Zones invisibles (salle conf) : tout le monde peut toujours entrer.
    if (this.isHidden(workstationId)) return true;
    const ws = this.states.get(workstationId);
    if (!ws) return true;   // zone inconnue → pas de restriction
    if (ws.claimedBy === null) return true;
    if (ws.claimedBy === playerId) return true;
    return ws.invitedPlayerIds.includes(playerId);
  }

  /**
   * Définit le nom personnalisé d'un poste (max 40 chars).
   * Seul le claimer peut modifier le nom.
   * null → efface le nom personnalisé (revient au nom par défaut).
   * Retourne true si réussi.
   */
  setCustomName(actorId: string, workstationId: string, customName: string | null): boolean {
    if (this.isHidden(workstationId)) return false;
    const ws = this.states.get(workstationId);
    if (!ws) return false;
    if (ws.claimedBy !== actorId) return false;
    if (customName === null) {
      ws.customName = null;
      return true;
    }
    const trimmed = customName.trim().slice(0, 40);
    if (trimmed.length === 0) return false;
    ws.customName = trimmed;
    return true;
  }

  /**
   * Retourne true si (x, y) se trouve dans un poste verrouillé
   * pour lequel playerId n'est PAS autorisé.
   * Utilisé par updatePlayerPosition pour bloquer le mouvement.
   */
  isInsideAnyLockedWorkstation(playerId: string, x: number, y: number): boolean {
    const wsId = workstationIdForPointIn(this.workstations, x, y);
    if (wsId === null) return false;
    return !this.canEnter(wsId, playerId);
  }
}
