import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ProductPicker from './ProductPicker.vue'

/**
 * Сквозная проверка без моков API: компонент → `createProduct` → `apiFetch`
 * → `fetch`. Подменён только сам `fetch`.
 *
 * Регрессия, которую ловим: `tripId` не доходил до запроса, и продукт
 * уезжал в общий справочник вместо похода. Тест бьёт по настоящей цепочке,
 * поэтому ловит и опечатку в импорте, и потерю параметра по пути.
 */
describe('ProductPicker → apiFetch', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('создаёт продукт похода запросом с tripId', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 777,
            name: 'Трава',
            unit: 'piece',
            weightPerUnitGrams: 0,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(ProductPicker, { props: { tripId: '679' } })

    await wrapper.find('[data-test="product-search"]').setValue('Трава')
    await flushPromises()

    const button = wrapper.find('[data-test="product-create"]')
    expect(button.exists()).toBe(true)

    await button.trigger('click')
    await flushPromises()

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    const call = calls.at(0)

    expect(call).toBeDefined()
    expect(String(call?.[0])).toContain('/api/products?tripId=679')
    expect(call?.[1]?.method).toBe('POST')

    const body = JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>
    expect(body).toMatchObject({ name: 'Трава', weightPerUnitGrams: 0 })

    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ id: 777 })
  })
})
