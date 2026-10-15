import { describe, expect, it } from 'vitest';

import { extractObjectIds } from './route-links';

/**
 * Разбор ссылок `[[object:N]]` — единственное место, где текст маршрута
 * превращается в связи с справочником. Ошибка здесь тихая: лишняя связь
 * или потерянная не ломают ни одного запроса, просто поиск «где упомянут
 * объект» начинает врать.
 */
describe('extractObjectIds', () => {
  it('пустой текст — пустой список', () => {
    expect(extractObjectIds('')).toEqual([]);
  });

  it('текст без ссылок — пустой список', () => {
    expect(extractObjectIds('Идём по тропе, ночуем у реки')).toEqual([]);
  });

  it('одна ссылка', () => {
    expect(extractObjectIds('Заброска на [[object:42]]')).toEqual([42]);
  });

  it('несколько разных ссылок — в порядке появления', () => {
    expect(extractObjectIds('[[object:7]] потом [[object:3]]')).toEqual([7, 3]);
  });

  it('повторы схлопываются: «туда и обратно» — одна связь', () => {
    expect(
      extractObjectIds('Перевал [[object:5]], обратно через [[object:5]]'),
    ).toEqual([5]);
  });

  it('нечисловой id остаётся текстом, а не превращается в NaN', () => {
    expect(extractObjectIds('Ссылка [[object:abc]] не считается')).toEqual([]);
  });

  it('пустой id игнорируется', () => {
    expect(extractObjectIds('[[object:]]')).toEqual([]);
  });

  it('похожий, но другой синтаксис не срабатывает', () => {
    // Будущие ссылки на походы и просто квадратные скобки.
    expect(extractObjectIds('[[trip:42]] [object:42] [[object:42 ]]')).toEqual(
      [],
    );
  });

  it('id длиннее безопасного целого отбрасывается', () => {
    expect(extractObjectIds('[[object:99999999999999999999]]')).toEqual([]);
  });

  it('ссылка внутри markdown-разметки находится', () => {
    expect(extractObjectIds('**Живая** ссылка: [[object:1]] и `код`')).toEqual([
      1,
    ]);
  });
});
