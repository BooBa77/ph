import { reactive } from 'vue'

/**
 * Тревога «даты похода сдвинулись, а трансферы уже запланированы» (19.11.2026).
 *
 * Заказчик: «при смещении дат стоит оценить, есть ли уже трансферы… уведомление
 * организатору… а в Трансфере подкрасить алым трансферы: изменение старта,
 * возвращения — сразу да, потому что даже если старт стал раньше, а у нас уже
 * поезд запланирован, то красная тревога».
 *
 * Это именно **непроверенное состояние**, а не признак сломанных данных: сервер
 * сдвигает все рейсы вместе с началом похода (`TripsService.syncTransferLegDates`,
 * `transfer.md` §1.4), поэтому формально они снова в датах — а билеты покупались
 * на прежние числа, и договорённости о заброске тоже. По базе такую разницу
 * не увидеть: знание «рейсы ещё не перепроверяли» живёт только в памяти
 * устройства того, кто менял даты.
 *
 * Почему `localStorage`, а не колонка в базе: схема в этом шаге не меняется,
 * а тревога — подсказка организатору на его устройстве, а не данные похода.
 * Переживать перезагрузку ей обязательно: про билеты человек выяснит не сразу,
 * и предупреждение, исчезнувшее по F5, обманывало бы.
 */
const KEY_PREFIX = 'ph.transfer.dates-changed.'

/**
 * Уже прочитанные значения — ради реактивности: `computed` во вкладке обязан
 * пересчитаться, когда тревогу сняли кнопкой «Проверил».
 */
const armed = reactive(new Map<string, boolean>())

function storageKey(tripId: string): string {
  return `${KEY_PREFIX}${tripId}`
}

/** Хранилища может не быть (приватный режим) — тогда тревога просто не запомнится. */
function readStorage(tripId: string): boolean {
  try {
    return localStorage.getItem(storageKey(tripId)) !== null
  } catch {
    return false
  }
}

/** Тревога по походу поднята и ещё не снята. */
export function transferDatesAlert(tripId: string): boolean {
  const cached = armed.get(tripId)
  if (cached !== undefined) return cached

  const value = readStorage(tripId)
  armed.set(tripId, value)
  return value
}

/** Поднять тревогу: даты похода изменили, рейсы надо перепроверить. */
export function armTransferDatesAlert(tripId: string): void {
  try {
    localStorage.setItem(storageKey(tripId), String(Date.now()))
  } catch {
    // см. `readStorage`: без хранилища подсказка живёт только до перезагрузки.
  }

  armed.set(tripId, true)
}

/** Снять тревогу: рейсы посмотрели и подтвердили, что они всё ещё верны. */
export function clearTransferDatesAlert(tripId: string): void {
  try {
    localStorage.removeItem(storageKey(tripId))
  } catch {
    // см. `readStorage`.
  }

  armed.set(tripId, false)
}
