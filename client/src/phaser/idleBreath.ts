// Respiration idle procédurale (aucun asset). Renvoie un facteur scaleY à
// appliquer aux couches de l'avatar quand le perso est immobile.
const DELAY_MS = 400; // temps d'immobilité avant de commencer à respirer
const PERIOD_MS = 1400; // durée d'un cycle inspiration/expiration
const AMPLITUDE = 0.03; // +3% en pic

export function breathScaleY(idleMs: number): number {
  if (idleMs < DELAY_MS) return 1;
  const t = idleMs - DELAY_MS;
  const phase = (2 * Math.PI * t) / PERIOD_MS;
  return 1 + AMPLITUDE * (0.5 - 0.5 * Math.cos(phase));
}
