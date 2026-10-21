/**
 * Вес словами: «2,4 кг», «900 г», «—».
 *
 * Вынесено из компонента и покрыто тестом, потому что это то место, где
 * ошибка не бросается в глаза: `0.9` без округления превращается
 * в «0,8999999999 кг», а `600` в «0,6 кг» читается хуже, чем «600 г».
 *
 * Порог — килограмм. До него граммы точнее и привычнее (спальник «900 г»),
 * после — килограммы с одним-двумя знаками («2,4 кг»).
 */
export function formatWeight(grams: number | null): string {
  if (grams === null) return '—'
  if (grams < 1000) return `${grams} г`

  return `${(grams / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} кг`
}

/**
 * Итог по рюкзаку одной строкой.
 *
 * Второе число — сколько предметов не взвешено. Без него итог выглядел бы
 * точным, хотя половина списка в него не вошла.
 */
export function formatWeightTotal(totalGrams: number, itemsWithoutWeight: number): string {
  const base = `Всего: ${formatWeight(totalGrams)}`

  return itemsWithoutWeight > 0 ? `${base} · без веса: ${itemsWithoutWeight}` : base
}
