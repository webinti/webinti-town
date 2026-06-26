import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { liveKitManager } from '../../livekit/LiveKitManager';
import { useGameStore } from '../../stores/gameStore';
import { setMuted as setSoundsMuted } from '../../sounds/sounds';

// Barre audio/vidéo : micro (+ choix du micro), caméra (+ choix caméra + miroir),
// et sortie son (casque = sourdine + slider de volume des voix entrantes).
// Lit le snapshot LiveKit en LECTURE SEULE (useSyncExternalStore) pour ne PAS
// déclencher de seconde connexion (le hook useLiveKit, lui, gère la connexion).

const subscribe = (cb: () => void) => liveKitManager.subscribe(cb);
const getSnapshot = () => liveKitManager.getSnapshot();

export function AvControls() {
  const snap = useSyncExternalStore(subscribe, getSnapshot);
  const deafened = useGameStore((s) => s.deafened);
  const masterVolume = useGameStore((s) => s.masterVolume);
  const camMirror = useGameStore((s) => s.camMirror);

  const [menu, setMenu] = useState<null | 'mic' | 'cam' | 'out'>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);

  const openMenu = useCallback(
    async (which: 'mic' | 'cam') => {
      if (menu === which) { setMenu(null); return; }
      setMenu(which);
      const kind: MediaDeviceKind = which === 'mic' ? 'audioinput' : 'videoinput';
      setDevices(await liveKitManager.listDevices(kind));
      setActiveId(liveKitManager.getActiveDeviceId(kind));
    },
    [menu],
  );

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const pick = async (id: string) => {
    const kind: MediaDeviceKind = menu === 'mic' ? 'audioinput' : 'videoinput';
    try { await liveKitManager.switchDevice(kind, id); setActiveId(id); } catch { /* ignore */ }
    setMenu(null);
  };

  const toggleMute = () => {
    const next = !deafened;
    useGameStore.getState().setDeafened(next);
    setSoundsMuted(next);
  };
  const onVolume = (v: number) => {
    useGameStore.getState().setMasterVolume(v);
    if (v > 0 && deafened) { useGameStore.getState().setDeafened(false); setSoundsMuted(false); }
  };

  const muted = deafened || masterVolume === 0;
  const pct = Math.round((deafened ? 0 : masterVolume) * 100);

  return (
    <div className="relative flex items-center gap-1.5">
      {menu && <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />}
      {/* MICRO */}
      <DeviceControl
        label="Micro"
        icon="🎤"
        enabled={snap.localMicEnabled}
        onToggle={() => void liveKitManager.setMicEnabled(!snap.localMicEnabled)}
        onChevron={() => void openMenu('mic')}
        open={menu === 'mic'}
      >
        {menu === 'mic' && (
          <DeviceMenu title="Sélectionner le micro" devices={devices} activeId={activeId} onPick={pick} />
        )}
      </DeviceControl>

      {/* CAMÉRA */}
      <DeviceControl
        label="Caméra"
        icon="🎥"
        enabled={snap.localCamEnabled}
        onToggle={() => void liveKitManager.setCamEnabled(!snap.localCamEnabled)}
        onChevron={() => void openMenu('cam')}
        open={menu === 'cam'}
      >
        {menu === 'cam' && (
          <DeviceMenu title="Sélectionner la caméra" devices={devices} activeId={activeId} onPick={pick}>
            <button
              onClick={() => useGameStore.getState().setCamMirror(!camMirror)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm text-slate-200 hover:bg-white/5"
            >
              <span>🪞 Miroir (vue perso)</span>
              <span
                className={`relative h-4 w-7 rounded-full transition ${camMirror ? 'bg-indigo-500' : 'bg-slate-600'}`}
              >
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${camMirror ? 'left-3.5' : 'left-0.5'}`}
                />
              </span>
            </button>
          </DeviceMenu>
        )}
      </DeviceControl>

      {/* SORTIE SON : casque (sourdine) + caret → popover volume (barre minimale) */}
      <div className="relative flex items-center rounded-full bg-slate-800/80">
        <button
          onClick={toggleMute}
          title={muted ? 'Réactiver le son' : 'Couper tout le son'}
          className={`flex h-8 items-center rounded-l-full pl-3 pr-2 text-base transition ${
            muted ? 'bg-red-500/90 text-white' : 'text-slate-100 hover:bg-slate-700'
          }`}
        >
          🎧
        </button>
        <button
          onClick={() => setMenu(menu === 'out' ? null : 'out')}
          title="Volume des autres"
          className={`flex h-8 w-6 items-center justify-center rounded-r-full text-[10px] text-slate-300 transition hover:bg-slate-700 ${
            menu === 'out' ? 'bg-slate-700' : ''
          }`}
        >
          ▲
        </button>
        {menu === 'out' && (
          <div className="absolute bottom-full right-0 z-50 mb-2 w-56 rounded-xl bg-slate-900/95 p-3 text-sm shadow-2xl ring-1 ring-white/10 backdrop-blur">
            <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              <span>Volume des autres</span>
              <span className="tabular-nums text-slate-300">{pct}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={pct}
              onChange={(e) => onVolume(Number(e.target.value) / 100)}
              className="h-1 w-full cursor-pointer accent-indigo-500"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function DeviceControl({
  label, icon, enabled, onToggle, onChevron, open, children,
}: {
  label: string;
  icon: string;
  enabled: boolean;
  onToggle: () => void;
  onChevron: () => void;
  open: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="relative flex items-center rounded-full bg-slate-800/80">
      <button
        onClick={onToggle}
        title={`${label} ${enabled ? '(couper)' : '(activer)'}`}
        className={`flex h-8 items-center gap-1 rounded-l-full pl-3 pr-2 text-base transition ${
          enabled ? 'text-slate-100 hover:bg-slate-700' : 'bg-red-500/90 text-white rounded-l-full'
        }`}
      >
        {icon}
      </button>
      <button
        onClick={onChevron}
        title={`Choisir ${label.toLowerCase()}`}
        className={`flex h-8 w-6 items-center justify-center rounded-r-full text-[10px] text-slate-300 transition hover:bg-slate-700 ${
          open ? 'bg-slate-700' : ''
        }`}
      >
        ▲
      </button>
      {children}
    </div>
  );
}

function DeviceMenu({
  title, devices, activeId, onPick, children,
}: {
  title: string;
  devices: MediaDeviceInfo[];
  activeId: string | undefined;
  onPick: (id: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-xl bg-slate-900/95 p-2 text-sm shadow-2xl ring-1 ring-white/10 backdrop-blur">
      <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </div>
      {devices.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-slate-500">Aucun périphérique.</div>
      ) : (
        devices.map((d) => {
          const active = d.deviceId === activeId;
          return (
            <button
              key={d.deviceId}
              onClick={() => onPick(d.deviceId)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-white/5 ${
                active ? 'text-indigo-300' : 'text-slate-200'
              }`}
            >
              <span className="w-3 shrink-0 text-indigo-400">{active ? '●' : ''}</span>
              <span className="truncate">{d.label || 'Périphérique'}</span>
            </button>
          );
        })
      )}
      {children && <div className="mt-1 border-t border-white/10 pt-1">{children}</div>}
    </div>
  );
}
