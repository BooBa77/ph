import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useConversationsStore } from '@/stores/conversations'
import type { TripChat as ChatInfo, TripMessage } from '@/types/trips'
import TripChat from '@/views/trips/TripChat.vue'

/**
 * Чат похода: гостевой на «Гостевой», членский на «Участниках».
 *
 * Проверяем то, ради чего он здесь: сообщения приходят с бэкенда,
 * отправка уходит в API с видом чата, пустой чат приглашает написать.
 * Отдельной вкладки «Чаты» нет — это и есть её замена.
 *
 * Плюс галочка «Уведомлять об этом чате» (23.11.2026): состояние приходит
 * в `GET /trips/:id/chats`, переключение идёт в `POST/DELETE
 * /conversations/:id/mute`, а гостю публичного похода галочки нет.
 */
const mocks = vi.hoisted(() => ({
  listTripMessages: vi.fn(),
  sendTripMessage: vi.fn(),
  listTripChats: vi.fn(),
  setConversationMuted: vi.fn(),
  editTripMessage: vi.fn(),
  deleteTripMessage: vi.fn(),
  listConversations: vi.fn(),
}))

vi.mock('@/api/trips', () => ({
  listTripMessages: mocks.listTripMessages,
  sendTripMessage: mocks.sendTripMessage,
  listTripChats: mocks.listTripChats,
  editTripMessage: mocks.editTripMessage,
  deleteTripMessage: mocks.deleteTripMessage,
}))

vi.mock('@/api/conversations', () => ({
  setConversationMuted: mocks.setConversationMuted,
  listConversations: mocks.listConversations,
}))

/** Мой id: по нему чат отличает свои сообщения от чужих (25.11.2026). */
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: { id: 'u-1' } }),
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

function chat(overrides: Partial<ChatInfo> = {}): ChatInfo {
  return {
    id: '44',
    kind: 'trip_guest',
    title: 'Гостевой чат',
    canWrite: true,
    lastMessage: null,
    muted: false,
    ...overrides,
  }
}

async function mountChat() {
  // С 24.11.2026 чат слушает события переписки через стор ленты: ему нужна
  // Pinia, даже если поток открыт колонкой, а не здесь.
  const pinia = createPinia()
  setActivePinia(pinia)

  const wrapper = mount(TripChat, {
    props: { tripId: '7', kind: 'trip_guest' },
    global: { plugins: [pinia] },
  })
  await flushPromises()

  return wrapper
}

describe('TripChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listTripMessages.mockResolvedValue({ messages: [], hasMore: false })
    mocks.listTripChats.mockResolvedValue([])
    mocks.setConversationMuted.mockResolvedValue(undefined)
    mocks.editTripMessage.mockResolvedValue(message({ body: 'Исправлено' }))
    mocks.deleteTripMessage.mockResolvedValue(undefined)
    mocks.listConversations.mockResolvedValue({ conversations: [] })
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

    const editor = wrapper.find('[data-test="md-editor"]')
    editor.element.innerHTML = 'Буду к восьми'
    await editor.trigger('input')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.sendTripMessage).toHaveBeenCalledWith('7', 'trip_guest', 'Буду к восьми')
    expect(wrapper.find('[data-test="chat-messages"]').text()).toContain('Буду к восьми')
    expect(wrapper.find('[data-test="md-editor"]').element.innerHTML).toBe('')
  })

  it('галочка «Уведомлять» стоит по состоянию из списка чатов', async () => {
    mocks.listTripChats.mockResolvedValue([chat({ muted: true })])

    const wrapper = await mountChat()

    const input = wrapper.find('[data-test="chat-mute"]')
    expect(input.exists()).toBe(true)
    expect(wrapper.text()).toContain('Уведомлять об этом чате')
    expect((input.element as HTMLInputElement).checked).toBe(false)
  })

  it('снятие галочки глушит уведомления по этому чату', async () => {
    mocks.listTripChats.mockResolvedValue([chat()])

    const wrapper = await mountChat()

    const input = wrapper.find('[data-test="chat-mute"]')
    expect((input.element as HTMLInputElement).checked).toBe(true)

    await input.setValue(false)
    await flushPromises()

    expect(mocks.setConversationMuted).toHaveBeenCalledWith('44', true)
    expect((wrapper.find('[data-test="chat-mute"]').element as HTMLInputElement).checked).toBe(
      false,
    )
  })

  it('гостю публичного похода галочки нет — глушить нечего', async () => {
    mocks.listTripChats.mockResolvedValue([chat({ muted: null })])

    const wrapper = await mountChat()

    expect(wrapper.find('[data-test="chat-mute"]').exists()).toBe(false)
  })

  /**
   * Переписанный текст (24.11.2026): событие `message_updated` меняет тело
   * уже показанного сообщения, а не дописывает второе. Диалог узнаётся по
   * id из `GET /trips/:id/chats` — в адресе экрана его нет.
   */
  it('заменяет текст сообщения из события переписки', async () => {
    mocks.listTripMessages.mockResolvedValue({
      messages: [message({ id: '1', body: 'Старый текст' })],
      hasMore: false,
    })
    mocks.listTripChats.mockResolvedValue([chat()])

    const wrapper = await mountChat()

    expect(wrapper.find('[data-test="chat-messages"]').text()).toContain('Старый текст')

    const feed = useConversationsStore()
    await feed.applyEvent({
      conversationId: '44',
      kind: 'message_updated',
      actorId: '',
      at: '2026-11-24T09:30:00.000Z',
      messageId: '1',
      body: 'Новый текст',
    })
    await flushPromises()

    const items = wrapper.findAll('[data-test="chat-messages"] li')
    expect(items).toHaveLength(1)
    expect(items[0]?.text()).toContain('Новый текст')
    expect(items[0]?.text()).not.toContain('Старый текст')
  })

  /**
   * Правка и удаление своего сообщения в чате похода (25.11.2026).
   *
   * Чужие и системные строки не трогаются, денежные — тоже. Адрес ручки —
   * пара «поход + вид чата»: у чата похода нет своего id в адресе экрана,
   * а гость публичного похода не состоит в диалоге по составу.
   */
  it('своё сообщение правится через ручку чата похода', async () => {
    mocks.listTripMessages.mockResolvedValue({
      messages: [message({ id: '1', body: 'Опечатка' })],
      hasMore: false,
    })
    mocks.listTripChats.mockResolvedValue([chat()])
    mocks.editTripMessage.mockResolvedValue(message({ id: '1', body: 'Исправлено' }))

    const wrapper = await mountChat()

    await wrapper
      .find('[data-test="chat-message-1"] [data-test="chat-edit"]')
      .trigger('click')
    await flushPromises()

    const input = wrapper.find('[data-test="chat-edit-input"]')
    expect((input.element as HTMLTextAreaElement).value).toBe('Опечатка')

    await input.setValue('  Исправлено  ')
    await wrapper.find('[data-test="chat-edit-save"]').trigger('click')
    await flushPromises()

    expect(mocks.editTripMessage).toHaveBeenCalledWith(
      '7',
      'trip_guest',
      '1',
      'Исправлено',
    )
    expect(wrapper.find('[data-test="chat-message-1"]').text()).toContain('Исправлено')
    expect(wrapper.find('[data-test="chat-edit-input"]').exists()).toBe(false)
  })

  it('у чужого сообщения нет «Изменить» и «Удалить»', async () => {
    mocks.listTripMessages.mockResolvedValue({
      messages: [message({ id: '2', senderId: 'u-2', senderName: 'Ваня' })],
      hasMore: false,
    })

    const wrapper = await mountChat()

    expect(wrapper.find('[data-test="chat-edit"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="chat-delete"]').exists()).toBe(false)
  })

  it('удаление спрашивает подтверждение и убирает строку', async () => {
    mocks.listTripMessages.mockResolvedValue({
      messages: [message({ id: '3', body: 'Уберу' })],
      hasMore: false,
    })

    const wrapper = await mountChat()

    await wrapper
      .find('[data-test="chat-message-3"] [data-test="chat-delete"]')
      .trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="chat-delete-confirm"]').exists()).toBe(true)
    expect(mocks.deleteTripMessage).not.toHaveBeenCalled()

    await wrapper.find('[data-test="chat-delete-confirm"]').trigger('click')
    await flushPromises()

    expect(mocks.deleteTripMessage).toHaveBeenCalledWith('7', 'trip_guest', '3')
    expect(wrapper.find('[data-test="chat-message-3"]').exists()).toBe(false)
  })

  it('убирает строку по событию «сообщение удалено»', async () => {
    mocks.listTripMessages.mockResolvedValue({
      messages: [message({ id: '1', body: 'Пропадёт' })],
      hasMore: false,
    })
    mocks.listTripChats.mockResolvedValue([chat()])

    const wrapper = await mountChat()

    expect(wrapper.find('[data-test="chat-message-1"]').exists()).toBe(true)

    const feed = useConversationsStore()
    await feed.applyEvent({
      conversationId: '44',
      kind: 'message_deleted',
      actorId: 'u-2',
      at: '2026-11-25T09:30:00.000Z',
      messageId: '1',
    })
    await flushPromises()

    expect(wrapper.find('[data-test="chat-message-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="chat-empty"]').exists()).toBe(true)
  })
})
