import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { Trip, TripListResponse } from '@/types/trips'
import TripAnnounces from '@/views/trips/TripAnnounces.vue'

/**
 * Тесты страницы анонсов.
 *
 * Проверяем то, ради чего страница сделана: **что именно уходит в запрос**.
 * «Любое значение» в интерфейсе обязано быть отсутствием параметра, а не
 * `false`, цель — id из справочника, а смена фильтра — новым запросом
 * с первой страницы: доклеенная к старым фильтрам страница показала бы
 * походы, которые под новые условия не подходят.
 *
 * Таймеры поддельные: у поиска цели задержка, и ждать её по-настоящему
 * значит делать тесты медленными.
 */
const mocks = vi.hoisted(() => ({ listTrips: vi.fn(), listObjects: vi.fn() }))

vi.mock('@/api/trips', () => ({ listTrips: mocks.listTrips }))
vi.mock('@/api/objects', () => ({ listObjects: mocks.listObjects }))

const BASE: Trip = {
  id: '1',
  organizerUserId: 'u-1',
  goalObjectId: '10',
  goalObject: { id: '10', name: 'Витязь', type: 'скала', url: null },
  announcement: 'Идём на майские',
  routeText: '',
  requirementsText: null,
  visibility: 'public',
  isRecruitmentClosed: false,
  activityTypeIds: [],
  status: 'decided',
  startsAt: '2027-05-05T00:00:00.000Z',
  endsAt: null,
  actualStartedAt: null,
  actualFinishedAt: null,
  isCommercial: false,
  isSport: false,
  priceRub: null,
  priceNote: null,
  cancelledAt: null,
  createdAt: '2026-10-14T10:00:00.000Z',
  updatedAt: '2026-10-14T10:00:00.000Z',
}

const trip = (overrides: Partial<Trip> = {}): Trip => ({ ...BASE, ...overrides })

const page = (trips: Trip[], total = trips.length): TripListResponse => ({ trips, total })

/** Дать промисам и планировщику Vue разрешиться. */
async function settle() {
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(0)
}

/** Запрос, который ушёл последним. */
function lastQuery(): Record<string, unknown> {
  const calls = mocks.listTrips.mock.calls
  return (calls[calls.length - 1]?.[0] ?? {}) as Record<string, unknown>
}

/**
 * Смонтировать страницу и дождаться первой загрузки.
 *
 * Роутер настоящий: карточка похода — ссылка, и без роутера она
 * не отрисуется вовсе.
 */
async function open(): Promise<VueWrapper> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/trips/announces', name: 'trips-announces', component: TripAnnounces },
      { path: '/trips/:id', name: 'trip', component: { template: '<div />' } },
    ],
  })
  await router.push('/trips/announces')
  await router.isReady()

  const wrapper = mount(TripAnnounces, { global: { plugins: [router] } })
  await settle()
  return wrapper
}

describe('TripAnnounces', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.listTrips.mockReset()
    mocks.listObjects.mockReset()
    mocks.listTrips.mockResolvedValue(page([trip()]))
    mocks.listObjects.mockResolvedValue([
      { id: '10', name: 'Витязь', type: 'скала', url: null, parentId: '9', parentName: 'Олхинское плато' },
    ])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('первый запрос — чужие походы без фильтров', async () => {
    await open()

    expect(mocks.listTrips).toHaveBeenCalledTimes(1)
    expect(lastQuery()).toMatchObject({ mine: false, limit: 20, offset: 0 })
    expect(lastQuery().when).toBeUndefined()
    expect(lastQuery().isCommercial).toBeUndefined()
    expect(lastQuery().isSport).toBeUndefined()
  })

  it('показывает карточки и общее число найденных', async () => {
    mocks.listTrips.mockResolvedValue(page([trip(), trip({ id: '2' })], 7))
    const wrapper = await open()

    expect(wrapper.findAll('[data-test="trip-card"]')).toHaveLength(2)
    expect(wrapper.find('[data-test="announces-total"]').text()).toContain('7')
  })

  it('«когда» и «готовность» уезжают в запрос как значения бэкенда', async () => {
    const wrapper = await open()

    await wrapper.find('[data-test="filter-when"]').setValue('upcoming')
    await settle()
    expect(lastQuery()).toMatchObject({ when: 'upcoming', offset: 0 })

    await wrapper.find('[data-test="filter-status"]').setValue('planning')
    await settle()
    expect(lastQuery()).toMatchObject({ when: 'upcoming', status: 'planning', offset: 0 })
  })

  it('«бесплатные» и «платные» — это false и true, а не отсутствие фильтра', async () => {
    const wrapper = await open()

    await wrapper.find('[data-test="filter-commercial"]').setValue('false')
    await settle()
    expect(lastQuery().isCommercial).toBe(false)

    await wrapper.find('[data-test="filter-commercial"]').setValue('true')
    await settle()
    expect(lastQuery().isCommercial).toBe(true)

    await wrapper.find('[data-test="filter-commercial"]').setValue('')
    await settle()
    expect(lastQuery().isCommercial).toBeUndefined()
  })

  it('спортивный флаг фильтрует в обе стороны', async () => {
    const wrapper = await open()

    await wrapper.find('[data-test="filter-sport"]').setValue('true')
    await settle()
    expect(lastQuery().isSport).toBe(true)

    await wrapper.find('[data-test="filter-sport"]').setValue('false')
    await settle()
    expect(lastQuery().isSport).toBe(false)
  })

  it('цель выбирается из справочника и уходит своим id', async () => {
    const wrapper = await open()

    await wrapper.find('[data-test="object-search"]').setValue('Витязь')
    await vi.advanceTimersByTimeAsync(400)
    await wrapper.find('[data-test="object-option"]').trigger('click')
    await settle()

    expect(lastQuery().goalObjectId).toBe(10)
    expect(wrapper.find('[data-test="filter-goal"]').text()).toContain('Витязь')

    await wrapper.find('[data-test="filter-goal-clear"]').trigger('click')
    await settle()
    expect(lastQuery().goalObjectId).toBeUndefined()
  })

  it('сброс фильтров чистит всё сразу и кнопка исчезает', async () => {
    const wrapper = await open()

    await wrapper.find('[data-test="filter-when"]').setValue('past')
    await wrapper.find('[data-test="filter-sport"]').setValue('true')
    await settle()

    expect(wrapper.find('[data-test="filters-reset"]').exists()).toBe(true)

    await wrapper.find('[data-test="filters-reset"]').trigger('click')
    await settle()

    expect(lastQuery()).toMatchObject({ mine: false, offset: 0 })
    expect(lastQuery().when).toBeUndefined()
    expect(lastQuery().isSport).toBeUndefined()
    expect(wrapper.find('[data-test="filters-reset"]').exists()).toBe(false)
  })

  it('пустая лента без фильтров зовёт создать поход, с фильтрами — снять их', async () => {
    mocks.listTrips.mockResolvedValue(page([]))
    const wrapper = await open()

    expect(wrapper.find('[data-test="announces-empty"]').text()).toContain('Анонсов пока нет')

    await wrapper.find('[data-test="filter-when"]').setValue('past')
    await settle()

    expect(wrapper.find('[data-test="announces-empty"]').text()).toContain('ничего не нашлось')
  })

  it('«показать ещё» догружает следующую страницу, а не первую', async () => {
    mocks.listTrips
      .mockResolvedValueOnce(page([trip(), trip({ id: '2' })], 3))
      .mockResolvedValueOnce(page([trip({ id: '3' })], 3))

    const wrapper = await open()

    const more = wrapper.find('[data-test="announces-more"]')
    expect(more.text()).toContain('1')

    await more.trigger('click')
    await settle()

    expect(lastQuery()).toMatchObject({ offset: 2 })
    expect(wrapper.findAll('[data-test="trip-card"]')).toHaveLength(3)
    expect(wrapper.find('[data-test="announces-more"]').exists()).toBe(false)
  })

  it('сбой загрузки показывается и повторяется по кнопке', async () => {
    mocks.listTrips.mockRejectedValueOnce(new Error('сеть')).mockResolvedValueOnce(page([trip()]))
    const wrapper = await open()

    expect(wrapper.find('[data-test="announces-error"]').exists()).toBe(true)

    await wrapper.find('[data-test="announces-retry"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-test="announces-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="trip-card"]')).toHaveLength(1)
  })
})
