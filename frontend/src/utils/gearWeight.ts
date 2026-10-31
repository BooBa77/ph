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
 * Вес вещи на плашке снаряжения в походе: «2400 гр.», «900 гр.».
 *
 * Формат продиктовал заказчик 29.10.2026 для заголовка палатки —
 * «{хозяин} {основная характеристика} {вес}гр.»: граммами, с сокращением.
 * `formatWeight` («2,4 кг») здесь не подходит: рядом с характеристикой
 * «3-х местная» дробные килограммы теряются.
 *
 * `null` — вес не знаем, и тогда его просто нет в подписи. Прочерк «—»
 * в заголовке плашки читался бы как ошибка, а не как «не взвесили».
 */
export function weightInGrams(grams: number | null): string | null {
  return grams === null ? null : `${grams} гр.`
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

/**
 * Вес из поля формы: пусто — `null`, мусор — `undefined`.
 *
 * Три состояния, а не два, потому что «не указал» и «указал неправильно» —
 * разные вещи: первое законно (вес необязателен), второе надо объяснить
 * словами, а не молча отправить `NaN`. `v-model` на `<input type="number">`
 * отдаёт число, а через `:value` — строку, поэтому на входе принимаем оба.
 *
 * Живёт здесь, а не в форме, потому что вес спрашивают два экрана:
 * личный каталог и «Указать вручную» в походе, — и правило у них одно.
 */
export function parseWeightGrams(value: string | number): number | null | undefined {
  const text = String(value).trim()
  if (text === '') return null

  const grams = Number(text)
  if (!Number.isInteger(grams) || grams <= 0) return undefined

  return grams
}
