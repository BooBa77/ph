/**
 * Прогрев кеша текущего похода.
 *
 * Один раз при открытии похода (и по кнопке «Обновить») проходим по всем
 * вкладкам и складываем их ответы в IndexedDB. Дальше в поле любая вкладка
 * открывается из кеша — без сети и без «белого экрана».
 *
 * **Почему все вкладки сразу, а не «что посмотрел».** В поле человек
 * вспоминает не «я открою это, если успею», а «что у нас на ужин и кто несёт
 * тент». Кешировать только просмотренное значит гарантированно не иметь
 * нужного.
 *
 * **Почему порциями.** Сервер живёт на одном ядре; двадцать параллельных
 * запросов с телефона — это заметная очередь. Отправляем по четыре.
 *
 * **Почему не чаще раза в 10 минут.** Прогрев — фоновая работа; при каждом
 * возврате на страницу он не нужен. Ручное «Обновить» (`force`) обходит
 * ограничение.
 */

import { getTripFirstAid } from '@/api/firstAid'
import { getTripFinance } from '@/api/finance'
import { getTripGearLoad, listTripGear } from '@/api/gear'
import { listDishes } from '@/api/meals'
import { listTripChecklists } from '@/api/tripChecklists'
import {
  fetchGuestTrip,
  fetchMealChecks,
  fetchMealPlan,
  fetchMyMealChecks,
  fetchMyMealPlan,
  fetchTripRoute,
  fetchTripTabs,
  fetchTripTransfer,
  getTrip,
  listParticipants,
  listRequests,
  listTripChats,
  listTripMessages,
  listTripTypes,
} from '@/api/trips'
import { prefetchStateKey, readOfflineState, writeOfflineState } from '@/offline/cache'
import { isTripOngoing } from '@/offline/isTripOngoing'
import type { Trip } from '@/types/trips'

/** Сколько живёт удачный прогрев. */
export const PREFETCH_TTL_MS = 10 * 60 * 1000

/** Размер порции параллельных запросов. */
const BATCH_SIZE = 4

/** Ключ отметки о прогреве конкретного похода. */
export const prefetchKey = prefetchStateKey

/**
 * Когда поход последний раз прогревали. `null` — не прогревали.
 */
export async function readPrefetchedAt(tripId: string): Promise<number | null> {
  const value = await readOfflineState<number>(prefetchKey(tripId))
  return typeof value === 'number' ? value : null
}

/**
 * Сохранить ответы всех вкладок похода.
 *
 * Возвращает время сохранения (мс) или `null`, если поход не идёт или связи
 * нет. Ошибки отдельных запросов не прерывают прогрев: одна недоступная
 * вкладка не должна отменять остальные.
 */
export async function prefetchTripCache(trip: Trip, force = false): Promise<number | null> {
  if (!isTripOngoing(trip)) return null
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null

  const savedAt = await readPrefetchedAt(trip.id)
  if (!force && savedAt !== null && Date.now() - savedAt < PREFETCH_TTL_MS) {
    return savedAt
  }

  const id = trip.id

  /*
   * Список повторяет то, что зовут вкладки при монтировании
   * (`TripView` → дочерние компоненты) плюс словари, без которых раскладка
   * и снаряжение не отрисуются. Пути кешируются в `apiFetch` автоматически.
   */
  const tasks: Array<() => Promise<unknown>> = [
    () => getTrip(id),
    () => fetchTripTabs(id),
    () => fetchGuestTrip(id),
    () => listParticipants(id),
    () => listRequests(id),
    () => listTripTypes(),
    () => listDishes(),
    () => fetchMealPlan(id),
    () => fetchMyMealPlan(id),
    () => fetchMealChecks(id),
    () => fetchMyMealChecks(id),
    () => fetchTripTransfer(id),
    () => fetchTripRoute(id),
    () => listTripGear(id),
    () => getTripGearLoad(id),
    () => listTripChecklists(id),
    () => getTripFirstAid(id),
    () => getTripFinance(id),
    () => prefetchChats(id),
  ]

  for (let index = 0; index < tasks.length; index += BATCH_SIZE) {
    const batch = tasks.slice(index, index + BATCH_SIZE)
    await Promise.allSettled(batch.map((task) => task()))
  }

  const finishedAt = Date.now()
  await writeOfflineState(prefetchKey(id), finishedAt)
  return finishedAt
}

/**
 * Чаты похода: список и первая страница сообщений каждого.
 *
 * Историю листаем не всю — первая страница это то, что человек прочитает
 * в поле. Глубже — только когда был онлайн и сам долистал.
 */
async function prefetchChats(tripId: string): Promise<void> {
  const chats = await listTripChats(tripId)
  await Promise.allSettled(chats.map((chat) => listTripMessages(tripId, chat.kind)))
}
