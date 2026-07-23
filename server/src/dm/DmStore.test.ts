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

  describe('edit', () => {
    it("l'auteur peut modifier son message ; editedAt est posé", () => {
      const store = makeStore();
      const msg = store.append('alice', 'bob', 'avant', null)!;
      const edited = store.edit('alice', msg.id, 'après');
      expect(edited?.text).toBe('après');
      expect(edited?.editedAt).toBeGreaterThan(0);
      expect(store.getConversationsFor('bob')['alice']![0]!.text).toBe('après');
    });

    it("refusé si le demandeur n'est pas l'auteur", () => {
      const store = makeStore();
      const msg = store.append('alice', 'bob', 'avant', null)!;
      expect(store.edit('bob', msg.id, 'piraté')).toBeNull();
      expect(store.getConversationsFor('bob')['alice']![0]!.text).toBe('avant');
    });

    it('refusé si le texte devient vide sans pièce jointe', () => {
      const store = makeStore();
      const msg = store.append('alice', 'bob', 'avant', null)!;
      expect(store.edit('alice', msg.id, '   ')).toBeNull();
      expect(store.getConversationsFor('bob')['alice']![0]!.text).toBe('avant');
    });
  });

  describe('remove', () => {
    it("l'auteur peut supprimer son message", () => {
      const store = makeStore();
      const msg = store.append('alice', 'bob', 'à supprimer', null)!;
      const removed = store.remove('alice', msg.id);
      expect(removed?.id).toBe(msg.id);
      expect(store.getConversationsFor('bob')['alice']).toBeUndefined();
    });

    it("refusé si le demandeur n'est pas l'auteur", () => {
      const store = makeStore();
      const msg = store.append('alice', 'bob', 'reste là', null)!;
      expect(store.remove('bob', msg.id)).toBeNull();
      expect(store.getConversationsFor('bob')['alice']).toHaveLength(1);
    });
  });
});
