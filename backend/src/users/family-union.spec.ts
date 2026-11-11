import { describe, expect, it } from 'vitest';

import { crossPairs, familyPair, sameMembers } from './family-union';

/**
 * Юнит-тесты правил объединения семей (11.11.2026).
 *
 * Здесь то, что нельзя проверить «на глаз» в e2e: состав полного графа,
 * отсутствие повторов пар и сравнение состава заявки. Ошибка в любом из
 * трёх мест тихая — заявка просто станет «согласием» не того состава или
 * создаст две строки об одном родстве, и увидеть это в интерфейсе
 * невозможно.
 */
describe('родные: правила объединения семей', () => {
  describe('familyPair', () => {
    it('ставит меньший uuid первым', () => {
      expect(familyPair('b2', 'a1')).toEqual(['a1', 'b2']);
    });

    it('не меняет уже упорядоченную пару', () => {
      expect(familyPair('a1', 'b2')).toEqual(['a1', 'b2']);
    });

    it('приводит регистр: uuid из запроса может прийти в верхнем', () => {
      expect(familyPair('B2', 'A1')).toEqual(['a1', 'b2']);
    });
  });

  describe('crossPairs', () => {
    it('на двух людях даёт одну пару', () => {
      expect(crossPairs(['u2', 'u1'])).toEqual([['u1', 'u2']]);
    });

    it('на трёх людях даёт полный граф из трёх пар', () => {
      const pairs = crossPairs(['u1', 'u2', 'u3']);

      expect(pairs).toHaveLength(3);
      expect(pairs).toEqual([
        ['u1', 'u2'],
        ['u1', 'u3'],
        ['u2', 'u3'],
      ]);
    });

    it('не повторяет пары, если человека передали дважды', () => {
      const pairs = crossPairs(['u1', 'u2', 'u1']);

      expect(pairs).toEqual([['u1', 'u2']]);
    });

    it('на одном человеке пар нет — родства с собой не бывает', () => {
      expect(crossPairs(['u1'])).toEqual([]);
      expect(crossPairs([])).toEqual([]);
    });
  });

  describe('sameMembers', () => {
    it('одинаковый состав в разном порядке — та же заявка', () => {
      expect(sameMembers(['u1', 'u2', 'u3'], ['u3', 'u1', 'u2'])).toBe(true);
    });

    it('регистр значения не имеет', () => {
      expect(sameMembers(['A1', 'b2'], ['a1', 'B2'])).toBe(true);
    });

    it('другой состав — другая заявка', () => {
      expect(sameMembers(['u1', 'u2'], ['u1', 'u3'])).toBe(false);
    });

    it('лишний человек в заявке — другой состав', () => {
      expect(sameMembers(['u1', 'u2'], ['u1', 'u2', 'u3'])).toBe(false);
    });

    it('повтор в списке не делает состав другим', () => {
      expect(sameMembers(['u1', 'u2', 'u2'], ['u2', 'u1'])).toBe(true);
    });
  });
});
