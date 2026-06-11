// Entrées tactiles (mobile / tablette) lues DIRECTEMENT par le GameScene et le
// Player, sans passer par le store React — on veut zéro re-render à 60 fps.
// Le joystick virtuel écrit dx/dy (normalisés dans [-1, 1]). Le bouton d'action
// pousse une demande d'interaction « one-shot » consommée par le GameScene.

export const touchInput = {
  /** Axe horizontal du joystick, -1 (gauche) → +1 (droite). */
  dx: 0,
  /** Axe vertical du joystick, -1 (haut) → +1 (bas). */
  dy: 0,
  /** true tant que le joueur tient le joystick hors zone morte. */
  active: false,
  /** Demande d'interaction tactile en attente (interne — voir consume). */
  _interact: false,
};

export function setTouchMove(dx: number, dy: number): void {
  touchInput.dx = dx;
  touchInput.dy = dy;
  touchInput.active = dx !== 0 || dy !== 0;
}

export function clearTouchMove(): void {
  touchInput.dx = 0;
  touchInput.dy = 0;
  touchInput.active = false;
}

/** Le bouton d'action tactile signale une interaction (monter/objet/etc.). */
export function requestTouchInteract(): void {
  touchInput._interact = true;
}

/** Renvoie true une seule fois après une demande d'interaction tactile. */
export function consumeTouchInteract(): boolean {
  if (touchInput._interact) {
    touchInput._interact = false;
    return true;
  }
  return false;
}
