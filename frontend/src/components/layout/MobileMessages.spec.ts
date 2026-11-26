import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MobileMessages from '@/components/layout/MobileMessages.vue'
import type { AppNotification, NotificationSectionDto } from '@/types/notifications'

const { route, push, listNotifications, closeNotification, subscribeConversationEvents } =
  vi.hoisted(() => ({
    route: { name: 'trips', fullPath: '/trips/193' } as { name: string; fullPath: string },
    push: vi.fn(),
    listNotifications: vi.fn(),
    closeNotification: vi.fn(),
    subscribeConversationEvents: vi.fn(),
  }))

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push }),
}))
vi.mock('@/api/notifications', () => ({
  listNotifications,
  closeNotification,
  readAllNotifications: vi.fn(),
}))
vi.mock('@/api/events', () => ({ subscribeConversationEvents }))
vi.mock('@/api/conversations', () => ({ sendConversationMessage: vi.fn() }))
vi.mock('@/api/finance', () => ({ confirmTripCompensation: vi.fn() }))

function card(overrides: Partial<AppNotification> = {}): AppNotification {
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

const personal = card({
  id: '2',
  kind: 'direct_chat',
  title: 'Борис',
  announce: 'Борис: Собираемся в шесть',
  body: 'Собираемся в шесть',
  tripId: null,
  compensationId: null,
  unreadCount: 2,
  preview: [
    {
      id: '10',
      body: 'Собираемся в шесть',
      senderId: 'peer',
      senderName: 'Борис',
      createdAt: '2026-11-24T09:00:00.000Z',
    },
  ],
})

function section(
  tripId: string,
  items: AppNotification[],
  tripName = 'Хамар-Дабан',
): NotificationSectionDto {
  return { tripId, tripName, startsAt: null, items }
}

function answer(sections: NotificationSectionDto[], personalList: AppNotification[]) {
  const response = {
    sections,
    personal: personalList,
    tripCount: sections.length,
    personalCount: personalList.length,
    total:
      sections.reduce((sum, item) => sum + item.items.length, 0) + personalList.length,
  }

  listNotifications.mockResolvedValue(response)
  return response
}

let wrapper: VueWrapper | null = null

async function mountPanel() {
  wrapper = mount(MobileMessages, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  window.localStorage.clear()
  route.name = 'trips'
  route.fullPath = '/trips/193'
  subscribeConversationEvents.mockReturnValue(() => undefined)
  closeNotification.mockResolvedValue(undefined)
  answer(
    [
      section('193', [card()]),
      section('810', [card({ id: '3', kind: 'almanac_changed', tripId: '810' })], 'Пик Черского'),
    ],
    [personal],
  )
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('MobileMessages — секции походов', () => {
  it('рисует две иконки, счётчик треугольника — сумма карточек походов', async () => {
    const panel = await mountPanel()

    // Две карточки в двух походах — «2»; пять сообщений в чате остаются
    // одной карточкой.
    expect(panel.get('[data-test="mobile-notifications-system-badge"]').text()).toBe('2')
    expect(panel.get('[data-test="mobile-notifications-personal-badge"]').text()).toBe('1')
  })

  it('раздел без уведомлений иконки не имеет', async () => {
    answer([], [personal])

    const panel = await mountPanel()

    expect(panel.find('[data-test="mobile-notifications-system"]').exists()).toBe(false)
    expect(panel.find('[data-test="mobile-notifications-personal"]').exists()).toBe(true)
  })

  it('без уведомлений нет ни одной иконки', async () => {
    answer([], [])

    const panel = await mountPanel()

    expect(panel.find('[data-test^="mobile-notifications-"]').exists()).toBe(false)
  })

  /**
   * Треугольник открывает панель со **всеми** секциями походов: у каждой
   * свой заголовок, счётчик и сворачивание.
   */
  it('треугольник открывает панель со всеми секциями походов', async () => {
    const panel = await mountPanel()

    await panel.get('[data-test="mobile-notifications-system"]').trigger('click')

    expect(panel.find('[data-test="mobile-messages-panel"]').exists()).toBe(true)
    expect(panel.get('[data-test="mobile-messages-title"]').text()).toBe('Уведомления')
    expect(panel.get('[data-test="mobile-messages-count"]').text()).toBe('2')
    expect(
      panel.find('[data-test="mobile-messages-section-trip-193"]').exists(),
    ).toBe(true)
    expect(
      panel.find('[data-test="mobile-messages-section-trip-810"]').exists(),
    ).toBe(true)
    expect(panel.get('[data-test="mobile-messages-toggle-trip-193"]').text()).toContain(
      'поход Хамар-Дабан',
    )
    expect(panel.find('[data-test="mobile-messages-card-1"]').exists()).toBe(true)
    expect(panel.find('[data-test="mobile-messages-card-3"]').exists()).toBe(true)
    // Личные в этом режиме не показываются: для них есть конверт.
    expect(panel.find('[data-test="mobile-messages-card-2"]').exists()).toBe(false)
  })

  it('конверт открывает панель «Сообщения» с личными карточками', async () => {
    const panel = await mountPanel()

    await panel.get('[data-test="mobile-notifications-personal"]').trigger('click')

    expect(panel.get('[data-test="mobile-messages-title"]').text()).toBe('Сообщения')
    expect(panel.get('[data-test="mobile-messages-count"]').text()).toBe('1')
    expect(panel.find('[data-test="mobile-messages-card-2"]').exists()).toBe(true)
    expect(panel.find('[data-test="mobile-messages-card-1"]').exists()).toBe(false)
  })

  /**
   * 25.11.2026: круг иконок без заливки, треугольник крупный контурный
   * (44 px в кнопке 56 px), конверт тоже без заливки.
   */
  it('иконки без заливки, у треугольника обводка primary', async () => {
    const panel = await mountPanel()

    const system = panel.get('[data-test="mobile-notifications-system"]')
    const personalButton = panel.get('[data-test="mobile-notifications-personal"]')

    expect(system.classes()).toContain('bg-surface')
    expect(system.classes()).not.toContain('bg-primary')
    expect(system.classes()).toContain('border-primary')
    expect(personalButton.classes()).toContain('bg-surface')
    expect(personalButton.classes()).not.toContain('bg-primary')

    expect(system.get('span.block').classes()).toContain('h-11')
    expect(personalButton.get('span.block').classes()).toContain('h-6')
  })

  /**
   * 25.11.2026, замечание заказчика: иконки стоят **вертикально**.
   * Столбик задаётся контейнером (`flex-col`), у кнопок порядок прежний:
   * сверху походы, под ними «Сообщения».
   */
  it('две иконки стоят вертикально', async () => {
    const panel = await mountPanel()

    const stack = panel.get('[data-test="mobile-notifications-system"]').element
      .parentElement as HTMLElement

    expect(stack.className).toContain('flex-col')
    expect(stack.className).not.toContain('flex-row')
    expect(
      Array.from(stack.querySelectorAll('button')).map((button) =>
        button.getAttribute('data-test'),
      ),
    ).toEqual(['mobile-notifications-system', 'mobile-notifications-personal'])
  })

  it('секции походов сворачиваются в панели независимо', async () => {
    const panel = await mountPanel()
    await panel.get('[data-test="mobile-notifications-system"]').trigger('click')

    await panel.get('[data-test="mobile-messages-toggle-trip-193"]').trigger('click')

    expect(panel.find('[data-test="mobile-messages-card-1"]').exists()).toBe(false)
    expect(panel.get('[data-test="mobile-messages-count-trip-193"]').text()).toBe('1')
    // Вторая секция осталась открытой.
    expect(panel.find('[data-test="mobile-messages-card-3"]').exists()).toBe(true)
    expect(window.localStorage.getItem('ph.notifications.trip.193.open')).toBe('0')
  })

  it('карточки в панели те же, что в колонке: «ОК» закрывает и панель пустеет', async () => {
    const panel = await mountPanel()
    await panel.get('[data-test="mobile-notifications-personal"]').trigger('click')
    await panel.get('[data-test="mobile-messages-card-2"] button').trigger('click')

    // После закрытия карточек не осталось — панель закрылась сама.
    answer([], [])
    await panel.get('[data-test="mobile-messages-ok"]').trigger('click')
    await flushPromises()

    expect(closeNotification).toHaveBeenCalledWith('2')
    expect(panel.find('[data-test="mobile-messages-panel"]').exists()).toBe(false)
    expect(panel.find('[data-test="mobile-notifications-personal"]').exists()).toBe(false)
  })

  it('на экране диалога ни иконок, ни панели', async () => {
    route.name = 'messages'

    const panel = await mountPanel()

    expect(panel.find('[data-test="mobile-notifications-system"]').exists()).toBe(false)
    expect(panel.find('[data-test="mobile-messages-panel"]').exists()).toBe(false)
  })
})
