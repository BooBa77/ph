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

function mountRail() {
  return mount(RightRail, { attachTo: document.body })
}

beforeEach(() => {
  vi.clearAllMocks()
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
    // Разделитель тысяч в ru-RU — неразрывный пробел, поэтому \u00A0.
    expect(rows[0].text()).toContain('Перевод 1\u00A0200 ₽')

    await rows[0].find('button').trigger('click')
    await flushPromises()

    const confirm = wrapper.find('[data-test="rail-confirm"]')
    expect(confirm.exists()).toBe(true)

    await confirm.trigger('click')
    await flushPromises()

    expect(actions.respondToAction).toHaveBeenCalledWith('77', 'confirmed')

    wrapper.unmount()
  })

  it('раскрывает не больше трёх последних сообщений и укладывается в 300 символов', async () => {
    api.listConversations.mockResolvedValue({ conversations: [conversation()] })
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
    api.listConversations.mockResolvedValue({ conversations: [conversation()] })

    const wrapper = mountRail()
    await flushPromises()

    await wrapper.find('[data-test^="rail-row-"] button').trigger('click')
    await flushPromises()

    await wrapper.find('[data-test="rail-hide"]').trigger('click')
    await flushPromises()

    expect(api.setConversationMuted).toHaveBeenCalledWith('1', true)
    expect(wrapper.findAll('[data-test^="rail-row-"]')).toHaveLength(0)

    await wrapper.find('[data-test="rail-muted-toggle"]').trigger('click')
    await wrapper.find('[data-test="rail-restore"]').trigger('click')
    await flushPromises()

    expect(api.setConversationMuted).toHaveBeenCalledWith('1', false)
    expect(wrapper.findAll('[data-test^="rail-row-"]')).toHaveLength(1)

    wrapper.unmount()
  })
})
