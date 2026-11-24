import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RightRail from '@/components/layout/RightRail.vue'
import type { Conversation } from '@/types/conversations'

const { push, api, actions } = vi.hoisted(() => ({
  push: vi.fn(),
  api: {
    listConversations: vi.fn(),
    listConversationMessages: vi.fn(),
    markConversationRead: vi.fn(),
    sendConversationMessage: vi.fn(),
    setConversationMuted: vi.fn(),
  },
  actions: { respondToAction: vi.fn() },
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

vi.mock('@/api/conversations', () => api)
vi.mock('@/api/message-actions', () => actions)

function message(id: string, body: string, createdAt = '2026-11-23T09:00:00.000Z') {
  return {
    id,
    senderId: 'peer',
    senderName: 'Анна',
    senderAvatarUrl: null,
    body,
    isSystem: false,
    createdAt,
    action: null,
  }
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: '1',
    kind: 'direct',
    tripId: null,
    title: 'Анна',
    tripTitle: null,
    peer: { id: 'peer', displayName: 'Анна', avatarUrl: null },
    lastMessage: message('10', 'Привет'),
    unreadCount: 1,
    muted: false,
    peerLastReadAt: null,
    ...overrides,
  }
}

/**
 * Чат похода: раскрывается в колонке.
 *
 * Личные диалоги с 23.11.2026 открываются экраном `/messages/:id`, поэтому
 * быстрый чат проверяется на походном — там он и остался.
 */
function tripConversation(overrides: Partial<Conversation> = {}): Conversation {
  return conversation({
    id: '5',
    kind: 'trip_finance',
    tripId: '3',
    title: 'Чат бухгалтерии',
    tripTitle: 'Витязь',
    peer: null,
    ...overrides,
  })
}

function mountRail() {
  return mount(RightRail, { attachTo: document.body })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Лента живёт в сторе (23.11.2026): его же держит мобильная панель.
  setActivePinia(createPinia())
  api.listConversations.mockResolvedValue({ conversations: [] })
  api.listConversationMessages.mockResolvedValue({ messages: [], hasMore: false })
  api.markConversationRead.mockResolvedValue(undefined)
  api.setConversationMuted.mockResolvedValue(undefined)
})

describe('RightRail', () => {
  it('ставит денежное действие выше свежего сообщения', async () => {
    api.listConversations.mockResolvedValue({
      conversations: [
        conversation({
          id: '2',
          peer: { id: 'other', displayName: 'Борис', avatarUrl: null },
          lastMessage: message('20', 'Свежее сообщение', '2026-11-23T10:00:00.000Z'),
        }),
        conversation({
          id: '3',
          lastMessage: {
            ...message('30', 'Тебе перевели 1200 ₽', '2026-11-20T10:00:00.000Z'),
            action: {
              id: '77',
              kind: 'money_received',
              targetUserId: 'me',
              state: 'pending',
              payload: { amountRub: 1200 },
              canRespond: true,
              canRecheck: false,
              createdAt: '2026-11-20T10:00:00.000Z',
              respondedAt: null,
            },
          },
        }),
      ],
    })

    const wrapper = mountRail()
    await flushPromises()

    const rows = wrapper.findAll('[data-test^="rail-row-"]')
    expect(rows).toHaveLength(2)

    const [urgent] = rows
    // Разделитель тысяч в ru-RU — неразрывный пробел, поэтому \u00A0.
    expect(urgent?.text()).toContain('Перевод 1\u00A0200 ₽')

    await urgent?.find('button').trigger('click')
    await flushPromises()

    const confirm = wrapper.find('[data-test="rail-confirm"]')
    expect(confirm.exists()).toBe(true)
    // Кнопки «Не получено» больше нет: единственный ответ — подтверждение.
    expect(wrapper.find('[data-test="rail-dispute"]').exists()).toBe(false)

    await confirm.trigger('click')
    await flushPromises()

    expect(actions.respondToAction).toHaveBeenCalledWith('77', '')

    wrapper.unmount()
  })

  it('отправляет ответ вместе с «сообщением отправителю»', async () => {
    api.listConversations.mockResolvedValue({
      conversations: [
        conversation({
          id: '3',
          lastMessage: {
            ...message('30', 'Анна перевела тебе 1000 ₽', '2026-11-20T10:00:00.000Z'),
            action: {
              id: '79',
              kind: 'money_received',
              targetUserId: 'me',
              state: 'pending',
              payload: { amountRub: 1000 },
              canRespond: true,
              canRecheck: false,
              createdAt: '2026-11-20T10:00:00.000Z',
              respondedAt: null,
            },
          },
        }),
      ],
    })

    const wrapper = mountRail()
    await flushPromises()

    await wrapper.find('[data-test^="rail-row-"] button').trigger('click')
    await flushPromises()

    const reply = wrapper.find('[data-test="rail-reply-input"]')
    expect(reply.exists()).toBe(true)
    expect(reply.attributes('placeholder')).toBe('Сообщение отправителю:')

    await reply.setValue('Получил, спасибо!')
    await wrapper.find('[data-test="rail-confirm"]').trigger('click')
    await flushPromises()

    expect(actions.respondToAction).toHaveBeenCalledWith('79', 'Получил, спасибо!')

    wrapper.unmount()
  })

  /**
   * Поле обратной связи без подтверждения (24.11.2026).
   *
   * Заказчик снял «Не получено»: если денег ещё нет, человеку достаточно
   * написать отправителю. Это обычное сообщение — таймер автосогласия
   * продолжает идти, и через 72 часа перевод засчитывается сам.
   */
  it('отправляет сообщение отправителю без подтверждения перевода', async () => {
    api.listConversations.mockResolvedValue({
      conversations: [
        conversation({
          id: '6',
          lastMessage: {
            ...message('60', 'Анна перевела тебе 1000 ₽'),
            action: {
              id: '80',
              kind: 'money_received',
              targetUserId: 'me',
              state: 'pending',
              payload: { amountRub: 1000 },
              canRespond: true,
              canRecheck: false,
              createdAt: '2026-11-20T10:00:00.000Z',
              respondedAt: null,
            },
          },
        }),
      ],
    })
    api.sendConversationMessage.mockResolvedValue(message('61', 'Деньги ещё не пришли'))

    const wrapper = mountRail()
    await flushPromises()

    await wrapper.find('[data-test^="rail-row-"] button').trigger('click')
    await flushPromises()

    const send = wrapper.find('[data-test="rail-reply-send"]')
    expect(send.exists()).toBe(true)
    // Пока поле пустое, отправлять нечего.
    expect(send.attributes('disabled')).toBeDefined()

    await wrapper.find('[data-test="rail-reply-input"]').setValue('Деньги ещё не пришли')
    await send.trigger('click')
    await flushPromises()

    expect(api.sendConversationMessage).toHaveBeenCalledWith('6', 'Деньги ещё не пришли')
    // Перевод не подтверждён: ответ на действие не отправлялся.
    expect(actions.respondToAction).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('у просьбы о платеже — кнопка «Перейти» в бухгалтерию похода', async () => {
    api.listConversations.mockResolvedValue({
      conversations: [
        conversation({
          id: '4',
          lastMessage: {
            ...message('40', 'Организатор запросил платёж по походу «Витязь».'),
            action: {
              id: '88',
              kind: 'payment_request',
              targetUserId: 'me',
              state: 'pending',
              payload: { tripId: '3', tripTitle: 'Витязь' },
              canRespond: false,
              canRecheck: false,
              createdAt: '2026-11-24T09:00:00.000Z',
              respondedAt: null,
            },
          },
        }),
      ],
    })

    const wrapper = mountRail()
    await flushPromises()

    // Просьба раскрывается на месте, а не уводит на экран диалога.
    await wrapper.find('[data-test^="rail-row-"] button').trigger('click')
    await flushPromises()

    expect(push).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="rail-confirm"]').exists()).toBe(false)

    await wrapper.find('[data-test="rail-go-finance"]').trigger('click')
    await flushPromises()

    expect(push).toHaveBeenCalledWith({ path: '/trips/3', query: { tab: 'finance' } })

    wrapper.unmount()
  })

  it('раскрывает не больше трёх последних сообщений и укладывается в 300 символов', async () => {
    api.listConversations.mockResolvedValue({ conversations: [tripConversation()] })
    api.listConversationMessages.mockResolvedValue({
      messages: [
        message('1', 'а'.repeat(150)),
        message('2', 'б'.repeat(150)),
        message('3', 'в'.repeat(150)),
      ],
      hasMore: false,
    })

    const wrapper = mountRail()
    await flushPromises()

    await wrapper.find('[data-test^="rail-row-"] button').trigger('click')
    await flushPromises()

    const items = wrapper.findAll('[data-test^="rail-messages-"] li')
    expect(items).toHaveLength(2)
    expect(wrapper.text()).toContain('в'.repeat(10))
    expect(wrapper.text()).not.toContain('а'.repeat(10))

    expect(wrapper.find('[data-test="rail-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="rail-hide"]').exists()).toBe(true)

    wrapper.unmount()
  })

  it('скрывает чат из ленты и возвращает его из «Скрытых»', async () => {
    api.listConversations.mockResolvedValue({ conversations: [tripConversation()] })

    const wrapper = mountRail()
    await flushPromises()

    await wrapper.find('[data-test^="rail-row-"] button').trigger('click')
    await flushPromises()

    await wrapper.find('[data-test="rail-hide"]').trigger('click')
    await flushPromises()

    expect(api.setConversationMuted).toHaveBeenCalledWith('5', true)
    expect(wrapper.findAll('[data-test^="rail-row-"]')).toHaveLength(0)

    await wrapper.find('[data-test="rail-muted-toggle"]').trigger('click')
    await wrapper.find('[data-test="rail-restore"]').trigger('click')
    await flushPromises()

    expect(api.setConversationMuted).toHaveBeenCalledWith('5', false)
    expect(wrapper.findAll('[data-test^="rail-row-"]')).toHaveLength(1)

    wrapper.unmount()
  })

  it('клик по личному диалогу ведёт на экран /messages/:id', async () => {
    api.listConversations.mockResolvedValue({ conversations: [conversation()] })

    const wrapper = mountRail()
    await flushPromises()

    await wrapper.find('[data-test^="rail-row-"] button').trigger('click')
    await flushPromises()

    expect(push).toHaveBeenCalledWith('/messages/1')
    // Раскрытия нет: быстрый чат остался у чатов похода.
    expect(wrapper.find('[data-test="rail-input"]').exists()).toBe(false)
    expect(api.listConversationMessages).not.toHaveBeenCalled()

    wrapper.unmount()
  })
})
