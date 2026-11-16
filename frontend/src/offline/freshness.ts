/**
 * Сверка офлайн-копии с сервером по отметке свежести.
 *
 * Клиент помнит, какой была отметка в момент сохранения, и сравнивает
 * с серверной: разошлись — копия устарела, её надо перечитать.
 *
 * **Почему счётчик, а не время.** Две правки в одну миллисекунду время
 * не различит, а `contentRevision` различит всегда. Время хранится рядом
 * только для подписи человеку («данные на 14:32»), решений по нему
 * не принимается.
 *
 * **Чаты — отдельно.** Одно сообщение в чате не должно заставлять
 * перечитывать все вкладки, поэтому у каждого чата свой курсор
 * (`lastMessageId`), и сверка идёт по паре «счётчик похода + все курсоры».
 */

import {
  deleteOfflineState,
  freshnessStateKey,
  readOfflineState,
  writeOfflineState,
} from '@/offline/cache'
import type { TripCacheState } from '@/types/trips'

/** Что клиент запомнил о сохранённой копии. */
export interface CachedFreshness {
  contentRevision: string
  contentUpdatedAt: string
  /** Вид чата → id последнего сообщения. */
  chats: Record<string, string | null>
  /** Когда сверяли (мс) — для подписи «проверено …». */
  checkedAt: number
}

/** Ключ отметки в хранилище состояния. */
export function freshnessKey(tripId: string): string {
  return freshnessStateKey(tripId)
}

function toChatMap(state: TripCacheState): Record<string, string | null> {
  const map: Record<string, string | null> = {}
  for (const chat of state.chats) map[chat.kind] = chat.lastMessageId
  return map
}

/** Отметка сервера в том виде, в каком она лежит на устройстве. */
export function toCachedFreshness(
  state: TripCacheState,
  checkedAt: number = Date.now(),
): CachedFreshness {
  return {
    contentRevision: state.contentRevision,
    contentUpdatedAt: state.contentUpdatedAt,
    chats: toChatMap(state),
    checkedAt,
  }
}

export async function readCachedFreshness(tripId: string): Promise<CachedFreshness | null> {
  const value = await readOfflineState<CachedFreshness>(freshnessKey(tripId))
  if (!value || typeof value !== 'object') return null
  if (typeof value.contentRevision !== 'string') return null
  return value
}

export async function writeCachedFreshness(
  tripId: string,
  state: TripCacheState,
): Promise<CachedFreshness> {
  const cached = toCachedFreshness(state)
  await writeOfflineState(freshnessKey(tripId), cached)
  return cached
}

export async function clearCachedFreshness(tripId: string): Promise<void> {
  await deleteOfflineState(freshnessKey(tripId))
}

/**
 * Копия соответствует серверу.
 *
 * Сравниваются счётчик и **все** курсоры чатов. Набор чатов тоже важен:
 * новый чат у похода — это новые данные, даже если старый счётчик совпал
 * (чат создаётся при правке похода, но полагаться на это не будем).
 */
export function isFreshnessEqual(
  cached: CachedFreshness,
  state: TripCacheState,
): boolean {
  if (cached.contentRevision !== state.contentRevision) return false

  const chats = toChatMap(state)
  const cachedKinds = Object.keys(cached.chats)
  const serverKinds = Object.keys(chats)
  if (cachedKinds.length !== serverKinds.length) return false

  return serverKinds.every((kind) => cached.chats[kind] === chats[kind])
}

/**
 * Какие чаты изменились с момента сохранения.
 *
 * Возвращает виды чатов, где курсор сдвинулся или чат появился. Пустой
 * список — «чаты не менялись»: тогда при устаревшем счётчике перечитываются
 * вкладки, а чаты можно не трогать.
 */
export function changedChats(
  cached: CachedFreshness,
  state: TripCacheState,
): string[] {
  const chats = toChatMap(state)
  return Object.keys(chats).filter((kind) => cached.chats[kind] !== chats[kind])
}
