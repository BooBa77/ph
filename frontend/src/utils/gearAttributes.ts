import type { GearItem, GearItemAttribute } from '@/types/gear'
import type { GearTypeAttribute } from '@/types/gearTypes'

/**
 * Характеристики вещи на экране личного каталога.
 *
 * Три задачи, и все три — про одно место: форма спрашивает значения
 * по типу вещи, правка отдаёт их картой «код → значение», а строка списка
 * показывает уже сохранённое словами. Разнеси эти правила по компоненту
 * и они разойдутся: подпись «3 мест» осталась бы, а отправка числа — нет.
 *
 * **Черновик формы — плоская карта строк.** Поле ввода всегда отдаёт строку
 * (даже `type="number"`), галочка — `boolean`, поэтому значение хранится
 * как `string | boolean`, а число появляется только при отправке. Так
 * «2,5» из формы не превращается в `NaN` на середине набора, а пустое поле
 * остаётся отличимым от нуля.
 */
export type GearAttributeDrafts = Record<string, string | boolean>

/** Значения, которые уходят в API: `null` — стереть («не знаю»). */
export type GearAttributePayload = Record<string, number | string | boolean | null>

/** Итог сборки: карта значений и первая ошибка формы. */
export interface GearAttributesResult {
  attributes: GearAttributePayload
  error: string | null
}

/** Перевести сохранённое значение в черновик формы. */
export function gearAttributeDrafts(
  saved: readonly GearItemAttribute[],
): GearAttributeDrafts {
  const drafts: GearAttributeDrafts = {}

  for (const attribute of saved) {
    drafts[attribute.code] =
      attribute.valueKind === 'bool' ? attribute.value === true : String(attribute.value ?? '')
  }

  return drafts
}

/**
 * Пустая ли строка черновика.
 *
 * Отдельной функцией, потому что «пусто» проверяют три места: сборка
 * значений, блокировка кнопки и подпись необязательного поля.
 */
export function isBlankDraft(value: string | boolean | undefined): boolean {
  if (typeof value === 'boolean') return false

  return (value ?? '').trim().length === 0
}

/**
 * Карта значений для `POST`/`PATCH /api/gear`.
 *
 * **Ключи идут все, пустые — `null`.** Пропустить пустое нельзя: `PATCH`
 * без ключа значение не трогает, и стёртое поле вернулось бы прежним
 * после перезагрузки. `null` для бэкенда — «стереть», поэтому очистка
 * работает, а незаполненное просто не попадает в базу.
 *
 * **Галочка — всегда `true` или `false`.** У неё нет третьего состояния:
 * снятая галочка — это «нет», а не «не ответил». Поэтому обязательная
 * галочка никогда не блокирует отправку.
 *
 * Обязательные проверяются здесь же и тем же текстом, что и на сервере:
 * человек не должен узнавать про пустое поле из ответа 400, уже потеряв
 * заполненное.
 */
export function buildGearAttributes(
  attributes: readonly GearTypeAttribute[],
  drafts: GearAttributeDrafts,
): GearAttributesResult {
  const values: GearAttributePayload = {}
  const missing: string[] = []

  for (const attribute of attributes) {
    const raw = drafts[attribute.code]

    if (attribute.valueKind === 'bool') {
      values[attribute.code] = raw === true
      continue
    }

    const text = typeof raw === 'boolean' ? '' : (raw ?? '').trim()

    if (text.length === 0) {
      values[attribute.code] = null
      if (attribute.isRequired) missing.push(`«${attribute.name}»`)
      continue
    }

    if (attribute.valueKind === 'number') {
      // Запятая — не прихоть: заказчик так и писал вес и размеры.
      const grams = Number(text.replace(',', '.'))

      if (!Number.isFinite(grams)) {
        return {
          attributes: values,
          error: `«${attribute.name}» — число: «${text}» не разобрано.`,
        }
      }

      values[attribute.code] = grams
      continue
    }

    // text и select: у списка значением служит имя варианта.
    values[attribute.code] = text
  }

  if (missing.length > 0) {
    return {
      attributes: values,
      error: `Заполните обязательные характеристики: ${missing.join(', ')}`,
    }
  }

  return { attributes: values, error: null }
}

/** Значение словами: «3 мест», «MSR», «да», «160 г». */
export function gearAttributeValueWords(attribute: GearItemAttribute): string {
  if (attribute.valueKind === 'bool') return attribute.value === true ? 'да' : 'нет'

  const text = String(attribute.value ?? '').trim()
  if (text.length === 0) return ''

  return attribute.unit ? `${text} ${attribute.unit}` : text
}

/**
 * Строка подсказки под предметом: «Вместимость: 3 мест · Модель: MSR».
 *
 * Пустых значений в подписи нет: «Модель: » читалось бы как сломанный экран.
 * Если не заполнено ничего, возвращается пустая строка — что сказать вместо
 * неё, решает шаблон (у него есть кнопка «Характеристики»).
 */
export function gearAttributesSummary(item: GearItem): string {
  return item.attributes
    .map((attribute) => ({ name: attribute.name, words: gearAttributeValueWords(attribute) }))
    .filter((row) => row.words.length > 0)
    .map((row) => `${row.name}: ${row.words}`)
    .join(' · ')
}
