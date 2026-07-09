import { useGameStore } from '../stores/gameStore';

/**
 * Écran plein affiché en édition self-host quand la licence Webinti est
 * expirée/absente (`license_expired`) ou que la capacité est plafonnée par la
 * licence (`license_capacity`). Les données de l'instance restent intactes :
 * dès que l'abonnement est régularisé, l'accès revient tout seul (le serveur de
 * licence ré-émet un jeton au prochain heartbeat).
 */
export function LicenseBlockedScreen() {
  const block = useGameStore((s) => s.licenseBlock);
  if (!block) return null;

  const expired = block.code === 'license_expired';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/95 p-6 text-slate-200">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center shadow-2xl">
        <div className="mb-4 text-5xl">{expired ? '🔒' : '⏳'}</div>
        <h1 className="mb-2 text-xl font-semibold text-white">
          {expired ? 'Accès suspendu' : 'Capacité atteinte'}
        </h1>
        <p className="mb-6 text-sm leading-relaxed text-slate-400">
          {block.message}
        </p>
        <p className="mb-6 text-xs leading-relaxed text-slate-500">
          {expired
            ? "Vos données sont conservées et intactes. L'accès sera rétabli automatiquement dès la régularisation de l'abonnement."
            : 'Réessayez dans un moment, ou contactez votre administrateur pour augmenter la capacité.'}
        </p>
        <button
          type="button"
          onClick={() => {
            useGameStore.getState().setLicenseBlock(null);
            window.location.reload();
          }}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500"
        >
          Réessayer
        </button>
        <p className="mt-6 text-[11px] text-slate-600">Webinti Town — édition self-host</p>
      </div>
    </div>
  );
}
