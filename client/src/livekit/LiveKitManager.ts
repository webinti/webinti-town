import {
  Room,
  RoomEvent,
  Track,
  type LocalAudioTrack,
  type LocalVideoTrack,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type RemoteVideoTrack,
} from 'livekit-client';

const TOKEN_URL = 'http://localhost:3001/api/livekit/token';

export interface RemoteSnapshot {
  identity: string;
  name: string;
  audioTrack: RemoteAudioTrack | null;
  videoTrack: RemoteVideoTrack | null;
  screenTrack: RemoteVideoTrack | null;
  isMuted: boolean;
}

export interface LiveKitSnapshot {
  connected: boolean;
  localMicEnabled: boolean;
  localCamEnabled: boolean;
  localScreenEnabled: boolean;
  localCamTrack: LocalVideoTrack | null;
  localMicTrack: LocalAudioTrack | null;
  localScreenTrack: LocalVideoTrack | null;
  remotes: RemoteSnapshot[];
}

class LiveKitManager {
  private room: Room | null = null;
  private listeners = new Set<() => void>();
  private connecting: Promise<void> | null = null;
  private snapshotVersion = 0;
  private cachedSnapshot: LiveKitSnapshot | null = null;
  private cachedVersion = -1;

  async connect(roomSlug: string, identity: string, name: string): Promise<void> {
    if (this.room) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomSlug, identity, name }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`token request failed: ${res.status} ${text}`);
      }
      const data = (await res.json()) as { token: string; url: string };
      const room = new Room({ adaptiveStream: true, dynacast: true });
      this.room = room;
      const emit = () => this.emit();
      room.on(RoomEvent.TrackSubscribed, emit);
      room.on(RoomEvent.TrackUnsubscribed, emit);
      room.on(RoomEvent.TrackMuted, emit);
      room.on(RoomEvent.TrackUnmuted, emit);
      room.on(RoomEvent.ParticipantConnected, emit);
      room.on(RoomEvent.ParticipantDisconnected, emit);
      room.on(RoomEvent.LocalTrackPublished, emit);
      room.on(RoomEvent.LocalTrackUnpublished, emit);
      room.on(RoomEvent.Disconnected, emit);
      room.on(RoomEvent.Connected, emit);
      await room.connect(data.url, data.token, { autoSubscribe: false });
      this.emit();
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    if (!this.room) return;
    try {
      await this.room.localParticipant.setMicrophoneEnabled(enabled);
      this.emit();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Microphone: ${msg}`);
    }
  }

  async setCamEnabled(enabled: boolean): Promise<void> {
    if (!this.room) return;
    try {
      await this.room.localParticipant.setCameraEnabled(enabled);
      this.emit();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Camera: ${msg}`);
    }
  }

  async setScreenShareEnabled(enabled: boolean): Promise<void> {
    if (!this.room) return;
    try {
      await this.room.localParticipant.setScreenShareEnabled(enabled, { audio: true });
      this.emit();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Partage d'écran: ${msg}`);
    }
  }

  async setSubscribedIdentities(identities: string[]): Promise<void> {
    if (!this.room) return;
    const allowed = new Set(identities);
    for (const participant of this.room.remoteParticipants.values()) {
      const subscribe = allowed.has(participant.identity);
      const pubs = participant.trackPublications;
      for (const pub of pubs.values()) {
        const remotePub = pub as RemoteTrackPublication;
        try {
          remotePub.setSubscribed(subscribe);
        } catch {
          // ignore
        }
      }
    }
  }

  getSnapshot(): LiveKitSnapshot {
    if (this.cachedSnapshot && this.cachedVersion === this.snapshotVersion) {
      return this.cachedSnapshot;
    }
    const snap = this.computeSnapshot();
    this.cachedSnapshot = snap;
    this.cachedVersion = this.snapshotVersion;
    return snap;
  }

  private computeSnapshot(): LiveKitSnapshot {
    const room = this.room;
    if (!room) {
      return {
        connected: false,
        localMicEnabled: false,
        localCamEnabled: false,
        localScreenEnabled: false,
        localCamTrack: null,
        localMicTrack: null,
        localScreenTrack: null,
        remotes: [],
      };
    }
    const local = room.localParticipant;
    let localCamTrack: LocalVideoTrack | null = null;
    let localMicTrack: LocalAudioTrack | null = null;
    let localScreenTrack: LocalVideoTrack | null = null;
    for (const pub of local.trackPublications.values()) {
      if (pub.kind === Track.Kind.Video && pub.track) {
        if (pub.source === Track.Source.ScreenShare) {
          localScreenTrack = pub.track as LocalVideoTrack;
        } else {
          localCamTrack = pub.track as LocalVideoTrack;
        }
      } else if (pub.kind === Track.Kind.Audio && pub.track && pub.source !== Track.Source.ScreenShareAudio) {
        localMicTrack = pub.track as LocalAudioTrack;
      }
    }
    const remotes: RemoteSnapshot[] = [];
    for (const participant of room.remoteParticipants.values() as IterableIterator<RemoteParticipant>) {
      let audioTrack: RemoteAudioTrack | null = null;
      let videoTrack: RemoteVideoTrack | null = null;
      let screenTrack: RemoteVideoTrack | null = null;
      let isMuted = true;
      for (const pub of participant.trackPublications.values()) {
        if (pub.kind === Track.Kind.Audio && pub.source !== Track.Source.ScreenShareAudio) {
          if (pub.track) audioTrack = pub.track as RemoteAudioTrack;
          if (!pub.isMuted && pub.track) isMuted = false;
        } else if (pub.kind === Track.Kind.Video && pub.track) {
          if (pub.source === Track.Source.ScreenShare) {
            screenTrack = pub.track as RemoteVideoTrack;
          } else {
            videoTrack = pub.track as RemoteVideoTrack;
          }
        }
      }
      remotes.push({
        identity: participant.identity,
        name: participant.name ?? participant.identity,
        audioTrack,
        videoTrack,
        screenTrack,
        isMuted,
      });
    }
    return {
      connected: room.state === 'connected',
      localMicEnabled: local.isMicrophoneEnabled,
      localCamEnabled: local.isCameraEnabled,
      localScreenEnabled: local.isScreenShareEnabled,
      localCamTrack,
      localMicTrack,
      localScreenTrack,
      remotes,
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async disconnect(): Promise<void> {
    const room = this.room;
    this.room = null;
    if (room) {
      try {
        await room.disconnect();
      } catch {
        // ignore
      }
    }
    this.emit();
  }

  private emit(): void {
    this.snapshotVersion++;
    for (const fn of this.listeners) fn();
  }
}

export const liveKitManager = new LiveKitManager();
