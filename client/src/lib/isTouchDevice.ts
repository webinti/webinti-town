// Détection « appareil principalement tactile » (téléphone / tablette).
// On se base sur le media query `pointer: coarse` (= le pointeur principal est
// imprécis → doigt), plus un repli sur maxTouchPoints. Un `?touch=1` dans l'URL
// force l'affichage des contrôles tactiles (pratique pour tester au bureau).

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('touch')) return params.get('touch') !== '0';
  } catch {
    /* ignore */
  }
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const hasTouch = (navigator?.maxTouchPoints ?? 0) > 0;
  const fine = window.matchMedia?.('(pointer: fine)').matches ?? false;
  return coarse || (hasTouch && !fine);
}
