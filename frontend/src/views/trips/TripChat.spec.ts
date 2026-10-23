import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TripMessage } from '@/types/trips'
import TripChat from '@/views/trips/TripChat.vue'

/**
 * Чат похода: гостевой на «Гостевой», членский на «Участниках».
 *
 * Проверяем то, ради чего он здесь: сообщения приходят с бэкенда,
 * отправка уходит в API с видом чата, пустой чат приглашает написать.
 * Отдельной вкладки «Чаты» нет — это и есть её замена.
 */
const mocks = vi.hoisted(() => ({
  listTripMessages: vi.fn(),
  sendTripMessage: vi.fn(),
}))

vi.mock('@/api/trips', () => ({
  listTripMessages: mocks.listTripMessages,
  sendTripMessage: mocks.sendTripMessage,
}))

function message(overrides: Partial<TripMessage> = {}): TripMessage {
  return {
    id: '1',
    senderId: 'u-1',
    senderName: 'Ваня',
    senderAvatarUrl: null,
    body: 'Привет',
    isSystem: false,
    createdAt: '2026-10-21T10:00:00.000Z',
    ...overrides,
  }
}

async function mountChat() {
  const wrapper = mount(TripChat, {
    props: { tripId: '7', kind: 'trip_guest' },
  })
  await flushPromises()

  return wrapper
}

describe('TripChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listTripMessages.mockResolvedValue({ messages: [], hasMore: false })
  })

  it('показывает сообщения из чата', async () => {
    mocks.listTripMessages.mockResolvedValue({
      messages: [message(), message({ id: '2', body: 'Взял горелку' })],
      hasMore: false,
    })

    const wrapper = await mountChat()

    expect(mocks.listTripMessages).toHaveBeenCalledWith('7', 'trip_guest')
    expect(wrapper.find('[data-test="chat-messages"]').text()).toContain('Привет')
    expect(wrapper.find('[data-test="chat-messages"]').text()).toContain('Взял горелку')
  })

  it('пустой чат приглашает написать', async () => {
    const wrapper = await mountChat()

    expect(wrapper.find('[data-test="chat-empty"]').exists()).toBe(true)
  })

  it('отправляет сообщение в тот же чат и показывает его', async () => {
    mocks.sendTripMessage.mockResolvedValue(message({ id: '9', senderName: 'Я', body: 'Буду к восьми' }))

    const wrapper = await mountChat()

    await wrapper.find('[data-test="chat-input"]').setValue('Буду к восьми')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.sendTripMessage).toHaveBeenCalledWith('7', 'trip_guest', 'Буду к восьми')
    expect(wrapper.find('[data-test="chat-messages"]').text()).toContain('Буду к восьми')
    expect((wrapper.find('[data-test="chat-input"]').element as HTMLInputElement).value).toBe('')
  })
})
