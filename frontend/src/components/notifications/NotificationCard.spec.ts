import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NotificationCard from '@/components/notifications/NotificationCard.vue'
import type { AppNotification } from '@/types/notifications'

const { push, notificationsApi, conversationsApi, financeApi } = vi.hoisted(() => ({
  push: vi.fn(),
  notificationsApi: {
    listNotifications: vi.fn(),
    closeNotification: vi.fn(),
  },
  conversationsApi: { sendConversationMessage: vi.fn() },
  financeApi: { confirmTripCompensation: vi.fn() },
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/api/notifications', () => notificationsApi)
vi.mock('@/api/conversations', () => conversationsApi)
vi.mock('@/api/finance', () => financeApi)

function notification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: '1',
    kind: 'money_transfer',
    section: 'system',
    title: 'Денежный перевод',
    body: 'Анна перевела тебе 1 000 ₽ за поход «Хамар-Дабан».',
    conversationId: '1268',
    tripId: '193',
    compensationId: '55',
    unreadCount: null,
    preview: [],
    createdAt: '2026-11-24T10:00:00.000Z',
    updatedAt: '2026-11-24T10:00:00.000Z',
    ...overrides,
  }
}

function chatNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return notification({
    id: '2',
    kind: 'direct_chat',
    section: 'personal',
    title: 'Борис',
    body: 'Привет',
    conversationId: '1268',
    tripId: null,
    compensationId: null,
    unreadCount: 2,
    preview: [
      {
        id: '10',
        body: 'Привет',
        senderId: 'peer',
        senderName: 'Борис',
        createdAt: '2026-11-24T09:00:00.000Z',
      },
      {
        id: '11',
        body: 'Собираемся в шесть',
        senderId: 'peer',
        senderName: 'Борис',
        createdAt: '2026-11-24T09:30:00.000Z',
      },
    ],
    ...overrides,
  })
}

function mountCard(
  value: AppNotification,
  options: { expanded?: boolean; testPrefix?: string } = {},
) {
  return mount(NotificationCard, {
    props: {
      notification: value,
      expanded: options.expanded ?? true,
      testPrefix: options.testPrefix ?? 'rail',
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  notificationsApi.listNotifications.mockResolvedValue({
    system: [],
    personal: [],
    systemCount: 0,
    personalCount: 0,
  })
  notificationsApi.closeNotification.mockResolvedValue(undefined)
  conversationsApi.sendConversationMessage.mockResolvedValue({
    id: '12',
    senderId: 'me',
    senderName: 'Я',
    senderAvatarUrl: null,
    body: 'Привет',
    isSystem: false,
    createdAt: '2026-11-24T10:00:00.000Z',
    action: null,
  })
  financeApi.confirmTripCompensation.mockResolvedValue({})
})

describe('NotificationCard', () => {
  it('свёрнутая карточка показывает заголовок и превью, но не действия', () => {
    const wrapper = mountCard(notification(), { expanded: false })

    expect(wrapper.get('[data-test="rail-title-1"]').text()).toBe('Денежный перевод')
    expect(wrapper.get('[data-test="rail-preview-1"]').text()).toBe(
      'Анна перевела тебе 1 000 ₽ за поход «Хамар-Дабан».',
    )
    expect(wrapper.find('[data-test="rail-confirm"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="rail-reply-input"]').exists()).toBe(false)
  })

  it('превью в свёрнутой карточке обрезано до 50 символов', () => {
    const long = 'а'.repeat(80)
    const wrapper = mountCard(
      notification({ kind: 'almanac', body: long, conversationId: null }),
      { expanded: false },
    )

    expect(wrapper.get('[data-test="rail-preview-1"]').text()).toBe(
      `${'а'.repeat(50)}...`,
    )
  })

  /**
   * Заказчик: «превью дублируется при раскрытии». Поэтому в раскрытом виде
   * строки-превью нет вовсе: у нечата — полный `body`, у чата — сообщения.
   */
  it('в раскрытии строки-превью нет, а у нечата виден полный текст', () => {
    const body =
      'Расходы по походу «Пик Черского» распределены. Проверь свой баланс ' +
      'в «Бухгалтерии» — там видно, кому и сколько перевести.'

    const wrapper = mountCard(
      notification({ kind: 'trip_finance', title: 'Компенсируйте расходы', body }),
    )

    expect(wrapper.find('[data-test="rail-preview-1"]').exists()).toBe(false)
    expect(wrapper.text()).toContain(body)
  })

  it('у перевода — «Подтвердить» и поле «Сообщение отправителю», но не «ОК»', () => {
    const wrapper = mountCard(notification())

    expect(wrapper.find('[data-test="rail-confirm"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="rail-reply-input"]').attributes('placeholder')).toBe(
      'Сообщение отправителю:',
    )
    // Деньги «ОК» не закрываются: сервер ответит 400.
    expect(wrapper.find('[data-test="rail-ok"]').exists()).toBe(false)
  })

  it('«Подтвердить» вызывает подтверждение компенсации и перечитывает панель', async () => {
    const wrapper = mountCard(notification())

    await wrapper.get('[data-test="rail-confirm"]').trigger('click')
    await flushPromises()

    expect(financeApi.confirmTripCompensation).toHaveBeenCalledWith('193', '55')
    expect(notificationsApi.listNotifications).toHaveBeenCalled()
  })

  it('поле «Сообщение отправителю» уходит обычным сообщением', async () => {
    const wrapper = mountCard(notification())

    await wrapper.get('[data-test="rail-reply-input"]').setValue('деньги ещё не пришли')
    await wrapper.get('[data-test="rail-reply-send"]').trigger('click')
    await flushPromises()

    expect(conversationsApi.sendConversationMessage).toHaveBeenCalledWith(
      '1268',
      'деньги ещё не пришли',
    )
    // Поле очищается: повторная отправка того же текста не нужна.
    expect(
      (wrapper.get('[data-test="rail-reply-input"]').element as HTMLInputElement).value,
    ).toBe('')
  })

  it('пустое поле не отправляет сообщение', async () => {
    const wrapper = mountCard(notification())

    await wrapper.get('[data-test="rail-reply-input"]').setValue('   ')
    await wrapper.get('[data-test="rail-reply-send"]').trigger('click')
    await flushPromises()

    expect(conversationsApi.sendConversationMessage).not.toHaveBeenCalled()
  })

  it('у просьбы о платеже — «Перейти» в бухгалтерию похода', async () => {
    const wrapper = mountCard(
      notification({
        id: '3',
        kind: 'payment_request',
        title: 'Запрос платежа',
        body: 'Организатор запросил платёж по походу «Хамар-Дабан».',
        compensationId: null,
      }),
    )

    await wrapper.get('[data-test="rail-go-finance"]').trigger('click')

    expect(push).toHaveBeenCalledWith({ path: '/trips/193', query: { tab: 'finance' } })
  })

  it('у альманаха — «ОК» без архива и «Перейти» в гостевую с раскрытой секцией', async () => {
    window.localStorage.setItem(
      'ph.tripGuestView.open.193',
      JSON.stringify({ chat: false }),
    )

    const wrapper = mountCard(
      notification({
        id: '4',
        kind: 'almanac',
        title: 'Альманах «Хамар-Дабан»',
        body: 'В походе «Хамар-Дабан» новая редакция альманаха',
        conversationId: null,
        compensationId: null,
      }),
    )

    await wrapper.get('[data-test="rail-ok"]').trigger('click')
    await flushPromises()
    expect(notificationsApi.closeNotification).toHaveBeenCalledWith('4')

    await wrapper.get('[data-test="rail-go-almanac"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/trips/193', query: { tab: 'guest' } })
    // Ключ «Гостевого чата» не затёрт: секции делят одну запись.
    expect(window.localStorage.getItem('ph.tripGuestView.open.193')).toBe(
      JSON.stringify({ chat: false, almanac: true }),
    )
  })

  it('у личного чата — последние сообщения, быстрый ответ, «ОК» и «Открыть чат»', async () => {
    const wrapper = mountCard(chatNotification())

    const list = wrapper.get('[data-test="rail-messages-2"]')
    expect(list.text()).toContain('Привет')
    expect(list.text()).toContain('Собираемся в шесть')
    expect(wrapper.get('[data-test="rail-title-2"]').text()).toBe('Борис')
    expect(wrapper.get('[data-test="rail-unread-2"]').text()).toBe('2')
    expect(wrapper.find('[data-test="rail-confirm"]').exists()).toBe(false)
    // Последнее сообщение не повторяется подписью: в раскрытии её нет.
    expect(wrapper.find('[data-test="rail-preview-2"]').exists()).toBe(false)

    await wrapper.get('[data-test="rail-reply-input"]').setValue('Буду')
    await wrapper.get('[data-test="rail-reply-send"]').trigger('click')
    await flushPromises()
    expect(conversationsApi.sendConversationMessage).toHaveBeenCalledWith('1268', 'Буду')

    await wrapper.get('[data-test="rail-ok"]').trigger('click')
    await flushPromises()
    expect(notificationsApi.closeNotification).toHaveBeenCalledWith('2')

    await wrapper.get('[data-test="rail-open-chat"]').trigger('click')
    expect(push).toHaveBeenCalledWith('/messages/1268')
  })

  it('у общегрупповых денег — «Перейти в бухгалтерию» и «ОК» без архива', async () => {
    const wrapper = mountCard(
      notification({
        id: '6',
        kind: 'trip_finance',
        title: 'Установлен залог',
        body:
          'В походе «Пик Черского» установлен залог 300 ₽ с человека. ' +
          'Залог можно покрыть расходами или переводом — подробности ' +
          'в «Бухгалтерии».',
        conversationId: null,
        compensationId: null,
      }),
    )

    expect(wrapper.get('[data-test="rail-go-finance"]').text()).toBe(
      'Перейти в бухгалтерию',
    )
    // Деньги-архив здесь не при чём: карточка закрывается «ОК» без архива.
    expect(wrapper.find('[data-test="rail-ok"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="rail-confirm"]').exists()).toBe(false)

    await wrapper.get('[data-test="rail-go-finance"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/trips/193', query: { tab: 'finance' } })

    await wrapper.get('[data-test="rail-ok"]').trigger('click')
    await flushPromises()
    expect(notificationsApi.closeNotification).toHaveBeenCalledWith('6')
  })

  /**
   * 25.11.2026: перевод виртуальному приходит его владельцу, диалога с
   * человеком без аккаунта нет. Поле «Сообщение отправителю» рисовать
   * некуда — его нет, а «Подтвердить» остаётся.
   */
  it('у перевода владельцу виртуального нет поля «Сообщение отправителю»', () => {
    const wrapper = mountCard(
      notification({
        id: '7',
        kind: 'money_transfer',
        body: 'Анна перевёл(а) твоему участнику (Виктор) 300 ₽ за поход «Пик Черского».',
        conversationId: null,
      }),
    )

    expect(wrapper.find('[data-test="rail-confirm"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="rail-reply-input"]').exists()).toBe(false)
  })

  it('у чата похода нет «Открыть чат»: переход — только у личного', async () => {
    const wrapper = mountCard(
      chatNotification({
        id: '5',
        kind: 'trip_chat',
        section: 'system',
        title: 'Гостевой чат «Хамар-Дабан»',
        tripId: '193',
      }),
    )

    expect(wrapper.find('[data-test="rail-open-chat"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="rail-ok"]').exists()).toBe(true)
  })

  it('ошибка действия остаётся в карточке и не ломает её', async () => {
    notificationsApi.closeNotification.mockRejectedValue(new Error('сеть'))

    const wrapper = mountCard(chatNotification(), { expanded: true })
    await wrapper.get('[data-test="rail-ok"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="rail-error"]').text()).toBe(
      'Не удалось закрыть уведомление',
    )
  })

  it('клик по заголовку просит родителя раскрыть карточку', async () => {
    const wrapper = mountCard(notification(), { expanded: false })

    await wrapper.get('[data-test="rail-card-1"] button').trigger('click')

    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })
})
