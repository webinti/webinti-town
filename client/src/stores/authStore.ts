import { create } from 'zustand';
import { pb } from '../pocketbase';
import type { Appearance } from '../types';
import { DEFAULT_APPEARANCE } from '../types';

// Forme du record `users` PocketBase (champs utiles côté jeu).
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  appearance?: Appearance;
  [k: string]: unknown;
}

function currentUser(): AuthUser | null {
  return pb.authStore.isValid ? (pb.authStore.model as unknown as AuthUser) : null;
}

interface AuthState {
  user: AuthUser | null;
  ready: boolean; // true une fois le check d'auth initial terminé
  init: () => Promise<void>;
  loginPassword: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  loginGoogle: () => Promise<void>;
  logout: () => void;
  saveProfile: (name: string, appearance: Appearance) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: currentUser(),
  ready: false,

  init: async () => {
    // Garde le store React en phase avec le SDK (login/logout/refresh).
    pb.authStore.onChange(() => set({ user: currentUser() }));
    // Vérifie/rafraîchit le token persistant au démarrage.
    if (pb.authStore.isValid) {
      try {
        await pb.collection('users').authRefresh();
      } catch {
        pb.authStore.clear(); // token périmé/invalide
      }
    }
    set({ user: currentUser(), ready: true });
  },

  loginPassword: async (email, password) => {
    await pb.collection('users').authWithPassword(email, password);
  },

  signup: async (email, password, name) => {
    await pb.collection('users').create({
      email,
      password,
      passwordConfirm: password,
      name,
      appearance: DEFAULT_APPEARANCE,
    });
    await pb.collection('users').authWithPassword(email, password);
  },

  loginGoogle: async () => {
    // Ouvre le flux OAuth2 Google (popup). Nécessite Google activé dans
    // PocketBase (users → Options → OAuth2). Voir étape B.
    await pb.collection('users').authWithOAuth2({ provider: 'google' });
  },

  logout: () => {
    pb.authStore.clear();
  },

  saveProfile: async (name, appearance) => {
    const id = pb.authStore.model?.id;
    if (!id) return;
    await pb.collection('users').update(id, { name, appearance });
  },
}));
