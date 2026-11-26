import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { ApiError } from '@/api/errors'
import type { GuestTrip } from '@/types/trips'
import GuestTripView from '@/views/trips/GuestTripView.vue'

/**
 * Тесты «Гостевой» вкладки.
 *
 * Главное — что гость видит обзор, но **не видит** того, что решено
 * скрыть: места сбора и состава. Первое обеспечивается DTO на бэкенде
 * (e2e `access.e2e-spec.ts`), второе — тем, что экран рисует ровно
 * гостевые поля.
 */
vi.mock('@/api/trips', () => ({
  fetchGuestTrip: vi.fn(),
  listTripMessages: vi.fn(),
  sendTripMessage: vi.fn(),
}))
vi.mock('@/api/objects', () => ({ listObjectsByIds: vi.fn() }))
vi.mock('@/api/diary', () => ({
  getTripAlmanac: vi.fn(),
  createAlmanacEntry: vi.fn(),
  updateAlmanacEntry: vi.fn(),
  deleteAlmanacEntry: vi.fn(),
}))

import * as api from '@/api/trips'
import * as objects from '@/api/objects'
import * as diary from '@/api/diary'

const mocked = vi.mocked(api)
const mockedObjects = vi.mocked(objects)
const mockedDiary = vi.mocked(diary)

function makeGuest(overrides: Partial<GuestTrip> = {}): GuestTrip {
  return {
    id: '7',
    goalObject: { id: '10', name: 'Витязь', type: 'скальник', url: null },
    announcement: 'Идём на майские',
    routeText: 'Подход от станции',
    requirementsText: 'Свои кошки',
    status: 'decided',
    startsAt: '2027-05-05T00:00:00.000Z',
    endsAt: '2027-05-09T00:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    participants: [],
    isCommercial: true,
    priceRub: 5000,
    priceNote: 'Заброска и питание',
    isOfficial: false,
    isRecruitmentClosed: false,
    ...overrides,
  }
}

async function mountView(): Promise<ReturnType<typeof mount>> {
  /**
   * Чат похода (`TripChat`) берёт `useAuthStore` в setup, поэтому «Гостевой»
   * без Pinia не монтируется: Vue ловит ошибку стора, и секции чата в дереве
   * не оказывается. Тесты секций обязаны давать приложению тот же контекст,
   * что даёт `App.vue`.
   */
  const wrapper = mount(GuestTripView, {
    props: { tripId: '7' },
    global: { plugins: [createPinia()] },
  })
  await flushPromises()

  return wrapper
}

describe('GuestTripView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.localStorage.clear()
    mocked.fetchGuestTrip.mockResolvedValue(makeGuest())
    mocked.listTripMessages.mockResolvedValue({ messages: [], hasMore: false })
    mockedObjects.listObjectsByIds.mockResolvedValue([])
    mockedDiary.getTripAlmanac.mockResolvedValue({
      tripId: '7',
      completedAt: '2026-11-18T10:00:00.000Z',
      canWrite: false,
      canManage: false,
      entries: [],
    })
  })

  it('показывает обзор: цель, даты, статус, рамку, маршрут и требования', async () => {
    const wrapper = await mountView()

    expect(wrapper.find('[data-test="guest-goal"]').text()).toContain('Витязь')
    expect(wrapper.find('[data-test="guest-dates"]').text()).toContain('2027')
    expect(wrapper.find('[data-test="guest-status"]').text()).toBe('Решено')
    expect(wrapper.find('[data-test="guest-frame"]').text()).toContain('коммерческий')
    expect(wrapper.find('[data-test="guest-route"]').text()).toContain('Подход')
    expect(wrapper.find('[data-test="guest-requirements"]').text()).toContain('кошки')
  })

  /**
   * Замечания заказчика к шагу 09.11.2026: подпись «Когда» — это «Даты»,
   * готовность вынесена в отдельную строку «Статус», а информация
   * по стоимости скрыта из-за юридических вопросов.
   */
  it('подписи «Даты» и «Статус», а не «Когда» со статусом в одной строке', async () => {
    const wrapper = await mountView()
    const labels = wrapper.findAll('dt').map((label) => label.text())

    expect(labels).toContain('Даты')
    expect(labels).toContain('Статус')
    expect(labels).not.toContain('Когда')
    expect(wrapper.find('[data-test="guest-dates"]').text()).not.toContain('Решено')
  })

  it('стоимости на «Гостевой» нет: ни блока, ни суммы', async () => {
    const wrapper = await mountView()

    expect(wrapper.text()).not.toContain('Что входит в стоимость')
    expect(wrapper.text()).not.toContain('Заброска и питание')
    expect(wrapper.text()).not.toContain('5000')
    expect(wrapper.find('[data-test="guest-frame"]').text()).not.toContain('₽')
  })

  it('у мечты без дат написано «не заданы», а не статус вместо даты', async () => {
    mocked.fetchGuestTrip.mockResolvedValue(
      makeGuest({ status: 'idea', startsAt: null, endsAt: null, isCommercial: false }),
    )

    const wrapper = await mountView()

    expect(wrapper.find('[data-test="guest-dates"]').text()).toBe('не заданы')
    expect(wrapper.find('[data-test="guest-status"]').text()).toBe('Мечта')
  })

  it('значения обзора и имена в составе — полужирные', async () => {
    mocked.fetchGuestTrip.mockResolvedValue(
      makeGuest({
        participants: [
          {
            userId: 'u-1',
            displayName: 'Анна',
            avatarUrl: null,
            status: 'going',
            roles: [],
            isOrganizer: false,
            isVirtual: false,
            createdAt: '2026-10-14T10:00:00.000Z',
            updatedAt: '2026-10-14T10:00:00.000Z',
          },
        ],
      }),
    )

    const wrapper = await mountView()

    // font-semibold — слова заказчика «оформи жирным шрифтом покрупнее».
    expect(wrapper.find('[data-test="guest-goal"]').classes()).toContain('font-semibold')
    expect(wrapper.find('[data-test="guest-dates"]').classes()).toContain('font-semibold')
    expect(wrapper.find('[data-test="guest-status"]').classes()).toContain('font-semibold')
    expect(wrapper.find('[data-test="guest-participants"] span').classes()).toContain(
      'font-semibold',
    )
  })

  it('места сбора на обзоре нет', async () => {
    const wrapper = await mountView()

    expect(wrapper.text()).not.toContain('Место сбора')
  })

  it('состав виден всем: имя, роль и статус', async () => {
    // С 21.10.2026 «Гостевая» одна для всех: состав — часть анонса.
    mocked.fetchGuestTrip.mockResolvedValue(
      makeGuest({
        participants: [
          {
            userId: 'u-1',
            displayName: 'Ваня',
            avatarUrl: null,
            status: 'going',
            roles: [
              { code: 'organizer', name: 'Организатор' },
              { code: 'quartermaster', name: 'Завхоз' },
            ],
            isOrganizer: true,
            isVirtual: false,
            createdAt: '2026-10-14T10:00:00.000Z',
            updatedAt: '2026-10-14T10:00:00.000Z',
          },
        ],
      }),
    )

    const wrapper = await mountView()
    const list = wrapper.find('[data-test="guest-participants"]')

    expect(list.exists()).toBe(true)
    expect(list.text()).toContain('Ваня')
    expect(list.text()).toContain('организатор')
    // Роль «Организатор» не дублируется: её заменяет подпись выше.
    expect(list.text()).not.toContain('Организатор')
    expect(list.text()).toContain('Завхоз')
    expect(list.text()).toContain('Идёт')
  })

  it('присутствие видно гостю: «на маршруте», «вернулся», «не отметился»', async () => {
    mocked.fetchGuestTrip.mockResolvedValue(
      makeGuest({
        // Поход уже начался: только тогда «не отметился» — факт, а не шум.
        startsAt: '2026-11-16T00:00:00.000Z',
        participants: [
          {
            userId: 'u-1',
            displayName: 'Сергей',
            avatarUrl: null,
            status: 'going',
            roles: [],
            isOrganizer: true,
            isVirtual: false,
            createdAt: '2026-10-14T10:00:00.000Z',
            updatedAt: '2026-10-14T10:00:00.000Z',
            presenceStatus: 'route',
          },
          {
            userId: 'u-2',
            displayName: 'Марина',
            avatarUrl: null,
            status: 'going',
            roles: [],
            isOrganizer: false,
            isVirtual: false,
            createdAt: '2026-10-14T10:00:00.000Z',
            updatedAt: '2026-10-14T10:00:00.000Z',
            presenceStatus: 'returned',
          },
          {
            userId: 'u-3',
            displayName: 'Пётр',
            avatarUrl: null,
            status: 'going',
            roles: [],
            isOrganizer: false,
            isVirtual: false,
            createdAt: '2026-10-14T10:00:00.000Z',
            updatedAt: '2026-10-14T10:00:00.000Z',
            presenceStatus: 'none',
          },
        ],
      }),
    )

    const wrapper = await mountView()
    const list = wrapper.get('[data-test="guest-participants"]')

    expect(list.text()).toContain('На маршруте')
    expect(list.text()).toContain('Вернулся')
    expect(list.text()).toContain('Не отметился')
  })

  it('404 объясняется словами «закрыт», а не пустой страницей', async () => {
    mocked.fetchGuestTrip.mockRejectedValue(new ApiError(404, 'Поход не найден', null))

    const wrapper = await mountView()

    expect(wrapper.find('[data-test="guest-error"]').text()).toContain('закрыт')
  })

  /**
   * Решение заказчика 22.11.2026: «обе секции „гостевой чат“ и „Альманах“
   * сделать сворачиваемыми, как Снаряжение и Питание. Гостевая должна
   * помнить состояние при переходах между закладками».
   */
  it('гостевой чат — свёрнутая секция, состояние помнится между заходами', async () => {
    const first = await mountView()
    const section = first.get('[data-test="guest-chat-section"]')

    expect(section.element.hasAttribute('open')).toBe(false)

    await section.get('summary').trigger('click')
    // Клик по summary — нативное поведение браузера; в jsdom ставим open сами.
    ;(section.element as HTMLDetailsElement).open = true
    await section.trigger('toggle')
    expect(JSON.parse(window.localStorage.getItem('ph.tripGuestView.open.7') ?? '{}')).toMatchObject({
      chat: true,
    })

    const second = await mountView()
    expect(second.get('[data-test="guest-chat-section"]').element.hasAttribute('open')).toBe(true)
  })

  it('альманах — секция «Гостевой» у завершённого и отменённого похода', async () => {
    const planned = await mountView()
    expect(planned.find('[data-test="trip-almanac"]').exists()).toBe(false)

    mocked.fetchGuestTrip.mockResolvedValue(
      makeGuest({ completedAt: '2026-11-18T10:00:00.000Z' }),
    )

    const completed = await mountView()
    expect(completed.find('[data-test="trip-almanac"]').exists()).toBe(true)
    expect(mockedDiary.getTripAlmanac).toHaveBeenCalledWith('7')

    // Отменённый поход открывает альманах с 26.11.2026 (§4.6): «альманах
    // подготовки» без требования завершения.
    mocked.fetchGuestTrip.mockResolvedValue(
      makeGuest({ cancelledAt: '2026-11-26T10:00:00.000Z' }),
    )

    const cancelled = await mountView()
    expect(cancelled.find('[data-test="trip-almanac"]').exists()).toBe(true)
  })
})
