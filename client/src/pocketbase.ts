import PocketBase from 'pocketbase';

// Instance PocketBase partagée.
// - En prod : nginx proxifie `/pb/` → 127.0.0.1:8090, donc l'URL relative `/pb`
//   suffit (le SDK appelle `/pb/api/...`).
// - En local : définir `VITE_POCKETBASE_URL` (ex. `https://live.webinti.com/pb`
//   pour taper la prod, ou `http://127.0.0.1:8090` si PocketBase tourne en local).
const PB_URL = (import.meta.env.VITE_POCKETBASE_URL as string | undefined) || '/pb';

export const pb = new PocketBase(PB_URL);

// Désactive l'auto-annulation des requêtes "dupliquées" du SDK : sinon deux
// appels rapprochés (ex. authRefresh + update) se annulent mutuellement
// (AbortError). On gère les erreurs nous-mêmes.
pb.autoCancellation(false);
