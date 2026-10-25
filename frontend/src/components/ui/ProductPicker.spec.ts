import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProductPicker from './ProductPicker.vue'

/**
 * Свой продукт заводится только в походе.
 *
 * Регрессия, которую ловим: `tripId` забыли передать, и продукт молча
 * попадал в общий справочник — а кнопка в интерфейсе при этом выглядела
 * «ничего не произошло».
 */
const createProduct = vi.fn()
const searchProducts = vi.fn()

vi.mock('@/api/meals', () => ({
  createProduct: (...args: unknown[]) => createProduct(...args),
  searchProducts: (...args: unknown[]) => searchProducts(...args),
}))

describe('ProductPicker', () => {
  beforeEach(() => {
    createProduct.mockReset()
    searchProducts.mockReset()
    searchProducts.mockResolvedValue([])
    createProduct.mockResolvedValue({
      id: 501,
      name: 'Трава',
      unit: 'piece',
      weightPerUnitGrams: 0,
    })
  })

  it('создаёт свой продукт в походе, а не в справочнике', async () => {
    const wrapper = mount(ProductPicker, { props: { tripId: '679' } })

    await wrapper.find('[data-test="product-search"]').setValue('Трава')
    await flushPromises()
    await wrapper.find('[data-test="product-create"]').trigger('click')
    await flushPromises()

    expect(createProduct).toHaveBeenCalledWith(
      { name: 'Трава', unit: 'piece', weightPerUnitGrams: 0 },
      '679',
    )
    expect(wrapper.emitted('select')?.[0]).toEqual([
      { id: 501, name: 'Трава', unit: 'piece', weightPerUnitGrams: 0 },
    ])
  })
})
