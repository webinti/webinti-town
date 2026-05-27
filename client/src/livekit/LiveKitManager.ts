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

const SERVER_BASE =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  (import.meta.env.PROD ? '' : 'http://localhost:3001');
const TOKEN_URL = `${SERVER_BASE}/api/livekit/token`;

export interface RemoteSnapshot {
  identity: string;
  name: string;
  audioTrack: RemoteAudioTrack | null;
  videoTrack: RemoteVideoTrack | null;
  screenTrack: RemoteVideoTrack | null;
  isMuted: boolean;
  // True when the remote's screen-share publication is muted — happens when
  // the sharer minimizes / hides the source window. We propagate this
  // manually from the sender side via the underlying MediaStreamTrack's
  // 'mute' event (see attachScreenSourceVisibilityRelay).
  screenMuted: boolean;
}

export interface LiveKitSnapshot {
  connected: boolean;
  localMicEnabled: boolean;
  localCamEnabled: boolean;
  localScreenEnabled: boolean;
  // True when the local screen-share source window is currently hidden
  // (minimized). The MediaStreamTrack fires 'mute' in that state; we relay
  // it as a LiveKit mute so remotes can show a "paused" placeholder.
  localScreenSourceHidden: boolean;
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
  // Relay state for the local screen-share source visibility (see
  // attachScreenSourceVisibilityRelay).
  private screenRelayMst: MediaStreamTrack | null = null;
  private screenRelayOnMute: (() => void) | null = null;
  private screenRelayOnUnmute: (() => void) | null = null;
  private localScreenSourceHidden = false;

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
      room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
        // If the user stopped screen sharing via the browser's native UI
        // (not through our toggle), the source MediaStreamTrack is gone —
        // drop our relay listeners so we don't hold a dead reference.
        if (pub.source === Track.Source.ScreenShare) {
          this.detachScreenSourceVisibilityRelay();
        }
        emit();
      });
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
      // CRITICAL: detach the visibility relay BEFORE asking LiveKit to stop the
      // share. Otherwise, the MediaStreamTrack's 'mute' event (fired during
      // disposal) is caught by our relay and propagated as track.mute() →
      // remotes receive isMuted=true on the screen publication just before
      // (or instead of) the unpublish signal, leaving the remote viewer
      // stuck on a paused/black state. Detaching first guarantees the
      // 'mute' event during disposal is ignored.
      if (!enabled) {
        this.detachScreenSourceVisibilityRelay();
      }
      await this.room.localParticipant.setScreenShareEnabled(enabled, { audio: true });
      if (enabled) {
        // Locate the freshly-published screen track and hook our visibility relay.
        let track: LocalVideoTrack | null = null;
        for (const pub of this.room.localParticipant.trackPublications.values()) {
          if (pub.source === Track.Source.ScreenShare && pub.track) {
            track = pub.track as LocalVideoTrack;
            break;
          }
        }
        if (track) this.attachScreenSourceVisibilityRelay(track);
      }
      this.emit();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Partage d'écran: ${msg}`);
    }
  }

  /**
   * Browsers fire 'mute' on a getDisplayMedia MediaStreamTrack when the OS
   * stops compositing the source (window minimized, app hidden). LiveKit's
   * built-in handler only pauses the upstream after a 5s debounce and does
   * NOT propagate `isMuted` to remote participants — so the other side keeps
   * displaying the last frozen frame (typically black) with no indication.
   *
   * We relay the native mute/unmute through LiveKit's own mute() / unmute()
   * so `RemoteTrackPublication.isMuted` flips on every other client and the
   * UI can show a "partage en pause" placeholder.
   */
  private attachScreenSourceVisibilityRelay(track: LocalVideoTrack): void {
    this.detachScreenSourceVisibilityRelay();
    const mst = track.mediaStreamTrack;
    if (!mst) return;
    const onMute = () => {
      this.localScreenSourceHidden = true;
      void track.mute().catch(() => undefined);
      this.emit();
    };
    const onUnmute = () => {
      this.localScreenSourceHidden = false;
      void track.unmute().catch(() => undefined);
      this.emit();
    };
    mst.addEventListener('mute', onMute);
    mst.addEventListener('unmute', onUnmute);
    this.screenRelayMst = mst;
    this.screenRelayOnMute = onMute;
    this.screenRelayOnUnmute = onUnmute;
    // Initial state: if the browser already considers the track muted (rare,
    // but happens if the user immediately switches apps), reflect it.
    if (mst.muted) onMute();
  }

  private detachScreenSourceVisibilityRelay(): void {
    if (this.screenRelayMst && this.screenRelayOnMute) {
      this.screenRelayMst.removeEventListener('mute', this.screenRelayOnMute);
    }
    if (this.screenRelayMst && this.screenRelayOnUnmute) {
      this.screenRelayMst.removeEventListener('unmute', this.screenRelayOnUnmute);
    }
    this.screenRelayMst = null;
    this.screenRelayOnMute = null;
    this.screenRelayOnUnmute = null;
    this.localScreenSourceHidden = false;
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
        localScreenSourceHidden: false,
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
      let screenMuted = false;
      for (const pub of participant.trackPublications.values()) {
        if (pub.kind === Track.Kind.Audio && pub.source !== Track.Source.ScreenShareAudio) {
          if (pub.track) audioTrack = pub.track as RemoteAudioTrack;
          if (!pub.isMuted && pub.track) isMuted = false;
        } else if (pub.kind === Track.Kind.Video && pub.track) {
          if (pub.source === Track.Source.ScreenShare) {
            screenTrack = pub.track as RemoteVideoTrack;
            screenMuted = pub.isMuted;
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
        screenMuted,
      });
    }
    return {
      connected: room.state === 'connected',
      localMicEnabled: local.isMicrophoneEnabled,
      localCamEnabled: local.isCameraEnabled,
      localScreenEnabled: local.isScreenShareEnabled,
      localScreenSourceHidden: this.localScreenSourceHidden,
      localCamTrack,
      localMicTrack,
      localScreenTrack,
      remotes,
    };
  }

  getRoom(): Room | null {
    return this.room;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getRemoteAudioMediaStreamTracks(): MediaStreamTrack[] {
    if (!this.room) return [];
    const out: MediaStreamTrack[] = [];
    for (const p of this.room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
        if (pub.kind === Track.Kind.Audio && pub.track && pub.source !== Track.Source.ScreenShareAudio) {
          const mst = pub.track.mediaStreamTrack;
          if (mst && mst.readyState === 'live') out.push(mst);
        }
      }
    }
    return out;
  }

  async disconnect(): Promise<void> {
    this.detachScreenSourceVisibilityRelay();
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
