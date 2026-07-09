/**
 * Écran plein affiché brièvement quand une intention de plan (venue de la landing
 * ?plan=…) déclenche le checkout Stripe juste après l'authentification :
 *  - état « redirection » : spinner + « Redirection vers le paiement sécurisé… »
 *    pour que l'utilisateur comprenne le départ vers Stripe ;
 *  - état « erreur » : message discret + bouton pour poursuivre dans l'app
 *    (l'intention a déjà été effacée, l'abonnement reste dispo via « Mon compte »).
 */
export function PlanRedirectOverlay({
  error = false,
  onDismiss,
}: {
  error?: boolean;
  onDismiss?: () => void;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 p-6 text-slate-100">
      <div className="w-full max-w-sm rounded-2xl bg-slate-800/80 p-8 text-center shadow-2xl ring-1 ring-white/10 backdrop-blur">
        {error ? (
          <>
            <div className="mb-4 text-4xl">💳</div>
            <h1 className="mb-2 text-lg font-semibold text-white">
              Paiement indisponible
            </h1>
            <p className="mb-6 text-sm leading-relaxed text-slate-400">
              Le paiement n'a pas pu démarrer pour le moment. Vous pouvez le relancer
              depuis « Mon compte ».
            </p>
            <button
              type="button"
              onClick={onDismiss}
              className="w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400"
            >
              Continuer
            </button>
          </>
        ) : (
          <>
            <div
              className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400"
              aria-hidden
            />
            <h1 className="mb-1 text-lg font-semibold text-white">
              Redirection vers le paiement sécurisé…
            </h1>
            <p className="text-sm text-slate-400">
              Vous allez être redirigé vers Stripe pour finaliser votre abonnement.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
