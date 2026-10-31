import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Trip } from '@/types/trips'
import TripRoute from '@/views/trips/TripRoute.vue'

/**
 * Вкладка «Ночёвки» (29.10.2026).
 *
 * В ней два слоя: таблица ночёвок и чат табора — тема вкладки, как
 * у «Питания» и «Трансфера». Тест держит связку: вкладка обязана открыть
 * **свой** чат (`trip_route`), а не чужой, иначе разговор о таборе уедет
 * в другой раздел и его там никто не найдёт.
 *
 * Таблица ночёвок с 31.10.2026 грузится из `GET /route`, поэтому запросы
 * заглушены: здесь проверяется вкладка, а не сетка ночей (её держит
 * `TripRouteNights.spec.ts`).
 */
const mocks = vi.hoisted(() => ({
  listTripMessages: vi.fn(),
  sendTripMessage: vi.fn(),
  fetchTripRoute: vi.fn(),
  fetchTripTransfer: vi.fn(),
  saveRouteNights: vi.fn(),
  lodgeRoute: vi.fn(),
  acceptRouteLodger: vi.fn(),
  releaseRouteLodger: vi.fn(),
  listParticipants: vi.fn(),
  listTripGear: vi.fn(),
  listGear: vi.fn(),
}))

vi.mock('@/api/trips', () => ({
  listTripMessages: mocks.listTripMessages,
  sendTripMessage: mocks.sendTripMessage,
  fetchTripRoute: mocks.fetchTripRoute,
  fetchTripTransfer: mocks.fetchTripTransfer,
  saveRouteNights: mocks.saveRouteNights,
  lodgeRoute: mocks.lodgeRoute,
  acceptRouteLodger: mocks.acceptRouteLodger,
  releaseRouteLodger: mocks.releaseRouteLodger,
  listParticipants: mocks.listParticipants,
}))

vi.mock('@/api/gear', () => ({
  listTripGear: mocks.listTripGear,
  listGear: mocks.listGear,
}))

const TRIP = { id: '1' } as Trip

describe('вкладка «Ночёвки»', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listTripMessages.mockResolvedValue({ messages: [], hasMore: false })
    mocks.fetchTripRoute.mockResolvedValue({
      canEdit: true,
      nights: [],
      lodgers: [],
      travelers: [],
    })
    mocks.fetchTripTransfer.mockResolvedValue({ canEdit: true, travelers: [], legs: [] })
    mocks.listTripGear.mockResolvedValue({
      items: [],
      totalWeightGrams: 0,
      itemsWithoutWeight: 0,
    })
    mocks.listParticipants.mockResolvedValue([])
  })

  it('открывает чат табора, а не чужой', async () => {
    mount(TripRoute, { props: { trip: TRIP } })
    await flushPromises()

    expect(mocks.listTripMessages).toHaveBeenCalledWith('1', 'trip_route')
  })

  it('чат подписан «Чат табора»', async () => {
    const wrapper = mount(TripRoute, { props: { trip: TRIP } })
    await flushPromises()

    expect(wrapper.find('[data-test="trip-route"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="trip-chat"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Чат табора')
  })

  it('пустой чат приглашает написать, а не показывает ошибку', async () => {
    const wrapper = mount(TripRoute, { props: { trip: TRIP } })
    await flushPromises()

    expect(wrapper.find('[data-test="chat-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="chat-error"]').exists()).toBe(false)
  })
})
