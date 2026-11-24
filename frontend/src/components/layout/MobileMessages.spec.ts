import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MobileMessages from '@/components/layout/MobileMessages.vue'
import { useConversationsStore } from '@/stores/conversations'
import type { Conversation } from '@/types/conversations'

const { push, api, actions } = vi.hoisted(() => ({
  push: vi.fn(),
  api: {
    listConversations: vi.fn(),
    getConversation: vi.fn(),
    markConversationRead: vi.fn(),
    sendConversationMessage: vi.fn(),
  },
  actions: { respondToAction: vi.fn() },
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ name: 'home', fullPath: '/' }),
}))

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

/** Денежная строка: ждёт ответа «получил / не получил». */
function moneyConversation(overrides: Partial<Conversation> = {}): Conversation {
  return conversation({
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
    ...overrides,
  })
}

/**
 * Чат похода: ведёт на вкладку похода, а не на экран диалога.
 *
 * Так же, как «Открыть чат» в колонке: таблица `utils/chatTabs.ts` общая.
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

function mountPanel() {
  return mount(MobileMessages, { attachTo: document.body })
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  api.listConversations.mockResolvedValue({ conversations: [] })
  api.markConversationRead.mockResolvedValue(undefined)
  actions.respondToAction.mockResolvedValue(undefined)
})

describe('MobileMessages', () => {
  it('показывает счётчик непрочитанного на свёрнутой кнопке', async () => {
    api.listConversations.mockResolvedValue({
      conversations: [
        conversation({ id: '1', unreadCount: 2 }),
        // Заглушенный чат в счётчик не идёт: человек сам его погасил.
        conversation({ id: '2', unreadCount: 5, muted: true }),
      ],
    })

    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.find('[data-test="mobile-messages-badge"]').text()).toBe('2')

    wrapper.unmount()
  })

  it('разворачивается в ленту без заглушенных чатов', async () => {
    api.listConversations.mockResolvedValue({
      conversations: [
        conversation({ id: '1' }),
        conversation({ id: '2', unreadCount: 5, muted: true }),
      ],
    })

    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.find('[data-test="mobile-messages-button"]').trigger('click')

    expect(wrapper.find('[data-test="mobile-messages-panel"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-test^="mobile-messages-row-"]')).toHaveLength(1)

    wrapper.unmount()
  })

  it('ведёт личный диалог на /messages/:id и снимает непрочитанное', async () => {
    api.listConversations.mockResolvedValue({ conversations: [conversation()] })

    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.find('[data-test="mobile-messages-button"]').trigger('click')
    await wrapper.find('[data-test="mobile-messages-row-1"]').trigger('click')
    await flushPromises()

    expect(api.markConversationRead).toHaveBeenCalledWith('1')
    expect(push).toHaveBeenCalledWith('/messages/1')
    // Переход закрывает панель: поверх новой страницы ей не место.
    expect(wrapper.find('[data-test="mobile-messages-panel"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('ведёт чат похода на его вкладку', async () => {
    api.listConversations.mockResolvedValue({ conversations: [tripConversation()] })

    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.find('[data-test="mobile-messages-button"]').trigger('click')
    await wrapper.find('[data-test="mobile-messages-row-5"]').trigger('click')
    await flushPromises()

    expect(push).toHaveBeenCalledWith({ path: '/trips/3', query: { tab: 'finance' } })

    wrapper.unmount()
  })

  it('раскрывает денежное действие и отвечает на него', async () => {
    api.listConversations.mockResolvedValue({ conversations: [moneyConversation()] })

    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.find('[data-test="mobile-messages-button"]').trigger('click')

    const row = wrapper.find('[data-test="mobile-messages-row-3"]')
    expect(row.text()).toContain('Перевод 1\u00A0200 ₽')

    await row.trigger('click')
    await flushPromises()

    // Ушли не на экран диалога: отвечать там нечем.
    expect(push).not.toHaveBeenCalled()

    // «Сообщение отправителю» есть и на мобиле (24.11.2026).
    const reply = wrapper.find('[data-test="mobile-messages-reply-input"]')
    expect(reply.attributes('placeholder')).toBe('Сообщение отправителю:')
    await reply.setValue('Получил')

    // «Не получено» убрано: ответ на перевод один (24.11.2026).
    expect(wrapper.find('[data-test="mobile-messages-dispute"]').exists()).toBe(false)
    // Поле обратной связи отправляется и без подтверждения.
    expect(wrapper.find('[data-test="mobile-messages-reply-send"]').exists()).toBe(true)

    await wrapper.find('[data-test="mobile-messages-confirm"]').trigger('click')
    await flushPromises()

    expect(actions.respondToAction).toHaveBeenCalledWith('77', 'Получил')

    wrapper.unmount()
  })

  /**
   * Приоритет действия — серверный (24.11.2026): просьба о платеже после
   * перевода не должна отбирать у строки «Подтверждаю».
   */
  it('не отдаёт строку просьбе о платеже, пока перевод ждёт ответа', async () => {
    api.listConversations.mockResolvedValue({
      conversations: [
        conversation({
          id: '7',
          action: {
            id: '71',
            kind: 'money_received',
            targetUserId: 'me',
            state: 'pending',
            payload: { amountRub: 1000 },
            canRespond: true,
            canRecheck: false,
            createdAt: '2026-11-20T10:00:00.000Z',
            respondedAt: null,
          },
          lastMessage: {
            ...message('70', 'Организатор запросил платёж по походу «Витязь».'),
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

    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.find('[data-test="mobile-messages-button"]').trigger('click')

    const row = wrapper.find('[data-test="mobile-messages-row-7"]')
    expect(row.text()).toContain('Перевод 1\u00A0000 ₽')

    await row.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="mobile-messages-confirm"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="mobile-messages-go-finance"]').exists()).toBe(false)

    await wrapper.find('[data-test="mobile-messages-confirm"]').trigger('click')
    await flushPromises()

    expect(actions.respondToAction).toHaveBeenCalledWith('71', '')

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

    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.find('[data-test="mobile-messages-button"]').trigger('click')
    await wrapper.find('[data-test="mobile-messages-row-4"]').trigger('click')
    await flushPromises()

    expect(push).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="mobile-messages-confirm"]').exists()).toBe(false)

    await wrapper.find('[data-test="mobile-messages-go-finance"]').trigger('click')
    await flushPromises()

    expect(push).toHaveBeenCalledWith({ path: '/trips/3', query: { tab: 'finance' } })

    wrapper.unmount()
  })

  /**
   * Переписанный текст (24.11.2026): автосогласие через 72 часа меняет тело
   * уведомления. Подпись строки берётся из `lastMessage`, поэтому панель
   * показывает новый текст после того, как стор перечитал строку, и счётчик
   * непрочитанного от этого не растёт.
   */
  it('показывает новый текст сообщения, не наращивая непрочитанное', async () => {
    // Личный диалог: у чата похода подпись — название вкладки, а не текст
    // сообщения, поэтому переписанное уведомление проверяем на личном.
    api.listConversations.mockResolvedValue({
      conversations: [
        conversation({
          id: '1',
          unreadCount: 0,
          lastMessage: message('10', 'Анна перевела тебе 1000 ₽'),
        }),
      ],
    })

    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.find('[data-test="mobile-messages-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="mobile-messages-row-1"]').text()).toContain(
      'Анна перевела тебе 1000 ₽',
    )

    api.getConversation.mockResolvedValue(
      conversation({
        id: '1',
        unreadCount: 0,
        lastMessage: message('10', 'Время ожидания подтверждения вышло'),
      }),
    )

    const feed = useConversationsStore()
    await feed.applyEvent({
      conversationId: '1',
      kind: 'message_updated',
      actorId: '',
      at: '2026-11-24T09:30:00.000Z',
      messageId: '10',
      body: 'Время ожидания подтверждения вышло',
    })
    await flushPromises()

    expect(wrapper.find('[data-test="mobile-messages-row-1"]').text()).toContain(
      'Время ожидания подтверждения вышло',
    )
    expect(feed.rows[0]?.unreadCount).toBe(0)
    expect(wrapper.find('[data-test="mobile-messages-badge"]').exists()).toBe(false)

    wrapper.unmount()
  })
})
