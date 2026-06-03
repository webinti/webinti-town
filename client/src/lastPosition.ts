// Mémorise la dernière position du joueur PAR SALLE (localStorage), pour
// réapparaître au même endroit après un refresh plutôt qu'à l'entrée.
// Volontairement en localStorage (haute fréquence, éphémère) et non en BDD.

const KEY = (slug: string) => `webinti-town:pos:${slug}`;

export function saveLastPosition(slug: string, x: number, y: number): void {
  if (!slug || !Number.isFinite(x) || !Number.isFinite(y)) return;
  try {
    localStorage.setItem(KEY(slug), JSON.stringify({ x: Math.round(x), y: Math.round(y) }));
  } catch {
    /* quota / mode privé : on ignore */
  }
}

export function readLastPosition(slug: string): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(KEY(slug));
    if (!raw) return null;
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      return { x: p.x, y: p.y };
    }
  } catch {
    /* ignore */
  }
  return null;
}
