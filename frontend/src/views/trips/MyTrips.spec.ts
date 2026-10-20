import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { Trip, TripListResponse } from '@/types/trips'
import MyTrips from '@/views/trips/MyTrips.vue'

/**
 * Тесты страницы «Мои походы».
 *
 * Ключевое отличие от анонсов — `mine: true` в запросе. Это не мелочь
 * оформления: корень раздела обязан показывать свои походы, и если фильтр
 * однажды потеряется, страница молча превратится в общую ленту.
 */
const mocks = vi.hoisted(() => ({ listTrips: vi.fn() }))

vi.mock('@/api/trips', () => ({ listTrips: mocks.listTrips }))

const BASE: Trip = {
  id: '1',
  organizerUserId: 'u-1',
  goalObjectId: '10',
  goalObject: { id: '10', name: 'Витязь', type: 'скальник', url: null },
  announcement: null,
  routeText: '',
  requirementsText: null,
  meetingPlace: null,
  meetingAt: null,
  transferText: null,
  visibility: 'public',
  isRecruitmentClosed: false,
  activityTypeIds: [],
  status: 'idea',
  startsAt: null,
  endsAt: null,
  actualStartedAt: null,
  actualFinishedAt: null,
  isCommercial: false,
  isOfficial: false,
  priceRub: null,
  priceNote: null,
  cancelledAt: null,
  createdAt: '2026-10-14T10:00:00.000Z',
  updatedAt: '2026-10-14T10:00:00.000Z',
}

const trip = (overrides: Partial<Trip> = {}): Trip => ({ ...BASE, ...overrides })

const page = (trips: Trip[], total = trips.length): TripListResponse => ({ trips, total })

async function settle() {
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(0)
}

/**
 * Роутер настоящий, а не заглушка ссылок: карточка похода — это ссылка,
 * и без роутера она не отрисуется вовсе. Заодно проверяется, что ссылка
 * «Создать поход» ведёт именно на форму создания.
 */
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/trips', name: 'trips-mine', component: MyTrips },
      { path: '/trips/new', name: 'trips-create', component: { template: '<div />' } },
      { path: '/trips/:id', name: 'trip', component: { template: '<div />' } },
    ],
  })
}

async function open(): Promise<VueWrapper> {
  const router = makeRouter()
  await router.push('/trips')
  await router.isReady()

  const wrapper = mount(MyTrips, { global: { plugins: [router] } })
  await settle()
  return wrapper
}

describe('MyTrips', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.listTrips.mockReset()
    mocks.listTrips.mockResolvedValue(page([trip()]))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('просит у API только свои походы', async () => {
    await open()

    expect(mocks.listTrips).toHaveBeenCalledTimes(1)
    expect(mocks.listTrips.mock.calls[0]?.[0]).toMatchObject({
      mine: true,
      limit: 20,
      offset: 0,
    })
  })

  it('показывает карточки и общее число', async () => {
    mocks.listTrips.mockResolvedValue(page([trip(), trip({ id: '2' })], 5))
    const wrapper = await open()

    expect(wrapper.findAll('[data-test="trip-card"]')).toHaveLength(2)
    expect(wrapper.find('[data-test="my-trips-total"]').text()).toContain('5')
  })

  it('пусто — объясняет, что здесь появится, и зовёт создать поход', async () => {
    mocks.listTrips.mockResolvedValue(page([]))
    const wrapper = await open()

    expect(wrapper.find('[data-test="my-trips-empty"]').text()).toContain('появятся походы')
    expect(wrapper.find('[data-test="my-trips-create"]').attributes('href')).toBe('/trips/new')
  })

  it('«показать ещё» догружает следующую страницу', async () => {
    mocks.listTrips
      .mockResolvedValueOnce(page([trip(), trip({ id: '2' })], 3))
      .mockResolvedValueOnce(page([trip({ id: '3' })], 3))

    const wrapper = await open()

    await wrapper.find('[data-test="my-trips-more"]').trigger('click')
    await settle()

    expect(mocks.listTrips.mock.calls[1]?.[0]).toMatchObject({ offset: 2 })
    expect(wrapper.findAll('[data-test="trip-card"]')).toHaveLength(3)
  })

  it('сбой показывается и повторяется по кнопке', async () => {
    mocks.listTrips.mockRejectedValueOnce(new Error('сеть')).mockResolvedValueOnce(page([trip()]))
    const wrapper = await open()

    expect(wrapper.find('[data-test="my-trips-error"]').exists()).toBe(true)

    await wrapper.find('[data-test="my-trips-retry"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-test="my-trips-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="trip-card"]')).toHaveLength(1)
  })
})
