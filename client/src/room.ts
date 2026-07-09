// Room courante (?room=) + politique d'accès invité (sans compte).

const ROOM_SLUG_KEY = 'webinti-town:roomSlug';
const ROOM_SLUG_RE = /^[a-z0-9-]{1,50}$/;

// Slug de la room courante : ?room= (validé), sinon dernière room mémorisée,
// sinon 'demo'. Mémorisé dans localStorage pour les rechargements.
export function readRoomSlug(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('room');
    if (fromUrl && ROOM_SLUG_RE.test(fromUrl)) {
      localStorage.setItem(ROOM_SLUG_KEY, fromUrl);
      return fromUrl;
    }
    const stored = localStorage.getItem(ROOM_SLUG_KEY);
    if (stored && ROOM_SLUG_RE.test(stored)) return stored;
    return 'demo';
  } catch {
    return 'demo';
  }
}

// La room EXPLICITEMENT demandée dans l'URL (?room=), sans fallback localStorage
// ni défaut. Sert à décider de l'accès invité : seul un lien explicite ouvre le
// mode invité ; le site nu (sans ?room=) garde son mur de connexion.
export function explicitRoomFromUrl(): string | null {
  try {
    const v = new URLSearchParams(window.location.search).get('room');
    return v && ROOM_SLUG_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

// Room ouverte aux INVITÉS (sans compte) : uniquement la room 'demo', et
// seulement via un lien explicite ?room=demo. Toute autre room — et le site nu —
// exige un compte.
export function isGuestRoom(slug: string | null): boolean {
  return slug === 'demo';
}
