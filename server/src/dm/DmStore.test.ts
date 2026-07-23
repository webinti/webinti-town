import { describe, expect, it } from 'vitest';
import { DmStore, pairKey } from './DmStore.js';

describe('DmStore', () => {
  const makeStore = () => new DmStore({ roomSlug: 'test', persist: false });

  it('pairKey est canonique quel que soit le sens', () => {
    expect(pairKey('alice', 'bob')).toBe(pairKey('bob', 'alice'));
  });

  it('conserve un message long de 10 000 caractères sans le tronquer', () => {
    const store = makeStore();
    const text = 'a'.repeat(10000);
    const msg = store.append('alice', 'bob', text, null);
    expect(msg?.text).toHaveLength(10000);
  });

  it('tronque au-delà de 10 000 caractères (aligné sur MESSAGE_MAX_LEN)', () => {
    const store = makeStore();
    const msg = store.append('alice', 'bob', 'a'.repeat(10001), null);
    expect(msg?.text).toHaveLength(10000);
  });

  it('conserve les chevrons et le texte entre eux', () => {
    const store = makeStore();
    const text = 'si x < 10 et y > 2 alors <example>garde tout</example>';
    const msg = store.append('alice', 'bob', text, null);
    expect(msg?.text).toBe(text);
  });
});
