import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import type { Trip, TripParticipant, TripTabCode, TripTabPermission } from '@/types/trips'
import TripView from '@/views/trips/TripView.vue'
import type { User } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { useMobileMenuStore } from '@/stores/mobileMenu'

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
  listParticipants: vi.fn(),
  setTripPresence: vi.fn(),
}))

vi.mock('@/api/trips', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/trips')>()
  return {
    ...actual,
    getTrip: mocks.getTrip,
    fetchTripTabs: mocks.fetchTripTabs,
    updateTrip: mocks.updateTrip,
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

async function mountTrip() {
  const router = makeRouter()
  await router.push('/trips/1')
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
})
