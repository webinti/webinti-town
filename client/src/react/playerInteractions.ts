import { useGameStore } from '../stores/gameStore';
import { socketManager } from '../network/SocketManager';

// Actions « façon Gather » partagées par la carte joueur (clic sur l'avatar)
// et la notif de wave reçue. Centralisées ici pour rester cohérentes.

/** Envoie un « coucou » (wave) à un joueur — réutilise le canal knock existant. */
export function wavePlayer(playerId: string): void {
  socketManager.knock(playerId);
}

/**
 * Téléporte le joueur local juste à côté d'un autre (légèrement en dessous pour
 * ne pas chevaucher son avatar). Réutilise autoWalkTarget consommé par GameScene.
 * Retourne false si la position du joueur cible est inconnue.
 */
export function walkToPlayer(playerId: string): boolean {
  const st = useGameStore.getState();
  const target = st.players.get(playerId);
  if (!target) return false;
  st.setAutoWalkTarget({ x: target.x, y: target.y + 40, startedAt: Date.now() });
  return true;
}

/**
 * Centre la caméra sur un joueur SANS déplacer le perso local (réutilise la
 * « vue libre » de la minimap). Le bouton « Revenir à moi » de la minimap, ou un
 * déplacement, ramène la vue. Retourne false si la position est inconnue.
 */
export function locatePlayer(playerId: string): boolean {
  const st = useGameStore.getState();
  const target = st.players.get(playerId);
  if (!target) return false;
  st.enterFreeLook(target.x, target.y);
  return true;
}

/** Ouvre une conversation privée (DM) avec un joueur dans le ChatPanel. */
export function dmPlayer(playerId: string): void {
  useGameStore.getState().requestOpenDm(playerId);
}
