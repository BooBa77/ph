/**
 * Фактический вес «Моих продуктов» — контрольное взвешивание личной еды.
 *
 * Это **отметка для себя, а не данные похода**: сервер про неё не знает,
 * и второй человек её не увидит (`meals.md` §5.7). Пока живёт в браузере —
 * когда личная еда поедет в «Снаряжение» одной позицией со своим весом,
 * переедет в базу вместе с рюкзаком. Ключ общий на два экрана, поэтому
 * «Питание» и «Мой рюкзак» не могут разойтись в одной цифре.
 *
 * Ключ — на поход и человека: в другом походе та же еда весит иначе,
 * а у второго участника своя отметка.
 */

const KEY_PREFIX = 'ph.myFoodWeight'

export function myFoodWeightKey(tripId: string, userId: string): string {
  return `${KEY_PREFIX}.${tripId}.${userId}`
}

/**
 * Вес из хранилища. `null` — не взвешивали (или хранилище недоступно,
 * или там мусор: приватный режим и квота не должны ломать экран).
 */
export function readMyFoodWeight(tripId: string, userId: string): number | null {
  try {
    const raw = window.localStorage.getItem(myFoodWeightKey(tripId, userId))
    if (raw === null) return null

    const grams = Number(raw)

    return Number.isInteger(grams) && grams > 0 ? grams : null
  } catch {
    return null
  }
}

/** Запомнить вес; `null` — стереть отметку. */
export function writeMyFoodWeight(
  tripId: string,
  userId: string,
  grams: number | null,
): void {
  try {
    if (grams === null) {
      window.localStorage.removeItem(myFoodWeightKey(tripId, userId))
    } else {
      window.localStorage.setItem(myFoodWeightKey(tripId, userId), String(grams))
    }
  } catch {
    // Без хранилища отметка просто не переживёт перезагрузку.
  }
}
