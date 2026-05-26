/**
 * Returns a French relative time label for a past timestamp.
 * Default `now` is `Date.now()`. Both args are ms epoch.
 */
export function relativeTimeFr(timestamp: number, now: number = Date.now()): string {
  const deltaSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (deltaSec < 60) return "à l'instant";
  if (deltaSec < 3600) return `il y a ${Math.floor(deltaSec / 60)}min`;
  if (deltaSec < 86400) return `il y a ${Math.floor(deltaSec / 3600)}h`;
  if (deltaSec < 7 * 86400) return `il y a ${Math.floor(deltaSec / 86400)}j`;
  return new Date(timestamp).toISOString().slice(0, 10);
}
