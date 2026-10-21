import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { GearItem, GearList } from '@/types/gear'
import UserGear from '@/views/profile/sections/UserGear.vue'

/**
 * Тесты раздела «Снаряжение».
 *
 * Главное здесь — **вес**: итог складывает только известные веса, правка
 * веса сохраняется на месте по `change`, а пустое поле значит «не знаю»,
 * а не ноль. API подменён: проверяем аргументы запросов и состояние.
 */
vi.mock('@/api/gear', () => ({
  listGear: vi.fn(),
  createGearItem: vi.fn(),
  updateGearItem: vi.fn(),
  deleteGearItem: vi.fn(),
}))

import * as api from '@/api/gear'

const mocked = vi.mocked(api)

function makeItem(overrides: Partial<GearItem> = {}): GearItem {
  return {
    id: 'gear-1',
    kind: 'tent',
    title: 'Палатка на четверых',
    weightGrams: 2400,
    note: null,
    createdAt: '2026-10-21T08:00:00.000Z',
    ...overrides,
  }
}

function makeList(items: GearItem[]): GearList {
  return {
    items,
    totalWeightGrams: items.reduce((sum, item) => sum + (item.weightGrams ?? 0), 0),
    itemsWithoutWeight: items.filter((item) => item.weightGrams === null).length,
  }
}

async function mountSection(items: GearItem[] = [makeItem()]): Promise<VueWrapper> {
  mocked.listGear.mockResolvedValue(makeList(items))

  const wrapper = mount(UserGear)
  await flushPromises()

  return wrapper
}

/** Значения полей названий — заголовки в списке живут в input, а не в тексте. */
function titles(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll('[data-test="item-title"]')
    .map((input) => (input.element as HTMLInputElement).value)
}

describe('UserGear', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.createGearItem.mockResolvedValue(makeItem({ id: 'gear-new', title: 'Котелок' }))
    mocked.updateGearItem.mockImplementation(async (_id, patch) =>
      makeItem({
        weightGrams: patch.weightGrams === undefined ? 2400 : patch.weightGrams,
        title: patch.title ?? 'Палатка на четверых',
      }),
    )
    mocked.deleteGearItem.mockResolvedValue(undefined)
  })

  it('показывает предметы по видам и итог по весу', async () => {
    const wrapper = await mountSection([
      makeItem(),
      makeItem({ id: 'gear-2', kind: 'sleeping', title: 'Спальник', weightGrams: 1500 }),
    ])

    expect(wrapper.findAll('[data-test="gear-group"]')).toHaveLength(2)
    expect(titles(wrapper)).toContain('Палатка на четверых')
    expect(wrapper.find('[data-test="gear-total"]').text()).toBe('Всего: 3,9 кг')
  })

  it('неизвестный вес не считается в итог, но виден в подписи', async () => {
    const wrapper = await mountSection([
      makeItem({ weightGrams: null, title: 'Котелок' }),
    ])

    expect(wrapper.find('[data-test="gear-total"]').text()).toBe(
      'Всего: 0 г · без веса: 1',
    )
  })

  it('пустой список приглашает начать', async () => {
    const wrapper = await mountSection([])

    expect(wrapper.find('[data-test="gear-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-total"]').text()).toBe('Всего: 0 г')
  })

  it('добавляет предмет с видом, весом и заметкой', async () => {
    const wrapper = await mountSection([])

    await wrapper.find('[data-test="gear-kind"]').setValue('kitchen')
    await wrapper.find('[data-test="gear-title"]').setValue('Котелок 3 л')
    await wrapper.find('[data-test="gear-weight"]').setValue('450')
    await wrapper.find('[data-test="gear-note"]').setValue('алюминиевый')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocked.createGearItem).toHaveBeenCalledWith({
      kind: 'kitchen',
      title: 'Котелок 3 л',
      weightGrams: 450,
      note: 'алюминиевый',
    })
    expect(titles(wrapper)).toContain('Котелок')
  })

  it('без веса добавить можно: пустое поле — «не знаю»', async () => {
    const wrapper = await mountSection([])

    await wrapper.find('[data-test="gear-title"]').setValue('Верёвка')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocked.createGearItem).toHaveBeenCalledWith({
      kind: 'tent',
      title: 'Верёвка',
      weightGrams: null,
      note: null,
    })
  })

  it('мусор в весе не отправляется', async () => {
    const wrapper = await mountSection([])

    await wrapper.find('[data-test="gear-title"]').setValue('Гитара')
    await wrapper.find('[data-test="gear-weight"]').setValue('0')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocked.createGearItem).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="gear-error"]').text()).toContain('целое число')
  })

  it('вес правится на месте и сохраняется через PATCH', async () => {
    const wrapper = await mountSection()

    const weight = wrapper.find('[data-test="item-weight"]')
    await weight.setValue('1800')
    await weight.trigger('change')
    await flushPromises()

    expect(mocked.updateGearItem).toHaveBeenCalledWith('gear-1', { weightGrams: 1800 })
    expect(wrapper.find('[data-test="gear-total"]').text()).toBe('Всего: 1,8 кг')
  })

  it('пустое поле веса стирает вес null-ом', async () => {
    const wrapper = await mountSection()

    const weight = wrapper.find('[data-test="item-weight"]')
    await weight.setValue('')
    await weight.trigger('change')
    await flushPromises()

    expect(mocked.updateGearItem).toHaveBeenCalledWith('gear-1', { weightGrams: null })
    expect(wrapper.find('[data-test="gear-total"]').text()).toContain('без веса: 1')
  })

  it('пустое название не сохраняется — возвращается прежнее', async () => {
    const wrapper = await mountSection()

    const title = wrapper.find('[data-test="item-title"]')
    await title.setValue('   ')
    await title.trigger('change')
    await flushPromises()

    expect(mocked.updateGearItem).not.toHaveBeenCalled()
    expect((title.element as HTMLInputElement).value).toBe('Палатка на четверых')
  })

  it('удаляет предмет из списка', async () => {
    const wrapper = await mountSection()

    await wrapper.find('[data-test="item-delete"]').trigger('click')
    await flushPromises()

    expect(mocked.deleteGearItem).toHaveBeenCalledWith('gear-1')
    expect(wrapper.find('[data-test="gear-empty"]').exists()).toBe(true)
  })

  it('ошибку сервера показывает словами бэкенда', async () => {
    const wrapper = await mountSection([])
    mocked.createGearItem.mockRejectedValue(
      new ApiError(400, 'У предмета должно быть название', null),
    )

    await wrapper.find('[data-test="gear-title"]').setValue('Палатка')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-test="gear-error"]').text()).toContain(
      'У предмета должно быть название',
    )
  })
})
