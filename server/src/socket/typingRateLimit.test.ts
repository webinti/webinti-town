import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Réimplémentation locale de la fonction rateLimit de handlers.ts
 * pour tester la logique d'isolation sans importer le module complet
 * (qui a des side effects Socket.IO au niveau module).
 *
 * La logique est identique à celle de handlers.ts :
 *   - fenêtre glissante de `windowMs` ms (défaut 1000)
 *   - si stamps.length >= limit après purge → drop (return false)
 *   - sinon push + return true
 */
function rateLimit(stamps: number[], limit: number, windowMs = 1000): boolean {
  const now = Date.now();
  while (stamps.length > 0 && now - stamps[0]! > windowMs) stamps.shift();
  if (stamps.length >= limit) return false;
  stamps.push(now);
  return true;
}

describe('typing_start rate-limit — 5/sec/socket', () => {
  let stamps: number[];

  beforeEach(() => {
    stamps = [];
    vi.useFakeTimers();
  });

  it('accepts the first 5 calls within 1 s', () => {
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(stamps, 5)).toBe(true);
    }
    expect(stamps).toHaveLength(5);
  });

  it('drops the 6th call within the same second', () => {
    for (let i = 0; i < 5; i++) rateLimit(stamps, 5);
    expect(rateLimit(stamps, 5)).toBe(false);
  });

  it('accepts again after the 1 s window rolls over', () => {
    for (let i = 0; i < 5; i++) rateLimit(stamps, 5);
    // Advance time past the window so all 5 old stamps expire.
    vi.advanceTimersByTime(1001);
    expect(rateLimit(stamps, 5)).toBe(true);
  });

  it('sliding window: accepts after partial expiry', () => {
    // Call twice at t=0
    rateLimit(stamps, 5);
    rateLimit(stamps, 5);
    // Advance 600 ms — those 2 stamps are now 600 ms old, still < 1000 ms.
    vi.advanceTimersByTime(600);
    // Call 3 more times (total 5 accepted).
    rateLimit(stamps, 5);
    rateLimit(stamps, 5);
    rateLimit(stamps, 5);
    // 6th call: stamps.length === 5 → drop.
    expect(rateLimit(stamps, 5)).toBe(false);
    // Advance another 401 ms: the first 2 stamps (t=0) expire (> 1000 ms).
    // stamps now has 3 entries.
    vi.advanceTimersByTime(401);
    expect(rateLimit(stamps, 5)).toBe(true);
    expect(rateLimit(stamps, 5)).toBe(true);
  });

  it('exactly at the window boundary: stamp is still alive', () => {
    rateLimit(stamps, 5);
    // At exactly 1000 ms, the stamp is NOT yet expired (condition: now - t > windowMs).
    vi.advanceTimersByTime(1000);
    // stamps[0] was pushed at t=0, now = 1000, diff = 1000, NOT > 1000 → not purged.
    expect(stamps).toHaveLength(1);
    // At 1001 ms it expires.
    vi.advanceTimersByTime(1);
    rateLimit(stamps, 5); // triggers purge
    expect(stamps).toHaveLength(1); // the new call, old one purged
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
