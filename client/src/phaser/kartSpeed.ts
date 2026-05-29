import { KART_SPEED_BASE, KART_SPEED_BOOST } from '../karts';

export const WALK_SPEED = 160;

export interface KartSpeedInput {
  onKart: boolean;
  boosting: boolean;
}

export function computeKartSpeed({ onKart, boosting }: KartSpeedInput): number {
  if (!onKart) return WALK_SPEED;
  return boosting ? KART_SPEED_BOOST : KART_SPEED_BASE;
}
