import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RightRail from '@/components/layout/RightRail.vue'
import type { AppNotification, NotificationSectionDto } from '@/types/notifications'

const { listNotifications, readAllNotifications, subscribeConversationEvents } =
  vi.hoisted(() => ({
    listNotifications: vi.fn(),
    readAllNotifications: vi.fn(),
    subscribeConversationEvents: vi.fn(),
  }))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/api/notifications', () => ({
  listNotifications,
  readAllNotifications,
  closeNotification: vi.fn(),
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
  listNotifications.mockResolvedValue({
    sections,
    personal: personalList,
    tripCount: sections.length,
    personalCount: personalList.length,
    total:
      sections.reduce((sum, item) => sum + item.items.length, 0) + personalList.length,
  })
}

let wrapper: VueWrapper | null = null

async function mountRail() {
  wrapper = mount(RightRail)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  // Свёрнутость секций живёт в localStorage: иначе тест «берёт из хранилища»
  // менял бы поведение следующим.
  window.localStorage.clear()
  subscribeConversationEvents.mockReturnValue(() => undefined)
  readAllNotifications.mockResolvedValue({ closed: 1, left: 1 })
  answer([section('193', [card()])], [personal])
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('RightRail — секции по походам', () => {
  it('рисует секции походов и «Сообщения» последней, без общего заголовка', async () => {
    answer(
      [section('193', [card()]), section('810', [card({ id: '3', tripId: '810' })])],
      [personal],
    )
    const rail = await mountRail()

    const sections = rail.findAll('[data-test^="rail-section-"]')
    expect(sections.map((item) => item.attributes('data-test'))).toEqual([
      'rail-section-trip-193',
      'rail-section-trip-810',
      'rail-section-personal',
    ])
    // Заголовок секции — «поход {цель}», префикс добавляет клиент.
    expect(rail.get('[data-test="rail-toggle-trip-193"]').text()).toContain(
      'поход Хамар-Дабан',
    )
    expect(rail.get('[data-test="rail-count-trip-193"]').text()).toBe('1')
    expect(rail.get('[data-test="rail-count-trip-810"]').text()).toBe('1')
    expect(rail.get('[data-test="rail-toggle-personal"]').text()).toContain('Сообщения')
    // Общего заголовка и сводного счётчика больше нет.
    expect(rail.find('[data-test="rail-total"]').exists()).toBe(false)
  })

  /**
   * Пустая секция не рисуется (§1.1): карточка есть только там, где есть
   * событие, и секция без событий не появляется вовсе.
   */
  it('секцию без уведомлений не показывает', async () => {
    answer([section('193', [card()])], [])

    const rail = await mountRail()

    expect(rail.find('[data-test="rail-section-trip-193"]').exists()).toBe(true)
    expect(rail.find('[data-test="rail-section-personal"]').exists()).toBe(false)
  })

  it('без уведомлений пишет «Пока тихо» и не рисует секций', async () => {
    answer([], [])

    const rail = await mountRail()

    expect(rail.get('[data-test="rail-empty"]').text()).toBe('Пока тихо.')
    expect(rail.findAll('[data-test^="rail-section-"]')).toHaveLength(0)
  })

  it('раскрыто всегда одно уведомление: выбор другого сворачивает прежнее', async () => {
    answer(
      [section('193', [card(), card({ id: '3', title: 'Запрос платежа', kind: 'payment_request' })])],
      [],
    )

    const rail = await mountRail()

    await rail.get('[data-test="rail-card-1"] button').trigger('click')
    expect(rail.find('[data-test="rail-confirm"]').exists()).toBe(true)

    await rail.get('[data-test="rail-card-3"] button').trigger('click')

    // У первой карточки действий нет: она свёрнута.
    expect(rail.find('[data-test="rail-confirm"]').exists()).toBe(false)
    expect(rail.find('[data-test="rail-go-finance"]').exists()).toBe(true)
  })

  it('повторный клик по раскрытой карточке сворачивает её', async () => {
    const rail = await mountRail()

    await rail.get('[data-test="rail-card-1"] button').trigger('click')
    await rail.get('[data-test="rail-card-1"] button').trigger('click')

    expect(rail.find('[data-test="rail-confirm"]').exists()).toBe(false)
  })

  it('секции сворачиваются независимо и помнят это в localStorage', async () => {
    const rail = await mountRail()

    await rail.get('[data-test="rail-toggle-trip-193"]').trigger('click')

    // Свернули поход — карточки скрыты, счётчик цел.
    expect(rail.find('[data-test="rail-card-1"]').exists()).toBe(false)
    expect(rail.get('[data-test="rail-count-trip-193"]').text()).toBe('1')
    // «Сообщения» остались открытыми: секции не зависят друг от друга.
    expect(rail.find('[data-test="rail-card-2"]').exists()).toBe(true)
    expect(window.localStorage.getItem('ph.notifications.trip.193.open')).toBe('0')
    expect(window.localStorage.getItem('ph.notifications.section.personal.open')).toBeNull()

    await rail.get('[data-test="rail-toggle-trip-193"]').trigger('click')
    expect(rail.find('[data-test="rail-card-1"]').exists()).toBe(true)
    expect(window.localStorage.getItem('ph.notifications.trip.193.open')).toBe('1')
  })

  it('свёрнутость берёт из localStorage при создании', async () => {
    window.localStorage.setItem('ph.notifications.trip.193.open', '0')

    const rail = await mountRail()

    expect(rail.find('[data-test="rail-card-1"]').exists()).toBe(false)
    expect(rail.find('[data-test="rail-card-2"]').exists()).toBe(true)
  })

  /**
   * Двойная галочка (§1.3): кнопка не рисуется, если закрывать нечего;
   * клик зовёт ручку и перечитывает панель.
   */
  it('двойная галочка есть только когда есть что закрывать', async () => {
    answer([section('193', [card()])], [])
    const onlyMoney = await mountRail()
    expect(onlyMoney.find('[data-test="rail-read-all-trip-193"]').exists()).toBe(false)

    onlyMoney.unmount()
    wrapper = null
    const list = vi.mocked(listNotifications)
    list.mockResolvedValue({
      sections: [section('193', [card(), card({ id: '4', kind: 'almanac_changed' })])],
      personal: [],
      tripCount: 1,
      personalCount: 0,
      total: 2,
    })

    const withAlmanac = await mountRail()
    expect(withAlmanac.find('[data-test="rail-read-all-trip-193"]').exists()).toBe(true)

    await withAlmanac.get('[data-test="rail-read-all-trip-193"]').trigger('click')
    await flushPromises()

    expect(readAllNotifications).toHaveBeenCalledWith('193')
  })

  it('ошибку загрузки показывает вместо списка', async () => {
    listNotifications.mockRejectedValue(new Error('сеть'))

    const rail = await mountRail()

    expect(rail.get('[data-test="rail-error"]').text()).toBe(
      'Не удалось загрузить уведомления',
    )
  })
})
