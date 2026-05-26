import { describe, it, expect } from 'vitest';
import { relativeTimeFr } from './kanbanRelativeTime';

describe('relativeTimeFr', () => {
  const NOW = new Date('2026-05-26T12:00:00Z').getTime();

  it('returns "à l\'instant" if < 60s', () => {
    expect(relativeTimeFr(NOW - 30_000, NOW)).toBe("à l'instant");
  });

  it('returns "il y a Xmin" if < 1h', () => {
    expect(relativeTimeFr(NOW - 5 * 60_000, NOW)).toBe('il y a 5min');
    expect(relativeTimeFr(NOW - 59 * 60_000, NOW)).toBe('il y a 59min');
  });

  it('returns "il y a Xh" if < 24h', () => {
    expect(relativeTimeFr(NOW - 2 * 3600_000, NOW)).toBe('il y a 2h');
  });

  it('returns "il y a Xj" if < 7d', () => {
    expect(relativeTimeFr(NOW - 3 * 86400_000, NOW)).toBe('il y a 3j');
  });

  it('returns ISO short date for >= 7d', () => {
    const t = NOW - 30 * 86400_000;
    expect(relativeTimeFr(t, NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
