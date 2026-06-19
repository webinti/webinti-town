import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { pb } from '../../pocketbase';

// Base de l'API (même logique que SocketManager) : same-origin en prod,
// localhost:3001 en dev, surchargeable via VITE_SERVER_URL.
const API_BASE =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  (import.meta.env.PROD ? '' : 'http://localhost:3001');

// Plans payants proposés au changement d'abonnement (le plan `free` n'est pas
// vendable). Ordre = ordre d'affichage des boutons.
type PaidPlan = 'starter' | 'team' | 'enterprise';
const PAID_PLANS: { id: PaidPlan; label: string; price: string }[] = [
  { id: 'starter', label: 'Démarrage', price: '39€' },
  { id: 'team', label: 'Équipe', price: '90€' },
  { id: 'enterprise', label: 'Entreprise', price: '350€' },
];

// Libellés d'abonnement affichés (champ `plan` du user PB).
const PLAN_LABELS: Record<string, string> = {
  free: 'Gratuit · jusqu’à 3 personnes',
  starter: 'Démarrage · jusqu’à 10',
  team: 'Équipe · jusqu’à 25',
  enterprise: 'Entreprise · jusqu’à 100',
};

// Compte hôte : toujours Entreprise (comme côté serveur). Surchargeable via env.
const HOST_EMAIL = (
  (import.meta.env.VITE_HOST_EMAIL as string | undefined) ?? 'agence.webinti@gmail.com'
).toLowerCase();

// Style du badge par palier — l'Entreprise est mise en avant en Or.
const PLAN_STYLE: Record<string, { wrap: string; dot: string }> = {
  free: { wrap: 'bg-slate-900/60 text-slate-300 ring-slate-700', dot: 'bg-slate-400' },
  starter: { wrap: 'bg-sky-500/10 text-sky-200 ring-sky-500/40', dot: 'bg-sky-400' },
  team: { wrap: 'bg-violet-500/10 text-violet-200 ring-violet-500/40', dot: 'bg-violet-400' },
  enterprise: {
    wrap: 'bg-amber-400/15 text-amber-200 ring-amber-400/60 shadow-[0_0_14px_-2px_rgba(251,191,36,.55)]',
    dot: 'bg-amber-400',
  },
};

/** Code du plan : le champ `plan` PocketBase est PRIORITAIRE ; l'hôte n'est
 *  Entreprise que par défaut, si aucun plan n'est défini (permet de tester). */
function planCode(user: unknown): string {
  const u = user as { plan?: string; email?: string } | null;
  if (u?.plan) return u.plan; // un plan défini en base gagne
  if (u?.email && u.email.toLowerCase() === HOST_EMAIL) return 'enterprise'; // défaut hôte
  return 'free';
}

/** Libellé lisible du plan du user PB. */
function planLabel(user: unknown): string {
  return PLAN_LABELS[planCode(user)] ?? PLAN_LABELS.free!;
}

/**
 * Section de gestion d'abonnement réutilisable : badge du plan courant (coloré),
 * boutons de changement d'abonnement (Stripe Checkout) et accès au Portail client
 * Stripe (« Gérer mon abonnement »). Lit le user via le store d'auth.
 */
export function SubscriptionSection() {
  const user = useAuthStore((s) => s.user);

  // Abonnement Stripe : plan en cours de redirection + erreur éventuelle.
  const [checkoutPlan, setCheckoutPlan] = useState<PaidPlan | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  // Portail client Stripe : redirection en cours + erreur éventuelle.
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const currentPlan = planCode(user);
  const badgeStyle = PLAN_STYLE[currentPlan] ?? PLAN_STYLE.free!;

  // Lance une session Stripe Checkout pour le plan choisi puis redirige.
  const startCheckout = async (plan: PaidPlan) => {
    setCheckoutError(null);
    setCheckoutPlan(plan);
    try {
      const res = await fetch(`${API_BASE}/api/stripe/create-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(pb.authStore.token ? { Authorization: `Bearer ${pb.authStore.token}` } : {}),
        },
        body: JSON.stringify({ plan, token: pb.authStore.token }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error('no url');
      // Redirection vers Stripe Checkout.
      window.location.href = data.url;
    } catch {
      setCheckoutError('Paiement indisponible pour le moment.');
      setCheckoutPlan(null);
    }
  };

  // Ouvre le Portail client Stripe (gérer/annuler son abonnement) puis redirige.
  const openPortal = async () => {
    setPortalError(null);
    setPortalLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/stripe/create-portal-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(pb.authStore.token ? { Authorization: `Bearer ${pb.authStore.token}` } : {}),
        },
        body: JSON.stringify({ token: pb.authStore.token }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error('no url');
      // Redirection vers le Portail client Stripe.
      window.location.href = data.url;
    } catch {
      setPortalError('Gestion indisponible pour le moment.');
      setPortalLoading(false);
    }
  };

  return (
    <div className="rounded-lg bg-slate-900/40 p-3 ring-1 ring-slate-700">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${badgeStyle.wrap}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${badgeStyle.dot}`} aria-hidden />
        Abonnement : {planLabel(user)}
      </span>

      <div className="mt-3">
        <p className="mb-2 text-xs font-medium text-slate-400">Changer d'abonnement</p>
        <div className="grid grid-cols-3 gap-2">
          {PAID_PLANS.map(({ id, label, price }) => {
            const isCurrent = currentPlan === id;
            const isRedirecting = checkoutPlan === id;
            const busy = checkoutPlan !== null;
            return (
              <button
                key={id}
                type="button"
                disabled={isCurrent || busy}
                onClick={() => startCheckout(id)}
                className="flex flex-col items-center rounded-lg border border-slate-600 bg-slate-800 px-2 py-2 text-center text-xs font-medium text-slate-200 transition hover:border-indigo-400 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-600 disabled:hover:bg-slate-800"
              >
                {isRedirecting ? (
                  <span>Redirection…</span>
                ) : (
                  <>
                    <span>{label}</span>
                    <span className="text-slate-400">{price}</span>
                    {isCurrent ? (
                      <span className="mt-0.5 text-[10px] text-indigo-300">Plan actuel</span>
                    ) : null}
                  </>
                )}
              </button>
            );
          })}
        </div>
        {checkoutError ? (
          <p role="alert" className="mt-2 text-xs text-amber-300/90">
            {checkoutError}
          </p>
        ) : null}

        {currentPlan !== 'free' ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={openPortal}
              disabled={portalLoading}
              className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-indigo-400 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {portalLoading ? 'Redirection…' : 'Gérer mon abonnement'}
            </button>
            {portalError ? (
              <p role="alert" className="mt-2 text-xs text-amber-300/90">
                {portalError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
