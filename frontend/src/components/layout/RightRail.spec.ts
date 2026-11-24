import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RightRail from '@/components/layout/RightRail.vue'
import type { AppNotification } from '@/types/notifications'

const { listNotifications, subscribeConversationEvents } = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  subscribeConversationEvents: vi.fn(),
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/api/notifications', () => ({ listNotifications, closeNotification: vi.fn() }))
vi.mock('@/api/events', () => ({ subscribeConversationEvents }))
vi.mock('@/api/conversations', () => ({ sendConversationMessage: vi.fn() }))
vi.mock('@/api/finance', () => ({ confirmTripCompensation: vi.fn() }))

function card(overrides: Partial<AppNotification> = {}): AppNotification {
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

const personal = card({
  id: '2',
  kind: 'direct_chat',
  section: 'personal',
  title: 'Борис',
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

function answer(system: AppNotification[], personalList: AppNotification[]) {
  listNotifications.mockResolvedValue({
    system,
    personal: personalList,
    systemCount: system.length,
    personalCount: personalList.length,
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
  subscribeConversationEvents.mockReturnValue(() => undefined)
  answer([card()], [personal])
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('RightRail — две секции уведомлений', () => {
  it('рисует обе секции со счётчиками в порядке системные → личные', async () => {
    const rail = await mountRail()

    const sections = rail.findAll('[data-test^="rail-section-"]')
    expect(sections.map((section) => section.attributes('data-test'))).toEqual([
      'rail-section-system',
      'rail-section-personal',
    ])
    expect(rail.get('[data-test="rail-count-system"]').text()).toBe('1')
    expect(rail.get('[data-test="rail-count-personal"]').text()).toBe('1')
    expect(rail.get('[data-test="rail-total"]').text()).toBe('2')
  })

  /**
   * Пустых строк чатов больше нет (§14.1): карточка есть только там, где
   * есть событие, и секция без событий не рисуется вовсе.
   */
  it('секцию без уведомлений не показывает', async () => {
    answer([card()], [])

    const rail = await mountRail()

    expect(rail.find('[data-test="rail-section-system"]').exists()).toBe(true)
    expect(rail.find('[data-test="rail-section-personal"]').exists()).toBe(false)
  })

  it('без уведомлений пишет «Пока тихо» и не рисует счётчика', async () => {
    answer([], [])

    const rail = await mountRail()

    expect(rail.get('[data-test="rail-empty"]').text()).toBe('Пока тихо.')
    expect(rail.find('[data-test="rail-total"]').exists()).toBe(false)
    expect(rail.findAll('[data-test^="rail-section-"]')).toHaveLength(0)
  })

  it('раскрыто всегда одно уведомление: выбор другого сворачивает прежнее', async () => {
    answer([card(), card({ id: '3', title: 'Запрос платежа', kind: 'payment_request' })], [])

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

  it('секция сворачивается по заголовку, не теряя счётчик', async () => {
    const rail = await mountRail()

    await rail.get('[data-test="rail-toggle-system"]').trigger('click')

    expect(rail.find('[data-test="rail-card-1"]').exists()).toBe(false)
    expect(rail.get('[data-test="rail-count-system"]').text()).toBe('1')

    await rail.get('[data-test="rail-toggle-system"]').trigger('click')
    expect(rail.find('[data-test="rail-card-1"]').exists()).toBe(true)
  })

  it('ошибку загрузки показывает вместо списка', async () => {
    listNotifications.mockRejectedValue(new Error('сеть'))

    const rail = await mountRail()

    expect(rail.get('[data-test="rail-error"]').text()).toBe(
      'Не удалось загрузить уведомления',
    )
  })
})
