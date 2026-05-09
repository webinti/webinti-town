import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { liveKitManager, type LiveKitSnapshot } from '../../livekit/LiveKitManager';
import { socketManager } from '../../network/SocketManager';
import { useGameStore } from '../../stores/gameStore';

const subscribe = (cb: () => void) => liveKitManager.subscribe(cb);
const getSnapshot = (): LiveKitSnapshot => liveKitManager.getSnapshot();

export function useLiveKit() {
  const snap = useSyncExternalStore(subscribe, getSnapshot);
  const joined = useGameStore((s) => s.joined);
  const localPlayerId = useGameStore((s) => s.localPlayerId);
  const name = useGameStore((s) => s.name);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!joined || !localPlayerId || !name) return;
    const roomSlug = 'demo';
    let cancelled = false;
    liveKitManager
      .connect(roomSlug, localPlayerId, name)
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      });
    return () => {
      cancelled = true;
      void liveKitManager.disconnect();
    };
  }, [joined, localPlayerId, name]);

  useEffect(() => {
    const off = socketManager.onProximityUpdate((ids) => {
      void liveKitManager.setSubscribedIdentities(ids);
    });
    return off;
  }, []);

  const toggleMic = useCallback(async () => {
    setError(null);
    try {
      await liveKitManager.setMicEnabled(!snap.localMicEnabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [snap.localMicEnabled]);

  const toggleCam = useCallback(async () => {
    setError(null);
    try {
      await liveKitManager.setCamEnabled(!snap.localCamEnabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [snap.localCamEnabled]);

  const toggleScreenShare = useCallback(async () => {
    setError(null);
    try {
      await liveKitManager.setScreenShareEnabled(!snap.localScreenEnabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [snap.localScreenEnabled]);

  return {
    connected: snap.connected,
    micEnabled: snap.localMicEnabled,
    camEnabled: snap.localCamEnabled,
    screenShareEnabled: snap.localScreenEnabled,
    toggleMic,
    toggleCam,
    toggleScreenShare,
    localCamTrack: snap.localCamTrack,
    localScreenTrack: snap.localScreenTrack,
    remotes: snap.remotes,
    error,
  };
}
