import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import GeoObjectPicker from '@/components/ui/GeoObjectPicker.vue'

/**
 * Тесты выбора объекта из справочника.
 *
 * Главное, что здесь проверяется, — **пустое поле не показывает весь
 * справочник**. Это не мелочь: в нём сотни объектов, они не помещаются
 * на экран, и список целиком — не выбор, а простыня. Заказчик на это
 * указал отдельно, и сломать это легко: достаточно убрать проверку
 * на пустую строку.
 *
 * Таймеры поддельные: у поиска задержка, и ждать её по-настоящему значит
 * делать тест медленным и мигающим.
 */
const mocks = vi.hoisted(() => ({ listObjects: vi.fn() }))

vi.mock('@/api/objects', () => ({ listObjects: mocks.listObjects }))

const VITYAZ = {
  id: '10',
  name: 'Витязь',
  type: 'скала',
  url: null,
  parentId: '9',
  parentName: 'Олхинское плато',
}

/** Подождать задержку поиска и отдать управление промисам. */
async function waitForSearch() {
  await vi.advanceTimersByTimeAsync(400)
}

describe('GeoObjectPicker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.listObjects.mockReset()
    mocks.listObjects.mockResolvedValue([VITYAZ])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('при пустом поле не ищет и ничего не показывает', async () => {
    const wrapper = mount(GeoObjectPicker)

    expect(mocks.listObjects).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="object-options"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="object-nothing"]').exists()).toBe(false)
  })

  it('ищет по введённому и показывает объект с родителем', async () => {
    const wrapper = mount(GeoObjectPicker)

    await wrapper.find('[data-test="object-search"]').setValue('Витязь')
    await waitForSearch()

    expect(mocks.listObjects).toHaveBeenCalledWith('Витязь')
    expect(wrapper.find('[data-test="object-options"]').text()).toContain(
      'Витязь · Олхинское плато',
    )
  })

  it('пустой ответ показывает «ничего не нашлось», а не пустой список', async () => {
    mocks.listObjects.mockResolvedValue([])
    const wrapper = mount(GeoObjectPicker)

    await wrapper.find('[data-test="object-search"]').setValue('Такого нет')
    await waitForSearch()

    expect(wrapper.find('[data-test="object-options"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="object-nothing"]').exists()).toBe(true)
  })

  it('выбор отдаёт объект наружу и очищает поле', async () => {
    const wrapper = mount(GeoObjectPicker)

    await wrapper.find('[data-test="object-search"]').setValue('Витязь')
    await waitForSearch()
    await wrapper.find('[data-test="object-option"]').trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual([VITYAZ])

    const input = wrapper.find('[data-test="object-search"]')
      .element as HTMLInputElement
    expect(input.value).toBe('')
    expect(wrapper.find('[data-test="object-options"]').exists()).toBe(false)
  })

  it('сбой справочника не оставляет список пустым молча', async () => {
    mocks.listObjects.mockRejectedValue(new Error('сеть'))
    const wrapper = mount(GeoObjectPicker)

    await wrapper.find('[data-test="object-search"]').setValue('Витязь')
    await waitForSearch()

    expect(wrapper.text()).toContain('Не удалось загрузить справочник')
  })
})
