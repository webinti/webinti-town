import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';

type Mode = 'login' | 'signup';

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loginPassword = useAuthStore((s) => s.loginPassword);
  const signup = useAuthStore((s) => s.signup);
  const loginGoogle = useAuthStore((s) => s.loginGoogle);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signup') {
        const pseudo = name.trim().slice(0, 20);
        if (!pseudo) throw new Error('Choisis un pseudo.');
        if (password.length < 8) throw new Error('Mot de passe : 8 caractères minimum.');
        await signup(email.trim(), password, pseudo);
      } else {
        await loginPassword(email.trim(), password);
      }
      // La réussite déclenche le changement d'auth → App affiche la suite.
    } catch (err) {
      setError(messageFor(err, mode));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setError(null);
    setBusy(true);
    try {
      await loginGoogle();
    } catch (err) {
      setError(messageFor(err, mode));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-slate-100">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl bg-slate-800/80 p-8 shadow-2xl ring-1 ring-white/10 backdrop-blur"
      >
        <h1 className="mb-1 text-3xl font-bold tracking-tight">Webinti Town</h1>
        <p className="mb-6 text-sm text-slate-400">
          {mode === 'login' ? 'Connecte-toi pour entrer.' : 'Crée ton compte.'}
        </p>

        <button
          type="button"
          onClick={google}
          disabled={busy}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 font-medium text-slate-800 transition hover:bg-slate-100 disabled:opacity-50"
        >
          <svg className="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continuer avec Google
        </button>

        <div className="mb-4 flex items-center gap-3 text-xs text-slate-500">
          <span className="h-px flex-1 bg-slate-700" /> ou <span className="h-px flex-1 bg-slate-700" />
        </div>

        {mode === 'signup' && (
          <input
            type="text"
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pseudo"
            className="mb-3 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 outline-none focus:border-indigo-400"
          />
        )}
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="mb-3 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 outline-none focus:border-indigo-400"
        />
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mot de passe"
          className="mb-4 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 outline-none focus:border-indigo-400"
        />

        {error && <p className="mb-3 text-sm text-rose-400">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-indigo-500 px-4 py-2.5 font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-50"
        >
          {busy ? '...' : mode === 'login' ? 'Se connecter' : "S'inscrire"}
        </button>

        <p className="mt-4 text-center text-sm text-slate-400">
          {mode === 'login' ? 'Pas de compte ?' : 'Déjà un compte ?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setError(null);
            }}
            className="font-medium text-indigo-400 hover:underline"
          >
            {mode === 'login' ? "S'inscrire" : 'Se connecter'}
          </button>
        </p>
      </form>
    </div>
  );
}

function messageFor(err: unknown, mode: Mode): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Erreurs PocketBase courantes → messages FR clairs.
  if (/Failed to authenticate/i.test(msg)) return 'Email ou mot de passe incorrect.';
  if (/already in use|validation_not_unique|email.*exists/i.test(msg)) return 'Cet email a déjà un compte.';
  if (/oauth2|provider/i.test(msg)) return "La connexion Google n'est pas encore activée côté serveur.";
  if (mode === 'signup' && /password/i.test(msg)) return 'Mot de passe trop court (8 caractères min).';
  return msg || 'Une erreur est survenue.';
}
