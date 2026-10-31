import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { GearItem } from '@/types/gear'
import ChecklistGearPicker from '@/components/checklists/ChecklistGearPicker.vue'

/**
 * Выбор вещи снаряжения для пункта чек-листа.
 *
 * Проверяется то, что видит человек: **полки как в каталоге**, поиск
 * по названию, типу и полке, и отказ — выбор ничего не пишет сам, он отдаёт
 * вещь событием. Ошибку загрузки каталога модалка показывает словами,
 * а не пустым списком: пустой список читался бы как «снаряжения нет».
 */
vi.mock('@/api/gear', () => ({
  listGear: vi.fn(),
}))

import * as gearApi from '@/api/gear'

function makeGearItem(overrides: Partial<GearItem> = {}): GearItem {
  return {
    id: '5',
    typeId: 1,
    typeCode: 'tent',
    typeName: 'Палатка',
    groupId: 1,
    groupCode: 'roof',
    groupName: 'Кров',
    sortOrder: 10,
    title: 'Палатка Анны',
    weightGrams: 2400,
    note: null,
    attributes: [],
    createdAt: '2026-10-31T08:00:00.000Z',
    ...overrides,
  }
}

async function mountPicker(items: GearItem[] = [makeGearItem()]) {
  vi.mocked(gearApi.listGear).mockResolvedValue({
    items,
    totalWeightGrams: items.reduce((sum, item) => sum + (item.weightGrams ?? 0), 0),
    itemsWithoutWeight: items.filter((item) => item.weightGrams === null).length,
  })

  const wrapper = mount(ChecklistGearPicker, {
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
  await flushPromises()

  return wrapper
}

describe('ChecklistGearPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('показывает вещи полками, как в каталоге', async () => {
    const wrapper = await mountPicker([
      makeGearItem(),
      makeGearItem({
        id: '6',
        title: 'Топор',
        typeCode: 'axe',
        typeName: 'Топор',
        groupCode: 'campfire',
        groupName: 'Костровое',
        weightGrams: 900,
      }),
    ])

    const options = wrapper.findAll('[data-test="gear-option"]')
    expect(options).toHaveLength(2)
    expect(wrapper.text()).toContain('Кров')
    expect(wrapper.text()).toContain('Костровое')
    expect(options[0]?.text()).toContain('Палатка Анны')
    expect(options[0]?.find('[data-test="gear-option-subtitle"]').text()).toBe(
      'Палатка · 2,4 кг',
    )
  })

  it('вещь без веса подписывается одним типом, без прочерка', async () => {
    const wrapper = await mountPicker([makeGearItem({ weightGrams: null })])

    expect(wrapper.find('[data-test="gear-option-subtitle"]').text()).toBe('Палатка')
  })

  it('поиск фильтрует по названию, типу и полке', async () => {
    const wrapper = await mountPicker([
      makeGearItem(),
      makeGearItem({
        id: '6',
        title: 'Топор',
        typeCode: 'axe',
        typeName: 'Топор',
        groupCode: 'campfire',
        groupName: 'Костровое',
        weightGrams: 900,
      }),
    ])

    await wrapper.find('[data-test="gear-search"]').setValue('топор')
    await flushPromises()

    expect(wrapper.findAll('[data-test="gear-option"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('Топор')

    // Имя полки — тоже повод найтись: человек ищет «Костровое».
    await wrapper.find('[data-test="gear-search"]').setValue('костровое')
    await flushPromises()
    expect(wrapper.findAll('[data-test="gear-option"]')).toHaveLength(1)

    await wrapper.find('[data-test="gear-search"]').setValue('спальник')
    await flushPromises()
    expect(wrapper.find('[data-test="gear-not-found"]').exists()).toBe(true)
  })

  it('выбор вещи уходит событием, а не запросом', async () => {
    const wrapper = await mountPicker()

    await wrapper.find('[data-test="gear-option"]').trigger('click')

    const emitted = wrapper.emitted('select') as unknown[][] | undefined
    expect(emitted).toHaveLength(1)
    expect((emitted?.[0]?.[0] as GearItem).id).toBe('5')
    expect(gearApi.listGear).toHaveBeenCalledTimes(1)
  })

  it('пустой каталог объясняет, где завести вещь', async () => {
    const wrapper = await mountPicker([])

    expect(wrapper.find('[data-test="gear-catalog-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-option"]').exists()).toBe(false)
  })

  it('ошибка загрузки видна словами, а не пустым списком', async () => {
    vi.mocked(gearApi.listGear).mockRejectedValue(
      new ApiError(500, 'Снаряжение временно недоступно', null),
    )

    const wrapper = mount(ChecklistGearPicker, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    await flushPromises()

    expect(wrapper.find('[data-test="gear-error"]').text()).toContain(
      'Снаряжение временно недоступно',
    )
  })

  it('Escape закрывает выбор', async () => {
    const wrapper = await mountPicker()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
