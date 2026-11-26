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
    title: 'Денежный перевод',
    announce: 'Анна перевела тебе 1 000 ₽ за поход «Хамар-Дабан».',
    body: 'Анна перевела тебе 1 000 ₽ за поход «Хамар-Дабан».',
    conversationId: '1268',
    tripId: '193',
    compensationId: '55',
    unreadCount: null,
    viewerDeclined: null,
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
    title: 'Борис',
    announce: 'Борис: Собираемся в шесть',
    body: 'Собираемся в шесть',
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
    sections: [],
    personal: [],
    tripCount: 0,
    personalCount: 0,
    total: 0,
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
    expect(wrapper.get('[data-test="rail-announce-1"]').text()).toBe(
      'Анна перевела тебе 1 000 ₽ за поход «Хамар-Дабан».',
    )
    expect(wrapper.find('[data-test="rail-confirm"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="rail-reply-input"]').exists()).toBe(false)
  })

  /**
   * 25.11.2026, замечание заказчика: «заголовки у всех уведомлений должны
   * быть жирные; про залог и требование компенсации не bold». Раньше вес
   * зависел от непрочитанного, а у денег и альманаха его не бывает —
   * такие карточки выглядели бледнее чатов.
   */
  it('заголовок жирный у любого вида, а не только у непрочитанного', () => {
    for (const kind of ['money_transfer', 'trip_deposit', 'almanac_changed'] as const) {
      const wrapper = mountCard(
        notification({
          kind,
          title: 'Заголовок',
          conversationId: null,
          compensationId: null,
        }),
        { expanded: false },
      )

      expect(
        wrapper.get('[data-test="rail-title-1"]').classes(),
        `жирный для ${kind}`,
      ).toContain('font-semibold')
    }
  })

  it('анонс в свёрнутой карточке обрезан до 75 символов', () => {
    const long = 'а'.repeat(80)
    const wrapper = mountCard(
      notification({ kind: 'almanac_changed', announce: long, conversationId: null }),
      { expanded: false },
    )

    expect(wrapper.get('[data-test="rail-announce-1"]').text()).toBe(
      `${'а'.repeat(75)}...`,
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
      notification({ kind: 'trip_deposit', title: 'Компенсируйте расходы', body }),
    )

    expect(wrapper.find('[data-test="rail-announce-1"]').exists()).toBe(false)
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
        kind: 'almanac_changed',
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
    expect(wrapper.find('[data-test="rail-announce-2"]').exists()).toBe(false)

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
        kind: 'trip_deposit',
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
  /**
   * 25.11.2026: перевод человеку, который вышел из похода.
   *
   * Деньги его, и подтвердить получение может только он, но «Бухгалтерия»
   * ему закрыта — кнопка живёт в карточке, и карточка это объясняет.
   */
  it('у перевода ушедшему — объяснение, «Подтвердить» и поле отправителю', () => {
    const wrapper = mountCard(notification({ viewerDeclined: true }))

    expect(wrapper.get('[data-test="rail-declined-hint"]').text()).toContain(
      'Ты не идёшь в этом походе',
    )
    expect(wrapper.get('[data-test="rail-declined-hint"]').text()).toContain(
      'через 72 часа',
    )
    // Права не расширены: поле ответа и сама кнопка на месте.
    expect(wrapper.find('[data-test="rail-confirm"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="rail-reply-input"]').attributes('placeholder')).toBe(
      'Сообщение отправителю:',
    )
  })

  it('у перевода идущему объяснения про закрытую бухгалтерию нет', () => {
    const wrapper = mountCard(notification({ viewerDeclined: false }))

    expect(wrapper.find('[data-test="rail-declined-hint"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="rail-confirm"]').exists()).toBe(true)
  })

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

  /**
   * 26.11.2026, часть 5: новые виды походов получают кнопки и переходы (§8).
   *
   * Переходы — те же, что у вкладок: «Трансфер», «Ночёвки», «Питание».
   * Закупка ведёт ещё и прямо в модалку списка общих продуктов.
   */
  it('у трансфера — «Трансфер» и «ОК»', async () => {
    for (const kind of ['transfer_seat', 'transfer_lost'] as const) {
      const wrapper = mountCard(
        notification({
          id: `t-${kind}`,
          kind,
          title: kind === 'transfer_seat' ? 'Билет на проезд' : 'Проблемы с транспортом',
          announce: 'водитель Сергей, Лада, А123ВС38',
          body: 'Ты добавлен пассажиром в автомобиль, водитель Сергей',
          conversationId: null,
          compensationId: null,
        }),
      )

      expect(wrapper.get('[data-test="rail-go-tab"]').text()).toBe('Трансфер')
      expect(wrapper.find('[data-test="rail-ok"]').exists()).toBe(true)

      await wrapper.get('[data-test="rail-go-tab"]').trigger('click')
      expect(push).toHaveBeenCalledWith({
        path: '/trips/193',
        query: { tab: 'transfer' },
      })
    }
  })

  it('у потерянной палатки — «Ночёвки» и «ОК»', async () => {
    const wrapper = mountCard(
      notification({
        id: 'tent',
        kind: 'tent_lost',
        title: 'Проблемы с палаткой',
        announce: 'Ты остался без палатки',
        body: 'Палатка, в которую тебя определили, стала недоступна',
        conversationId: null,
        compensationId: null,
      }),
    )

    expect(wrapper.get('[data-test="rail-go-tab"]').text()).toBe('Ночёвки')
    await wrapper.get('[data-test="rail-go-tab"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/trips/193', query: { tab: 'route' } })

    await wrapper.get('[data-test="rail-ok"]').trigger('click')
    await flushPromises()
    expect(notificationsApi.closeNotification).toHaveBeenCalledWith('tent')
  })

  it('у отмены похода — только «ОК», без перехода', async () => {
    const card = notification({
      id: 'cancelled',
      kind: 'trip_cancelled',
      title: 'Поход отменён',
      announce: 'Увы и ах (((',
      body:
        'По объективным причинам поход отменяется. Снаряжение ' +
        'освобождается. Все понесённые расходы представлены к компенсации',
      conversationId: null,
      compensationId: null,
    })

    // Свёрнутая показывает анонс заказчика, раскрытая — содержимое и «ОК».
    const collapsed = mountCard(card, { expanded: false })
    expect(collapsed.get('[data-test="rail-announce-cancelled"]').text()).toBe(
      'Увы и ах (((',
    )

    const wrapper = mountCard(card)

    // Поход отменён: вести в правку или на вкладку некуда, действие одно.
    expect(wrapper.find('[data-test="rail-go-tab"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="rail-reply-input"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('По объективным причинам')

    await wrapper.get('[data-test="rail-ok"]').trigger('click')
    await flushPromises()
    expect(notificationsApi.closeNotification).toHaveBeenCalledWith('cancelled')
  })

  it('у раскладки — «Питание» и «ОК»', async () => {
    const wrapper = mountCard(
      notification({
        id: 'layout',
        kind: 'meals_layout',
        title: 'Раскладка',
        announce: 'Анна изменила раскладку',
        body: 'Анна изменила раскладку',
        conversationId: null,
        compensationId: null,
      }),
    )

    expect(wrapper.get('[data-test="rail-go-tab"]').text()).toBe('Питание')
    await wrapper.get('[data-test="rail-go-tab"]').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/trips/193', query: { tab: 'meals' } })
  })

  it('у закупки — список продуктов, «Питание» и «ОК»', async () => {
    const wrapper = mountCard(
      notification({
        id: 'purchase',
        kind: 'meals_purchase',
        title: 'Закупка продуктов',
        announce: 'Борис',
        body: 'Борис закупил общие продукты',
        conversationId: null,
        compensationId: null,
      }),
    )

    // Свёрнутая карточка показывает announce, а не body.
    const collapsed = mountCard(
      notification({
        id: 'purchase-collapsed',
        kind: 'meals_purchase',
        title: 'Закупка продуктов',
        announce: 'Борис',
        body: 'Борис закупил общие продукты',
        conversationId: null,
        compensationId: null,
      }),
      { expanded: false },
    )
    expect(collapsed.get('[data-test="rail-announce-purchase-collapsed"]').text()).toBe(
      'Борис',
    )
    expect(collapsed.text()).not.toContain('закупил общие продукты')

    await wrapper.get('[data-test="rail-go-shopping"]').trigger('click')
    expect(push).toHaveBeenCalledWith({
      path: '/trips/193',
      query: { tab: 'meals', modal: 'shopping' },
    })

    expect(wrapper.get('[data-test="rail-go-tab"]').text()).toBe('Питание')
    await wrapper.get('[data-test="rail-go-tab"]').trigger('click')
    expect(push).toHaveBeenLastCalledWith({
      path: '/trips/193',
      query: { tab: 'meals' },
    })

    await wrapper.get('[data-test="rail-ok"]').trigger('click')
    await flushPromises()
    expect(notificationsApi.closeNotification).toHaveBeenCalledWith('purchase')
  })

  /**
   * Виды части 3 (участники, роли, расход, маршрут) в этой сессии тоже
   * получают действие: без него карточка была бы тупиком. Подпись — название
   * вкладки, «ОК» закрывает.
   */
  it('остальные виды похода ведут на свою вкладку и закрываются «ОК»', async () => {
    const cases = [
      ['participant_joined', 'Участники', 'members'],
      ['role_removed', 'Участники', 'members'],
      ['trip_expense', 'Бухгалтерия', 'finance'],
      ['trip_route', 'Ночёвки', 'route'],
    ] as const

    for (const [kind, label, tab] of cases) {
      const wrapper = mountCard(
        notification({
          id: `g-${kind}`,
          kind,
          title: 'Заголовок',
          conversationId: null,
          compensationId: null,
        }),
      )

      expect(wrapper.get('[data-test="rail-go-tab"]').text()).toBe(label)
      await wrapper.get('[data-test="rail-go-tab"]').trigger('click')
      expect(push).toHaveBeenLastCalledWith({ path: '/trips/193', query: { tab } })
      expect(wrapper.find('[data-test="rail-ok"]').exists()).toBe(true)
    }
  })

  it('у созданного альманаха те же действия, что у изменённого', async () => {
    const wrapper = mountCard(
      notification({
        id: 'almanac-created',
        kind: 'almanac_created',
        title: 'Альманах',
        conversationId: null,
        compensationId: null,
      }),
    )

    expect(wrapper.get('[data-test="rail-go-almanac"]').text()).toBe('Перейти')
    expect(wrapper.find('[data-test="rail-ok"]').exists()).toBe(true)
  })

  it('клик по заголовку просит родителя раскрыть карточку', async () => {
    const wrapper = mountCard(notification(), { expanded: false })

    await wrapper.get('[data-test="rail-card-1"] button').trigger('click')

    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })
})
