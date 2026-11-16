/**
 * Состояние офлайн-режима.
 *
 * Один стор отвечает на три вопроса, которые нужны всему приложению:
 *  1. есть ли связь (`isOnline`);
 *  2. какие походы идут сейчас и сохранены на устройстве (`currentTrips`);
 *  3. можно ли открыть конкретный поход (`canOpenTrip`).
 *
 * **Почему текущие походы хранятся списком, а не одним id.** По датам может
 * идти два похода (например, у соорганизатора), и запрещать второй было бы
 * произволом. Правило заказчика — «только текущий поход», а не «ровно один».
 *
 * **Почему это IndexedDB, а не localStorage.** Список содержит полные DTO
 * походов; в localStorage они упираются в квоту и сериализуются синхронно.
 * localStorage остаётся для профиля (`offline/session.ts`), которому нужен
 * синхронный доступ на старте.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { listTrips } from '@/api/trips'
import { useAuthStore } from '@/stores/auth'
import {
  clearAllOfflineData,
  clearTripCache,
  readOfflineState,
  setCacheableTrips,
  writeOfflineState,
} from '@/offline/cache'
import { isIndexedDbAvailable } from '@/offline/indexedDb'
import { isTripCacheable, keepOfflineCopy } from '@/offline/cacheable'
import { isTripOngoing } from '@/offline/isTripOngoing'
import type { Trip } from '@/types/trips'

/** Ключ состояния с текущими походами. */
export const CURRENT_TRIPS_KEY = 'currentTrips'

/** Как часто перепроверяем текущие походы у сервера. */
export const CURRENT_TRIPS_TTL_MS = 5 * 60 * 1000

/** Поход, сохранённый для офлайна. */
export interface OfflineTrip {
  id: string
  /** Имя для списка: цель похода. */
  name: string
  /** Начало по правилу «факт, иначе план». */
  startsAt: string | null
  /** Конец по правилу «факт, иначе план». */
  endsAt: string | null
  /** Когда данные последний раз сохранялись; `null` — ещё не сохраняли. */
  cachedAt: number | null
  /** Полный поход: из него рисуется карточка в офлайне. */
  trip: Trip
}

function currentTime(): number {
  return Date.now()
}

function readNavigatorOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

/** Собрать запись из DTO, сохранив прежнюю отметку сохранения. */
function toOfflineTrip(trip: Trip, cachedAt: number | null): OfflineTrip {
  return {
    id: trip.id,
    name: trip.goalObject?.name ?? 'Поход',
    startsAt: trip.actualStartedAt ?? trip.startsAt,
    endsAt: trip.actualFinishedAt ?? trip.endsAt,
    cachedAt,
    trip,
  }
}

/** Мусор в хранилище (старая версия, ручная правка) не должен ломать старт. */
function isOfflineTrip(value: unknown): value is OfflineTrip {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Partial<OfflineTrip>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    candidate.trip !== null &&
    typeof candidate.trip === 'object'
  )
}

export const useOfflineStore = defineStore('offline', () => {
  /** Есть ли сеть. `navigator.onLine` врёт только в одну сторону: true при
   *  мёртвом Wi-Fi, поэтому сюда же приходит и обрыв запроса — см. клиент. */
  const isOnline = ref(readNavigatorOnline())

  /** Походы, идущие сейчас и сохранённые на устройстве. */
  const savedTrips = ref<OfflineTrip[]>([])

  /**
   * Походы, доступные без связи.
   *
   * Это **все сохранённые копии**, а не только идущие сейчас: группа,
   * задержавшаяся в горах, не должна потерять свой поход в тот момент,
   * когда он по плану закончился. Копия живёт, пока её не удалит правило
   * `cacheable.ts` (связь + срок + пустая очередь), — и это же правило
   * решает, когда поход перестаёт быть доступным.
   *
   * Порядок — идущие сначала: на вопрос «куда меня ведёт офлайн-режим»
   * первым должен отвечать поход, который идёт, а не вчерашний.
   */
  const currentTrips = computed(() => {
    const now = Date.now()
    return [...savedTrips.value].sort((left, right) => {
      const leftRank = isTripOngoing(left.trip, now) ? 0 : 1
      const rightRank = isTripOngoing(right.trip, now) ? 0 : 1
      if (leftRank !== rightRank) return leftRank - rightRank

      const leftStart = left.startsAt ? Date.parse(left.startsAt) : Infinity
      const rightStart = right.startsAt ? Date.parse(right.startsAt) : Infinity
      return leftStart - rightStart
    })
  })

  /**
   * Походы, которые **сейчас** подлежат офлайн-хранению.
   *
   * Отличаются от `currentTrips`: закончившийся, но ещё не удалённый поход
   * открыть можно, а вот снова прогревать его и записывать в него новые
   * ответы незачем — он больше не изменится по нашей воле.
   */
  const cacheableTripIds = computed(() =>
    savedTrips.value.filter((item) => isTripCacheable(item.trip)).map((item) => item.id),
  )

  /** Состояние прочитано из хранилища: guard может на него опираться. */
  const isReady = ref(false)

  /** Есть ли IndexedDB. Без неё офлайн-режим не работает. */
  const isSupported = ref(isIndexedDbAvailable())

  const isOffline = computed(() => !isOnline.value)
  const hasCurrentTrips = computed(() => currentTrips.value.length > 0)
  const currentTripIds = computed(() => currentTrips.value.map((item) => item.id))
  const primaryTrip = computed(() => currentTrips.value[0] ?? null)

  let initPromise: Promise<void> | null = null
  let refreshPromise: Promise<void> | null = null
  let lastRefreshAt = 0
  let boundHandlers: { onOnline: () => void; onOffline: () => void } | null = null

  /**
   * Подготовить стор: прочитать сохранённые походы и подписаться на события
   * сети. Идемпотентно, вызывается из `main.ts` и из guard.
   */
  function init(): Promise<void> {
    if (initPromise) return initPromise

    initPromise = (async () => {
      isOnline.value = readNavigatorOnline()
      bindNetworkListeners()

      const stored = await readOfflineState<OfflineTrip[]>(CURRENT_TRIPS_KEY)
      if (Array.isArray(stored)) savedTrips.value = stored.filter(isOfflineTrip)

      // Есть связь — можно прибрать копии, которым уже пора уходить.
      // Без связи не трогаем ничего: именно эта копия, возможно, сейчас
      // единственная, что у группы есть.
      if (isOnline.value) await pruneExpiredCopies()

      // С этого момента кешируем ответы только тех походов, что подлежат
      // офлайн-хранению: закончившиеся копии дочитывать незачем.
      setCacheableTrips(cacheableTripIds.value)

      // Вернулись на вкладку — тихо перепроверяем, какие походы идут.
      // Это же убирает из хранилища поход, даты которого поправили.
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void refreshCurrentTrips()
        })
      }

      isReady.value = true
    })()

    return initPromise
  }

  /** Убрать копии, которым пора уходить по правилу `cacheable.ts`. */
  async function pruneExpiredCopies(): Promise<void> {
    const kept: OfflineTrip[] = []
    const dropped: string[] = []

    for (const item of savedTrips.value) {
      if (await keepOfflineCopy(item.trip)) kept.push(item)
      else dropped.push(item.id)
    }

    if (dropped.length === 0) return

    savedTrips.value = kept
    setCacheableTrips(cacheableTripIds.value)
    await writeOfflineState(CURRENT_TRIPS_KEY, kept)
    await Promise.all(dropped.map((id) => clearTripCache(id)))
  }

  function bindNetworkListeners(): void {
    if (typeof window === 'undefined') return

    if (boundHandlers) {
      window.removeEventListener('online', boundHandlers.onOnline)
      window.removeEventListener('offline', boundHandlers.onOffline)
    }

    const onOnline = () => {
      isOnline.value = true
      void handleOnline()
    }

    const onOffline = () => {
      isOnline.value = false
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    boundHandlers = { onOnline, onOffline }
  }

  /** Сеть вернулась: поднять сессию и перепроверить, какие походы идут. */
  async function handleOnline(): Promise<void> {
    await useAuthStore().resumeSession()
    await refreshCurrentTrips(true)
  }

  /**
   * Спросить у сервера, какие походы хранить на устройстве, и сохранить их.
   *
   * `offline: true` — серверный фильтр: `decided`, я `going`, поход ещё
   * не закончился (`trips.service.ts`). Локальное `isTripCacheable`
   * дополнительно проверяет саму запись и не даёт сохранить отменённый
   * поход или чужой.
   */
  async function refreshCurrentTrips(force = false): Promise<void> {
    if (!isOnline.value) return
    if (refreshPromise) return refreshPromise
    if (!force && currentTime() - lastRefreshAt < CURRENT_TRIPS_TTL_MS) return

    lastRefreshAt = currentTime()

    refreshPromise = (async () => {
      try {
        const response = await listTrips({ mine: true, offline: true, limit: 20 })
        await setCurrentTrips(response.trips)
      } catch {
        // Сети нет или сервер недоступен — остаёмся на сохранённом списке.
      } finally {
        refreshPromise = null
      }
    })()

    return refreshPromise
  }

  /**
   * Заменить список походов на устройстве.
   *
   * Походы, переставшие подходить, удаляются вместе с кешем ответов — но
   * **не сразу**. Удаление разрешено, когда есть связь (сюда без связи
   * не попадают), срок похода истёк и очередь отправлена
   * (`cacheable.ts`, `shouldDropOfflineCopy`). Задержавшаяся группа иначе
   * потеряла бы копию ровно тогда, когда она нужнее всего.
   */
  async function setCurrentTrips(trips: Trip[]): Promise<void> {
    const previous = new Map(savedTrips.value.map((item) => [item.id, item]))
    const ongoing = trips.filter((trip) => isTripCacheable(trip))

    const fresh = ongoing.map((trip) =>
      toOfflineTrip(trip, previous.get(trip.id)?.cachedAt ?? null),
    )
    const freshIds = new Set(fresh.map((item) => item.id))

    const kept: OfflineTrip[] = []
    const removed: string[] = []

    for (const item of savedTrips.value) {
      if (freshIds.has(item.id)) continue

      if (await keepOfflineCopy(item.trip)) kept.push(item)
      else removed.push(item.id)
    }

    savedTrips.value = [...fresh, ...kept]
    setCacheableTrips(cacheableTripIds.value)
    await writeOfflineState(CURRENT_TRIPS_KEY, savedTrips.value)
    await Promise.all(removed.map((id) => clearTripCache(id)))
  }

  /**
   * Запомнить поход, который сейчас открыли.
   *
   * Нужен на случай, когда серверный список ещё не обновлялся: человек
   * открыл поход, который подлежит офлайн-хранению, — значит он доступен
   * и без связи.
   */
  async function rememberTrip(trip: Trip): Promise<void> {
    const existing = savedTrips.value.find((item) => item.id === trip.id)

    if (!isTripCacheable(trip)) {
      // Поход перестал подходить: отменён или закончился. Удаляем, только
      // если правило хранения разрешает, — иначе оставляем копию.
      if (existing && !(await keepOfflineCopy(trip))) {
        savedTrips.value = savedTrips.value.filter((item) => item.id !== trip.id)
        await writeOfflineState(CURRENT_TRIPS_KEY, savedTrips.value)
        await clearTripCache(trip.id)
      }
      return
    }

    const saved = toOfflineTrip(trip, existing?.cachedAt ?? null)
    savedTrips.value = existing
      ? savedTrips.value.map((item) => (item.id === trip.id ? saved : item))
      : [...savedTrips.value, saved]

    // Поход подходит — теперь его ответы можно хранить; прогрев пойдёт следом.
    setCacheableTrips(cacheableTripIds.value)
    await writeOfflineState(CURRENT_TRIPS_KEY, savedTrips.value)
  }

  /** Отметить, что данные похода сохранены для офлайна. */
  async function markSaved(tripId: string, at: number = currentTime()): Promise<void> {
    let changed = false
    savedTrips.value = savedTrips.value.map((item) => {
      if (item.id !== tripId) return item
      changed = true
      return { ...item, cachedAt: at }
    })

    if (changed) await writeOfflineState(CURRENT_TRIPS_KEY, savedTrips.value)
  }

  /** Сохранён ли поход на устройстве (значит, доступен и без связи). */
  function isCurrentTrip(tripId: string): boolean {
    return currentTrips.value.some((item) => item.id === tripId)
  }

  /** Сохранённая копия похода. */
  function currentTripById(tripId: string): OfflineTrip | null {
    return currentTrips.value.find((item) => item.id === tripId) ?? null
  }

  /** Очистить всё: выход из аккаунта или полный сброс. */
  async function forgetAll(): Promise<void> {
    savedTrips.value = []
    setCacheableTrips([])
    await writeOfflineState(CURRENT_TRIPS_KEY, [])
    await clearAllOfflineData()
  }

  return {
    isOnline,
    isOffline,
    isReady,
    isSupported,
    currentTrips,
    currentTripIds,
    cacheableTripIds,
    hasCurrentTrips,
    primaryTrip,
    init,
    refreshCurrentTrips,
    setCurrentTrips,
    rememberTrip,
    markSaved,
    isCurrentTrip,
    currentTripById,
    forgetAll,
  }
})
