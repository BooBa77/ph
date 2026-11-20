import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Trip } from '@/types/trips'

/**
 * Стор офлайна: какие походы идут сейчас и что сохранено на устройстве.
 *
 * Хранилище и API подменены: проверяется логика стора — фильтр «идёт
 * сейчас», уборка переставших быть текущими, отметки сохранения и реакция
 * на события сети, — а не IndexedDB и не сервер.
 */
const mocks = vi.hoisted(() => ({
  listTrips: vi.fn(),
  readOfflineState: vi.fn(),
  writeOfflineState: vi.fn(),
  clearTripCache: vi.fn(),
  clearAllOfflineData: vi.fn(),
  resumeSession: vi.fn(async () => undefined),
}))

vi.mock('@/api/trips', () => ({ listTrips: mocks.listTrips }))
vi.mock('@/offline/cache', () => ({
  readOfflineState: mocks.readOfflineState,
  writeOfflineState: mocks.writeOfflineState,
  clearTripCache: mocks.clearTripCache,
  clearAllOfflineData: mocks.clearAllOfflineData,
  setCacheableTrips: vi.fn(),
}))
// Очередь дневника — единственная офлайн-запись: пустая, чтобы правило
// удаления проверялось без IndexedDB.
vi.mock('@/offline/diaryOutbox', () => ({
  readDiaryOutbox: vi.fn(async () => []),
}))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ resumeSession: mocks.resumeSession }),
}))

import { CURRENT_TRIPS_KEY, useOfflineStore, type OfflineTrip } from '@/stores/offline'

const BASE: Trip = {
  id: '1',
  organizerUserId: 'u-1',
  goalObjectId: '10',
  goalObject: { id: '10', name: 'Витязь', type: 'скальник', url: null },
  announcement: null,
  routeText: '',
  requirementsText: null,
  hasGuitar: false,
  visibility: 'public',
  isRecruitmentClosed: false,
  activityTypeIds: [],
  status: 'decided',
  startsAt: '2020-01-01T00:00:00.000Z',
  endsAt: null,
  dateVariants: [],
  isCommercial: false,
  isOfficial: false,
  openParticipation: true,
  priceRub: null,
  priceNote: null,
  cancelledAt: null,
  createdAt: '2026-10-14T10:00:00.000Z',
  updatedAt: '2026-10-14T10:00:00.000Z',
}

/** Поход без конца и с прошедшим началом — идёт. */
const ongoing = (overrides: Partial<Trip> = {}): Trip => ({ ...BASE, ...overrides })

/** Поход, который закончился в 2020-м. */
const finished = (overrides: Partial<Trip> = {}): Trip => ({
  ...BASE,
  id: '2',
  startsAt: '2020-01-01T00:00:00.000Z',
  endsAt: '2020-01-05T00:00:00.000Z',
  ...overrides,
})

function offlineTrip(trip: Trip, cachedAt: number | null = null): OfflineTrip {
  return {
    id: trip.id,
    name: trip.goalObject?.name ?? 'Поход',
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    cachedAt,
    trip,
  }
}

describe('стор офлайна', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })

    mocks.readOfflineState.mockResolvedValue(null)
    mocks.writeOfflineState.mockResolvedValue(undefined)
    mocks.clearTripCache.mockResolvedValue(undefined)
    mocks.clearAllOfflineData.mockResolvedValue(undefined)
    mocks.listTrips.mockResolvedValue({ trips: [], total: 0 })
  })

  it('читает сохранённые текущие походы при запуске', async () => {
    const store = useOfflineStore()
    mocks.readOfflineState.mockResolvedValue([offlineTrip(ongoing(), 1_700_000_000_000)])

    await store.init()

    expect(store.isReady).toBe(true)
    expect(store.currentTripIds).toEqual(['1'])
    expect(store.currentTrips[0]?.cachedAt).toBe(1_700_000_000_000)
  })

  it('спрашивает у сервера походы для офлайна и сохраняет их', async () => {
    const store = useOfflineStore()
    mocks.listTrips.mockResolvedValue({ trips: [ongoing(), finished()], total: 2 })

    await store.refreshCurrentTrips(true)

    expect(mocks.listTrips).toHaveBeenCalledWith({ mine: true, offline: true, limit: 20 })
    expect(store.currentTripIds).toEqual(['1'])
    expect(mocks.writeOfflineState).toHaveBeenCalledWith(CURRENT_TRIPS_KEY, [
      expect.objectContaining({ id: '1', name: 'Витязь' }),
    ])
  })

  it('поход перестал приходить с сервера, но ещё идёт — копия остаётся', async () => {
    const store = useOfflineStore()
    await store.setCurrentTrips([ongoing(), ongoing({ id: 'old' })])

    await store.setCurrentTrips([ongoing()])

    // «old» ещё идёт: копию не выбрасываем только потому, что сервер
    // перестал присылать его в наборе для офлайна.
    expect(store.currentTripIds).toEqual(['1', 'old'])
    expect(mocks.clearTripCache).not.toHaveBeenCalledWith('old')
  })

  it('открытый поход запоминается, а давно закончившийся при запуске убирается', async () => {
    const store = useOfflineStore()

    await store.rememberTrip(ongoing())
    expect(store.currentTripIds).toEqual(['1'])

    // Незакончившийся поход запомнить можно, давно закончившийся — нет.
    await store.rememberTrip(finished())
    expect(store.currentTripIds).toEqual(['1'])

    // Сохранённая копия, срок которой истёк, убирается при запуске
    // со связью — иначе она висела бы на телефоне вечно.
    mocks.readOfflineState.mockResolvedValue([offlineTrip(finished())])
    const restored = useOfflineStore()
    await restored.init()

    expect(restored.currentTripIds).toEqual([])
    expect(mocks.clearTripCache).toHaveBeenCalledWith('2')
  })

  it('отметка сохранения обновляется и переживает перезапуск', async () => {
    const store = useOfflineStore()
    await store.setCurrentTrips([ongoing()])

    await store.markSaved('1', 1_800_000_000_000)

    expect(store.currentTrips[0]?.cachedAt).toBe(1_800_000_000_000)
    expect(mocks.writeOfflineState).toHaveBeenCalledWith(
      CURRENT_TRIPS_KEY,
      expect.arrayContaining([expect.objectContaining({ id: '1', cachedAt: 1_800_000_000_000 })]),
    )
  })

  it('событие offline переключает режим, online — поднимает сессию и список', async () => {
    const store = useOfflineStore()
    await store.init()

    window.dispatchEvent(new Event('offline'))
    expect(store.isOffline).toBe(true)

    mocks.listTrips.mockResolvedValue({ trips: [ongoing()], total: 1 })
    window.dispatchEvent(new Event('online'))

    await vi.waitFor(() => expect(store.isOnline).toBe(true))
    await vi.waitFor(() => expect(mocks.resumeSession).toHaveBeenCalled())
    await vi.waitFor(() => expect(store.currentTripIds).toEqual(['1']))
  })

  it('в офлайне к серверу не ходит', async () => {
    const store = useOfflineStore()
    store.isOnline = false

    await store.refreshCurrentTrips(true)

    expect(mocks.listTrips).not.toHaveBeenCalled()
  })
})
