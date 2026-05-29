import { describe, it, expect } from 'vitest';
import { computeKartSpeed } from './kartSpeed';

describe('computeKartSpeed', () => {
  it('vitesse piéton si pas en kart', () => {
    expect(computeKartSpeed({ onKart: false, boosting: false })).toBe(160);
    expect(computeKartSpeed({ onKart: false, boosting: true })).toBe(160);
  });

  it('vitesse base en kart sans boost', () => {
    expect(computeKartSpeed({ onKart: true, boosting: false })).toBe(320);
  });

  it('vitesse boost en kart avec boost', () => {
    expect(computeKartSpeed({ onKart: true, boosting: true })).toBe(480);
  });
});
