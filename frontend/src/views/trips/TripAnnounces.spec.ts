import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import type { Trip, TripListResponse } from '@/types/trips'
import TripAnnounces from '@/views/trips/TripAnnounces.vue'

/**
 * Тесты страницы анонсов.
 *
 * Проверяем то, ради чего страница сделана: **что именно уходит в запрос**.
 * «Любое значение» в интерфейсе обязано быть отсутствием параметра, а не
 * `false`, объект — id из справочника, а смена фильтра — новым запросом
 * с первой страницы: доклеенная к старым фильтрам страница показала бы
 * походы, которые под новые условия не подходят.
 *
 * Отдельно проверяется адрес: фильтры живут в query-параметрах, и оба
 * направления обязаны работать — из адреса в запрос и обратно.
 *
 * Таймеры поддельные: у поиска объекта задержка, и ждать её по-настоящему
 * значит делать тесты медленными.
 */
const mocks = vi.hoisted(() => ({
  listTrips: vi.fn(),
  listObjects: vi.fn(),
  listObjectsByIds: vi.fn(),
}))

vi.mock('@/api/trips', () => ({ listTrips: mocks.listTrips }))
vi.mock('@/api/objects', () => ({
  listObjects: mocks.listObjects,
  listObjectsByIds: mocks.listObjectsByIds,
}))

const VITYAZ = {
  id: '10',
  name: 'Витязь',
  type: 'скальник',
  url: null,
  parentId: '9',
  parentName: 'Олхинское плато',
}

const BASE: Trip = {
  id: '1',
  organizerUserId: 'u-1',
  goalObjectId: '10',
  goalObject: { id: '10', name: 'Витязь', type: 'скальник', url: null },
  announcement: 'Идём на майские',
  routeText: '',
  requirementsText: null,
  meetingPlace: null,
  meetingAt: null,
  transferText: null,
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

interface Opened {
  wrapper: VueWrapper
  router: Router
}

/**
 * Смонтировать страницу и дождаться первой загрузки.
 *
 * Роутер настоящий: карточка похода — ссылка, а фильтры живут в адресе,
 * и без роутера не проверить ни то, ни другое.
 */
async function open(query: Record<string, string> = {}): Promise<Opened> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/trips/announces', name: 'trips-announces', component: TripAnnounces },
      { path: '/trips/:id', name: 'trip', component: { template: '<div />' } },
    ],
  })
  await router.push({ path: '/trips/announces', query })
  await router.isReady()

  const wrapper = mount(TripAnnounces, { global: { plugins: [router] } })
  await settle()
  await settle()

  return { wrapper, router }
}

describe('TripAnnounces', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.listTrips.mockReset()
    mocks.listObjects.mockReset()
    mocks.listObjectsByIds.mockReset()
    mocks.listTrips.mockResolvedValue(page([trip()]))
    mocks.listObjects.mockResolvedValue([VITYAZ])
    mocks.listObjectsByIds.mockResolvedValue([VITYAZ])
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
    expect(lastQuery().objectId).toBeUndefined()
  })

  it('показывает карточки и общее число найденных', async () => {
    mocks.listTrips.mockResolvedValue(page([trip(), trip({ id: '2' })], 7))
    const { wrapper } = await open()

    expect(wrapper.findAll('[data-test="trip-card"]')).toHaveLength(2)
    expect(wrapper.find('[data-test="announces-total"]').text()).toContain('7')
  })

  it('«когда» и «готовность» уезжают в запрос как значения бэкенда', async () => {
    const { wrapper } = await open()

    await wrapper.find('[data-test="filter-when"]').setValue('weekend')
    await settle()
    expect(lastQuery()).toMatchObject({ when: 'weekend', offset: 0 })

    await wrapper.find('[data-test="filter-status"]').setValue('planning')
    await settle()
    expect(lastQuery()).toMatchObject({ when: 'weekend', status: 'planning', offset: 0 })
  })

  it('в списке «когда» первыми идут следующие выходные', async () => {
    const { wrapper } = await open()
    const options = wrapper
      .findAll('[data-test="filter-when"] option')
      .map((option) => option.text())

    expect(options[0]).toBe('Любое')
    expect(options[1]).toBe('Следующие выходные')
  })

  it('«некоммерческие» и «коммерческие» — это false и true, а не отсутствие фильтра', async () => {
    const { wrapper } = await open()

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

  it('местный слэнг вместо казённого: «коммерческие», а не «платные»', async () => {
    const { wrapper } = await open()
    const text = wrapper.find('[data-test="filter-commercial"]').text()

    expect(text).toContain('Коммерческие')
    expect(text).toContain('Некоммерческие')
    expect(text).not.toContain('Платные')
  })

  it('спортивный флаг фильтрует в обе стороны', async () => {
    const { wrapper } = await open()

    await wrapper.find('[data-test="filter-sport"]').setValue('true')
    await settle()
    expect(lastQuery().isSport).toBe(true)

    await wrapper.find('[data-test="filter-sport"]').setValue('false')
    await settle()
    expect(lastQuery().isSport).toBe(false)
  })

  it('объект выбирается из справочника и уходит своим id', async () => {
    const { wrapper } = await open()

    await wrapper.find('[data-test="object-search"]').setValue('Витязь')
    await vi.advanceTimersByTimeAsync(400)
    await wrapper.find('[data-test="object-option"]').trigger('click')
    await settle()

    expect(lastQuery().objectId).toBe(10)
    expect(wrapper.find('[data-test="filter-goal"]').text()).toContain('Витязь')

    await wrapper.find('[data-test="filter-goal-clear"]').trigger('click')
    await settle()
    expect(lastQuery().objectId).toBeUndefined()
  })

  /**
   * Объект в фильтре — это цель **или** упоминание в маршруте: на бэкенде
   * это один параметр `objectId`, и второй раз объяснять это интерфейсом
   * не надо — но подпись обязана сказать, что фильтр шире, чем «цель».
   */
  it('подпись фильтра объясняет, что объект — это и маршрут тоже', async () => {
    const { wrapper } = await open()

    expect(wrapper.find('[data-test="filters"]').text()).toContain('упоминание в маршруте')
  })

  it('«любое» и «без дат» не остаются загадкой: под фильтрами есть пояснение', async () => {
    const { wrapper } = await open()

    const hint = wrapper.find('[data-test="filters-hint"]').text()
    expect(hint).toContain('«Любое»')
    expect(hint).toContain('«Без дат»')
  })

  it('сброс фильтров чистит всё сразу и кнопка исчезает', async () => {
    const { wrapper, router } = await open()

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
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('пустая лента без фильтров зовёт создать поход, с фильтрами — снять их', async () => {
    mocks.listTrips.mockResolvedValue(page([]))
    const { wrapper } = await open()

    expect(wrapper.find('[data-test="announces-empty"]').text()).toContain('Анонсов пока нет')

    await wrapper.find('[data-test="filter-when"]').setValue('past')
    await settle()

    expect(wrapper.find('[data-test="announces-empty"]').text()).toContain('ничего не нашлось')
  })

  it('«показать ещё» догружает следующую страницу, а не первую', async () => {
    mocks.listTrips
      .mockResolvedValueOnce(page([trip(), trip({ id: '2' })], 3))
      .mockResolvedValueOnce(page([trip({ id: '3' })], 3))

    const { wrapper } = await open()

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
    const { wrapper } = await open()

    expect(wrapper.find('[data-test="announces-error"]').exists()).toBe(true)

    await wrapper.find('[data-test="announces-retry"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-test="announces-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="trip-card"]')).toHaveLength(1)
  })

  /**
   * Главное в хранении фильтров: возврат со страницы похода не должен
   * обнулять подборку. Проверяется двумя направлениями — из адреса
   * в запрос и из фильтра в адрес.
   */
  it('фильтры из адреса применяются к запросу', async () => {
    const { wrapper } = await open({
      objectId: '10',
      when: 'weekend',
      status: 'decided',
      isCommercial: 'true',
      isSport: 'false',
    })

    expect(lastQuery()).toMatchObject({
      objectId: 10,
      when: 'weekend',
      status: 'decided',
      isCommercial: true,
      isSport: false,
      offset: 0,
    })

    // Имя объекта подтягивается из справочника по id из адреса.
    expect(mocks.listObjectsByIds).toHaveBeenCalledWith(['10'])
    expect(wrapper.find('[data-test="filter-goal"]').text()).toContain('Витязь')
  })

  it('выбранные фильтры попадают в адрес', async () => {
    const { wrapper, router } = await open()

    await wrapper.find('[data-test="filter-when"]').setValue('weekend')
    await wrapper.find('[data-test="filter-commercial"]').setValue('true')
    await settle()

    expect(router.currentRoute.value.query).toEqual({
      when: 'weekend',
      isCommercial: 'true',
    })
  })

  it('мусор в адресе не ломает ленту и не уходит в запрос', async () => {
    const { wrapper } = await open({ when: 'когда-нибудь', isSport: 'может', objectId: 'abc' })

    expect(lastQuery().when).toBeUndefined()
    expect(lastQuery().isSport).toBeUndefined()
    expect(lastQuery().objectId).toBeUndefined()
    expect(wrapper.findAll('[data-test="trip-card"]')).toHaveLength(1)
  })
})
