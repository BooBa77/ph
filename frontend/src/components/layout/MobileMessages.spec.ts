import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MobileMessages from '@/components/layout/MobileMessages.vue'
import type { AppNotification } from '@/types/notifications'

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
vi.mock('@/api/notifications', () => ({ listNotifications, closeNotification }))
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

async function mountPanel() {
  wrapper = mount(MobileMessages, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  route.name = 'trips'
  route.fullPath = '/trips/193'
  subscribeConversationEvents.mockReturnValue(() => undefined)
  closeNotification.mockResolvedValue(undefined)
  answer([card()], [personal])
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('MobileMessages — две иконки уведомлений', () => {
  it('рисует две иконки со своими счётчиками', async () => {
    // Счётчик секции считает карточки, а не непрочитанные сообщения:
    // две карточки — «2», хотя непрочитанных в них больше.
    answer([card()], [personal, card({ id: '3', kind: 'direct_chat', title: 'Анна' })])

    const panel = await mountPanel()

    expect(panel.get('[data-test="mobile-notifications-system-badge"]').text()).toBe('1')
    expect(panel.get('[data-test="mobile-notifications-personal-badge"]').text()).toBe('2')
  })

  /**
   * «Нет уведомлений в секции — нет и её иконки» (§14.1): кнопка с вечным
   * нулём — мусор в углу экрана.
   */
  it('секция без уведомлений иконки не имеет', async () => {
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
   * Иконка открывает панель **на своей секции**: раскрыта та, по которой
   * нажали, вторая свёрнута.
   */
  it('иконка системных открывает панель с раскрытой секцией «Уведомления»', async () => {
    const panel = await mountPanel()

    await panel.get('[data-test="mobile-notifications-system"]').trigger('click')

    expect(panel.find('[data-test="mobile-messages-panel"]').exists()).toBe(true)
    expect(panel.get('[data-test="mobile-messages-title"]').text()).toBe('Уведомления')
    expect(panel.get('[data-test="mobile-messages-count"]').text()).toBe('1')
    expect(panel.find('[data-test="mobile-messages-card-1"]').exists()).toBe(true)
    expect(panel.find('[data-test="mobile-messages-card-2"]').exists()).toBe(false)
  })

  it('иконка личных открывает панель с раскрытой секцией «Сообщения»', async () => {
    const panel = await mountPanel()

    await panel.get('[data-test="mobile-notifications-personal"]').trigger('click')

    expect(panel.get('[data-test="mobile-messages-title"]').text()).toBe('Сообщения')
    expect(panel.find('[data-test="mobile-messages-card-2"]').exists()).toBe(true)
    expect(panel.find('[data-test="mobile-messages-card-1"]').exists()).toBe(false)
  })

  /**
   * 25.11.2026: круг иконок без заливки. Треугольник — крупный контурный
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

  it('карточки в панели те же, что в колонке: «ОК» закрывает и перечитывает', async () => {
    const panel = await mountPanel()
    await panel.get('[data-test="mobile-notifications-personal"]').trigger('click')
    await panel.get('[data-test="mobile-messages-card-2"] button').trigger('click')

    // У личного чата в раскрытии есть «ОК».
    answer([], [])
    await panel.get('[data-test="mobile-messages-ok"]').trigger('click')
    await flushPromises()

    expect(closeNotification).toHaveBeenCalledWith('2')
    // Карточек не осталось — панель закрылась сама, и иконки тоже нет.
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
