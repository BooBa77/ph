import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { Dish, DishIngredient, Product } from '@/types/meals'
import UserMeals from '@/views/profile/sections/UserMeals.vue'

/**
 * Тесты раздела «Питание» (кулинарная книга).
 *
 * Главное — **состав**: блюдо собирается из продуктов справочника,
 * вес строки считает бэкенд, а итог блюда пересчитывается после правки
 * состава. API подменён: проверяем аргументы и состояние, а не сеть.
 */
vi.mock('@/api/meals', () => ({
  searchProducts: vi.fn(),
  listDishes: vi.fn(),
  createDish: vi.fn(),
  updateDish: vi.fn(),
  deleteDish: vi.fn(),
  addIngredient: vi.fn(),
  updateIngredient: vi.fn(),
  deleteIngredient: vi.fn(),
}))

import * as api from '@/api/meals'

const mocked = vi.mocked(api)

const KRUPA: Product = { id: 1, name: 'Гречка', unit: 'g', weightPerUnitGrams: 1 }
const TUSHONKA: Product = { id: 2, name: 'Тушёнка', unit: 'can', weightPerUnitGrams: 340 }

function makeIngredient(overrides: Partial<DishIngredient> = {}): DishIngredient {
  return {
    id: 'ing-1',
    product: KRUPA,
    amount: 200,
    grams: 200,
    isMeat: false,
    ...overrides,
  }
}

function makeDish(overrides: Partial<Dish> = {}): Dish {
  return {
    id: 'dish-1',
    title: 'Каша с тушёнкой',
    note: null,
    ingredients: [makeIngredient()],
    totalGrams: 200,
    createdAt: '2026-10-21T08:00:00.000Z',
    ...overrides,
  }
}

function dishTitles(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll('[data-test="dish-title"]')
    .map((input) => (input.element as HTMLInputElement).value)
}

async function mountSection(dishes: Dish[] = [makeDish()]): Promise<VueWrapper> {
  mocked.listDishes.mockResolvedValue(dishes)

  const wrapper = mount(UserMeals)
  await flushPromises()

  return wrapper
}

describe('UserMeals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.createDish.mockResolvedValue(makeDish({ id: 'dish-new', title: 'Суп', ingredients: [], totalGrams: 0 }))
    mocked.updateDish.mockResolvedValue(makeDish({ title: 'Новое имя' }))
    mocked.deleteDish.mockResolvedValue(undefined)
    mocked.searchProducts.mockResolvedValue([TUSHONKA])
    mocked.addIngredient.mockResolvedValue(
      makeIngredient({ id: 'ing-2', product: TUSHONKA, amount: 2, grams: 680 }),
    )
    mocked.updateIngredient.mockResolvedValue(
      makeIngredient({ amount: 400, grams: 400 }),
    )
    mocked.deleteIngredient.mockResolvedValue(undefined)
  })

  it('показывает блюда, состав и вес', async () => {
    const wrapper = await mountSection()

    expect(dishTitles(wrapper)).toContain('Каша с тушёнкой')
    expect(wrapper.find('[data-test="ingredient-name"]').text()).toBe('Гречка')
    expect(wrapper.find('[data-test="dish-weight"]').text()).toBe('200 г')
  })

  it('пустая книга приглашает завести блюдо', async () => {
    const wrapper = await mountSection([])

    expect(wrapper.find('[data-test="meals-empty"]').exists()).toBe(true)
  })

  it('создаёт блюдо и добавляет его в список', async () => {
    const wrapper = await mountSection([])

    await wrapper.find('[data-test="new-dish-title"]').setValue('Суп')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocked.createDish).toHaveBeenCalledWith('Суп')
    expect(dishTitles(wrapper)).toContain('Суп')
  })

  it('переименование и заметка сохраняются на месте', async () => {
    const wrapper = await mountSection()

    const title = wrapper.find('[data-test="dish-title"]')
    await title.setValue('Каша по-новому')
    await title.trigger('change')
    await flushPromises()

    expect(mocked.updateDish).toHaveBeenCalledWith('dish-1', { title: 'Каша по-новому' })

    const note = wrapper.find('[data-test="dish-note"]')
    await note.setValue('солить в конце')
    await note.trigger('change')
    await flushPromises()

    expect(mocked.updateDish).toHaveBeenCalledWith('dish-1', { note: 'солить в конце' })
  })

  it('пустое название блюда не сохраняется', async () => {
    const wrapper = await mountSection()

    const title = wrapper.find('[data-test="dish-title"]')
    await title.setValue('   ')
    await title.trigger('change')
    await flushPromises()

    expect(mocked.updateDish).not.toHaveBeenCalled()
    expect((title.element as HTMLInputElement).value).toBe('Каша с тушёнкой')
  })

  it('продукт добавляется через подсказку справочника', async () => {
    const wrapper = await mountSection()

    const picker = wrapper.find('[data-test="product-search"]')
    await picker.setValue('туш')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="product-option"]').exists()).toBe(true)
    })
    await wrapper.find('[data-test="product-option"]').trigger('click')

    expect(wrapper.find('[data-test="chosen-product"]').text()).toContain('Тушёнка')

    await wrapper.find('[data-test="ingredient-amount-input"]').setValue('2')
    await wrapper.findAll('form')[1]?.trigger('submit')
    await flushPromises()

    expect(mocked.addIngredient).toHaveBeenCalledWith('dish-1', 2, 2, false)
    // Вес блюда пересчитан по строкам: 200 г крупы + 680 г тушёнки.
    expect(wrapper.find('[data-test="dish-weight"]').text()).toBe('880 г')
  })

  it('мясной ингредиент помечается и уходит в запрос', async () => {
    const wrapper = await mountSection()
    mocked.addIngredient.mockResolvedValue(
      makeIngredient({ id: 'ing-2', product: TUSHONKA, amount: 2, grams: 680, isMeat: true }),
    )

    // Подсказка справочника: та же, что в обычном добавлении.
    const picker = wrapper.find('[data-test="product-search"]')
    await picker.setValue('туш')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="product-option"]').exists()).toBe(true)
    })
    await wrapper.find('[data-test="product-option"]').trigger('click')

    await wrapper.find('[data-test="ingredient-amount-input"]').setValue('2')
    await wrapper.find('[data-test="ingredient-meat-input"]').setValue(true)
    await wrapper.findAll('form')[1]?.trigger('submit')
    await flushPromises()

    expect(mocked.addIngredient).toHaveBeenCalledWith('dish-1', 2, 2, true)
    expect(wrapper.findAll('[data-test="ingredient-meat"]')).toHaveLength(1)
  })

  it('без выбранного продукта добавление не отправляется', async () => {
    const wrapper = await mountSection()

    expect(
      wrapper.find('[data-test="add-ingredient"]').attributes('disabled'),
    ).toBeDefined()

    await wrapper.findAll('form')[1]?.trigger('submit')
    await flushPromises()

    expect(mocked.addIngredient).not.toHaveBeenCalled()
  })

  it('количество в составе правится на месте', async () => {
    const wrapper = await mountSection()

    const amount = wrapper.find('[data-test="ingredient-amount"]')
    await amount.setValue('400')
    await amount.trigger('change')
    await flushPromises()

    expect(mocked.updateIngredient).toHaveBeenCalledWith('ing-1', 400)
    expect(wrapper.find('[data-test="dish-weight"]').text()).toBe('400 г')
  })

  it('мусор в количестве не отправляется, значение возвращается', async () => {
    const wrapper = await mountSection()

    const amount = wrapper.find('[data-test="ingredient-amount"]')
    await amount.setValue('0')
    await amount.trigger('change')
    await flushPromises()

    expect(mocked.updateIngredient).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="meals-error"]').text()).toContain('целое число')
  })

  it('продукт убирается из состава, вес пересчитывается', async () => {
    const wrapper = await mountSection()

    await wrapper.find('[data-test="ingredient-delete"]').trigger('click')
    await flushPromises()

    expect(mocked.deleteIngredient).toHaveBeenCalledWith('ing-1')
    expect(wrapper.find('[data-test="dish-weight"]').text()).toBe('0 г')
  })

  it('удаление блюда требует подтверждения', async () => {
    const wrapper = await mountSection()

    await wrapper.find('[data-test="dish-delete"]').trigger('click')
    expect(wrapper.find('[data-test="dish-delete-confirm"]').exists()).toBe(true)

    await wrapper.find('[data-test="dish-delete-cancel"]').trigger('click')
    expect(mocked.deleteDish).not.toHaveBeenCalled()

    await wrapper.find('[data-test="dish-delete"]').trigger('click')
    await wrapper.find('[data-test="dish-delete-confirm"]').trigger('click')
    await flushPromises()

    expect(mocked.deleteDish).toHaveBeenCalledWith('dish-1')
    expect(wrapper.find('[data-test="meals-empty"]').exists()).toBe(true)
  })

  it('ошибку сервера показывает словами бэкенда', async () => {
    const wrapper = await mountSection([])
    mocked.createDish.mockRejectedValue(new ApiError(400, 'У блюда должно быть название', null))

    await wrapper.find('[data-test="new-dish-title"]').setValue('Суп')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-test="meals-error"]').text()).toContain(
      'У блюда должно быть название',
    )
  })
})
