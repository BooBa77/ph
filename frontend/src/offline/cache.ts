/**
 * Кеш ответов API для офлайна.
 *
 * **Что кешируем.** Только данные похода и словари, без которых вкладки
 * не отрисуются: `/trips/…`, список походов, типы похода, блюда, типы
 * снаряжения, объекты справочника. Профили людей, календарь и админка
 * в поле не нужны, а место в телефоне и приватность — нужны.
 *
 * **Как кешируем.** Один ответ — одна запись, ключ — путь с query-строкой.
 * Путь уникален для набора параметров, поэтому «мои походы» и «анонсы»
 * не затирают друг друга. У записи есть `tripId`: по нему удаляется всё,
 * что относилось к походу, переставшему быть текущим.
 *
 * **Права.** Копия отдаётся через `readOnlyCopy`: в офлайне править нечего,
 * и флаги `canEdit`/`canWrite` из старого ответа не должны рисовать кнопки.
 */

import {
  clearStore,
  deleteByIndex,
  deleteRecord,
  getAllRecords,
  getRecord,
  putRecord,
  RESPONSES_STORE,
  STATE_STORE,
} from '@/offline/indexedDb'
import { readOnlyCopy } from '@/offline/readOnly'

export interface CachedApiResponse {
  /** Путь запроса без `/api`, вместе с query-строкой. */
  path: string
  /** Поход, к которому относится ответ; `null` — словарь или список. */
  tripId: string | null
  /** Разобранное тело ответа. */
  body: unknown
  /** Когда ответ сохранён (мс, `Date.now()`). */
  savedAt: number
}

/** `/trips/679`, `/trips/679/meals` → `679`. */
const TRIP_PATH = /^\/trips\/(\d+)(?:\/|$)/

/**
 * Что вообще имеет смысл хранить. Список закрытый: новое место кешируется
 * осознанно, а не «потому что это GET».
 */
const CACHEABLE_PATHS: readonly RegExp[] = [
  /^\/trips$/,
  /^\/trips\?/,
  /^\/trips\/types$/,
  /^\/trips\/roles$/,
  /^\/trips\/\d+(?:\/|$)/,
  /^\/dishes$/,
  /^\/gear-types(?:\?|$)/,
  /^\/objects\?/,
]

/** Идентификатор похода из пути запроса. */
export function tripIdFromPath(path: string): string | null {
  const match = TRIP_PATH.exec(path)
  return match?.[1] ?? null
}

/** Нужно ли сохранять ответ на этот путь. */
export function isCacheablePath(path: string): boolean {
  return CACHEABLE_PATHS.some((pattern) => pattern.test(path))
}

/**
 * Походы, данные которых разрешено держать на устройстве.
 *
 * `null` — «список ещё неизвестен»: до первого чтения стора кешируем всё,
 * иначе самый первый заход на текущий поход ничего бы не сохранил.
 * Пустой набор — «текущих нет», и чужие походы на телефон не попадают.
 *
 * Список ведёт стор офлайна (`setCacheableTrips`): он единственный знает,
 * что идёт сейчас. Клиент спрашивает только «можно ли писать этот ответ».
 */
let cacheableTripIds: Set<string> | null = null

/** Обновить список походов, которые можно хранить. */
export function setCacheableTrips(ids: readonly string[] | null): void {
  cacheableTripIds = ids === null ? null : new Set(ids)
}

/** Разрешено ли хранить ответ этого похода. */
function isTripAllowed(tripId: string | null): boolean {
  if (tripId === null) return true
  if (cacheableTripIds === null) return true
  return cacheableTripIds.has(tripId)
}

/** Ключ отметки о прогреве похода. Живёт в том же хранилище состояния. */
export function prefetchStateKey(tripId: string): string {
  return `prefetch:${tripId}`
}

/**
 * Сохранить ответ. Ошибки хранилища не всплывают: без кеша приложение
 * работает, а упавший запрос из-за неудачной записи — нет.
 */
export async function writeCachedResponse(path: string, body: unknown): Promise<void> {
  const tripId = tripIdFromPath(path)

  // Чужой поход на устройстве не нужен: в офлайне он всё равно недоступен.
  if (!isTripAllowed(tripId)) return

  const entry: CachedApiResponse = {
    path,
    tripId,
    body,
    savedAt: Date.now(),
  }

  await putRecord(RESPONSES_STORE, entry)
}

/** Прочитать ответ из кеша. Возвращает копию с погашенными правами. */
export async function readCachedResponse(path: string): Promise<CachedApiResponse | null> {
  const entry = await getRecord<CachedApiResponse>(RESPONSES_STORE, path)
  if (!entry) return null

  return { ...entry, body: readOnlyCopy(entry.body) }
}

/** Все сохранённые ответы — для проверок и отладки. */
export async function listCachedResponses(): Promise<CachedApiResponse[]> {
  return getAllRecords<CachedApiResponse>(RESPONSES_STORE)
}

/** Удалить всё, что относилось к походу, вместе с отметкой прогрева. */
export async function clearTripCache(tripId: string): Promise<void> {
  await Promise.all([
    deleteByIndex(RESPONSES_STORE, 'tripId', tripId),
    // Без сброса отметки следующий прогрев решил бы, что кеш ещё тёплый,
    // и не сохранил бы вкладки заново. Так уже случалось 16.11.2026.
    deleteOfflineState(prefetchStateKey(tripId)),
  ])
}

/** Состояние офлайна: текущие походы, отметки о прогреве. */
export async function readOfflineState<T>(key: string): Promise<T | null> {
  const record = await getRecord<{ key: string; value: T }>(STATE_STORE, key)
  return record ? record.value : null
}

/** Записать состояние офлайна. */
export async function writeOfflineState(key: string, value: unknown): Promise<void> {
  await putRecord(STATE_STORE, { key, value })
}

/** Удалить значение состояния. */
export async function deleteOfflineState(key: string): Promise<void> {
  await deleteRecord(STATE_STORE, key)
}

/**
 * Полная очистка офлайн-данных: выход из аккаунта.
 *
 * Телефон может достаться другому человеку, и чужие походы в нём остаться
 * не должны. Вызывается из `auth.clear()` без ожидания — выход важнее кеша.
 */
export async function clearAllOfflineData(): Promise<void> {
  await Promise.all([clearStore(RESPONSES_STORE), clearStore(STATE_STORE)])
}
