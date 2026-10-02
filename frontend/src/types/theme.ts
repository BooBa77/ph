/**
 * Сезонные темы оформления PeakHunter.
 *
 * Четыре сезона, привязаны к календарю Прибайкалья:
 *   1 — зима   (8 ноября — 7 марта)
 *   2 — весна  (8 марта — 24 мая)
 *   3 — лето   (25 мая — 31 августа)
 *   4 — осень  (1 сентября — 7 ноября)
 *
 * Числа, а не строки — потому что:
 *   - валидация сводится к «число от 1 до 4»;
 *   - тот же номер используется в CSS ([data-theme="1"], ...);
 *   - нет маппинга «'winter' → 1» в двух местах.
 *
 * Список SEASONS — единственный источник правды. Если добавляешь
 * сезон, правишь только здесь (плюс [data-theme="X"] в themes.css).
 */

export const SEASONS = [1, 2, 3, 4] as const

export type Season = (typeof SEASONS)[number]

/**
 * Проверка, что значение — валидный сезон.
 *
 * Используется при:
 *   - чтении из localStorage (там строка, Number() → число или NaN);
 *   - получении значения из Vue DevTools (юзер мог вписать что угодно);
 *   - любом внешнем входе, где тип unknown.
 */
export function isValidSeason(value: unknown): value is Season {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    (SEASONS as readonly number[]).includes(value)
  )
}