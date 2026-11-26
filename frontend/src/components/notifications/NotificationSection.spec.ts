import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import NotificationSection from '@/components/notifications/NotificationSection.vue'
import type { AppNotification } from '@/types/notifications'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

/**
 * Секция панели (26.11.2026, §1.1–§1.3).
 *
 * Проверяется то, что секция решает сама: заголовок похода, счётчик
 * активных карточек, chevron и сворачивание, двойная галочка только там,
 * где есть что закрывать, и отсутствие пустой секции. Раскрытие карточки
 * и переходы — дело `NotificationCard`.
 */

function card(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: '1',
    kind: 'almanac_changed',
    title: 'Альманах «Пик Черского»',
    announce: 'В походе «Пик Черского» новая редакция альманаха',
    body: 'В походе «Пик Черского» новая редакция альманаха',
    conversationId: null,
    tripId: '810',
    compensationId: null,
    unreadCount: null,
    viewerDeclined: null,
    preview: [],
    createdAt: '2026-11-25T10:00:00.000Z',
    updatedAt: '2026-11-25T10:00:00.000Z',
    ...overrides,
  }
}

function mountSection(
  options: {
    items?: AppNotification[]
    open?: boolean
    canReadAll?: boolean
    showHeader?: boolean
    expandedId?: string | null
  } = {},
) {
  return mount(NotificationSection, {
    props: {
      sectionKey: 'trip-810',
      title: 'поход Пик Черского',
      items: options.items ?? [card()],
      open: options.open ?? true,
      expandedId: options.expandedId ?? null,
      testPrefix: 'rail',
      canReadAll: options.canReadAll ?? false,
      showHeader: options.showHeader ?? true,
    },
  })
}

describe('NotificationSection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('показывает заголовок похода, счётчик активных карточек и chevron', () => {
    const wrapper = mountSection({
      items: [card(), card({ id: '2', kind: 'trip_chat' })],
    })

    expect(wrapper.find('[data-test="rail-section-trip-810"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="rail-toggle-trip-810"]').text()).toContain(
      'поход Пик Черского',
    )
    // Счётчик — карточки, а не непрочитанные сообщения.
    expect(wrapper.get('[data-test="rail-count-trip-810"]').text()).toBe('2')
    expect(wrapper.get('[data-test="rail-toggle-trip-810"]').attributes('aria-expanded')).toBe(
      'true',
    )
  })

  it('свёрнутая секция прячет карточки, но оставляет счётчик', () => {
    const wrapper = mountSection({ open: false })

    expect(wrapper.find('[data-test="rail-card-1"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="rail-count-trip-810"]').text()).toBe('1')
    expect(wrapper.get('[data-test="rail-toggle-trip-810"]').attributes('aria-expanded')).toBe(
      'false',
    )
  })

  it('клик по заголовку просит родителя свернуть секцию', async () => {
    const wrapper = mountSection()

    await wrapper.get('[data-test="rail-toggle-trip-810"]').trigger('click')

    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  /**
   * §1.3: двойная галочка не рисуется, если закрывать нечего. В секции
   * только перевод или запрос платежа — сервер их не тронет.
   */
  it('двойная галочка рисуется только когда есть что закрывать', async () => {
    const onlyMoney = mountSection({
      items: [card({ kind: 'money_transfer' })],
      canReadAll: false,
    })
    expect(onlyMoney.find('[data-test="rail-read-all-trip-810"]').exists()).toBe(false)

    const closable = mountSection({
      items: [card(), card({ kind: 'money_transfer' })],
      canReadAll: true,
    })
    const button = closable.get('[data-test="rail-read-all-trip-810"]')
    expect(button.attributes('aria-label')).toContain('Прочитать все')

    await button.trigger('click')
    expect(closable.emitted('readAll')).toHaveLength(1)
  })

  it('карточка сообщает о клике, а раскрыта только одна', async () => {
    const wrapper = mountSection({ expandedId: '1' })

    // Карточка раскрыта: у перевода нет, у альманаха есть «ОК».
    expect(wrapper.find('[data-test="rail-ok"]').exists()).toBe(true)

    await wrapper.get('[data-test="rail-card-1"] button').trigger('click')
    expect(wrapper.emitted('expand')).toEqual([['1']])
  })

  it('пустая секция не рисуется', () => {
    const wrapper = mountSection({ items: [] })

    expect(wrapper.find('[data-test="rail-section-trip-810"]').exists()).toBe(false)
  })

  it('без заголовка (мобильные «Сообщения») карточки видны сразу', () => {
    const wrapper = mountSection({ showHeader: false })

    expect(wrapper.find('[data-test="rail-toggle-trip-810"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="rail-card-1"]').exists()).toBe(true)
  })
})
