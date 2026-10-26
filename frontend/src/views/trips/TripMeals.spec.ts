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
  fetchMyMealPlan: vi.fn(),
  addMyMealDish: vi.fn(),
  removeMyMealDish: vi.fn(),
  setMyMealDishExclusions: vi.fn(),
  addMyMealLine: vi.fn(),
  removeMyMealLine: vi.fn(),
  fetchMyMealChecks: vi.fn(),
  updateMyMealCheck: vi.fn(),
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
  fetchMyMealPlan: mocks.fetchMyMealPlan,
  addMyMealDish: mocks.addMyMealDish,
  removeMyMealDish: mocks.removeMyMealDish,
  setMyMealDishExclusions: mocks.setMyMealDishExclusions,
  addMyMealLine: mocks.addMyMealLine,
  removeMyMealLine: mocks.removeMyMealLine,
  fetchMyMealChecks: mocks.fetchMyMealChecks,
  updateMyMealCheck: mocks.updateMyMealCheck,
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
      {
        id: 'p2',
        name: 'Пакет 2',
        kind: 'normal',
        mealId: null,
        weightActualGrams: null,
        weightActualStale: false,
        weightEstimatedGrams: 0,
        items: [],
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

/**
 * Личный слой участника: своё блюдо и свой продукт в завтраке первого дня.
 *
 * Он живёт в тех же плашках приёма, поэтому по умолчанию загружен: так
 * проверяются и личные строки, и карточка «Мои продукты», и то, что общие
 * тесты не ломаются от соседства.
 */
function myPlan(): TripMealPlan {
  return {
    dayCount: 2,
    eaters: {
      total: 1,
      men: 1,
      women: 0,
      vegetarians: 0,
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
      ],
    },
    meals: [
      {
        id: 'my1',
        dayIndex: 1,
        kind: 'breakfast',
        form: 'cook',
        dishes: [
          {
            dishId: 'dm1',
            title: 'Мой суп',
            ingredients: [
              { productId: 11, name: 'Сыр', unit: 'g', amount: 40, isMeat: false },
              { productId: 13, name: 'Соль', unit: 'g', amount: 5, isMeat: false },
            ],
            excludedProductIds: [],
          },
        ],
        products: [
          // Ингредиент блюда: в списке продуктов его быть не должно —
          // он уже показан чипом в составе, иначе он «дублируется».
          {
            productId: 11,
            name: 'Сыр',
            unit: 'g',
            weightPerUnitGrams: 1,
            recipeAmount: 40,
            manualAmount: 0,
            amount: 40,
            isMeat: false,
            fromDishes: ['Мой суп'],
            allocations: [],
          },
          // Свой продукт рукой — только он и попадает в список продуктов.
          {
            productId: 12,
            name: 'Хлеб',
            unit: 'g',
            weightPerUnitGrams: 1,
            recipeAmount: 0,
            manualAmount: 80,
            amount: 80,
            isMeat: false,
            fromDishes: [],
            allocations: [],
          },
        ],
        weightGrams: 120,
      },
    ],
    packages: [],
  }
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

/**
 * Раскладка, которую тесты правят перед монтированием: `fetchMealPlan`
 * отдаёт именно её, а `setMealAllocations` возвращает её же с новыми долями.
 */
let currentPlan: TripMealPlan

/** Личный план: ответы личных ручек тоже должны быть согласованы. */
let currentMyPlan: TripMealPlan

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
    currentPlan = current
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

    const currentMy = myPlan()
    currentMyPlan = currentMy
    mocks.fetchMyMealPlan.mockResolvedValue(currentMy)
    mocks.addMyMealDish.mockResolvedValue(currentMy)
    mocks.removeMyMealDish.mockResolvedValue(currentMy)
    mocks.setMyMealDishExclusions.mockResolvedValue(currentMy)
    mocks.addMyMealLine.mockResolvedValue(currentMy)
    mocks.removeMyMealLine.mockResolvedValue(currentMy)
    mocks.fetchMyMealChecks.mockResolvedValue([])
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

  it('иконка в углу плашки сворачивает её до результата', async () => {
    const wrapper = await mountMeals()

    const card = () => wrapper.find('[data-test="meal-1-breakfast"]')

    expect(card().find('[data-test="meal-dish-select-1-breakfast"]').exists()).toBe(true)
    expect(card().find('[data-test="meal-line-amount-1-breakfast"]').exists()).toBe(true)
    expect(card().find('[data-test="meal-form"]').exists()).toBe(true)
    expect(card().find('[data-test="meal-kulek-1-breakfast"]').exists()).toBe(true)

    await wrapper.find('[data-test="meal-add-toggle-1-breakfast"]').trigger('click')
    await flushPromises()

    // Поля сборки спрятаны: выбор блюда и продукта.
    expect(card().find('[data-test="meal-dish-select-1-breakfast"]').exists()).toBe(false)
    expect(card().find('[data-test="meal-line-amount-1-breakfast"]').exists()).toBe(false)
    // Кулёк остаётся: это фасовка, у неё своя кнопка.
    expect(card().find('[data-test="meal-kulek-1-breakfast"]').exists()).toBe(true)
    // Форма приёма остаётся: это режим (готовка/перекус), а не поле ввода.
    // Заказчик назвал багом, что она сворачивалась вместе с полями.
    expect(card().find('[data-test="meal-form"]').exists()).toBe(true)
    // Результат на месте: название приёма, вес, блюдо.
    expect(card().text()).toContain('Завтрак')
    expect(card().find('[data-test="meal-weight"]').exists()).toBe(true)
    expect(card().text()).toContain('Каша')
    // Фасовка — отдельный вопрос и отдельная кнопка: «свернуть поля»
    // выбор пакета не трогает.
    expect(card().find('[data-test="ing-pack-d1-1"]').exists()).toBe(true)
    // Общее свёртывание не прячет личные поля.
    expect(card().find('[data-test="my-meal-add"]').exists()).toBe(true)

    await wrapper.find('[data-test="meal-add-toggle-1-breakfast"]').trigger('click')
    await flushPromises()

    expect(card().find('[data-test="meal-dish-select-1-breakfast"]').exists()).toBe(true)
    expect(card().find('[data-test="meal-form"]').exists()).toBe(true)
  })

  it('третья кнопка сворачивает фасовку, не трогая пакеты и блюда', async () => {
    const wrapper = await mountMeals()

    const card = () => wrapper.find('[data-test="meal-1-breakfast"]')
    const packs = () =>
      card().findAll('[data-test^="ing-pack"], [data-test^="alloc-pack"]')

    expect(packs().length).toBeGreaterThan(0)
    expect(card().find('[data-test="meal-kulek-1-breakfast"]').exists()).toBe(true)

    await wrapper.find('[data-test="meal-pack-toggle-1-breakfast"]').trigger('click')
    await flushPromises()

    // Выбор пакета и кулёк ушли, а состав приёма остался: именно это и нужно
    // человеку, который смотрит «что едим», а не «во что уложено».
    expect(packs()).toHaveLength(0)
    expect(card().find('[data-test="meal-kulek-1-breakfast"]').exists()).toBe(false)
    expect(card().text()).toContain('Каша')
    expect(card().text()).toContain('Крупа')
    // Форма приёма и вес — не фасовка, они на месте.
    expect(card().find('[data-test="meal-form"]').exists()).toBe(true)
    expect(card().find('[data-test="meal-weight"]').exists()).toBe(true)

    // Секция «Пакеты» живёт своей жизнью: это не раскладка.
    const packages = wrapper.find('[data-test="packages"]')
    expect(packages.exists()).toBe(true)
    expect(packages.findAll('[data-test="package"]').length).toBeGreaterThan(0)

    // И обратно: кнопка возвращает выбор пакета.
    await wrapper.find('[data-test="meal-pack-toggle-1-breakfast"]').trigger('click')
    await flushPromises()

    expect(packs().length).toBeGreaterThan(0)
  })

  it('фасовка сворачивается сразу во всех приёмах', async () => {
    const wrapper = await mountMeals()

    // Кнопка в завтраке — а прячет выбор пакета везде: это режим просмотра,
    // а не настройка отдельного приёма (решение заказчика 26.10.2026).
    await wrapper.find('[data-test="meal-pack-toggle-1-breakfast"]').trigger('click')
    await flushPromises()

    const anywhere = wrapper.findAll('[data-test^="ing-pack"], [data-test^="alloc-pack"]')
    expect(anywhere).toHaveLength(0)
    // У обеда своя кнопка, и она тоже показывает свёрнутое состояние.
    expect(
      wrapper.get('[data-test="meal-pack-toggle-1-lunch"]').attributes('aria-expanded'),
    ).toBe('false')
  })

  it('иконки есть и у пустого приёма, и он сворачивается', async () => {
    const wrapper = await mountMeals()

    // Пустая плашка тоже сворачивается: с автономным питанием их много.
    expect(wrapper.find('[data-test="meal-add-toggle-2-dinner"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="meals-collapse-all-2-dinner"]').exists()).toBe(true)

    await wrapper.find('[data-test="meal-add-toggle-2-dinner"]').trigger('click')
    await flushPromises()

    const card = wrapper.find('[data-test="meal-2-dinner"]')
    expect(card.find('[data-test="meal-add"]').exists()).toBe(false)
    expect(card.text()).toContain('Пусто')

    // Без права правки иконок нет: полей добавления там нет вовсе.
    const guest = await mountMeals(false)
    expect(guest.find('[data-test="meal-add-toggle-2-dinner"]').exists()).toBe(false)
  })

  it('двойной шеврон сворачивает и разворачивает все плашки', async () => {
    const wrapper = await mountMeals()
    const card = (key: string) => wrapper.find(`[data-test="meal-${key}"]`)
    const all = () => wrapper.find('[data-test="meals-collapse-all-1-breakfast"]')

    // Приёмы с данными: завтрак и обед первого дня.
    expect(card('1-breakfast').find('[data-test="meal-form"]').exists()).toBe(true)
    expect(card('1-lunch').find('[data-test="meal-form"]').exists()).toBe(true)

    await all().trigger('click')
    await flushPromises()

    // Форма приёма видна и после общего свёртывания — см. предыдущий тест.
    expect(card('1-breakfast').find('[data-test="meal-form"]').exists()).toBe(true)
    expect(card('1-lunch').find('[data-test="meal-form"]').exists()).toBe(true)
    expect(card('1-breakfast').find('[data-test="meal-dish-select-1-breakfast"]').exists()).toBe(false)
    // Пустые плашки тоже свернулись: их формы добавления спрятаны.
    expect(card('2-dinner').find('[data-test="meal-add"]').exists()).toBe(false)
    // Иконка теперь предлагает разворот.
    expect(all().attributes('title')).toBe('Развернуть все приёмы')

    await all().trigger('click')
    await flushPromises()

    expect(card('1-breakfast').find('[data-test="meal-form"]').exists()).toBe(true)
    expect(card('1-lunch').find('[data-test="meal-form"]').exists()).toBe(true)
    expect(card('2-dinner').find('[data-test="meal-add"]').exists()).toBe(true)
    expect(all().attributes('title')).toBe('Свернуть все приёмы')
  })

  it('флаг «питаюсь отдельно» ставится через PATCH и перечитывает раскладку', async () => {
    const wrapper = await mountMeals()

    await wrapper.find('[data-test="eats-separately"]').setValue(true)
    await flushPromises()

    expect(mocks.setMyStatus).toHaveBeenCalledWith('7', 'going', true)
    expect(mocks.fetchMealPlan).toHaveBeenCalledTimes(2)
  })

  it('без права правки видны личные поля, а общие — нет', async () => {
    const wrapper = await mountMeals(false)

    // Личный слой ведёт любой идущий: свои поля есть и без прав на общие.
    expect(wrapper.find('[data-test="my-meal-add"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="my-meal-dish-select-1-breakfast"]').exists()).toBe(true)

    // А общие формы — только у завхоза.
    expect(wrapper.find('[data-test="meal-add"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="meal-dish-select-1-breakfast"]').exists()).toBe(false)
  })

  it('личный продукт добавляется в приём', async () => {
    const wrapper = await mountMeals()

    await wrapper
      .find('[data-test="my-meal-add"] [data-test="product-search"]')
      .setValue('Хлеб')
    await wrapper.find('[data-test="my-meal-line-amount-1-breakfast"]').setValue('200')
    await flushPromises()

    await wrapper.find('[data-test="my-meal-line-add-1-breakfast"]').trigger('click')
    await flushPromises()

    expect(mocks.addMyMealLine).toHaveBeenCalledWith('7', 1, 'breakfast', {
      amount: 200,
      name: 'Хлеб',
    })
  })

  it('личные строки идут выше общих и покрашены в синий', async () => {
    const wrapper = await mountMeals()
    const card = wrapper.find('[data-test="meal-1-breakfast"]')

    const myDish = card.find('[data-test="my-meal-dish"]')
    expect(myDish.text()).toContain('Мой суп')
    expect(myDish.find('span').classes()).toContain('text-blue-700')

    // В списке продуктов — только своя ручная строка, ингредиент блюда
    // живёт чипом в составе и сюда не дублируется.
    const myProduct = card.find('[data-test="my-meal-product"]')
    expect(myProduct.text()).toContain('Хлеб')
    expect(card.findAll('[data-test="my-meal-product"]')).toHaveLength(1)
    expect(myProduct.find('span').classes()).toContain('text-blue-700')

    // Личные строки стоят выше общих в разметке плашки.
    const rows = card.findAll('[data-test="my-meal-dish"], [data-test="meal-dish"]')
    expect(rows[0]!.attributes('data-test')).toBe('my-meal-dish')
  })

  it('ингредиент моего блюда убирается крестиком и возвращается', async () => {
    const wrapper = await mountMeals()
    const card = wrapper.find('[data-test="meal-1-breakfast"]')

    // У Сыра (id 11) в составе есть крестик: исключение живёт в моём приёме.
    const cross = card.find('[data-test="my-dish-ing-dm1-11"]')
    expect(cross.exists()).toBe(true)

    await cross.trigger('click')
    await flushPromises()

    expect(mocks.setMyMealDishExclusions).toHaveBeenCalledWith(
      '7',
      1,
      'breakfast',
      'dm1',
      [11],
    )
  })

  it('вес моих продуктов запоминается в браузере', async () => {
    const wrapper = await mountMeals()

    const input = wrapper.find('[data-test="my-products-weight"]')
    expect(input.exists()).toBe(true)

    await input.setValue('950')
    await input.trigger('change')
    await flushPromises()

    expect(window.localStorage.getItem(`ph.myFoodWeight.7.${ORGANIZER}`)).toBe('950')
  })

  it('«Список моих продуктов» открывает личный чек-лист', async () => {
    const wrapper = await mountMeals()

    await wrapper.find('[data-test="my-checklist-toggle"]').trigger('click')
    await flushPromises()

    expect(mocks.fetchMyMealChecks).toHaveBeenCalledWith('7')
    expect(mocks.fetchMealChecks).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="checklist"]').attributes('role')).toBe('dialog')
  })

  it('личный двойной шеврон сворачивает мои поля во всех плашках', async () => {
    const wrapper = await mountMeals()
    const card = (key: string) => wrapper.find(`[data-test="meal-${key}"]`)

    expect(wrapper.find('[data-test="my-meal-add"]').exists()).toBe(true)

    await wrapper.find('[data-test="my-meals-collapse-all-1-breakfast"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="my-meal-add"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="my-meal-dish-select-1-breakfast"]').exists()).toBe(false)
    // Общие поля свёртывание личных не трогает.
    expect(card('1-breakfast').find('[data-test="meal-add"]').exists()).toBe(true)
    expect(card('1-breakfast').find('[data-test="meal-form"]').exists()).toBe(true)

    await wrapper.find('[data-test="my-meals-collapse-all-1-breakfast"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="my-meal-add"]').exists()).toBe(true)
  })

  it('синяя карточка «Мои продукты» показывает вес и продукт', async () => {
    const wrapper = await mountMeals()

    const card = wrapper.find('[data-test="my-products"]')
    expect(card.exists()).toBe(true)
    expect(card.classes()).toContain('bg-blue-50')
    expect(card.text()).toContain('Мои продукты')
    expect(card.text()).toContain('расчётно')
    expect(card.text()).toContain('Сыр')
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

  it('количество заблокировано, пока не выбран пакет', async () => {
    const wrapper = await mountMeals()

    const amount = () =>
      wrapper.find('[data-test="ing-amount-d1-1"]').element as HTMLSelectElement

    // У строки без пакета количество — «всё», а не максимальное число.
    expect(amount().value).toBe('all')
    expect(amount().disabled).toBe(true)

    await wrapper.find('[data-test="ing-pack-d1-1"]').setValue('p1')
    await flushPromises()

    expect(amount().disabled).toBe(false)
  })

  it('кулёк виден в списках своего приёма и не оставляет пустых полей', async () => {
    currentPlan.packages.push({
      id: 'pk',
      name: '1з',
      kind: 'kulek',
      mealId: 'm1',
      weightActualGrams: null,
      weightActualStale: false,
      weightEstimatedGrams: 160,
      items: [],
    })
    currentPlan.meals[0]!.products[0]!.allocations = [
      { packageId: 'pk', amount: 160, isElastic: true },
    ]

    const wrapper = await mountMeals()

    const pack = () =>
      wrapper.find('[data-test="ing-pack-d1-1"]').element as HTMLSelectElement
    const amount = () =>
      wrapper.find('[data-test="ing-amount-d1-1"]').element as HTMLSelectElement

    expect(wrapper.find('[data-test="ing-pack-d1-1"]').text()).toContain('1з · кулёк')
    expect(pack().value).toBe('pk')
    expect(amount().value).toBe('all')
    // У кулька количество всегда «всё»: правка расформировала бы его.
    expect(amount().disabled).toBe(true)

    // Другой пакет расформировывает кулёк — без подтверждения, как решили.
    await wrapper.find('[data-test="ing-pack-d1-1"]').setValue('p2')
    await flushPromises()

    expect(mocks.setMealAllocations).toHaveBeenCalledWith('7', 1, 'breakfast', 1, [
      { packageId: 'p2', amount: 0, isElastic: true },
    ])
    // Кулёк больше не пакет этой строки — и в списке его нет.
    expect(wrapper.find('[data-test="ing-pack-d1-1"]').text()).not.toContain('кулёк')
  })

  it('у строки кулька есть крестик, и он убирает продукт', async () => {
    currentPlan.packages.push({
      id: 'pk',
      name: '1з',
      kind: 'kulek',
      mealId: 'm1',
      weightActualGrams: null,
      weightActualStale: false,
      weightEstimatedGrams: 160,
      items: [],
    })
    currentPlan.meals[0]!.products[0]!.allocations = [
      { packageId: 'pk', amount: 160, isElastic: true },
    ]

    const wrapper = await mountMeals()

    // Разделить кулёк нельзя, а убрать продукт — можно.
    expect(wrapper.find('[data-test="ing-action-d1-1-0"]').exists()).toBe(true)

    await wrapper.find('[data-test="ing-action-d1-1-0"]').trigger('click')
    await flushPromises()

    // Ингредиент один — уходит блюдо; доли кулька не перекраиваем.
    expect(mocks.removeMealDish).toHaveBeenCalledWith('7', 1, 'breakfast', 'd1')
    expect(mocks.setMealAllocations).not.toHaveBeenCalled()
  })

  it('остаток — такая же строка с другим весом и своим пакетом', async () => {
    const wrapper = await mountMeals()

    // Кладём в пакет 100 из 160 — на экране появляется вторая строка с 60.
    await wrapper.find('[data-test="ing-pack-d1-1"]').setValue('p1')
    await flushPromises()
    await wrapper.find('[data-test="ing-amount-d1-1"]').setValue('100')
    await flushPromises()

    const first = wrapper.find('[data-test="ing-row-d1-1-0"]')
    const second = wrapper.find('[data-test="ing-row-d1-1-1"]')

    expect(first.exists()).toBe(true)
    expect(second.exists()).toBe(true)
    // Строка остатка — без подписей и цвета, с тем же названием и весом.
    expect(second.text()).toContain('Крупа')
    expect(second.text()).toContain('60 г')
    expect(second.text()).not.toContain('остаток')
    // «Равна родителю»: та же обводка, а крестик — отдельной кнопкой рядом.
    const chip = second.find('[data-test="dish-ing-d1-1-2"]')
    expect(chip.classes()).toContain('rounded-full')
    expect(chip.classes()).toContain('border')
    expect(second.find('[data-test="ing-action-d1-1-1"]').text()).toBe('×')
    // Поля те же: выбор пакета (включая «новый пакет») и количество.
    expect(
      second.find('[data-test="ing-pack-d1-1-2"]').text(),
    ).toContain('новый пакет')
    expect(
      (second.find('[data-test="ing-amount-d1-1-2"]').element as HTMLSelectElement)
        .disabled,
    ).toBe(true)

    // Остаток кладём в другой пакет — он становится обычной долей.
    await second.find('[data-test="ing-pack-d1-1-2"]').setValue('p2')
    await flushPromises()

    expect(mocks.setMealAllocations).toHaveBeenCalledWith('7', 1, 'breakfast', 1, [
      { packageId: 'p1', amount: 100, isElastic: false },
      { packageId: 'p2', amount: 60, isElastic: false },
    ])
  })

  it('остаток продукта — такая же строка без подписи остатка', async () => {
    currentPlan.meals[0]!.products.push({
      productId: 2,
      name: 'Хлеб',
      unit: 'g',
      weightPerUnitGrams: 1,
      recipeAmount: 0,
      manualAmount: 200,
      amount: 200,
      isMeat: false,
      fromDishes: [],
      allocations: [],
    })

    const wrapper = await mountMeals()

    // У нового продукта количество — «всё» и заблокировано.
    const fresh = wrapper.find('[data-test="alloc-amount-2"]')
      .element as HTMLSelectElement
    expect(fresh.value).toBe('all')
    expect(fresh.disabled).toBe(true)

    // 150 из 200 в пакет — остаток 50 встаёт второй такой же строкой.
    await wrapper.find('[data-test="alloc-pack-2"]').setValue('p1')
    await flushPromises()
    await wrapper.find('[data-test="alloc-amount-2"]').setValue('150')
    await flushPromises()

    const second = wrapper.find('[data-test="meal-product-2-1"]')

    expect(second.exists()).toBe(true)
    expect(second.text()).toContain('Хлеб')
    expect(second.text()).toContain('50 г')
    expect(second.text()).not.toContain('остаток')
    expect(second.find('[data-test="alloc-pack-2-2"]').text()).toContain('новый пакет')
    expect(
      (second.find('[data-test="alloc-amount-2-2"]').element as HTMLSelectElement)
        .disabled,
    ).toBe(true)
    // У остатка продукта тоже есть крестик.
    expect(second.find('[data-test="meal-line-remove-2-2"]').exists()).toBe(true)

    await second.find('[data-test="alloc-pack-2-2"]').setValue('p2')
    await flushPromises()

    expect(mocks.setMealAllocations).toHaveBeenCalledWith('7', 1, 'breakfast', 2, [
      { packageId: 'p1', amount: 150, isElastic: false },
      { packageId: 'p2', amount: 50, isElastic: false },
    ])
  })

  it('у блюда из двух ингредиентов убирается один, а не всё блюдо', async () => {
    // Второй ингредиент и его продукт: иначе блюдо из одного, и убрать
    // единственный — значит убрать блюдо целиком (см. следующий тест).
    currentPlan.meals[0]!.dishes[0]!.ingredients.push({
      productId: 2,
      name: 'Соль',
      unit: 'g',
      amount: 5,
      isMeat: false,
    })
    currentPlan.meals[0]!.products.push({
      productId: 2,
      name: 'Соль',
      unit: 'g',
      weightPerUnitGrams: 1,
      recipeAmount: 5,
      manualAmount: 0,
      amount: 5,
      isMeat: false,
      fromDishes: ['Каша'],
      allocations: [],
    })

    const wrapper = await mountMeals()

    await wrapper.find('[data-test="ing-action-d1-2-0"]').trigger('click')
    await flushPromises()

    expect(mocks.setMealDishExclusions).toHaveBeenCalledWith('7', 1, 'breakfast', 'd1', [2])
    expect(mocks.removeMealDish).not.toHaveBeenCalled()
  })

  it('последний ингредиент убирает блюдо целиком, а не оставляет пустое', async () => {
    const wrapper = await mountMeals()

    // У блюда d1 один ингредиент: убираем его — уходит и блюдо.
    await wrapper.find('[data-test="ing-action-d1-1-0"]').trigger('click')
    await flushPromises()

    expect(mocks.removeMealDish).toHaveBeenCalledWith('7', 1, 'breakfast', 'd1')
    expect(mocks.setMealDishExclusions).not.toHaveBeenCalled()
  })

  it('крестик доли убирает эту порцию и её количество из плана', async () => {
    const wrapper = await mountMeals()

    // Кладём 100 из 160: первая строка — доля в пакете, вторая — остаток.
    await wrapper.find('[data-test="ing-pack-d1-1"]').setValue('p1')
    await flushPromises()
    await wrapper.find('[data-test="ing-amount-d1-1"]').setValue('100')
    await flushPromises()

    await wrapper.find('[data-test="ing-action-d1-1-0"]').trigger('click')
    await flushPromises()

    // Доля убрана, и её количество ушло из плана: «не расфасовано» не растёт.
    expect(mocks.setMealAllocations).toHaveBeenCalledWith('7', 1, 'breakfast', 1, [])
    expect(mocks.setMealLine).toHaveBeenCalledWith('7', 1, 'breakfast', 1, -100)
    expect(mocks.removeMealDish).not.toHaveBeenCalled()
  })

  it('крестик остатка продукта ужимает план до разложенного', async () => {
    currentPlan.meals[0]!.products.push({
      productId: 2,
      name: 'Хлеб',
      unit: 'g',
      weightPerUnitGrams: 1,
      recipeAmount: 0,
      manualAmount: 200,
      amount: 200,
      isMeat: false,
      fromDishes: [],
      allocations: [],
    })

    const wrapper = await mountMeals()

    await wrapper.find('[data-test="alloc-pack-2"]').setValue('p1')
    await flushPromises()
    await wrapper.find('[data-test="alloc-amount-2"]').setValue('150')
    await flushPromises()

    // Остаток 50 не нужен: план ужимается до 150, строка остатка исчезает.
    await wrapper.find('[data-test="meal-line-remove-2-2"]').trigger('click')
    await flushPromises()

    expect(mocks.setMealLine).toHaveBeenCalledWith('7', 1, 'breakfast', 2, 150)
    expect(mocks.removeMealLine).not.toHaveBeenCalled()
  })

  it('крестик остатка ингредиента ужимает план, а не убирает ингредиент', async () => {
    const wrapper = await mountMeals()

    await wrapper.find('[data-test="ing-pack-d1-1"]').setValue('p1')
    await flushPromises()
    await wrapper.find('[data-test="ing-amount-d1-1"]').setValue('100')
    await flushPromises()

    await wrapper.find('[data-test="ing-action-d1-1-1"]').trigger('click')
    await flushPromises()

    // Разложено 100 из рецепта 160: убавка -60, ингредиент остаётся.
    expect(mocks.setMealLine).toHaveBeenCalledWith('7', 1, 'breakfast', 1, -60)
    expect(mocks.removeMealDish).not.toHaveBeenCalled()
  })

  it('убираем первую долю — остальные доли остаются как были', async () => {
    // Пять яблок в двух пакетах: 2 и 3.
    currentPlan.meals[0]!.products.push({
      productId: 3,
      name: 'Яблоки',
      unit: 'piece',
      weightPerUnitGrams: 100,
      recipeAmount: 0,
      manualAmount: 5,
      amount: 5,
      isMeat: false,
      fromDishes: [],
      allocations: [
        { packageId: 'p1', amount: 2, isElastic: false },
        { packageId: 'p2', amount: 3, isElastic: false },
      ],
    })

    const wrapper = await mountMeals()

    await wrapper.find('[data-test="meal-line-remove-3"]').trigger('click')
    await flushPromises()

    // Убрана именно первая доля, вторая не изменилась и не сложилась с ней.
    expect(mocks.setMealAllocations).toHaveBeenCalledWith('7', 1, 'breakfast', 3, [
      { packageId: 'p2', amount: 3, isElastic: false },
    ])
    // И её количество ушло из плана: у ручного продукта это его строка —
    // 5 яблок стали 3, а не «2 не расфасовано».
    expect(mocks.setMealLine).toHaveBeenCalledWith('7', 1, 'breakfast', 3, 3)
  })

  it('варианты «кол-во» не дают взять больше, чем есть в строке', async () => {
    // Пять яблок: два в пакет, три в остатке.
    currentPlan.meals[0]!.products.push({
      productId: 3,
      name: 'Яблоки',
      unit: 'piece',
      weightPerUnitGrams: 100,
      recipeAmount: 0,
      manualAmount: 5,
      amount: 5,
      isMeat: false,
      fromDishes: [],
      allocations: [],
    })

    const wrapper = await mountMeals()

    await wrapper.find('[data-test="alloc-pack-3"]').setValue('p1')
    await flushPromises()
    await wrapper.find('[data-test="alloc-amount-3"]').setValue('2')
    await flushPromises()

    const values = (selector: string) =>
      wrapper
        .findAll(`${selector} option`)
        .map((option) => (option.element as HTMLOptionElement).value)

    // У остатка три яблока — в списке только 1..3, а не до пяти.
    const leftover = values('[data-test="alloc-amount-3-2"]')
    expect(leftover).toContain('3')
    expect(leftover).not.toContain('4')
    expect(leftover).not.toContain('5')

    // У доли можно забрать остаток целиком — до пяти.
    expect(values('[data-test="alloc-amount-3"]')).toContain('5')
  })

  it('крестик единственной строки продукта убирает продукт', async () => {
    currentPlan.meals[0]!.products.push({
      productId: 2,
      name: 'Хлеб',
      unit: 'g',
      weightPerUnitGrams: 1,
      recipeAmount: 0,
      manualAmount: 200,
      amount: 200,
      isMeat: false,
      fromDishes: [],
      allocations: [],
    })

    const wrapper = await mountMeals()

    await wrapper.find('[data-test="meal-line-remove-2"]').trigger('click')
    await flushPromises()

    expect(mocks.removeMealLine).toHaveBeenCalledWith('7', 1, 'breakfast', 2)
  })

  it('кулёк приёма включается кнопкой', async () => {
    const wrapper = await mountMeals()

    await wrapper.find('[data-test="meal-kulek-1-breakfast"]').trigger('click')
    await flushPromises()

    expect(mocks.setMealKulek).toHaveBeenCalledWith('7', 1, 'breakfast', true)
  })

  it('пакет без веса и пакет с устаревшим весом подписаны одинаково', async () => {
    currentPlan.packages[0]!.weightActualGrams = 500
    currentPlan.packages[0]!.weightActualStale = true
    // Пустой пакет показывает «пустой», поэтому второму даём содержимое.
    currentPlan.packages[1]!.items = [
      {
        mealId: 'm1',
        dayIndex: 1,
        kind: 'breakfast',
        productId: 1,
        name: 'Крупа',
        amount: 50,
        isElastic: false,
        weightGrams: 50,
      },
    ]

    const wrapper = await mountMeals()

    const rows = wrapper.findAll('[data-test="package"]')
    // Заказчик упростил формулировку (26.10.2026): «требуется перевзвесить»
    // больше нет — оба состояния читаются как «не взвешен». Различаются
    // только признаком разметки.
    expect(rows[0]!.find('[data-test="package-stale"]').text()).toBe('не взвешен')
    expect(rows[0]!.find('[data-test="package-unweighed"]').exists()).toBe(false)

    expect(rows[1]!.find('[data-test="package-unweighed"]').text()).toBe('не взвешен')
    expect(rows[1]!.find('[data-test="package-stale"]').exists()).toBe(false)
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

  it('чек-лист открывается модалкой: проекция и отметки', async () => {
    const wrapper = await mountMeals()

    // До открытия списка запроса нет: содержимое грузится кнопкой.
    expect(mocks.fetchMealChecks).not.toHaveBeenCalled()

    await wrapper.find('[data-test="checklist-toggle"]').trigger('click')
    await flushPromises()

    expect(mocks.fetchMealChecks).toHaveBeenCalledWith('7')
    expect(wrapper.find('[data-test="checklist"]').attributes('role')).toBe('dialog')
    expect(wrapper.findAll('[data-test="check-row"]')).toHaveLength(3)
    // Строка списка: «Гречка 160 г [---] взяли [ ] куплено [ ] из дома».
    expect(wrapper.text()).toContain('взяли')
    expect(wrapper.text()).toContain('из дома')
    expect(wrapper.text()).not.toContain('надо')
    expect(wrapper.text()).toContain('купил(а): Вегетарианка')
  })

  it('список покупок закрывается кнопкой и по Escape', async () => {
    const wrapper = await mountMeals()

    await wrapper.find('[data-test="checklist-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="checklist"]').exists()).toBe(true)

    await wrapper.find('[data-test="checklist-close"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="checklist"]').exists()).toBe(false)

    await wrapper.find('[data-test="checklist-toggle"]').trigger('click')
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('[data-test="checklist"]').exists()).toBe(false)
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

  it('раскладка и пакеты свёрнуты в details и раскрыты по умолчанию', async () => {
    const wrapper = await mountMeals()

    const sections = wrapper.findAll('details')
    expect(sections).toHaveLength(2)
    expect(sections[0]!.attributes('open')).toBeDefined()
    expect(sections[1]!.attributes('open')).toBeDefined()

    expect(wrapper.find('[data-test="schedule"] summary').text()).toBe('Раскладка')
    expect(wrapper.find('[data-test="packages"] summary').text()).toBe('Пакеты')

    // Содержимое осталось внутри своих секций.
    expect(sections[0]!.findAll('[data-test="meal-day"]')).toHaveLength(2)
    expect(sections[1]!.findAll('[data-test="package"]')).toHaveLength(2)
  })
})
