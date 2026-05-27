import { useEffect, useRef } from 'react';
import { liveKitManager } from '../../livekit/LiveKitManager';
import { socketManager } from '../../network/SocketManager';
import { useGameStore } from '../../stores/gameStore';

/**
 * Monté une seule fois dans HUD.
 *
 * 1. Surveille les activeSpeakers LiveKit de la room locale.
 *    Quand notre état "je parle / je ne parle plus" change, émet `speaking_state`
 *    au serveur. Pas de throttle ici : on n'émet QUE sur transition d'état,
 *    donc max 2 events par cycle parle/se-tait — pas besoin de limiter.
 *
 * 2. Subscribe à `speaking_state` entrant (broadcasts de tous les joueurs,
 *    nous-même inclus) et met à jour `speakingPlayerIds` dans le store.
 *
 * Pour être robuste au cas où la Room LiveKit n'est pas encore prête au
 * mount du hook, on s'abonne au manager pour retenter l'attachement à chaque
 * changement d'état de connexion.
 */
export function useSpeakerBubbles(): void {
  const lastSpeakingRef = useRef<boolean>(false);

  // 1. Surveillance LiveKit activeSpeakers pour le joueur LOCAL.
  useEffect(() => {
    let detach: (() => void) | null = null;

    const tryAttach = (): boolean => {
      if (detach) return true;
      const room = liveKitManager.getRoom();
      if (!room) return false;
      const localId = useGameStore.getState().localPlayerId;
      if (!localId) return false;

      const onSpeakersChanged = () => {
        const speakers = room.activeSpeakers ?? [];
        const isLocalSpeaking = speakers.some((p) => p.identity === localId);
        if (isLocalSpeaking === lastSpeakingRef.current) return;
        lastSpeakingRef.current = isLocalSpeaking;
        // Émettre sur CHAQUE transition d'état — pas de throttle au cas où
        // l'utilisateur parle puis se tait dans la même fenêtre de 500ms,
        // l'ancien throttle perdait l'event "stop" et la bulle restait visible.
        socketManager.sendSpeakingState(isLocalSpeaking);
      };

      room.on('activeSpeakersChanged', onSpeakersChanged);
      detach = () => room.off('activeSpeakersChanged', onSpeakersChanged);
      return true;
    };

    // Tentative immédiate (cas du re-mount après connexion).
    if (!tryAttach()) {
      // Sinon, retry à chaque changement d'état du manager.
      const unsub = liveKitManager.subscribe(() => {
        tryAttach();
      });
      return () => {
        unsub();
        detach?.();
      };
    }

    return () => {
      detach?.();
    };
  }, []);

  // 2. Mise à jour du store speakingPlayerIds à partir des events entrants.
  useEffect(() => {
    const unsub = socketManager.onSpeakingState(({ playerId, speaking }) => {
      useGameStore.getState().setSpeakingPlayer(playerId, speaking);
    });
    return unsub;
  }, []);
}
