import { syncTripExpenses } from '@/api/finance'
import { deleteOfflineState, readOfflineState, writeCachedResponse, writeOfflineState } from '@/offline/cache'
import { getAllRecords, STATE_STORE } from '@/offline/indexedDb'
import { EXPENSE_SPLITS, type ExpenseSplit, type TripFinance } from '@/types/finance'

/**
 * Очередь офлайн-чеков на устройстве (19.11.2026).
 *
 * Заказчик: «создание расходных чеков должно быть доступно оффлайн
 * (за наличку)». Чек рождается в поле без связи, лежит здесь и уезжает
 * на сервер, когда сеть вернётся ([lifecycle.md] §3).
 *
 * **Одна строка на чек, а не запрос.** Офлайн-чек только создаётся:
 * правка и удаление уже сохранённого — онлайн, иначе две копии разошлись
 * бы. Значит на каждый чек в очереди ровно одно намерение — «создать»,
 * и повторять его безопасно.
 *
 * **Ключ — `clientId`**, UUID с устройства. Он же ключ идемпотентности
 * на сервере: повтор после обрыва не создаёт дубль. Новый ключ берётся
 * из `newExpenseClientId()`.
 *
 * **Почему `state` IndexedDB.** Хранилище уже есть и переживает перезапуск
 * PWA; версия базы не меняется — старая вкладка с открытой PWA не получит
 * `onblocked` и не потеряет кеш. Как у дневника и присутствия.
 *
 * **Отклонённый чек остаётся.** Сервер отказал (например, плательщик уже
 * вышел из похода) — запись получает `error` и больше не отправляется;
 * человек сам решает, убрать её или подождать. Молча выбросить чужой
 * расход нельзя: деньги уже потрачены.
 */

/** Ключ очереди одного похода. */
export function expenseOutboxKey(tripId: string): string {
  return `expenseOutbox:${tripId}`
}

/** Сколько чеков принимает сервер за один запрос (`MAX_EXPENSE_SYNC_ENTRIES`). */
const SYNC_BATCH = 50

/** Чек в очереди: тело создания плюс местные отметки для экрана. */
export interface ExpenseOutboxEntry {
  clientId: string
  amountRub: number
  description?: string
  split: ExpenseSplit
  participantIds?: string[]
  spentAt: string
  payerUserId?: string
  /** Когда чек завели на устройстве — для порядка в ленте. */
  queuedAt: string
  /** Причина отказа сервера; такой чек ждёт решения человека. */
  error?: string
}

/** Прочитать очередь похода; мусор в хранилище отбрасывается. */
export async function readExpenseOutbox(
  tripId: string,
): Promise<ExpenseOutboxEntry[]> {
  const raw = await readOfflineState<unknown>(expenseOutboxKey(tripId))
  if (!Array.isArray(raw)) return []

  return raw.filter(isOutboxEntry)
}

/** Записать очередь; пустая очередь удаляет ключ, а не хранит пустой массив. */
export async function writeExpenseOutbox(
  tripId: string,
  entries: readonly ExpenseOutboxEntry[],
): Promise<void> {
  if (entries.length === 0) {
    await deleteOfflineState(expenseOutboxKey(tripId))
    return
  }

  await writeOfflineState(expenseOutboxKey(tripId), entries)
}

/** Поставить чек в очередь: ключ уникален, повтор с тем же заменяет запись. */
export async function queueExpense(
  tripId: string,
  entry: ExpenseOutboxEntry,
): Promise<ExpenseOutboxEntry[]> {
  const current = await readExpenseOutbox(tripId)
  const next = current.filter((item) => item.clientId !== entry.clientId)
  next.push(entry)
  await writeExpenseOutbox(tripId, next)

  return next
}

/** Убрать чек из очереди — человек отказался от него сам. */
export async function removeQueuedExpense(
  tripId: string,
  clientId: string,
): Promise<ExpenseOutboxEntry[]> {
  const current = await readExpenseOutbox(tripId)
  const next = current.filter((entry) => entry.clientId !== clientId)
  await writeExpenseOutbox(tripId, next)

  return next
}

/** Снять с очереди ровно те чеки, которые сервер принял. */
export async function pruneExpenseOutbox(
  tripId: string,
  accepted: readonly string[],
): Promise<ExpenseOutboxEntry[]> {
  if (accepted.length === 0) return readExpenseOutbox(tripId)

  const current = await readExpenseOutbox(tripId)
  const next = current.filter((entry) => !accepted.includes(entry.clientId))
  await writeExpenseOutbox(tripId, next)

  return next
}

/** Походы, у которых есть неотправленные чеки. */
export async function expenseOutboxTripIds(): Promise<string[]> {
  const records = await getAllRecords<{ key?: unknown }>(STATE_STORE)

  const ids: string[] = []
  for (const record of records) {
    if (typeof record.key !== 'string') continue
    if (!record.key.startsWith('expenseOutbox:')) continue
    ids.push(record.key.slice('expenseOutbox:'.length))
  }

  return ids
}

/**
 * Отправить очередь одного похода.
 *
 * Снимок берётся на момент вызова: чек, добавленный во время запроса,
 * остаётся в очереди и уходит следующим заходом. Пачка режется по лимиту
 * сервера. После успеха в кеш вкладки попадает серверная правда — иначе
 * следующий офлайн-запуск показал бы старую ленту без новых долей.
 *
 * `null` — отправлять нечего: очередь пуста или все чеки уже отклонены
 * и ждут решения человека.
 */
export async function pushExpenseOutbox(tripId: string): Promise<{
  view: TripFinance | null
  pending: ExpenseOutboxEntry[]
} | null> {
  // Отправку запускают два места сразу: `App.vue` по `online` и сама вкладка
  // по возврату связи. Без общей задачи обе читали бы один снимок очереди
  // и слали бы один и тот же чек дважды — идемпотентность это переживёт,
  // но лишний запрос в поле никому не нужен. Живая проверка 19.11.2026
  // поймала ровно это: два POST на один чек.
  const running = inFlight.get(tripId)
  if (running) return running

  const task = pushExpenseOutboxOnce(tripId).finally(() => {
    inFlight.delete(tripId)
  })
  inFlight.set(tripId, task)
  return task
}

/** Общая задача отправки одного похода: одна на все вызовы. */
const inFlight = new Map<
  string,
  Promise<{ view: TripFinance | null; pending: ExpenseOutboxEntry[] } | null>
>()

async function pushExpenseOutboxOnce(tripId: string): Promise<{
  view: TripFinance | null
  pending: ExpenseOutboxEntry[]
} | null> {
  const snapshot = await readExpenseOutbox(tripId)
  const sendable = snapshot.filter((entry) => entry.error === undefined)
  if (sendable.length === 0) return null

  let view: TripFinance | null = null
  const accepted: string[] = []
  const rejected = new Map<string, string>()

  for (let index = 0; index < sendable.length; index += SYNC_BATCH) {
    const batch = sendable.slice(index, index + SYNC_BATCH)
    const response = await syncTripExpenses(
      tripId,
      batch.map((entry) => ({
        clientId: entry.clientId,
        amountRub: entry.amountRub,
        split: entry.split,
        spentAt: entry.spentAt,
        ...(entry.description === undefined
          ? {}
          : { description: entry.description }),
        ...(entry.participantIds === undefined
          ? {}
          : { participantIds: entry.participantIds }),
        ...(entry.payerUserId === undefined
          ? {}
          : { payerUserId: entry.payerUserId }),
      })),
    )

    for (const result of response.results) {
      if (result.status === 'accepted') {
        accepted.push(result.clientId)
      } else {
        rejected.set(result.clientId, result.message ?? 'Сервер не принял чек')
      }
    }

    // В кеш кладём ответ как есть: лишнее поле `results` типу не мешает,
    // а экран после перезапуска получит серверную правду целиком.
    view = response
    await writeCachedResponse(`/trips/${tripId}/finance`, response)
  }

  const rest = await pruneExpenseOutbox(tripId, accepted)
  const withErrors = rest.map((entry) =>
    rejected.has(entry.clientId)
      ? { ...entry, error: rejected.get(entry.clientId) }
      : entry,
  )
  await writeExpenseOutbox(tripId, withErrors)

  return { view, pending: withErrors }
}

/** Отправить все очереди: при возврате связи и на старте приложения. */
export async function flushExpenseOutboxes(): Promise<number> {
  const trips = await expenseOutboxTripIds()
  let sentTrips = 0

  for (const tripId of trips) {
    try {
      if ((await pushExpenseOutbox(tripId)) !== null) sentTrips += 1
    } catch {
      // Ошибка одного похода не мешает остальным; чек остался в очереди.
    }
  }

  return sentTrips
}

/**
 * UUID для нового чека.
 *
 * Как у дневника: `crypto.randomUUID` есть везде, где работает PWA,
 * а запасной вариант — v4 из случайных чисел. Для ключа идемпотентности
 * стойкости не нужно, нужна уникальность.
 */
export function newExpenseClientId(): string {
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

/**
 * Чеки, которых ещё нет в серверной ленте.
 *
 * Серверная строка главнее: если чек уже доехал (по `clientId`), очередь
 * не должна рисовать его второй раз — это выглядело бы как дубль расхода.
 * Свежие сверху, как «Движение денег».
 */
export function pendingForLedger(
  server: readonly { clientId?: string | null }[],
  pending: readonly ExpenseOutboxEntry[],
): ExpenseOutboxEntry[] {
  const delivered = new Set(
    server
      .map((expense) => expense.clientId)
      .filter((clientId): clientId is string => typeof clientId === 'string'),
  )

  return pending
    .filter((entry) => !delivered.has(entry.clientId))
    .sort(
      (a, b) =>
        b.spentAt.localeCompare(a.spentAt) ||
        b.queuedAt.localeCompare(a.queuedAt) ||
        b.clientId.localeCompare(a.clientId),
    )
}

function isOutboxEntry(value: unknown): value is ExpenseOutboxEntry {
  if (typeof value !== 'object' || value === null) return false

  const entry = value as Partial<ExpenseOutboxEntry>
  return (
    typeof entry.clientId === 'string' &&
    typeof entry.amountRub === 'number' &&
    Number.isInteger(entry.amountRub) &&
    entry.amountRub > 0 &&
    typeof entry.spentAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(entry.spentAt) &&
    EXPENSE_SPLITS.includes(entry.split as ExpenseSplit) &&
    typeof entry.queuedAt === 'string' &&
    (entry.description === undefined || typeof entry.description === 'string') &&
    (entry.payerUserId === undefined || typeof entry.payerUserId === 'string') &&
    (entry.participantIds === undefined ||
      (Array.isArray(entry.participantIds) &&
        entry.participantIds.every((id) => typeof id === 'string'))) &&
    (entry.error === undefined || typeof entry.error === 'string')
  )
}
