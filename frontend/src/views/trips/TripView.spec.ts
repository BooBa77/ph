import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import type { Trip, TripTabCode, TripTabPermission } from '@/types/trips'
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
}))

vi.mock('@/api/trips', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/trips')>()
  return {
    ...actual,
    getTrip: mocks.getTrip,
    fetchTripTabs: mocks.fetchTripTabs,
    updateTrip: mocks.updateTrip,
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
  meetingPlace: null,
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
    expect(items.find((item) => item.key === 'sport')?.available).toBe(false)
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
})
