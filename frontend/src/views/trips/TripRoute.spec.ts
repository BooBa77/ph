import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Trip } from '@/types/trips'
import TripRoute from '@/views/trips/TripRoute.vue'

/**
 * Вкладка «Ночёвки» (29.10.2026).
 *
 * Пока в ней один чат — тема вкладки, как у «Питания» и «Трансфера». Тест
 * держит именно эту связку: вкладка обязана открыть **свой** чат
 * (`trip_route`), а не чужой, иначе разговор о таборе уедет в другой раздел
 * и его там никто не найдёт.
 */
const mocks = vi.hoisted(() => ({
  listTripMessages: vi.fn(),
  sendTripMessage: vi.fn(),
}))

vi.mock('@/api/trips', () => ({
  listTripMessages: mocks.listTripMessages,
  sendTripMessage: mocks.sendTripMessage,
}))

const TRIP = { id: '1' } as Trip

describe('вкладка «Ночёвки»', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listTripMessages.mockResolvedValue({ messages: [], hasMore: false })
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
