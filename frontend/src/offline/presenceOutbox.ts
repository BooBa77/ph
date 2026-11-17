import { setTripPresence } from '@/api/trips'
import { deleteOfflineState, readOfflineState, writeOfflineState } from '@/offline/cache'
import { getAllRecords, STATE_STORE } from '@/offline/indexedDb'
import type { PresenceAction } from '@/types/trips'

/**
 * Очередь отметок присутствия на устройстве (17.11.2026).
 *
 * Заказчик: «любой идущий отмечает любого, в том числе офлайн» — связь
 * в Прибайкалье появляется только в населёнке, а «кто уже вернулся» группа
 * хочет знать раньше. Отметка — не правка похода: она не спорит с чужими
 * данными, поэтому её можно отправить и позже.
 *
 * **Одна строка на человека, а не список нажатий.** Пока связи нет, человек
 * мог нажать «на маршруте», потом «вернулся», потом снова «на маршруте».
 * Важно последнее состояние; хранить три запроса и их порядок — лишняя
 * работа и лишний источник ошибок. Ключ — `presenceOutbox:<tripId>`.
 *
 * **Почему `state` IndexedDB.** Хранилище уже есть и переживает перезапуск
 * PWA; версия базы не меняется — старая вкладка с открытой PWA не получит
 * `onblocked` и не потеряет кеш. Как у дневника.
 *
 * **Что не отправляем.** Время отметки на устройстве не передаётся: сервер
 * ставит своё, и часы телефона в горах не должны влиять на историю. Поэтому
 * в очереди лежит только «кто» и «что», а `at` нужен лишь для того, чтобы
 * снять ровно ту версию, которую принял сервер.
 */

/** Ключ очереди одного похода. */
export function presenceOutboxKey(tripId: string): string {
  return `presenceOutbox:${tripId}`
}

/** Состояние одного человека в очереди. */
export interface PresenceOutboxEntry {
  userId: string
  status: PresenceAction
  /** Когда нажали на устройстве — только для снятия отправленной версии. */
  at: string
}

/** Прочитать очередь похода; мусор в хранилище отбрасывается. */
export async function readPresenceOutbox(
  tripId: string,
): Promise<PresenceOutboxEntry[]> {
  const raw = await readOfflineState<unknown>(presenceOutboxKey(tripId))
  if (!Array.isArray(raw)) return []

  return raw.filter(isOutboxEntry)
}

/** Записать очередь; пустая очередь удаляет ключ, а не хранит пустой массив. */
export async function writePresenceOutbox(
  tripId: string,
  entries: readonly PresenceOutboxEntry[],
): Promise<void> {
  if (entries.length === 0) {
    await deleteOfflineState(presenceOutboxKey(tripId))
    return
  }

  await writeOfflineState(presenceOutboxKey(tripId), entries)
}

/** Поставить отметку в очередь: прежняя отметка этого человека заменяется. */
export async function queuePresenceChange(
  tripId: string,
  change: PresenceOutboxEntry,
): Promise<PresenceOutboxEntry[]> {
  const current = await readPresenceOutbox(tripId)
  const next = current.filter((entry) => entry.userId !== change.userId)
  next.push(change)
  await writePresenceOutbox(tripId, next)

  return next
}

/** Убрать из очереди ровно те версии, которые уже принял сервер. */
export async function prunePresenceOutbox(
  tripId: string,
  sent: readonly Pick<PresenceOutboxEntry, 'userId' | 'at'>[],
): Promise<PresenceOutboxEntry[]> {
  const current = await readPresenceOutbox(tripId)
  const rest = current.filter(
    (entry) =>
      !sent.some(
        (version) => version.userId === entry.userId && version.at === entry.at,
      ),
  )
  await writePresenceOutbox(tripId, rest)

  return rest
}

/** Походы, у которых есть неотправленные отметки. */
export async function presenceOutboxTripIds(): Promise<string[]> {
  const records = await getAllRecords<{ key?: unknown }>(STATE_STORE)

  const ids: string[] = []
  for (const record of records) {
    if (typeof record.key !== 'string') continue
    if (!record.key.startsWith('presenceOutbox:')) continue
    ids.push(record.key.slice('presenceOutbox:'.length))
  }

  return ids
}

/**
 * Отправить очередь одного похода.
 *
 * Снимок берётся на момент вызова: отметки, поставленные во время запроса,
 * остаются в очереди и уходят следующим заходом. Отправленные версии
 * снимаются сразу — если следующий человек упадёт, предыдущие уже не
 * потеряются и не отправятся дважды.
 *
 * `null` — очередь пуста, ходить на сервер незачем.
 */
export async function pushPresenceOutbox(tripId: string): Promise<{
  pending: PresenceOutboxEntry[]
} | null> {
  const snapshot = await readPresenceOutbox(tripId)
  if (snapshot.length === 0) return null

  const sent: Pick<PresenceOutboxEntry, 'userId' | 'at'>[] = []

  for (const entry of snapshot) {
    try {
      await setTripPresence(tripId, entry.userId, entry.status)
      sent.push({ userId: entry.userId, at: entry.at })
    } catch {
      // Связь пропала или сервер отказал: эта и следующие остаются в очереди.
      break
    }
  }

  const pending = await prunePresenceOutbox(tripId, sent)
  return { pending }
}

/** Отправить все очереди: при возврате связи и на старте приложения. */
export async function flushPresenceOutboxes(): Promise<number> {
  const trips = await presenceOutboxTripIds()
  let sentTrips = 0

  for (const tripId of trips) {
    try {
      if ((await pushPresenceOutbox(tripId)) !== null) sentTrips += 1
    } catch {
      // Ошибка одного похода не мешает остальным.
    }
  }

  return sentTrips
}

function isOutboxEntry(value: unknown): value is PresenceOutboxEntry {
  if (typeof value !== 'object' || value === null) return false

  const entry = value as Partial<PresenceOutboxEntry>
  return (
    typeof entry.userId === 'string' &&
    (entry.status === 'route' ||
      entry.status === 'returned' ||
      entry.status === 'none') &&
    typeof entry.at === 'string'
  )
}
