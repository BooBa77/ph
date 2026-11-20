import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import type { Trip, TripParticipant, TripTabCode, TripTabPermission } from '@/types/trips'
import TripView from '@/views/trips/TripView.vue'
import type { User } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { useMobileMenuStore } from '@/stores/mobileMenu'
import { useOfflineStore } from '@/stores/offline'

/**
 * Тесты страницы похода: связка «вкладки → мобильный гамбургер».
 *
 * С 26.10.2026 нижней полосы вкладок нет: на телефоне вкладки открываются
 * гамбургером в шапке. Шапка и страница — соседние ветки дерева, связывает
 * их стор, и вот эта связка и проверяется: страница объявила контекст,
 * вкладки в нём правильные, активная совпадает с показанной, а уйдя
 * со страницы контекст снимается (иначе на главной открылся бы гамбургер
 * с вкладками покинутого похода).
 */
const mocks = vi.hoisted(() => ({
  getTrip: vi.fn(),
  fetchTripTabs: vi.fn(),
  updateTrip: vi.fn(),
  completeTrip: vi.fn(),
  listParticipants: vi.fn(),
  setTripPresence: vi.fn(),
  subscribeTripEvents: vi.fn(),
}))

vi.mock('@/api/events', () => ({
  subscribeTripEvents: mocks.subscribeTripEvents,
}))

vi.mock('@/api/trips', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/trips')>()
  return {
    ...actual,
    getTrip: mocks.getTrip,
    fetchTripTabs: mocks.fetchTripTabs,
    updateTrip: mocks.updateTrip,
    completeTrip: mocks.completeTrip,
    listParticipants: mocks.listParticipants,
    setTripPresence: mocks.setTripPresence,
  }
})

const TRIP: Trip = {
  id: '1',
  organizerUserId: 'u-1',
  goalObjectId: '10',
  goalObject: { id: '10', name: 'Витязь', type: 'скальник', url: null },
  announcement: null,
  routeText: '',
  requirementsText: null,
  hasGuitar: false,
  visibility: 'public',
  isRecruitmentClosed: false,
  activityTypeIds: [],
  status: 'decided',
  startsAt: null,
  endsAt: null,
  dateVariants: [],
  actualStartedAt: null,
  actualFinishedAt: null,
  isCommercial: false,
  isOfficial: false,
  openParticipation: true,
  priceRub: null,
  priceNote: null,
  cancelledAt: null,
  createdAt: '2026-10-14T10:00:00.000Z',
  updatedAt: '2026-10-14T10:00:00.000Z',
}

const ALL_TABS: TripTabCode[] = [
  'guest',
  'members',
  'sport',
  'transfer',
  'route',
  'meals',
  'gear',
  'firstAid',
  'finance',
  'diary',
]

const permissions = (): TripTabPermission[] => ALL_TABS.map((code) => ({ code, canEdit: false }))

function makeUser(): User {
  return {
    id: 'u-1',
    displayName: 'Тест',
    location: null,
    avatarUrl: null,
    gender: 'm',
    isVegetarian: false,
    allergies: null,
    sportExperience: null,
    paymentDetails: null,
    paymentBank: null,
    isAdmin: false,
  }
}

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/person/:id', name: 'person', component: { template: '<div />' } },
      { path: '/trips/:id', name: 'trip', component: TripView },
      { path: '/trips/:id/edit', name: 'trip-edit', component: { template: '<div />' } },
    ],
  })
}

async function mountTrip(path = '/trips/1') {
  const router = makeRouter()
  await router.push(path)
  await router.isReady()

  useAuthStore().setAuth(makeUser(), 'token')

  const wrapper = mount(TripView, {
    global: {
      plugins: [router],
      // Экраны вкладок не нужны: проверяется связка с меню, а не они.
      stubs: {
        GuestTripView: { template: '<div data-test="guest-stub" />' },
        TripParticipants: { template: '<div data-test="members-stub" />' },
        TripMeals: { template: '<div data-test="meals-stub" />' },
        TripTransfer: { template: '<div data-test="transfer-stub" />' },
        TripRoute: { template: '<div data-test="route-stub" />' },
        TripGear: { template: '<div data-test="gear-stub" />' },
        TripFirstAid: { template: '<div data-test="first-aid-stub" />' },
        TripFinance: { template: '<div data-test="finance-stub" />' },
      },
    },
  })

  await flushPromises()
  await flushPromises()

  return { wrapper, router }
}

describe('TripView и мобильное меню', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.getTrip.mockResolvedValue(TRIP)
    mocks.fetchTripTabs.mockResolvedValue(permissions())
    mocks.listParticipants.mockResolvedValue([])
    mocks.subscribeTripEvents.mockReturnValue(vi.fn())
  })

  it('нижней полосы вкладок больше нет', async () => {
    const { wrapper } = await mountTrip()

    expect(wrapper.find('[data-test^="tab-mobile"]').exists()).toBe(false)
  })

  it('десктопные вкладки на месте', async () => {
    const { wrapper } = await mountTrip()

    const tabs = wrapper.findAll('[data-test^="tab-"]')
    expect(tabs.length).toBe(ALL_TABS.length)
  })

  it('отдаёт вкладки в мобильное меню', async () => {
    await mountTrip()

    const context = useMobileMenuStore().context
    expect(context?.title).toBe('Разделы похода')
    expect(context?.items.map((item) => item.key)).toEqual(ALL_TABS)
    expect(context?.items[0]?.label).toBe('Гостевая')
  })

  it('отмечает активной ту вкладку, которая открыта', async () => {
    await mountTrip()

    const items = useMobileMenuStore().context?.items ?? []
    expect(items.find((item) => item.key === 'guest')?.active).toBe(true)
    expect(items.find((item) => item.key === 'meals')?.active).toBe(false)
  })

  it('недоступные вкладки помечены недоступными', async () => {
    await mountTrip()

    const items = useMobileMenuStore().context?.items ?? []
    expect(items.find((item) => item.key === 'meals')?.available).toBe(true)
    expect(items.find((item) => item.key === 'transfer')?.available).toBe(true)
    expect(items.find((item) => item.key === 'route')?.available).toBe(true)
    expect(items.find((item) => item.key === 'gear')?.available).toBe(true)
    expect(items.find((item) => item.key === 'firstAid')?.available).toBe(true)
    expect(items.find((item) => item.key === 'finance')?.available).toBe(true)
    expect(items.find((item) => item.key === 'sport')?.available).toBe(false)
  })

  /**
   * Правка дат возвращает организатора в «Трансфер» через `?tab=transfer`
   * (19.11.2026): рейсы уже сдвинуты, но билеты надо перепроверить, и тревога
   * живёт именно на этой вкладке.
   */
  it('адрес ?tab=transfer открывает «Трансфер», чужой код — «Гостевую»', async () => {
    const opened = await mountTrip('/trips/1?tab=transfer')
    expect(opened.wrapper.find('[data-test="transfer-stub"]').exists()).toBe(true)

    const ignored = await mountTrip('/trips/1?tab=nonsense')
    expect(ignored.wrapper.find('[data-test="guest-stub"]').exists()).toBe(true)
  })

  it('вкладка «Бухгалтерия» открывается и показывает свой экран', async () => {
    const { wrapper } = await mountTrip()

    useMobileMenuStore()
      .context?.items.find((item) => item.key === 'finance')
      ?.onSelect?.()
    await flushPromises()

    expect(wrapper.find('[data-test="finance-stub"]').exists()).toBe(true)
    // Заглушки «ещё не готова» на этой вкладке быть не должно.
    expect(wrapper.find('[data-test="tab-soon"]').exists()).toBe(false)
  })

  it('вкладка «Ночёвки» называется так и показывает чат табора', async () => {
    const { wrapper } = await mountTrip()

    const items = useMobileMenuStore().context?.items ?? []
    expect(items.find((item) => item.key === 'route')?.label).toBe('Ночёвки')
    expect(items.find((item) => item.key === 'sport')?.label).toBe('Выпуск')

    items.find((item) => item.key === 'route')?.onSelect?.()
    await flushPromises()

    expect(wrapper.find('[data-test="route-stub"]').exists()).toBe(true)
  })

  it('вкладка «Снаряжение» активна и показывает экран снаряжения', async () => {
    const { wrapper } = await mountTrip()

    useMobileMenuStore()
      .context?.items.find((item) => item.key === 'gear')
      ?.onSelect?.()
    await flushPromises()

    expect(wrapper.find('[data-test="gear-stub"]').exists()).toBe(true)
  })

  it('переключение из меню меняет вкладку на странице', async () => {
    const { wrapper } = await mountTrip()

    const meals = useMobileMenuStore().context?.items.find((item) => item.key === 'meals')
    meals?.onSelect?.()
    await flushPromises()

    expect(wrapper.find('[data-test="meals-stub"]').exists()).toBe(true)
    expect(useMobileMenuStore().context?.items.find((item) => item.key === 'meals')?.active).toBe(
      true,
    )
  })

  it('при уходе со страницы меню возвращается к разделам сайта', async () => {
    const { wrapper } = await mountTrip()

    wrapper.unmount()

    expect(useMobileMenuStore().context).toBeNull()
  })

  // ───────────────────── свойства похода по SSE (19.11.2026) ─────────────────────

  it('шапка слушает поток похода и перечитывает свойства', async () => {
    const { wrapper } = await mountTrip()

    expect(mocks.subscribeTripEvents).toHaveBeenCalledWith('1', expect.any(Function))
    expect(wrapper.text()).not.toContain('Залог участия')

    // Сколько раз поход уже просили при открытии (копия для офлайна
    // перечитывает его сама) — важно только, что событие добавило ровно один.
    const loadsBefore = mocks.getTrip.mock.calls.length

    // Чужая правка: поход подорожал и получил даты.
    mocks.getTrip.mockResolvedValue({
      ...TRIP,
      startsAt: '2026-12-01T00:00:00.000Z',
      endsAt: '2026-12-05T00:00:00.000Z',
      depositRub: 200,
    })

    const onEvent = mocks.subscribeTripEvents.mock.calls[0]?.[1] as (event: {
      scope: string
      actorId: string
      at: string
    }) => void
    onEvent({ scope: 'trip', actorId: 'u-2', at: '2026-11-19T03:00:00.000Z' })
    await flushPromises()

    expect(wrapper.text()).toContain('Залог участия: 200 ₽ с человека')
    expect(wrapper.text()).toContain('5 декабря 2026 г.')
    expect(mocks.getTrip.mock.calls.length).toBe(loadsBefore + 1)
  })

  it('событие вкладки шапку не перечитывает', async () => {
    await mountTrip()

    const loadsBefore = mocks.getTrip.mock.calls.length

    const onEvent = mocks.subscribeTripEvents.mock.calls[0]?.[1] as (event: {
      scope: string
      actorId: string
      at: string
    }) => void
    onEvent({ scope: 'gear', actorId: 'u-2', at: '2026-11-19T03:00:00.000Z' })
    await flushPromises()

    expect(mocks.getTrip.mock.calls.length).toBe(loadsBefore)
  })

  it('уходя со страницы, закрывает поток', async () => {
    const stop = vi.fn()
    mocks.subscribeTripEvents.mockReturnValue(stop)

    const { wrapper } = await mountTrip()
    wrapper.unmount()

    expect(stop).toHaveBeenCalled()
  })

  // ───────────────────── присутствие (17.11.2026) ─────────────────────

  /** Своя строка состава: ответ похода статуса участия не содержит. */
  function me(overrides: Partial<TripParticipant> = {}): TripParticipant {
    return {
      userId: 'u-1',
      displayName: 'Тест',
      avatarUrl: null,
      status: 'going',
      roles: [],
      isOrganizer: true,
      isVirtual: false,
      createdAt: '2026-10-14T10:00:00.000Z',
      updatedAt: '2026-10-14T10:00:00.000Z',
      presenceStatus: 'none',
      ...overrides,
    }
  }

  const daysFromNow = (days: number): string =>
    new Date(Date.now() + days * 86_400_000).toISOString()

  it('поход начался — спрашивает, стартанул ли я, и ставит «на маршруте»', async () => {
    mocks.getTrip.mockResolvedValue({
      ...TRIP,
      startsAt: daysFromNow(-1),
      endsAt: daysFromNow(2),
    })
    mocks.listParticipants.mockResolvedValue([me()])
    mocks.setTripPresence.mockResolvedValue(
      me({ presenceStatus: 'route', startedAt: daysFromNow(0) }),
    )

    const { wrapper } = await mountTrip()

    expect(wrapper.get('[data-test="presence-question-text"]').text()).toContain('уже стартанул')

    await wrapper.get('[data-test="presence-start"]').trigger('click')
    await flushPromises()

    expect(mocks.setTripPresence).toHaveBeenCalledWith('1', 'u-1', 'route')
    // Ответ получен — вопрос больше не висит.
    expect(wrapper.find('[data-test="presence-question"]').exists()).toBe(false)
  })

  it('после окончания похода спрашивает о возвращении', async () => {
    mocks.getTrip.mockResolvedValue({
      ...TRIP,
      startsAt: daysFromNow(-5),
      endsAt: daysFromNow(-1),
    })
    mocks.listParticipants.mockResolvedValue([me({ presenceStatus: 'route' })])
    mocks.setTripPresence.mockResolvedValue(
      me({ presenceStatus: 'returned', returnedAt: daysFromNow(0) }),
    )

    const { wrapper } = await mountTrip()

    expect(wrapper.get('[data-test="presence-question-text"]').text()).toContain('вернулся')

    await wrapper.get('[data-test="presence-returned"]').trigger('click')
    await flushPromises()

    expect(mocks.setTripPresence).toHaveBeenCalledWith('1', 'u-1', 'returned')
  })

  it('пока поход идёт, «Я вернулся» — кнопка, а не вопрос', async () => {
    mocks.getTrip.mockResolvedValue({
      ...TRIP,
      startsAt: daysFromNow(-1),
      endsAt: daysFromNow(2),
    })
    mocks.listParticipants.mockResolvedValue([me({ presenceStatus: 'route' })])

    const { wrapper } = await mountTrip()

    expect(wrapper.find('[data-test="presence-question"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="presence-return-row"]').exists()).toBe(true)
  })

  it('без связи возвращение не предлагается (17.11.2026)', async () => {
    mocks.getTrip.mockResolvedValue({
      ...TRIP,
      startsAt: daysFromNow(-1),
      endsAt: daysFromNow(2),
    })
    mocks.listParticipants.mockResolvedValue([me({ presenceStatus: 'route' })])
    useOfflineStore().isOnline = false

    const { wrapper } = await mountTrip()

    // Защита от миссклика: «Я вернулся» без связи не показываем.
    expect(wrapper.find('[data-test="presence-return-row"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="presence-returned"]').exists()).toBe(false)
  })

  it('без связи вопрос о возвращении после похода не задаётся', async () => {
    mocks.getTrip.mockResolvedValue({
      ...TRIP,
      startsAt: daysFromNow(-5),
      endsAt: daysFromNow(-1),
    })
    mocks.listParticipants.mockResolvedValue([me({ presenceStatus: 'route' })])
    useOfflineStore().isOnline = false

    const { wrapper } = await mountTrip()

    expect(wrapper.find('[data-test="presence-question"]').exists()).toBe(false)
  })

  it('отложенный вопрос не показывается до следующего входа', async () => {
    mocks.getTrip.mockResolvedValue({
      ...TRIP,
      startsAt: daysFromNow(-1),
      endsAt: daysFromNow(2),
    })
    mocks.listParticipants.mockResolvedValue([me()])

    const { wrapper } = await mountTrip()

    await wrapper.get('[data-test="presence-later"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="presence-question"]').exists()).toBe(false)
  })

  // ───────────────────── завершение похода (20.11.2026) ─────────────────────

  /** Поход, который закончился по датам и где все идущие уже вернулись. */
  function readyToComplete(overrides: Partial<Trip> = {}): Trip {
    return {
      ...TRIP,
      startsAt: daysFromNow(-5),
      endsAt: daysFromNow(-1),
      // Флаг считает сервер: только автор, все вернулись, поход не завершён.
      canComplete: true,
      completedAt: null,
      ...overrides,
    }
  }

  it('автору после конца похода приходит вопрос «поход состоялся?»', async () => {
    mocks.getTrip.mockResolvedValue(readyToComplete())
    mocks.listParticipants.mockResolvedValue([me({ presenceStatus: 'returned' })])

    const { wrapper } = await mountTrip()

    expect(wrapper.get('[data-test="completion-question-text"]').text()).toContain(
      '«Витязь» благополучно вернулись. Поход состоялся?',
    )
    // Пока не ответили, кнопки в разделе нет: решение за вопросом.
    expect(wrapper.find('[data-test="complete-trip"]').exists()).toBe(false)
  })

  it('«Да» завершает поход: правки закрываются, вопрос исчезает', async () => {
    mocks.getTrip.mockResolvedValue(readyToComplete())
    mocks.listParticipants.mockResolvedValue([me({ presenceStatus: 'returned' })])
    mocks.completeTrip.mockResolvedValue(
      readyToComplete({ canComplete: false, completedAt: daysFromNow(0) }),
    )

    const { wrapper } = await mountTrip()

    await wrapper.get('[data-test="completion-yes"]').trigger('click')
    await flushPromises()

    expect(mocks.completeTrip).toHaveBeenCalledWith('1')
    expect(wrapper.find('[data-test="completion-question"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="trip-completed"]').exists()).toBe(true)
    // Поход закрыт — «Редактировать» и «Закрыть набор» больше не предлагаются.
    expect(wrapper.find('[data-test="trip-edit-link"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="toggle-recruitment"]').exists()).toBe(false)
  })

  it('«Ещё остались правки» — вопрос отложен, кнопка «Завершить поход» в разделе', async () => {
    mocks.getTrip.mockResolvedValue(readyToComplete())
    mocks.listParticipants.mockResolvedValue([me({ presenceStatus: 'returned' })])

    const { wrapper } = await mountTrip()
    await wrapper.get('[data-test="completion-later"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="completion-question"]').exists()).toBe(false)

    const button = wrapper.get('[data-test="complete-trip"]')
    expect(button.text()).toBe('Завершить поход')

    // Кнопка — то же действие, что «Да».
    mocks.completeTrip.mockResolvedValue(
      readyToComplete({ canComplete: false, completedAt: daysFromNow(0) }),
    )
    await button.trigger('click')
    await flushPromises()

    expect(mocks.completeTrip).toHaveBeenCalledWith('1')
    expect(wrapper.find('[data-test="trip-completed"]').exists()).toBe(true)
  })

  it('не автору вопрос не задаётся: флаг приходит с сервера', async () => {
    mocks.getTrip.mockResolvedValue(readyToComplete({ canComplete: false }))
    mocks.listParticipants.mockResolvedValue([me({ presenceStatus: 'returned' })])

    const { wrapper } = await mountTrip()

    expect(wrapper.find('[data-test="completion-question"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="complete-trip"]').exists()).toBe(false)
  })

  // ──────────────────── соорганизатор (20.11.2026) ────────────────────

  /**
   * Соорганизатор равен организатору во всём, кроме пяти отличий
   * ([lifecycle.md](../../../docs/ph/lifecycle.md) §4.5): правка похода
   * и дат — не отличие, поэтому кнопки шапки у него те же. Бейдж в шапке
   * нужен, чтобы человек понимал, почему у него есть эти кнопки.
   */
  it('соорганизатор видит бейдж в шапке и кнопки правки', async () => {
    mocks.getTrip.mockResolvedValue({ ...TRIP, organizerUserId: 'u-org' })
    mocks.listParticipants.mockResolvedValue([
      me({
        isOrganizer: false,
        roles: [{ code: 'coOrganizer', name: 'Соорганизатор' }],
      }),
    ])

    const { wrapper } = await mountTrip()

    expect(wrapper.find('[data-test="trip-coorganizer-badge"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="trip-edit-link"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="toggle-recruitment"]').exists()).toBe(true)
  })

  it('рядовому участнику бейджа и кнопок правки не достаётся', async () => {
    mocks.getTrip.mockResolvedValue({ ...TRIP, organizerUserId: 'u-org' })
    mocks.listParticipants.mockResolvedValue([me({ isOrganizer: false })])

    const { wrapper } = await mountTrip()

    expect(wrapper.find('[data-test="trip-coorganizer-badge"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="trip-edit-link"]').exists()).toBe(false)
  })
})
