import { syncTripDiary } from '@/api/diary'
import {
  deleteOfflineState,
  readOfflineState,
  writeCachedResponse,
  writeOfflineState,
} from '@/offline/cache'
import { getAllRecords, STATE_STORE } from '@/offline/indexedDb'
import type { DiarySyncEntry, TripDiaryEntry } from '@/types/diary'

/**
 * Очередь изменений дневника на устройстве (16.11.2026).
 *
 * Заказчик: «Дневник ведётся онлайн и оффлайн (синхронизация при возвращении
 * связи)». Писать в поле можно всё что угодно и без сети — запись ложится
 * сюда и уходит на сервер, когда связь появится.
 *
 * **Почему «состояние записи», а не список запросов.** Пока связи нет,
 * запись можно создать, дважды поправить и удалить. Хранить три запроса
 * и помнить их порядок — лишняя работа и лишний источник ошибок. Здесь
 * на каждую запись одна строка: её текущее состояние. Отправка пачки
 * идемпотентна, сервер решает спор по `updatedAt`.
 *
 * **Почему очередь в `state` IndexedDB, а не в новой базе.** Хранилище
 * `state` уже есть и переживает перезапуск PWA; версия базы при этом
 * не меняется — старая вкладка с открытой PWA не получит `onblocked`
 * и не потеряет кеш. Ключ — `diaryOutbox:<tripId>`.
 *
 * **Чего здесь намеренно нет.** Фоновой синхронизации (`Background Sync`):
 * её поддержка в браузерах неровная, а связь в поле возвращается
 * непредсказуемо. Отправку запускают события `online` и возвращение
 * на вкладку (см. `App.vue` и `TripDiary.vue`).
 */

/** Ключ очереди одного похода. */
export function diaryOutboxKey(tripId: string): string {
  return `diaryOutbox:${tripId}`
}

/** Сколько записей принимает сервер за один запрос (как `MAX_DIARY_SYNC_ENTRIES`). */
const SYNC_BATCH = 200

/** Состояние записи в очереди: всё, что нужно серверу. */
export type DiaryOutboxEntry = Required<DiarySyncEntry>

/**
 * Прочитать очередь похода.
 *
 * Мусор в хранилище (старая схема, ручная правка) отбрасывается: дневник
 * должен открываться, даже если в очереди что-то испортилось.
 */
export async function readDiaryOutbox(
  tripId: string,
): Promise<DiaryOutboxEntry[]> {
  const raw = await readOfflineState<unknown>(diaryOutboxKey(tripId))
  if (!Array.isArray(raw)) return []

  return raw.filter(isOutboxEntry)
}

/** Записать очередь; пустая очередь удаляет ключ, а не хранит пустой массив. */
export async function writeDiaryOutbox(
  tripId: string,
  entries: readonly DiaryOutboxEntry[],
): Promise<void> {
  if (entries.length === 0) {
    await deleteOfflineState(diaryOutboxKey(tripId))
    return
  }

  await writeOfflineState(diaryOutboxKey(tripId), entries)
}

/** Поставить изменение в очередь и вернуть очередь целиком. */
export async function queueDiaryChange(
  tripId: string,
  change: DiaryOutboxEntry,
): Promise<DiaryOutboxEntry[]> {
  const current = await readDiaryOutbox(tripId)
  const next = current.filter((entry) => entry.id !== change.id)
  next.push(change)
  await writeDiaryOutbox(tripId, next)

  return next
}

/** Убрать из очереди ровно те версии, которые уже принял сервер. */
export async function pruneDiaryOutbox(
  tripId: string,
  sent: readonly Pick<DiaryOutboxEntry, 'id' | 'updatedAt'>[],
): Promise<DiaryOutboxEntry[]> {
  const current = await readDiaryOutbox(tripId)
  const rest = current.filter(
    (entry) =>
      !sent.some(
        (version) =>
          version.id === entry.id && version.updatedAt === entry.updatedAt,
      ),
  )
  await writeDiaryOutbox(tripId, rest)

  return rest
}

/** Походы, у которых есть неотправленные записи. */
export async function diaryOutboxTripIds(): Promise<string[]> {
  const records = await getAllRecords<{ key?: unknown }>(STATE_STORE)

  const ids: string[] = []
  for (const record of records) {
    if (typeof record.key !== 'string') continue
    if (!record.key.startsWith('diaryOutbox:')) continue
    ids.push(record.key.slice('diaryOutbox:'.length))
  }

  return ids
}

/**
 * Свести серверные записи с неотправленными.
 *
 * Серверная версия главнее при равной отметке: если запись уже доехала,
 * локальная копия с тем же `updatedAt` ничего не добавляет. Удалённая
 * локально запись не показывается, даже если на сервере она ещё есть.
 */
export function mergeDiaryEntries(
  server: readonly TripDiaryEntry[],
  pending: readonly DiaryOutboxEntry[],
): TripDiaryEntry[] {
  const byId = new Map<string, TripDiaryEntry>()
  for (const entry of server) byId.set(entry.id, entry)

  for (const change of pending) {
    if (change.deletedAt) {
      byId.delete(change.id)
      continue
    }

    const current = byId.get(change.id)
    if (current && time(current.updatedAt) >= time(change.updatedAt)) continue

    byId.set(change.id, {
      id: change.id,
      body: change.body,
      createdAt: change.createdAt,
      updatedAt: change.updatedAt,
    })
  }

  return [...byId.values()].sort(
    (a, b) => time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id),
  )
}

/**
 * Отправить очередь одного похода.
 *
 * Пачка режется по лимиту сервера. После успеха в кеш ответа попадает
 * серверная правда: иначе следующий офлайн-запуск показал бы старую
 * копию GET и «неотправленные» записи, которых уже нет.
 *
 * `null` — очередь пуста, ходить на сервер незачем.
 */
export async function pushDiaryOutbox(tripId: string): Promise<{
  entries: TripDiaryEntry[]
  pending: DiaryOutboxEntry[]
} | null> {
  // Снимок очереди на момент вызова: правки, сделанные во время запроса,
  // остаются в очереди и уходят следующим заходом. Так отправка не крутится
  // в цикле, пока человек продолжает писать.
  const snapshot = await readDiaryOutbox(tripId)
  if (snapshot.length === 0) return null

  let entries: TripDiaryEntry[] = []

  for (let index = 0; index < snapshot.length; index += SYNC_BATCH) {
    const batch = snapshot.slice(index, index + SYNC_BATCH)
    const response = await syncTripDiary(tripId, batch)
    entries = response.entries

    await writeCachedResponse(`/trips/${tripId}/diary`, response)
  }

  const pending = await pruneDiaryOutbox(
    tripId,
    snapshot.map((entry) => ({ id: entry.id, updatedAt: entry.updatedAt })),
  )

  return { entries, pending }
}

/**
 * Отправить всё, что накопилось на устройстве.
 *
 * Вызывается при возврате связи и на старте приложения. Ошибка одного
 * похода не мешает остальным: очереди независимы, а сервер может быть
 * недоступен целиком — тогда просто попробуем позже.
 */
export async function flushDiaryOutboxes(): Promise<number> {
  const trips = await diaryOutboxTripIds()
  let sentTrips = 0

  for (const tripId of trips) {
    try {
      if ((await pushDiaryOutbox(tripId)) !== null) sentTrips += 1
    } catch {
      // Связь пропала или сервер отказал: запись осталась в очереди.
    }
  }

  return sentTrips
}

/**
 * UUID для новой записи.
 *
 * `crypto.randomUUID` есть во всех браузерах, где работает PWA, но
 * в тестовой среде его может не быть. Запасной вариант — v4 из случайных
 * чисел: для ключа личного дневника стойкости не нужно, нужна уникальность.
 */
export function newDiaryEntryId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (letter) => {
    const random = Math.floor(Math.random() * 16)
    const value = letter === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

function time(iso: string): number {
  const value = new Date(iso).getTime()
  return Number.isNaN(value) ? 0 : value
}

function isOutboxEntry(value: unknown): value is DiaryOutboxEntry {
  if (typeof value !== 'object' || value === null) return false

  const entry = value as Partial<DiaryOutboxEntry>
  return (
    typeof entry.id === 'string' &&
    typeof entry.body === 'string' &&
    typeof entry.createdAt === 'string' &&
    typeof entry.updatedAt === 'string' &&
    (entry.deletedAt === null || typeof entry.deletedAt === 'string')
  )
}
