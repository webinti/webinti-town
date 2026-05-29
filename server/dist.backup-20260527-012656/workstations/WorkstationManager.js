import { workstationIdForPointIn } from '../workstations.js';
export class WorkstationManager {
    workstations;
    states = new Map();
    constructor(workstations) {
        this.workstations = workstations;
        for (const w of workstations) {
            this.states.set(w.id, {
                id: w.id,
                claimedBy: null,
                claimedByName: null,
                invitedPlayerIds: [],
                claimedAt: null,
            });
        }
    }
    /** Retourne l'état d'un poste, ou undefined si l'id est inconnu. */
    getState(workstationId) {
        return this.states.get(workstationId);
    }
    /** Retourne une copie de tous les états (ordre stable = ordre de WORKSTATIONS). */
    getAllStates() {
        return this.workstations.map((w) => ({ ...this.states.get(w.id) }));
    }
    /**
     * Tente de revendiquer un poste.
     * Conditions : poste libre ET (x, y) dans la zone.
     * Retourne true si réussi.
     */
    claim(workstationId, playerId, playerName, x, y) {
        const ws = this.states.get(workstationId);
        if (!ws)
            return false;
        if (ws.claimedBy !== null)
            return false;
        // Le joueur doit être physiquement dans la zone.
        if (workstationIdForPointIn(this.workstations, x, y) !== workstationId)
            return false;
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
    release(workstationId, playerId) {
        const ws = this.states.get(workstationId);
        if (!ws)
            return false;
        if (ws.claimedBy !== playerId)
            return false;
        ws.claimedBy = null;
        ws.claimedByName = null;
        ws.invitedPlayerIds = [];
        ws.claimedAt = null;
        return true;
    }
    /**
     * Invite un joueur dans le poste.
     * Conditions : acteur === claimer ET target pas déjà invité.
     * Retourne true si réussi.
     */
    invite(workstationId, actorId, targetId) {
        const ws = this.states.get(workstationId);
        if (!ws)
            return false;
        if (ws.claimedBy !== actorId)
            return false;
        if (ws.invitedPlayerIds.includes(targetId))
            return false;
        ws.invitedPlayerIds.push(targetId);
        return true;
    }
    /**
     * Désinvite un joueur du poste.
     * Conditions : acteur === claimer ET target dans la liste.
     * Retourne true si réussi.
     */
    uninvite(workstationId, actorId, targetId) {
        const ws = this.states.get(workstationId);
        if (!ws)
            return false;
        if (ws.claimedBy !== actorId)
            return false;
        const idx = ws.invitedPlayerIds.indexOf(targetId);
        if (idx === -1)
            return false;
        ws.invitedPlayerIds.splice(idx, 1);
        return true;
    }
    /**
     * Vérifie si un joueur peut entrer dans un poste spécifique.
     * - Poste libre → true
     * - Poste claimé → uniquement claimer ou invité
     */
    canEnter(workstationId, playerId) {
        const ws = this.states.get(workstationId);
        if (!ws)
            return true; // zone inconnue → pas de restriction
        if (ws.claimedBy === null)
            return true;
        if (ws.claimedBy === playerId)
            return true;
        return ws.invitedPlayerIds.includes(playerId);
    }
    /**
     * Retourne true si (x, y) se trouve dans un poste verrouillé
     * pour lequel playerId n'est PAS autorisé.
     * Utilisé par updatePlayerPosition pour bloquer le mouvement.
     */
    isInsideAnyLockedWorkstation(playerId, x, y) {
        const wsId = workstationIdForPointIn(this.workstations, x, y);
        if (wsId === null)
            return false;
        return !this.canEnter(wsId, playerId);
    }
}
//# sourceMappingURL=WorkstationManager.js.map