import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProductPicker from './ProductPicker.vue'

/**
 * Пикер — только подсказки из справочника.
 *
 * Кнопки «добавить в справочник» здесь быть не должно: свой продукт
 * создаётся в походе кнопкой «Добавить» у приёма, а не из поля поиска.
 * Тест закрепляет оба конца контракта: текст уходит наверх, выбор
 * приходит обратно событием.
 */
const searchProducts = vi.fn()

vi.mock('@/api/meals', () => ({
  searchProducts: (...args: unknown[]) => searchProducts(...args),
}))

describe('ProductPicker', () => {
  beforeEach(() => {
    searchProducts.mockReset()
    searchProducts.mockResolvedValue([
      { id: 7, name: 'Тушёнка', unit: 'can', weightPerUnitGrams: 340 },
    ])
  })

  it('набранный текст сообщает родителю', async () => {
    const wrapper = mount(ProductPicker)

    await wrapper.find('[data-test="product-search"]').setValue('Трава')
    await flushPromises()

    expect(wrapper.emitted('update:query')?.at(-1)).toEqual(['Трава'])
  })

  it('выбор подсказки отдаёт продукт и текст названия', async () => {
    const wrapper = mount(ProductPicker)

    await wrapper.find('[data-test="product-search"]').setValue('Тушёнка')
    // Поиск с задержкой: даём дебаунсу отработать.
    await new Promise((resolve) => setTimeout(resolve, 350))
    await flushPromises()

    const options = wrapper.findAll('[data-test="product-option"]')
    expect(options).toHaveLength(1)

    await options[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({
      id: 7,
      name: 'Тушёнка',
    })
    expect(wrapper.emitted('update:query')?.at(-1)).toEqual(['Тушёнка'])
  })

  it('кнопки создания в справочнике нет', async () => {
    const wrapper = mount(ProductPicker)

    await wrapper.find('[data-test="product-search"]').setValue('Трава')
    await flushPromises()

    expect(wrapper.find('[data-test="product-create"]').exists()).toBe(false)
  })
})
