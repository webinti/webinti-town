import { useEffect, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { useAuthStore } from '../../stores/authStore';
import { socketManager } from '../../network/SocketManager';
import { AvatarPreview, AvatarControls, clampAppearance } from '../avatar/AvatarCustomizer';

/**
 * Menu d'édition de l'avatar en cours de partie (ouvert au clic sur le nom).
 * Applique le changement en live (GameScene écoute le store), le diffuse aux
 * autres joueurs (socket) et le persiste sur le compte PocketBase.
 */
export function AvatarEditModal({ onClose }: { onClose: () => void }) {
  const saveProfile = useAuthStore((s) => s.saveProfile);
  const [appearance, setAppearance] = useState(() =>
    clampAppearance(useGameStore.getState().appearance),
  );
  const [saving, setSaving] = useState(false);

  // Bloque les contrôles clavier du jeu tant que le menu est ouvert.
  useEffect(() => {
    useGameStore.getState().setInputFocused(true);
    return () => useGameStore.getState().setInputFocused(false);
  }, []);

  const save = async () => {
    setSaving(true);
    // 1. live (le Player local lit le store) + 2. diffusion aux autres
    useGameStore.getState().setAppearance(appearance);
    socketManager.sendAppearanceUpdate(appearance);
    // 3. persistance sur le compte (best-effort)
    try {
      await saveProfile(useGameStore.getState().name, appearance);
    } catch {
      /* on garde le changement local/diffusé même si la sauvegarde échoue */
    }
    onClose();
  };

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 text-slate-100"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-slate-800 p-6 shadow-2xl ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">Mon avatar</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded p-1 text-slate-400 transition hover:text-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 flex justify-center">
          <div className="rounded-lg bg-slate-900/60 p-3 ring-1 ring-slate-700">
            <AvatarPreview appearance={appearance} scale={3} />
          </div>
        </div>

        <AvatarControls appearance={appearance} onChange={setAppearance} />

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg bg-slate-700 px-4 py-2.5 font-semibold transition hover:bg-slate-600"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex-1 rounded-lg bg-indigo-500 px-4 py-2.5 font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-50"
          >
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}
