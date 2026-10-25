import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth'
import type { Trip, TripMealCheck, TripMealPlan } from '@/types/trips'
import TripMeals from '@/views/trips/TripMeals.vue'

/**
 * Вкладка «Питание»: едоки, дни и приёмы, раскладка.
 *
 * Считает бэкенд; здесь проверяем то, что видит человек: едоков с пометками,
 * сетку дней и приёмов, форму приёма, добавление блюда и флаг «питаюсь
 * отдельно». Права: без `canEdit` правок нет.
 */
const mocks = vi.hoisted(() => ({
  fetchMealPlan: vi.fn(),
  addMealDish: vi.fn(),
  removeMealDish: vi.fn(),
  setMealForm: vi.fn(),
  setMealLine: vi.fn(),
  removeMealLine: vi.fn(),
  setMyStatus: vi.fn(),
  createMealPackage: vi.fn(),
  updateMealPackage: vi.fn(),
  removeMealPackage: vi.fn(),
  setMealAllocations: vi.fn(),
  setMealDishExclusions: vi.fn(),
  setMealKulek: vi.fn(),
  fetchMealChecks: vi.fn(),
  updateMealCheck: vi.fn(),
  listTripMessages: vi.fn(),
  sendTripMessage: vi.fn(),
  listDishes: vi.fn(),
  searchProducts: vi.fn(),
}))

vi.mock('@/api/trips', () => ({
  fetchMealPlan: mocks.fetchMealPlan,
  addMealDish: mocks.addMealDish,
  removeMealDish: mocks.removeMealDish,
  setMealForm: mocks.setMealForm,
  setMealLine: mocks.setMealLine,
  removeMealLine: mocks.removeMealLine,
  setMyStatus: mocks.setMyStatus,
  createMealPackage: mocks.createMealPackage,
  updateMealPackage: mocks.updateMealPackage,
  removeMealPackage: mocks.removeMealPackage,
  setMealAllocations: mocks.setMealAllocations,
  setMealDishExclusions: mocks.setMealDishExclusions,
  setMealKulek: mocks.setMealKulek,
  fetchMealChecks: mocks.fetchMealChecks,
  updateMealCheck: mocks.updateMealCheck,
  listTripMessages: mocks.listTripMessages,
  sendTripMessage: mocks.sendTripMessage,
}))

vi.mock('@/api/meals', () => ({
  listDishes: mocks.listDishes,
  searchProducts: mocks.searchProducts,
}))

const ORGANIZER = 'u-org'
const MEMBER = 'u-member'

const TRIP: Trip = {
  id: '7',
  organizerUserId: ORGANIZER,
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
  // Локальная полночь: «00:00 — время не задано», все приёмы видны.
  startsAt: new Date(2027, 4, 5).toISOString(),
  endsAt: new Date(2027, 4, 6).toISOString(),
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

function plan(): TripMealPlan {
  return {
    dayCount: 2,
    eaters: {
      total: 2,
      men: 1,
      women: 1,
      vegetarians: 1,
      people: [
        {
          userId: ORGANIZER,
          displayName: 'Организатор',
          avatarUrl: null,
          gender: 'm',
          isVegetarian: false,
          allergies: null,
          eatsSeparately: false,
        },
        {
          userId: MEMBER,
          displayName: 'Вегетарианка',
          avatarUrl: null,
          gender: 'f',
          isVegetarian: true,
          allergies: 'орехи',
          eatsSeparately: false,
        },
      ],
    },
    meals: [
      {
        id: 'm1',
        dayIndex: 1,
        kind: 'breakfast',
        form: 'cook',
        dishes: [
          {
            dishId: 'd1',
            title: 'Каша',
            ingredients: [
              { productId: 1, name: 'Крупа', unit: 'g', amount: 80, isMeat: false },
            ],
            excludedProductIds: [],
          },
        ],
        products: [
          {
            productId: 1,
            name: 'Крупа',
            unit: 'g',
            weightPerUnitGrams: 1,
            recipeAmount: 160,
            manualAmount: 0,
            amount: 160,
            isMeat: false,
            fromDishes: ['Каша'],
            allocations: [],
          },
        ],
        weightGrams: 160,
      },
      {
        id: 'm2',
        dayIndex: 1,
        kind: 'lunch',
        form: 'cook',
        dishes: [],
        products: [],
        weightGrams: 0,
      },
    ],
    packages: [
      {
        id: 'p1',
        name: 'Пакет 1',
        kind: 'normal',
        mealId: null,
        weightActualGrams: null,
        weightActualStale: false,
        weightEstimatedGrams: 0,
        items: [
          {
            mealId: 'm1',
            dayIndex: 1,
            kind: 'breakfast',
            productId: 1,
            name: 'Крупа',
            amount: 160,
            isElastic: false,
            weightGrams: 160,
          },
        ],
      },
    ],
  }
}

function checks(): TripMealCheck[] {
  return [
    {
      productId: 1,
      name: 'Крупа',
      unit: 'g',
      weightPerUnitGrams: 1,
      needAmount: 160,
      needGrams: 160,
      isBought: false,
      isHome: false,
      boughtAmount: null,
      boughtByName: null,
      boughtAt: null,
      isOrphaned: false,
    },
    {
      productId: 2,
      name: 'Тушёнка',
      unit: 'can',
      weightPerUnitGrams: 340,
      needAmount: 1,
      needGrams: 340,
      isBought: true,
      isHome: false,
      boughtAmount: 1,
      boughtByName: 'Вегетарианка',
      boughtAt: '2026-10-21T10:00:00.000Z',
      isOrphaned: false,
    },
    {
      productId: 3,
      name: 'Старая крупа',
      unit: 'g',
      weightPerUnitGrams: 1,
      needAmount: 0,
      needGrams: 0,
      isBought: true,
      isHome: false,
      boughtAmount: 500,
      boughtByName: 'Организатор',
      boughtAt: '2026-10-21T10:00:00.000Z',
      isOrphaned: true,
    },
  ]
}

function signIn() {
  const auth = useAuthStore()
  auth.user = {
    id: ORGANIZER,
    displayName: 'Организатор',
    location: null,
    avatarUrl: null,
    gender: 'm',
    isVegetarian: false,
    allergies: null,
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
  } as never
}

async function mountMeals(canEdit = true) {
  const wrapper = mount(TripMeals, { props: { trip: TRIP, canEdit } })
  await flushPromises()

  return wrapper
}

describe('TripMeals', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    signIn()

    const current = plan()
    mocks.fetchMealPlan.mockResolvedValue(current)
    mocks.addMealDish.mockResolvedValue(current)
    mocks.removeMealDish.mockResolvedValue(current)
    mocks.setMealForm.mockResolvedValue(current)
    mocks.setMealLine.mockResolvedValue(current)
    mocks.removeMealLine.mockResolvedValue(current)
    mocks.setMyStatus.mockResolvedValue({})
    mocks.createMealPackage.mockResolvedValue(current)
    mocks.updateMealPackage.mockResolvedValue(current)
    mocks.removeMealPackage.mockResolvedValue(current)
    mocks.setMealAllocations.mockImplementation(
      async (
        _tripId: string,
        _day: number,
        _kind: string,
        productId: number,
        rows: Array<{ packageId: string; amount: number; isElastic: boolean }>,
      ) => {
        const next = current
        const product = next.meals[0]?.products.find(
          (row) => row.productId === productId,
        )
        if (product) product.allocations = rows

        return next
      },
    )
    mocks.setMealDishExclusions.mockResolvedValue(current)
    mocks.setMealKulek.mockResolvedValue(current)
    mocks.fetchMealChecks.mockResolvedValue(checks())
    mocks.listTripMessages.mockResolvedValue({ messages: [], nextCursor: null })
    mocks.updateMealCheck.mockImplementation(
      async (_tripId: string, productId: number, patch: Record<string, unknown>) =>
        checks().map((row) => (row.productId === productId ? { ...row, ...patch } : row)),
    )
    mocks.listDishes.mockResolvedValue([
      {
        id: 'd2',
        title: 'Суп',
        note: null,
        ingredients: [],
        totalGrams: 0,
        createdAt: '2026-10-14T10:00:00.000Z',
      },
    ])
    mocks.searchProducts.mockResolvedValue([])
  })

  it('показывает едоков с полом, вегетарианцами и аллергиями', async () => {
    const wrapper = await mountMeals()

    expect(wrapper.find('[data-test="eaters-counts"]').text()).toContain('в общей раскладке')
    expect(wrapper.find('[data-test="eaters-counts"]').text()).toContain('вегетарианцев 1')
    expect(wrapper.find('[data-test="eaters-list"]').text()).toContain('Вегетарианка')
    expect(wrapper.find('[data-test="eaters-list"]').text()).toContain('орехи')
  })

  it('рисует дни и приёмы, даже пустые', async () => {
    const wrapper = await mountMeals()

    expect(wrapper.findAll('[data-test="meal-day"]')).toHaveLength(2)
    expect(wrapper.find('[data-test="meal-1-breakfast"]').text()).toContain('1з')
    expect(wrapper.find('[data-test="meal-1-breakfast"]').text()).toContain('Каша')
    expect(wrapper.find('[data-test="meal-2-dinner"]').text()).toContain('Пусто')
  })

  it('переключает форму приёма: готовка или перекус', async () => {
    const wrapper = await mountMeals()

    await wrapper.find('[data-test="meal-form-snack"]').trigger('click')
    await flushPromises()

    expect(mocks.setMealForm).toHaveBeenCalledWith('7', 1, 'breakfast', 'snack')
  })

  it('добавляет своё блюдо в приём', async () => {
    const wrapper = await mountMeals()

    await wrapper
      .find('[data-test="meal-dish-select-1-lunch"]')
      .setValue('d2')
    await flushPromises()

    expect(mocks.addMealDish).toHaveBeenCalledWith('7', 1, 'lunch', 'd2')
  })

  it('без права правки нет ни формы, ни добавления', async () => {
    const wrapper = await mountMeals(false)

    expect(wrapper.find('[data-test="meal-form"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="meal-add"]').exists()).toBe(false)
    // Флаг «питаюсь отдельно» — свой, он остаётся.
    expect(wrapper.find('[data-test="eats-separately"]').exists()).toBe(true)
  })

  it('флаг «питаюсь отдельно» ставится через PATCH и перечитывает раскладку', async () => {
    const wrapper = await mountMeals()

    await wrapper.find('[data-test="eats-separately"]').setValue(true)
    await flushPromises()

    expect(mocks.setMyStatus).toHaveBeenCalledWith('7', 'going', true)
    expect(mocks.fetchMealPlan).toHaveBeenCalledTimes(2)
  })

  it('показывает пакеты и их расчётный вес', async () => {
    const wrapper = await mountMeals()

    const name = wrapper.find('[data-test="package-name"]').element as HTMLInputElement
    expect(name.value).toBe('Пакет 1')
    expect(wrapper.find('[data-test="packages"]').text()).toContain('расчёт')
  })

  it('новый пакет создаётся кнопкой', async () => {
    const wrapper = await mountMeals()

    await wrapper.find('[data-test="package-add"]').trigger('click')
    await flushPromises()

    expect(mocks.createMealPackage).toHaveBeenCalledWith('7')
  })

  it('строку раскладывают по пакетам фиксированной долей', async () => {
    const wrapper = await mountMeals()

    // Продукт есть в списке; фасовка — в пакетах.
    expect(wrapper.find('[data-test="meal-products"]').text()).not.toContain('Крупа')

    await wrapper.find('[data-test="ing-pack-d1-1"]').setValue('p1')
    await wrapper.find('[data-test="ing-amount-d1-1"]').setValue('100')
    await flushPromises()

    expect(mocks.setMealAllocations).toHaveBeenCalledWith('7', 1, 'breakfast', 1, [
      { packageId: 'p1', amount: 100, isElastic: false },
    ])
  })

  it('«всё» раскладывает строку целиком', async () => {
    const wrapper = await mountMeals()

    await wrapper.find('[data-test="ing-pack-d1-1"]').setValue('p1')
    await wrapper.find('[data-test="ing-amount-d1-1"]').setValue('all')
    await flushPromises()

    expect(mocks.setMealAllocations).toHaveBeenCalledWith('7', 1, 'breakfast', 1, [
      { packageId: 'p1', amount: 0, isElastic: true },
    ])
  })

  it('ингредиент блюда убирается в приёме и возвращается', async () => {
    const wrapper = await mountMeals()

    await wrapper.find('[data-test="dish-ing-d1-1"]').trigger('click')
    await flushPromises()

    expect(mocks.setMealDishExclusions).toHaveBeenCalledWith('7', 1, 'breakfast', 'd1', [1])
  })

  it('кулёк приёма включается кнопкой', async () => {
    const wrapper = await mountMeals()

    await wrapper.find('[data-test="meal-kulek-1-breakfast"]').trigger('click')
    await flushPromises()

    expect(mocks.setMealKulek).toHaveBeenCalledWith('7', 1, 'breakfast', true)
  })

  it('фактический вес пакета сохраняется', async () => {
    const wrapper = await mountMeals()

    const input = wrapper.find('[data-test="package-weight"]')
    await input.setValue('500')
    await input.trigger('change')
    await flushPromises()

    expect(mocks.updateMealPackage).toHaveBeenCalledWith('7', 'p1', {
      weightActualGrams: 500,
    })
  })

  it('чек-лист открывается кнопкой: проекция и отметки', async () => {
    const wrapper = await mountMeals()

    await wrapper.find('[data-test="checklist-toggle"]').trigger('click')
    await flushPromises()

    expect(mocks.fetchMealChecks).toHaveBeenCalledWith('7')
    expect(wrapper.findAll('[data-test="check-row"]')).toHaveLength(3)
    expect(wrapper.text()).toContain('надо')
    expect(wrapper.text()).toContain('купил(а): Вегетарианка')
  })

  it('отметка «куплено» ставится любым участником', async () => {
    const wrapper = await mountMeals()

    await wrapper.find('[data-test="checklist-toggle"]').trigger('click')
    await flushPromises()

    const box = wrapper.findAll('[data-test="check-bought"]')[0]
    expect(box).toBeTruthy()
    await box!.setValue(true)
    await flushPromises()

    expect(mocks.updateMealCheck).toHaveBeenCalledWith('7', 1, { isBought: true })
  })

  it('продукт, ушедший из плана, помечен', async () => {
    const wrapper = await mountMeals()

    await wrapper.find('[data-test="checklist-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('нет в плане')
  })
})
