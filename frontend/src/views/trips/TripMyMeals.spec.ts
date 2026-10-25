import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TripMealPlan } from '@/types/trips'
import TripMyMeals from '@/views/trips/TripMyMeals.vue'

/**
 * «Моя еда» — личная раскладка того, кто питается отдельно.
 *
 * Проверяем то, что видит человек: свои продукты с количествами на одного,
 * пакеты, добавление блюда (в том числе общего из раскладки похода)
 * и отдельный личный список покупок.
 */
const mocks = vi.hoisted(() => ({
  fetchMyMealPlan: vi.fn(),
  addMyMealDish: vi.fn(),
  removeMyMealDish: vi.fn(),
  addMyMealLine: vi.fn(),
  removeMyMealLine: vi.fn(),
  setMyMealAllocations: vi.fn(),
  createMyMealPackage: vi.fn(),
  updateMyMealPackage: vi.fn(),
  removeMyMealPackage: vi.fn(),
  fetchMyMealChecks: vi.fn(),
  updateMyMealCheck: vi.fn(),
  fetchMealChecks: vi.fn(),
  updateMealCheck: vi.fn(),
  searchProducts: vi.fn(),
}))

vi.mock('@/api/trips', () => ({
  fetchMyMealPlan: mocks.fetchMyMealPlan,
  addMyMealDish: mocks.addMyMealDish,
  removeMyMealDish: mocks.removeMyMealDish,
  addMyMealLine: mocks.addMyMealLine,
  removeMyMealLine: mocks.removeMyMealLine,
  setMyMealAllocations: mocks.setMyMealAllocations,
  createMyMealPackage: mocks.createMyMealPackage,
  updateMyMealPackage: mocks.updateMyMealPackage,
  removeMyMealPackage: mocks.removeMyMealPackage,
  fetchMyMealChecks: mocks.fetchMyMealChecks,
  updateMyMealCheck: mocks.updateMyMealCheck,
  fetchMealChecks: mocks.fetchMealChecks,
  updateMealCheck: mocks.updateMealCheck,
}))

vi.mock('@/api/meals', () => ({
  searchProducts: mocks.searchProducts,
}))

const DAYS = [{ index: 1, date: '5 мая', kinds: ['breakfast' as const] }]

const SHARED_DISH = { dishId: 'd-shared', title: 'Каша группы' }

function plan(): TripMealPlan {
  return {
    dayCount: 1,
    eaters: {
      total: 1,
      men: 0,
      women: 1,
      vegetarians: 1,
      people: [
        {
          userId: 'u-me',
          displayName: 'Я',
          avatarUrl: null,
          gender: 'f',
          isVegetarian: true,
          allergies: null,
          eatsSeparately: true,
        },
      ],
    },
    meals: [
      {
        id: 'pm1',
        dayIndex: 1,
        kind: 'breakfast',
        form: 'cook',
        dishes: [],
        products: [
          {
            productId: 5,
            name: 'Крупа',
            unit: 'g',
            weightPerUnitGrams: 1,
            recipeAmount: 0,
            manualAmount: 300,
            amount: 300,
            isMeat: false,
            fromDishes: [],
            allocations: [{ packageId: 'pp1', amount: 0, isElastic: true }],
          },
        ],
        weightGrams: 300,
      },
    ],
    packages: [
      {
        id: 'pp1',
        name: 'Пакет 1',
        kind: 'normal',
        mealId: null,
        weightActualGrams: null,
        weightActualStale: false,
        weightEstimatedGrams: 300,
        items: [
          {
            mealId: 'pm1',
            dayIndex: 1,
            kind: 'breakfast',
            productId: 5,
            name: 'Крупа',
            amount: 300,
            isElastic: true,
            weightGrams: 300,
          },
        ],
      },
    ],
  }
}

async function mountMyMeals() {
  const wrapper = mount(TripMyMeals, {
    props: {
      tripId: '7',
      days: DAYS,
      dishes: [
        {
          id: 'd-mine',
          title: 'Мой суп',
          note: null,
          ingredients: [],
          totalGrams: 0,
          createdAt: '2026-10-14T10:00:00.000Z',
        },
      ],
      sharedDishes: [SHARED_DISH],
    },
  })
  await flushPromises()

  return wrapper
}

describe('TripMyMeals', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    const current = plan()
    mocks.fetchMyMealPlan.mockResolvedValue(current)
    mocks.addMyMealDish.mockResolvedValue(current)
    mocks.removeMyMealDish.mockResolvedValue(current)
    mocks.addMyMealLine.mockResolvedValue(current)
    mocks.removeMyMealLine.mockResolvedValue(current)
    mocks.setMyMealAllocations.mockResolvedValue(current)
    mocks.createMyMealPackage.mockResolvedValue(current)
    mocks.updateMyMealPackage.mockResolvedValue(current)
    mocks.removeMyMealPackage.mockResolvedValue(current)
    mocks.fetchMyMealChecks.mockResolvedValue([
      {
        productId: 5,
        name: 'Крупа',
        unit: 'g',
        weightPerUnitGrams: 1,
        needAmount: 300,
        needGrams: 300,
        isBought: false,
        isHome: false,
        boughtAmount: null,
        boughtByName: null,
        boughtAt: null,
        isOrphaned: false,
      },
    ])
    mocks.updateMyMealCheck.mockResolvedValue([])
    mocks.searchProducts.mockResolvedValue([])
  })

  it('грузит личную раскладку: продукты и вес на одного', async () => {
    const wrapper = await mountMyMeals()

    expect(mocks.fetchMyMealPlan).toHaveBeenCalledWith('7')
    expect(wrapper.find('[data-test="my-meal-products"]').text()).toContain('Крупа')
    expect(wrapper.find('[data-test="my-meals-weight"]').text()).toContain('на одного')
  })

  it('добавляет продукт в личный приём по названию', async () => {
    const wrapper = await mountMyMeals()

    await wrapper.find('[data-test="product-search"]').setValue('Хлеб')
    await wrapper
      .find('[data-test="my-meal-line-amount-1-breakfast"]')
      .setValue('200')
    await flushPromises()

    await wrapper.find('[data-test="my-meal-line-add-1-breakfast"]').trigger('click')
    await flushPromises()

    expect(mocks.addMyMealLine).toHaveBeenCalledWith('7', 1, 'breakfast', {
      amount: 200,
      name: 'Хлеб',
    })
  })

  it('берёт общее блюдо из раскладки похода', async () => {
    const wrapper = await mountMyMeals()

    const select = wrapper.find('[data-test="my-meal-dish-select-1-breakfast"]')
    // В списке есть и своё блюдо, и общее из общей раскладки.
    expect(select.text()).toContain('Мой суп')
    expect(select.text()).toContain('Каша группы')

    await select.setValue(SHARED_DISH.dishId)
    await flushPromises()

    expect(mocks.addMyMealDish).toHaveBeenCalledWith(
      '7',
      1,
      'breakfast',
      'd-shared',
    )
  })

  it('личный пакет создаётся кнопкой', async () => {
    const wrapper = await mountMyMeals()

    await wrapper.find('[data-test="my-package-add"]').trigger('click')
    await flushPromises()

    expect(mocks.createMyMealPackage).toHaveBeenCalledWith('7')
  })

  it('долю строки отдают в свой пакет', async () => {
    const wrapper = await mountMyMeals()

    await wrapper.find('[data-test="my-alloc-amount-5"]').setValue('100')
    await flushPromises()

    expect(mocks.setMyMealAllocations).toHaveBeenCalledWith('7', 1, 'breakfast', 5, [
      { packageId: 'pp1', amount: 100, isElastic: false },
    ])
  })

  it('мой список покупок грузит личные отметки', async () => {
    const wrapper = await mountMyMeals()

    await wrapper.find('[data-test="my-meals-shopping"]').trigger('click')
    await flushPromises()

    expect(mocks.fetchMyMealChecks).toHaveBeenCalledWith('7')
    expect(mocks.fetchMealChecks).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="check-row"]').text()).toContain('Крупа')
    expect(wrapper.find('[data-test="checklist"]').text()).toContain('Мой список покупок')
  })
})
