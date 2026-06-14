import { useGameStore } from '../stores/gameStore';

/** L'élément est-il un champ de saisie (input/textarea/select/contenteditable) ? */
export function isEditableElement(el: Element | EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * L'utilisateur est-il en train de taper dans un champ ?
 * On se base sur le focus DOM réel (document.activeElement) — fiable, contrairement
 * au flag de store qui peut être faux si le champ n'a jamais reçu le focus.
 */
export function isTypingInField(): boolean {
  return isEditableElement(document.activeElement) || useGameStore.getState().inputFocused;
}

/**
 * Faut-il ignorer les raccourcis clavier d'ACTION du jeu (confettis, debug,
 * emotes, interaction, danse…) ? Vrai si on tape dans un champ OU si le chat
 * est ouvert/visible (l'utilisateur s'attend à ce que les touches ne déclenchent
 * pas d'action quand le chat est affiché, même si le focus est sur le canvas).
 */
export function gameShortcutsBlocked(): boolean {
  return isTypingInField() || useGameStore.getState().chatPanelOpen;
}
