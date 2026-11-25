import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { ApiError } from '@/api/errors'
import { useConversationsStore } from '@/stores/conversations'
import type { Conversation } from '@/types/conversations'
import type { MessageAction, TripMessage } from '@/types/trips'
import MessageView from '@/views/messages/MessageView.vue'

/**
 * Экран диалога `/messages/:id` (23.11.2026; живое сообщение — 24.11.2026;
 * денежное действие — 24.11.2026).
 *
 * Проверяем то, ради чего он заведён: шапку (собеседник или чат с походом),
 * переписку, «Прочитано» на последнем своём сообщении, галочку «Уведомлять»
 * и историю вверх по курсору `before`. С 24.11.2026 — ещё и то, что чужое
 * сообщение из событий дописывается в открытую переписку, а действие
 * диалога («Подтверждаю», поле «Сообщение отправителю», «Перейти») живёт
 * на экране, а не только в ленте.
 *
 * Стор авторизации подменён: экрану нужен только мой id, чтобы отличить
 * свои сообщения от чужих. Pinia при этом настоящая — экран слушает стор
 * ленты (`stores/conversations.ts`), а он без неё не заводится.
 */
const mocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  listConversations: vi.fn(),
  listConversationMessages: vi.fn(),
  markConversationRead: vi.fn(),
  sendConversationMessage: vi.fn(),
  setConversationMuted: vi.fn(),
  respondToAction: vi.fn(),
  editConversationMessage: vi.fn(),
  deleteConversationMessage: vi.fn(),
}))

vi.mock('@/api/conversations', () => ({
  getConversation: mocks.getConversation,
  listConversations: mocks.listConversations,
  listConversationMessages: mocks.listConversationMessages,
  markConversationRead: mocks.markConversationRead,
  sendConversationMessage: mocks.sendConversationMessage,
  setConversationMuted: mocks.setConversationMuted,
  editConversationMessage: mocks.editConversationMessage,
  deleteConversationMessage: mocks.deleteConversationMessage,
}))

vi.mock('@/api/message-actions', () => ({
  respondToAction: mocks.respondToAction,
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
    myLastReadAt: null,
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

/** Действие диалога: по умолчанию неразрешённый перевод, ждущий ответа. */
function action(overrides: Partial<MessageAction> = {}): MessageAction {
  return {
    id: '42',
    kind: 'money_received',
    targetUserId: 'me',
    state: 'pending',
    payload: { amountRub: 1000 },
    canRespond: true,
    canRecheck: false,
    createdAt: '2026-11-24T09:00:00.000Z',
    respondedAt: null,
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
    mocks.listConversations.mockResolvedValue({ conversations: [] })
    mocks.listConversationMessages.mockResolvedValue({
      messages: [message()],
      hasMore: false,
    })
    mocks.markConversationRead.mockResolvedValue(undefined)
    mocks.sendConversationMessage.mockResolvedValue(
      message({ id: '9', senderId: 'me', senderName: 'Я', body: 'Буду к восьми' }),
    )
    mocks.setConversationMuted.mockResolvedValue(undefined)
    mocks.respondToAction.mockResolvedValue(action({ state: 'confirmed' }))
    mocks.editConversationMessage.mockResolvedValue(
      message({ id: '1', body: 'Исправлено' }),
    )
    mocks.deleteConversationMessage.mockResolvedValue(undefined)
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

  /**
   * Разделитель «Новые сообщения» (25.11.2026).
   *
   * Граница берётся из диалога (`myLastReadAt`), а не из DOM и не из
   * счётчика после прочтения: экран отмечает диалог прочитанным сразу,
   * поэтому запоминать границу нужно до `POST /read`.
   */
  it('ставит «Новые сообщения» перед первым непрочитанным и переживает отметку прочтения', async () => {
    mocks.getConversation.mockResolvedValue(
      conversation({
        unreadCount: 2,
        myLastReadAt: '2026-11-23T09:30:00.000Z',
      }),
    )
    mocks.listConversationMessages.mockResolvedValue({
      messages: [
        message({ id: '1', body: 'Старое', createdAt: '2026-11-23T09:00:00.000Z' }),
        message({ id: '2', body: 'Новое', createdAt: '2026-11-23T10:00:00.000Z' }),
        message({ id: '3', body: 'Ещё новее', createdAt: '2026-11-23T10:05:00.000Z' }),
      ],
      hasMore: false,
    })

    const { wrapper } = await openScreen()

    const list = wrapper.find('[data-test="message-list"]')

    expect(list.findAll('[data-test="message-unread"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="message-unread"]').text()).toContain('Новые сообщения')
    // Разделитель стоит ровно перед первым непрочитанным, а не над старым.
    const html = list.html()

    expect(html.indexOf('message-unread')).toBeLessThan(html.indexOf('data-test="message-2"'))
    expect(html.indexOf('data-test="message-1"')).toBeLessThan(html.indexOf('message-unread'))
    // Отметка прочтения ушла, но разделитель остался на месте: он про
    // момент входа, а счётчик сервер уже обнулил.
    expect(mocks.markConversationRead).toHaveBeenCalledWith('7')
  })

  it('после прочтения — без новых — разделителя нет', async () => {
    mocks.getConversation.mockResolvedValue(
      conversation({
        unreadCount: 0,
        myLastReadAt: '2026-11-23T10:30:00.000Z',
      }),
    )
    mocks.listConversationMessages.mockResolvedValue({
      messages: [
        message({ id: '1', body: 'Старое', createdAt: '2026-11-23T09:00:00.000Z' }),
        message({ id: '2', body: 'Прочитанное', createdAt: '2026-11-23T10:00:00.000Z' }),
      ],
      hasMore: false,
    })

    const { wrapper } = await openScreen()

    expect(wrapper.find('[data-test="message-unread"]').exists()).toBe(false)
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

  /**
   * Переписанный текст (24.11.2026): автосогласие через 72 часа заменило
   * уведомление о переводе объяснением «время вышло». Открытый диалог
   * обязан заменить тело уже показанного сообщения, а не дописать второе,
   * и счётчик непрочитанного при этом не растёт.
   */
  it('заменяет текст уже показанного сообщения из события', async () => {
    const { wrapper } = await openScreen()

    const feed = useConversationsStore()
    feed.rows = [conversation({ id: '7', unreadCount: 0, lastMessage: message() })]

    mocks.getConversation.mockResolvedValue(
      conversation({
        lastMessage: message({
          body: 'Анна перевела тебе 1000 ₽. Так как время ожидания вышло…',
        }),
      }),
    )

    await feed.applyEvent({
      conversationId: '7',
      kind: 'message_updated',
      actorId: '',
      at: '2026-11-24T09:30:00.000Z',
      messageId: '1',
      body: 'Анна перевела тебе 1000 ₽. Так как время ожидания вышло…',
    })
    await flushPromises()

    const items = wrapper.findAll('[data-test^="message-1"]')
    // Одно сообщение на месте — второго не появилось.
    expect(items).toHaveLength(1)
    expect(items[0]?.text()).toContain('Так как время ожидания вышло')
    expect(items[0]?.text()).not.toContain('Привет')
    // Счётчик не вырос: сообщение не новое.
    expect(feed.rows[0]?.unreadCount).toBe(0)
    // Историю не перечитывали.
    expect(mocks.listConversationMessages).toHaveBeenCalledTimes(1)
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

  /**
   * Денежное действие на экране (24.11.2026): человек открыл переписку по
   * прямой ссылке, и подтвердить перевод было негде — кнопка жила только
   * в колонке и мобильной панели.
   */
  it('у ждущего перевода показывает «Подтверждаю» и поле отправителю', async () => {
    mocks.getConversation.mockResolvedValue(conversation({ action: action() }))

    const { wrapper } = await openScreen()

    expect(wrapper.find('[data-test="message-action"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="message-action-title"]').text()).toBe('Перевод 1\u00A0000 ₽')
    expect(wrapper.find('[data-test="message-confirm"]').text()).toBe('Подтверждаю')
    expect(
      wrapper.find('[data-test="message-reply-input"]').attributes('placeholder'),
    ).toBe('Сообщение отправителю:')
    expect(wrapper.find('[data-test="message-reply-send"]').text()).toBe('→')
    // «Перейти» — у просьбы о платеже, здесь его быть не должно.
    expect(wrapper.find('[data-test="message-go-finance"]').exists()).toBe(false)
  })

  it('«Подтверждаю» закрывает перевод и перечитывает диалог и ленту', async () => {
    mocks.getConversation
      .mockResolvedValueOnce(conversation({ action: action() }))
      .mockResolvedValueOnce(
        conversation({ action: null, lastMessage: message({ id: '1' }) }),
      )

    const { wrapper } = await openScreen()

    await wrapper.find('[data-test="message-confirm"]').trigger('click')
    await flushPromises()

    expect(mocks.respondToAction).toHaveBeenCalledWith('42', '')
    // Диалог перечитан: GET /conversations/:id второй раз, после ответа.
    expect(mocks.getConversation).toHaveBeenCalledTimes(2)
    // Строка ленты тоже перечитана — своё действие стор не применяет.
    expect(mocks.listConversations).toHaveBeenCalled()
    // Перевод закрыт, ответ больше не предлагается.
    expect(wrapper.find('[data-test="message-confirm"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="message-action"]').exists()).toBe(false)
  })

  /**
   * Поле «Сообщение отправителю» — обычное сообщение (24.11.2026), а не
   * ответ на действие: таймер автосогласия не трогается, перевод остаётся
   * ждать «Подтверждаю».
   */
  it('поле «Сообщение отправителю» отправляет обычное сообщение', async () => {
    mocks.getConversation.mockResolvedValue(conversation({ action: action() }))
    mocks.sendConversationMessage.mockResolvedValueOnce(
      message({ id: '9', senderId: 'me', body: 'Деньги пришли, спасибо' }),
    )

    const { wrapper } = await openScreen()

    await wrapper.find('[data-test="message-reply-input"]').setValue('Деньги пришли, спасибо')
    await wrapper.find('[data-test="message-reply-send"]').trigger('click')
    await flushPromises()

    expect(mocks.sendConversationMessage).toHaveBeenCalledWith('7', 'Деньги пришли, спасибо')
    expect(mocks.respondToAction).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="message-list"]').text()).toContain('Деньги пришли, спасибо')
    expect(
      (wrapper.find('[data-test="message-reply-input"]').element as HTMLInputElement).value,
    ).toBe('')
    // Перевод так и ждёт ответа — кнопка на месте.
    expect(wrapper.find('[data-test="message-confirm"]').exists()).toBe(true)
  })

  /**
   * Поле работает и вместе с ответом (24.11.2026): текст уходит телом
   * `POST /message-actions/:id/respond`, а сервер записывает его обычным
   * сообщением. Своё сообщение событием не приходит, поэтому экран обязан
   * дописать его из перечитанного диалога — иначе реплика молча исчезнет.
   */
  it('«Подтверждаю» отправляет текст из поля и дописывает его в переписку', async () => {
    mocks.getConversation
      .mockResolvedValueOnce(conversation({ action: action() }))
      .mockResolvedValueOnce(
        conversation({
          action: null,
          lastMessage: message({ id: '10', senderId: 'me', body: 'Спасибо, получил' }),
        }),
      )

    const { wrapper } = await openScreen()

    await wrapper.find('[data-test="message-reply-input"]').setValue('Спасибо, получил')
    await wrapper.find('[data-test="message-confirm"]').trigger('click')
    await flushPromises()

    expect(mocks.respondToAction).toHaveBeenCalledWith('42', 'Спасибо, получил')
    expect(wrapper.find('[data-test="message-list"]').text()).toContain('Спасибо, получил')
  })

  it('«Перейти» у просьбы о платеже ведёт в «Бухгалтерию» похода', async () => {
    mocks.getConversation.mockResolvedValue(
      conversation({
        action: action({
          kind: 'payment_request',
          canRespond: false,
          payload: { tripId: '3' },
        }),
      }),
    )

    const { wrapper, router } = await openScreen()

    expect(wrapper.find('[data-test="message-action-title"]').text()).toBe(
      'Организатор запросил платёж',
    )
    expect(wrapper.find('[data-test="message-confirm"]').exists()).toBe(false)

    await wrapper.find('[data-test="message-go-finance"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/trips/3')
    expect(router.currentRoute.value.query).toEqual({ tab: 'finance' })
  })

  /**
   * Правка и удаление своего сообщения (25.11.2026, §10 п.9).
   *
   * Чужое и системное не трогается, сообщение с денежным действием — тоже:
   * текст уведомления о переводе человеку не принадлежит. Кнопки живут
   * только у своих реплик, поэтому чужую строку невозможно даже открыть
   * на правку.
   */
  it('у чужого сообщения нет «Изменить» и «Удалить»', async () => {
    const { wrapper } = await openScreen()

    expect(wrapper.find('[data-test="message-edit"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="message-delete"]').exists()).toBe(false)
  })

  it('своё сообщение правится на месте', async () => {
    mocks.listConversationMessages.mockResolvedValue({
      messages: [message({ id: '5', senderId: 'me', body: 'Опечатка' })],
      hasMore: false,
    })
    mocks.editConversationMessage.mockResolvedValue(
      message({ id: '5', senderId: 'me', body: 'Исправлено' }),
    )

    const { wrapper } = await openScreen()

    await wrapper.find('[data-test="message-edit"]').trigger('click')
    await flushPromises()

    const input = wrapper.find('[data-test="message-edit-input"]')
    expect((input.element as HTMLTextAreaElement).value).toBe('Опечатка')

    await input.setValue('  Исправлено  ')
    await wrapper.find('[data-test="message-edit-save"]').trigger('click')
    await flushPromises()

    expect(mocks.editConversationMessage).toHaveBeenCalledWith('7', '5', 'Исправлено')
    // Строка та же, второго сообщения не появилось.
    expect(wrapper.findAll('[data-test^="message-5"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="message-5"]').text()).toContain('Исправлено')
    expect(wrapper.find('[data-test="message-5"]').text()).not.toContain('Опечатка')
    expect(wrapper.find('[data-test="message-edit-input"]').exists()).toBe(false)
  })

  it('отмена правки возвращает прежний текст', async () => {
    mocks.listConversationMessages.mockResolvedValue({
      messages: [message({ id: '5', senderId: 'me', body: 'Как было' })],
      hasMore: false,
    })

    const { wrapper } = await openScreen()

    await wrapper.find('[data-test="message-edit"]').trigger('click')
    await wrapper.find('[data-test="message-edit-input"]').setValue('Не сохранять')
    await wrapper.find('[data-test="message-edit-cancel"]').trigger('click')
    await flushPromises()

    expect(mocks.editConversationMessage).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="message-5"]').text()).toContain('Как было')
    expect(wrapper.find('[data-test="message-edit-input"]').exists()).toBe(false)
  })

  it('ошибку правки показывает словами сервера', async () => {
    mocks.listConversationMessages.mockResolvedValue({
      messages: [message({ id: '5', senderId: 'me', body: 'Опечатка' })],
      hasMore: false,
    })
    mocks.editConversationMessage.mockRejectedValue(
      new ApiError(403, 'Можно менять только своё сообщение', null),
    )

    const { wrapper } = await openScreen()

    await wrapper.find('[data-test="message-edit"]').trigger('click')
    await wrapper.find('[data-test="message-edit-input"]').setValue('Чужое')
    await wrapper.find('[data-test="message-edit-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="message-error"]').text()).toContain(
      'Можно менять только своё сообщение',
    )
    // Форма осталась открытой: текст не потерян.
    expect(wrapper.find('[data-test="message-edit-input"]').exists()).toBe(true)
  })

  it('удаление спрашивает подтверждение и убирает строку', async () => {
    mocks.listConversationMessages.mockResolvedValue({
      messages: [
        message({ id: '4', senderId: 'me', body: 'Уберу' }),
        message({ id: '5', senderId: 'me', body: 'Останусь' }),
      ],
      hasMore: false,
    })

    const { wrapper } = await openScreen()

    await wrapper.find('[data-test="message-4"] [data-test="message-delete"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="message-delete-confirm"]').exists()).toBe(true)
    expect(mocks.deleteConversationMessage).not.toHaveBeenCalled()

    await wrapper.find('[data-test="message-delete-confirm"]').trigger('click')
    await flushPromises()

    expect(mocks.deleteConversationMessage).toHaveBeenCalledWith('7', '4')
    expect(wrapper.find('[data-test="message-4"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="message-list"]').text()).toContain('Останусь')
    // Строку ленты перечитали: своё событие стор не применяет.
    expect(mocks.listConversations).toHaveBeenCalled()
  })

  it('отмена удаления оставляет сообщение', async () => {
    mocks.listConversationMessages.mockResolvedValue({
      messages: [message({ id: '4', senderId: 'me', body: 'Уберу' })],
      hasMore: false,
    })

    const { wrapper } = await openScreen()

    await wrapper.find('[data-test="message-delete"]').trigger('click')
    await wrapper.find('[data-test="message-delete-cancel"]').trigger('click')
    await flushPromises()

    expect(mocks.deleteConversationMessage).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="message-4"]').exists()).toBe(true)
  })

  it('сообщение с денежным действием не правится и не удаляется', async () => {
    mocks.listConversationMessages.mockResolvedValue({
      messages: [
        message({
          id: '5',
          senderId: 'me',
          body: 'Анна перевела тебе 1000 ₽',
          action: action({ targetUserId: 'peer' }),
        }),
      ],
      hasMore: false,
    })

    const { wrapper } = await openScreen()

    expect(wrapper.find('[data-test="message-edit"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="message-delete"]').exists()).toBe(false)
  })

  /**
   * Удаление приходит событием (25.11.2026): строка исчезает у собеседника
   * и во второй вкладке автора без перезагрузки. Счётчик после удаления
   * серверный — удалённой строки в базе нет.
   */
  it('убирает строку по событию «сообщение удалено»', async () => {
    const { wrapper } = await openScreen()

    const feed = useConversationsStore()
    feed.rows = [conversation({ id: '7', unreadCount: 1, lastMessage: message() })]

    await feed.applyEvent({
      conversationId: '7',
      kind: 'message_deleted',
      actorId: 'peer',
      at: '2026-11-25T09:30:00.000Z',
      messageId: '1',
    })
    await flushPromises()

    expect(wrapper.find('[data-test="message-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="message-list"]').exists()).toBe(false)
    // Строку ленты перечитали — непрочитанное и последнее сообщение серверные.
    expect(mocks.getConversation).toHaveBeenCalledTimes(2)
  })
})
