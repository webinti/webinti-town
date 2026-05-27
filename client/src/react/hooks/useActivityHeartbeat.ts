import { useEffect, useRef } from 'react';
import { socketManager } from '../../network/SocketManager';
import { useGameStore } from '../../stores/gameStore';

const DEBOUNCE_MS = 10_000;

/**
 * Monté une seule fois dans HUD.
 * Détecte mousemove / keydown / focus et envoie un ping presence_activity
 * au serveur avec un debounce de 10 s pour ne pas saturer le réseau.
 * Met aussi à jour le store local si on était inactive.
 */
export function useActivityHeartbeat(): void {
  const lastSentRef = useRef<number>(0);

  useEffect(() => {
    function signal() {
      const now = Date.now();
      if (now - lastSentRef.current < DEBOUNCE_MS) return;
      lastSentRef.current = now;
      socketManager.sendActivity();
      // Rétablissement côté store si inactive (le serveur broadcastera aussi,
      // mais on met à jour le store local immédiatement pour la réactivité UI).
      const store = useGameStore.getState();
      if (store.localPresence === 'inactive') {
        store.setLocalPresence('available');
      }
    }

    window.addEventListener('mousemove', signal, { passive: true });
    window.addEventListener('keydown', signal, { passive: true });
    window.addEventListener('focus', signal);

    return () => {
      window.removeEventListener('mousemove', signal);
      window.removeEventListener('keydown', signal);
      window.removeEventListener('focus', signal);
    };
  }, []);
}
