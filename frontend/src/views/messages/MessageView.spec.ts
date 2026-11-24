import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { ApiError } from '@/api/errors'
import { useConversationsStore } from '@/stores/conversations'
import type { Conversation } from '@/types/conversations'
import type { TripMessage } from '@/types/trips'
import MessageView from '@/views/messages/MessageView.vue'

/**
 * Экран диалога `/messages/:id` (23.11.2026; живое сообщение — 24.11.2026).
 *
 * Проверяем то, ради чего он заведён: шапку (собеседник или чат с походом),
 * переписку, «Прочитано» на последнем своём сообщении, галочку «Уведомлять»
 * и историю вверх по курсору `before`. С 24.11.2026 — ещё и то, что чужое
 * сообщение из событий дописывается в открытую переписку.
 *
 * Стор авторизации подменён: экрану нужен только мой id, чтобы отличить
 * свои сообщения от чужих. Pinia при этом настоящая — экран слушает стор
 * ленты (`stores/conversations.ts`), а он без неё не заводится.
 */
const mocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  listConversationMessages: vi.fn(),
  markConversationRead: vi.fn(),
  sendConversationMessage: vi.fn(),
  setConversationMuted: vi.fn(),
}))

vi.mock('@/api/conversations', () => ({
  getConversation: mocks.getConversation,
  listConversationMessages: mocks.listConversationMessages,
  markConversationRead: mocks.markConversationRead,
  sendConversationMessage: mocks.sendConversationMessage,
  setConversationMuted: mocks.setConversationMuted,
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: { id: 'me' } }),
}))

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: '7',
    kind: 'direct',
    tripId: null,
    title: 'Анна',
    tripTitle: null,
    peer: { id: 'peer', displayName: 'Анна', avatarUrl: null },
    lastMessage: null,
    unreadCount: 0,
    muted: false,
    peerLastReadAt: null,
    ...overrides,
  }
}

function message(overrides: Partial<TripMessage> = {}): TripMessage {
  return {
    id: '1',
    senderId: 'peer',
    senderName: 'Анна',
    senderAvatarUrl: null,
    body: 'Привет',
    isSystem: false,
    createdAt: '2026-11-23T09:00:00.000Z',
    action: null,
    ...overrides,
  }
}

async function openScreen(path = '/messages/7') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/messages/:id', name: 'messages', component: MessageView },
      { path: '/trips/:id', name: 'trip', component: { template: '<div />' } },
      { path: '/', name: 'home', component: { template: '<div />' } },
    ],
  })

  await router.push(path)
  await router.isReady()

  const pinia = createPinia()
  setActivePinia(pinia)

  const wrapper = mount(MessageView, { global: { plugins: [router, pinia] } })
  await flushPromises()

  return { wrapper, router }
}

describe('MessageView', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  beforeEach(() => {
    mocks.getConversation.mockResolvedValue(conversation())
    mocks.listConversationMessages.mockResolvedValue({
      messages: [message()],
      hasMore: false,
    })
    mocks.markConversationRead.mockResolvedValue(undefined)
    mocks.sendConversationMessage.mockResolvedValue(
      message({ id: '9', senderId: 'me', senderName: 'Я', body: 'Буду к восьми' }),
    )
    mocks.setConversationMuted.mockResolvedValue(undefined)
  })

  it('шапка личного диалога — имя собеседника, переписка на месте', async () => {
    const { wrapper } = await openScreen()

    expect(mocks.getConversation).toHaveBeenCalledWith('7')
    expect(wrapper.find('[data-test="message-title"]').text()).toBe('Анна')
    expect(wrapper.find('[data-test="message-trip"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="message-list"]').text()).toContain('Привет')
  })

  it('прочтение отмечается при открытии экрана', async () => {
    await openScreen()

    expect(mocks.markConversationRead).toHaveBeenCalledWith('7')
  })

  it('чат похода подписан походом со ссылкой на него', async () => {
    mocks.getConversation.mockResolvedValue(
      conversation({
        kind: 'trip_finance',
        tripId: '3',
        tripTitle: 'Витязь',
        peer: null,
        title: 'Чат бухгалтерии',
      }),
    )

    const { wrapper } = await openScreen()

    expect(wrapper.find('[data-test="message-title"]').text()).toBe('Чат бухгалтерии')
    expect(wrapper.find('[data-test="message-trip"]').text()).toBe('Витязь')
    expect(wrapper.find('[data-test="message-trip"]').attributes('href')).toBe(
      '/trips/3?tab=finance',
    )
  })

  it('«Прочитано» стоит на последнем своём сообщении, если собеседник прочитал', async () => {
    mocks.listConversationMessages.mockResolvedValue({
      messages: [
        message({ id: '1', senderId: 'me', body: 'Привет', createdAt: '2026-11-23T09:00:00.000Z' }),
        message({ id: '2', senderId: 'me', body: 'Ты тут?', createdAt: '2026-11-23T09:05:00.000Z' }),
      ],
      hasMore: false,
    })
    mocks.getConversation.mockResolvedValue(
      conversation({ peerLastReadAt: '2026-11-23T09:10:00.000Z' }),
    )

    const { wrapper } = await openScreen()

    // Метка одна на диалог, поэтому рисуется только на последнем — «до этого
    // места прочитано»; на первом её нет.
    expect(wrapper.findAll('[data-test="message-read"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="message-2"]').text()).toContain('Прочитано')
    expect(wrapper.find('[data-test="message-1"]').text()).not.toContain('Прочитано')
  })

  it('без метки собеседника «Прочитано» не рисуется', async () => {
    mocks.listConversationMessages.mockResolvedValue({
      messages: [message({ id: '1', senderId: 'me', body: 'Привет' })],
      hasMore: false,
    })

    const { wrapper } = await openScreen()

    expect(wrapper.find('[data-test="message-read"]').exists()).toBe(false)
  })

  it('история вверх листается по курсору before', async () => {
    mocks.listConversationMessages.mockResolvedValueOnce({
      messages: [message({ id: '50', senderId: 'me', body: 'Свежее' })],
      hasMore: true,
    })

    const { wrapper } = await openScreen()

    expect(wrapper.find('[data-test="message-more"]').exists()).toBe(true)

    mocks.listConversationMessages.mockResolvedValueOnce({
      messages: [message({ id: '49', senderId: 'peer', body: 'Старое' })],
      hasMore: false,
    })

    await wrapper.find('[data-test="message-more"]').trigger('click')
    await flushPromises()

    expect(mocks.listConversationMessages).toHaveBeenLastCalledWith('7', {
      before: '50',
      limit: 50,
    })
    expect(wrapper.find('[data-test="message-list"]').text()).toContain('Старое')
    // Первая страница осталась на месте: история добавляется сверху.
    expect(wrapper.find('[data-test="message-list"]').text()).toContain('Свежее')
    expect(wrapper.find('[data-test="message-more"]').exists()).toBe(false)
  })

  it('отправляет сообщение и показывает его', async () => {
    const { wrapper } = await openScreen()

    await wrapper.find('[data-test="message-input"]').setValue('Буду к восьми')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.sendConversationMessage).toHaveBeenCalledWith('7', 'Буду к восьми')
    expect(wrapper.find('[data-test="message-list"]').text()).toContain('Буду к восьми')
    expect(
      (wrapper.find('[data-test="message-input"]').element as HTMLTextAreaElement).value,
    ).toBe('')
  })

  it('галочка «Уведомлять» глушит уведомления по диалогу', async () => {
    const { wrapper } = await openScreen()

    const input = wrapper.find('[data-test="message-mute"]')
    expect((input.element as HTMLInputElement).checked).toBe(true)

    await input.setValue(false)
    await flushPromises()

    expect(mocks.setConversationMuted).toHaveBeenCalledWith('7', true)
  })

  it('заглушённый диалог открывается со снятой галочкой', async () => {
    mocks.getConversation.mockResolvedValue(conversation({ muted: true }))

    const { wrapper } = await openScreen()

    expect(
      (wrapper.find('[data-test="message-mute"]').element as HTMLInputElement).checked,
    ).toBe(false)
  })

  it('чужой диалог объясняется словами, а не пустой страницей', async () => {
    mocks.getConversation.mockRejectedValue(new ApiError(403, 'Это не твой диалог', null))

    const { wrapper } = await openScreen()

    expect(wrapper.find('[data-test="message-error"]').text()).toContain(
      'Диалог не найден или недоступен',
    )
    expect(mocks.listConversationMessages).not.toHaveBeenCalled()
  })

  /**
   * Живое сообщение (24.11.2026): экран не перечитывает историю, а берёт
   * готовую строку из события — стор уже дотянул её одним
   * `GET /conversations/:id`.
   */
  it('дописывает чужое сообщение из события, не перечитывая историю', async () => {
    const { wrapper } = await openScreen()

    // Строка ленты уже есть, а в ней — пришедшее сообщение.
    const fresh = message({ id: '2', body: 'Я на связи', createdAt: '2026-11-24T09:10:00.000Z' })
    mocks.getConversation.mockResolvedValue(
      conversation({ lastMessage: fresh, unreadCount: 1 }),
    )

    const feed = useConversationsStore()
    feed.rows = [conversation({ id: '7', unreadCount: 0 })]

    await feed.applyEvent({
      conversationId: '7',
      kind: 'message',
      actorId: 'peer',
      at: '2026-11-24T09:10:00.000Z',
    })
    await flushPromises()

    expect(wrapper.find('[data-test="message-list"]').text()).toContain('Я на связи')
    // История не перечитывалась: первая страница запрошена один раз при
    // открытии экрана, а не на каждое сообщение.
    expect(mocks.listConversationMessages).toHaveBeenCalledTimes(1)
    // Открытый диалог прочитан сразу — повторная отметка отправлена.
    expect(mocks.markConversationRead).toHaveBeenCalledTimes(2)
    expect(feed.rows[0]?.unreadCount).toBe(0)
  })

  it('отметка прочтения собеседника из события рисует «Прочитано»', async () => {
    mocks.listConversationMessages.mockResolvedValue({
      messages: [message({ id: '5', senderId: 'me', body: 'Ты тут?' })],
      hasMore: false,
    })

    const { wrapper } = await openScreen()

    expect(wrapper.find('[data-test="message-read"]').exists()).toBe(false)

    const feed = useConversationsStore()
    feed.rows = [conversation({ id: '7', peerLastReadAt: null, lastMessage: null })]

    await feed.applyEvent({
      conversationId: '7',
      kind: 'read',
      actorId: 'peer',
      at: '2026-11-24T09:30:00.000Z',
    })
    await flushPromises()

    expect(wrapper.find('[data-test="message-read"]').text()).toBe('Прочитано')
  })
})
