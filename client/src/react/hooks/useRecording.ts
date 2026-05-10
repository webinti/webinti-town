import { useCallback, useEffect, useRef, useState } from 'react';
import { liveKitManager } from '../../livekit/LiveKitManager';

export type RecordingStatus = 'idle' | 'recording' | 'paused';

export interface RecordingOptions {
  includeMic: boolean;
  includeRemote: boolean;
}

export interface RecordingState {
  status: RecordingStatus;
  elapsedMs: number;
  error: string | null;
  start: (opts: RecordingOptions) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
}

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useRecording(): RecordingState {
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const mixedStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const remoteSourcesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const liveKitUnsubRef = useRef<(() => void) | null>(null);
  const startedAtRef = useRef<number>(0);
  const accumulatedRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const mimeRef = useRef<string>('');

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
    };
  }, []);

  const tickStart = () => {
    startedAtRef.current = Date.now();
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setElapsedMs(accumulatedRef.current + (Date.now() - startedAtRef.current));
    }, 200);
  };

  const tickPause = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    accumulatedRef.current += Date.now() - startedAtRef.current;
    setElapsedMs(accumulatedRef.current);
  };

  const cleanup = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (liveKitUnsubRef.current) {
      liveKitUnsubRef.current();
      liveKitUnsubRef.current = null;
    }
    remoteSourcesRef.current.clear();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {
      // ignore
    });
    streamRef.current = null;
    micStreamRef.current = null;
    mixedStreamRef.current = null;
    audioCtxRef.current = null;
    audioDestRef.current = null;
    recorderRef.current = null;
    accumulatedRef.current = 0;
    setElapsedMs(0);
  };

  const refreshRemoteAudio = () => {
    const ctx = audioCtxRef.current;
    const dest = audioDestRef.current;
    if (!ctx || !dest) return;
    const tracks = liveKitManager.getRemoteAudioMediaStreamTracks();
    const liveIds = new Set(tracks.map((t) => t.id));

    for (const [id, src] of remoteSourcesRef.current) {
      if (!liveIds.has(id)) {
        try {
          src.disconnect();
        } catch {
          // ignore
        }
        remoteSourcesRef.current.delete(id);
      }
    }

    for (const t of tracks) {
      if (remoteSourcesRef.current.has(t.id)) continue;
      try {
        const stream = new MediaStream([t]);
        const src = ctx.createMediaStreamSource(stream);
        src.connect(dest);
        remoteSourcesRef.current.set(t.id, src);
      } catch {
        // ignore
      }
    }
  };

  const start = useCallback(async (opts: RecordingOptions) => {
    setError(null);
    if (status !== 'idle') return;
    const { includeMic, includeRemote } = opts;
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
      streamRef.current = display;

      const displayAudioTracks = display.getAudioTracks();
      const tabAudioCaptured = displayAudioTracks.length > 0;

      let finalStream: MediaStream = display;
      const needsMix = includeMic || includeRemote || tabAudioCaptured;

      if (needsMix) {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const dest = ctx.createMediaStreamDestination();
        audioDestRef.current = dest;

        if (tabAudioCaptured) {
          try {
            const src = ctx.createMediaStreamSource(new MediaStream(displayAudioTracks));
            src.connect(dest);
          } catch {
            // ignore
          }
        }

        if (includeMic) {
          try {
            const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
            micStreamRef.current = mic;
            const src = ctx.createMediaStreamSource(mic);
            src.connect(dest);
          } catch (micErr) {
            const msg = micErr instanceof Error ? micErr.message : String(micErr);
            setError(`Micro: ${msg}`);
          }
        }

        if (includeRemote) {
          refreshRemoteAudio();
          liveKitUnsubRef.current = liveKitManager.subscribe(() => {
            refreshRemoteAudio();
          });
        }

        const mixed = new MediaStream();
        display.getVideoTracks().forEach((t) => mixed.addTrack(t));
        dest.stream.getAudioTracks().forEach((t) => mixed.addTrack(t));
        mixedStreamRef.current = mixed;
        finalStream = mixed;
      }

      const stopHandler = () => {
        // user stopped sharing via browser UI
        void stop();
      };
      display.getVideoTracks().forEach((t) => t.addEventListener('ended', stopHandler));

      const mime = pickMimeType();
      mimeRef.current = mime;
      const recorder = mime ? new MediaRecorder(finalStream, { mimeType: mime }) : new MediaRecorder(finalStream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current || 'video/webm' });
        const ext = (mimeRef.current.includes('mp4') ? 'mp4' : 'webm');
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        downloadBlob(blob, `webinti-town-${ts}.${ext}`);
        cleanup();
        setStatus('idle');
      };

      recorder.start(1000);
      accumulatedRef.current = 0;
      tickStart();
      setStatus('recording');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      cleanup();
      setStatus('idle');
    }
  }, [status]);

  const pause = useCallback(() => {
    const r = recorderRef.current;
    if (!r || r.state !== 'recording') return;
    r.pause();
    tickPause();
    setStatus('paused');
  }, []);

  const resume = useCallback(() => {
    const r = recorderRef.current;
    if (!r || r.state !== 'paused') return;
    r.resume();
    tickStart();
    setStatus('recording');
  }, []);

  const stop = useCallback(async () => {
    const r = recorderRef.current;
    if (!r) return;
    if (r.state !== 'inactive') {
      try {
        r.stop();
      } catch {
        // ignore
      }
    }
  }, []);

  return { status, elapsedMs, error, start, pause, resume, stop };
}
