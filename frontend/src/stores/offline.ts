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
   * «Текущие» считаются из сохранённых **в момент чтения**.
   *
   * Хранить флаг «текущий» нельзя: поход заканчивается сам, без запроса
   * к серверу, и вчерашняя запись осталась бы доступной в офлайне. Поэтому
   * список в хранилище — это кандидаты, а решение принимает `isTripOngoing`
   * здесь и сейчас. Заодно это чинит случай, когда даты похода поправили
   * с другого устройства.
   */
  const currentTrips = computed(() => savedTrips.value.filter((item) => isTripOngoing(item.trip)))

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

      // С этого момента кешируем ответы только текущих походов.
      setCacheableTrips(currentTripIds.value)

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
   * Спросить у сервера, какие походы идут сейчас, и сохранить их.
   *
   * `when: 'ongoing'` — серверный фильтр из `trips.service.ts`; локальное
   * `isTripOngoing` дополнительно проверяет запись (и не даёт сохранить
   * отменённый поход).
   */
  async function refreshCurrentTrips(force = false): Promise<void> {
    if (!isOnline.value) return
    if (refreshPromise) return refreshPromise
    if (!force && currentTime() - lastRefreshAt < CURRENT_TRIPS_TTL_MS) return

    lastRefreshAt = currentTime()

    refreshPromise = (async () => {
      try {
        const response = await listTrips({ mine: true, when: 'ongoing', limit: 20 })
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
   * Заменить список текущих походов.
   *
   * Походы, переставшие быть текущими, удаляются вместе с кешем ответов:
   * хранить в телефоне чужие походы незачем.
   */
  async function setCurrentTrips(trips: Trip[]): Promise<void> {
    const previous = new Map(savedTrips.value.map((item) => [item.id, item]))
    const ongoing = trips.filter((trip) => isTripOngoing(trip))

    const next = ongoing.map((trip) => toOfflineTrip(trip, previous.get(trip.id)?.cachedAt ?? null))
    const nextIds = new Set(next.map((item) => item.id))
    const removed = savedTrips.value.filter((item) => !nextIds.has(item.id)).map((item) => item.id)

    savedTrips.value = next
    setCacheableTrips(currentTripIds.value)
    await writeOfflineState(CURRENT_TRIPS_KEY, next)
    await Promise.all(removed.map((id) => clearTripCache(id)))
  }

  /**
   * Запомнить поход, который сейчас открыли.
   *
   * Нужен на случай, когда серверный список текущих ещё не обновлялся:
   * человек открыл поход, он идёт — значит доступен и в офлайне.
   */
  async function rememberTrip(trip: Trip): Promise<void> {
    const existing = savedTrips.value.find((item) => item.id === trip.id)

    if (!isTripOngoing(trip)) {
      // Поход закончился: убираем из сохранённых, кеш чистим.
      if (existing) {
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

    // Поход идёт — теперь его ответы можно хранить; прогрев пойдёт следом.
    setCacheableTrips(currentTripIds.value)
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

  /** Идёт ли поход сейчас и сохранён ли он. */
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
