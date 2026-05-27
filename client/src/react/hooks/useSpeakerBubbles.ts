import { useEffect, useRef } from 'react';
import { liveKitManager } from '../../livekit/LiveKitManager';
import { socketManager } from '../../network/SocketManager';
import { useGameStore } from '../../stores/gameStore';

const THROTTLE_MS = 500;

/**
 * Monté une seule fois dans HUD.
 *
 * 1. Surveille les activeSpeakers LiveKit de la room locale.
 *    Quand le statut "je parle" change, émet speaking_state au serveur
 *    avec un throttle de 500ms.
 *
 * 2. Subscribe à speaking_state entrant (remote players) et déclenche
 *    la mise à jour des bulles via le gameStore (GameScene lit le store).
 *
 * Note : la mise à jour des bulles Phaser est gérée par GameScene.update()
 * qui lit workstationId + workstations + speakingPlayerIds du store.
 * Ce hook alimente speakingPlayerIds.
 */
export function useSpeakerBubbles(): void {
  const lastSentRef = useRef<number>(0);
  const lastSpeakingRef = useRef<boolean>(false);

  // 1. Surveillance LiveKit activeSpeakers pour le joueur LOCAL
  useEffect(() => {
    const localId = useGameStore.getState().localPlayerId;
    if (!localId) return;

    // Abonnement direct à RoomEvent.ActiveSpeakersChanged (plus fiable que le snapshot)
    const room = liveKitManager.getRoom();
    if (!room) return;

    const onSpeakersChanged = () => {
      const speakers = room.activeSpeakers ?? [];
      const isLocalSpeaking = speakers.some((p) => p.identity === localId);
      if (isLocalSpeaking === lastSpeakingRef.current) return; // pas de changement
      lastSpeakingRef.current = isLocalSpeaking;
      const now = Date.now();
      if (now - lastSentRef.current < THROTTLE_MS) return;
      lastSentRef.current = now;
      socketManager.sendSpeakingState(isLocalSpeaking);
    };

    room.on('activeSpeakersChanged', onSpeakersChanged);

    return () => {
      room.off('activeSpeakersChanged', onSpeakersChanged);
    };
  }, []);

  // 2. Mise à jour du store speakingPlayerIds à partir des events entrants
  useEffect(() => {
    const unsub = socketManager.onSpeakingState(({ playerId, speaking }) => {
      useGameStore.getState().setSpeakingPlayer(playerId, speaking);
    });
    return unsub;
  }, []);
}
