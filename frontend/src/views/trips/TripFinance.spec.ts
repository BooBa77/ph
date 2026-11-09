import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TripFinance from '@/views/trips/TripFinance.vue'

/**
 * Вкладка «Бухгалтерия» (09.11.2026).
 *
 * Заказчик: «Пока пустую с чатом». Тест держит ровно это: экран есть,
 * чат в нём один и того вида, который читает бэкенд (`trip_finance`),
 * а лишних полей и заглушек нет — вкладку откроют, и она не должна
 * обещать того, чего ещё нет.
 */
vi.mock('@/api/trips', () => ({
  listTripMessages: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
  sendTripMessage: vi.fn(),
}))

const CHAT_STUB = {
  TripChat: {
    props: ['tripId', 'kind'],
    template: '<div data-test="chat-stub">чат {{ kind }} похода {{ tripId }}</div>',
  },
}

function mountFinance(tripId = '7') {
  return mount(TripFinance, {
    props: { tripId },
    global: { stubs: CHAT_STUB },
  })
}

describe('TripFinance', () => {
  enableAutoUnmount(afterEach)

  it('показывает чат бухгалтерии, и это единственное содержимое', async () => {
    const wrapper = mountFinance()
    await flushPromises()

    const chat = wrapper.find('[data-test="chat-stub"]')
    expect(chat.exists()).toBe(true)
    expect(chat.text()).toContain('trip_finance')
    expect(chat.text()).toContain('7')
  })

  it('не рисует заглушку «в разработке» и полей расходов', async () => {
    const wrapper = mountFinance()
    await flushPromises()

    expect(wrapper.find('[data-test="tab-soon"]').exists()).toBe(false)
    expect(wrapper.findAll('input')).toHaveLength(0)
    expect(wrapper.findAll('button')).toHaveLength(0)
  })
})
