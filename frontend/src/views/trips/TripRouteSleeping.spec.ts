import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { GearItem } from '@/types/gear'
import type { RouteSleeping, Trip, TripRoute } from '@/types/trips'
import TripRouteSleeping from '@/views/trips/TripRouteSleeping.vue'

/**
 * Личная секция «Спальник» (01.11.2026).
 *
 * Слова заказчика, которые держит спека: секция **личная** (каждый видит
 * только своё), в пилюле — название вещи и вес, две кнопки «Добавить
 * спальник» и «Добавить коврик» меняют цвет на белый, когда вещь уже
 * добавлена, а количество вещей не ограничено. Выбрать можно вещь из своего
 * каталога типа «Спальник»/«Коврик» или завести новую прямо здесь.
 */
const mocks = vi.hoisted(() => ({
  addRouteSleeping: vi.fn(),
  removeRouteSleeping: vi.fn(),
  listGear: vi.fn(),
  createGearItem: vi.fn(),
  fetchGearTypes: vi.fn(),
}))

vi.mock('@/api/trips', () => ({
  addRouteSleeping: mocks.addRouteSleeping,
  removeRouteSleeping: mocks.removeRouteSleeping,
}))

vi.mock('@/api/gear', () => ({
  listGear: mocks.listGear,
  createGearItem: mocks.createGearItem,
}))

vi.mock('@/api/gearTypes', () => ({
  fetchGearTypes: mocks.fetchGearTypes,
}))

const TRIP = { id: '1', organizerUserId: 'me' } as Trip

function route(overrides: Partial<TripRoute> = {}): TripRoute {
  return {
    canEdit: true,
    nights: [],
    sleeping: [],
    lodgers: [],
    travelers: [],
    ...overrides,
  }
}

function sleepingRow(overrides: Partial<RouteSleeping> = {}): RouteSleeping {
  return {
    id: '1',
    gearItemId: '11',
    typeCode: 'sleeping_bag',
    title: 'Спальник зимний',
    weightGrams: 1200,
    ...overrides,
  }
}

function gearItem(overrides: Partial<GearItem> = {}): GearItem {
  return {
    id: '11',
    typeId: 21,
    typeCode: 'sleeping_bag',
    typeName: 'Спальник',
    groupId: 1,
    groupCode: 'other',
    groupName: 'Прочее',
    sortOrder: 0,
    title: 'Спальник летний',
    weightGrams: 900,
    note: null,
    attributes: [],
    createdAt: '2026-10-29T10:00:00.000Z',
    ...overrides,
  }
}

function gearList(items: GearItem[]): {
  items: GearItem[]
  totalWeightGrams: number
  itemsWithoutWeight: number
} {
  return { items, totalWeightGrams: 0, itemsWithoutWeight: 0 }
}

function mounted(sleeping: RouteSleeping[] = []): ReturnType<typeof mount> {
  return mount(TripRouteSleeping, { props: { trip: TRIP, sleeping } })
}

describe('личные вещи ночёвки', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchGearTypes.mockResolvedValue([
      { id: 21, code: 'sleeping_bag', name: 'Спальник', sortOrder: 0, attributes: [] },
      { id: 22, code: 'mat', name: 'Коврик', sortOrder: 0, attributes: [] },
    ])
    mocks.listGear.mockResolvedValue(gearList([]))
    mocks.addRouteSleeping.mockResolvedValue(route())
    mocks.removeRouteSleeping.mockResolvedValue(route())
  })

  it('пустая секция честно говорит, что вещей нет, и показывает две кнопки', () => {
    const wrapper = mounted()

    expect(wrapper.get('[data-test="route-sleeping-empty"]').text()).toContain('не добавлено')
    expect(wrapper.get('[data-test="route-sleeping-add-sleeping_bag"]').text()).toBe(
      'Добавить спальник',
    )
    expect(wrapper.get('[data-test="route-sleeping-add-mat"]').text()).toBe('Добавить коврик')
  })

  it('пилюля подписана названием и весом: «Спальник зимний - 1200 гр.»', () => {
    const wrapper = mounted([sleepingRow()])

    expect(wrapper.get('[data-test="route-sleeping-item"]').text()).toContain(
      'Спальник зимний - 1200 гр.',
    )
  })

  it('без веса пилюля — только название, без прочерка', () => {
    const wrapper = mounted([sleepingRow({ weightGrams: null })])

    expect(wrapper.get('[data-test="route-sleeping-item"]').text()).toContain('Спальник зимний')
    expect(wrapper.get('[data-test="route-sleeping-item"]').text()).not.toContain('—')
  })

  it('кнопка цветная, пока вещи этого типа нет, и белая, когда есть', () => {
    const empty = mounted()
    expect(
      empty.get('[data-test="route-sleeping-add-sleeping_bag"]').classes(),
    ).toContain('bg-blue-600')

    const filled = mounted([sleepingRow()])
    expect(
      filled.get('[data-test="route-sleeping-add-sleeping_bag"]').classes(),
    ).toContain('bg-field')
    // Коврика ещё нет — его кнопка осталась цветной.
    expect(filled.get('[data-test="route-sleeping-add-mat"]').classes()).toContain('bg-blue-600')
  })

  it('крестик убирает вещь своим DELETE и отдаёт вкладку родителю', async () => {
    const wrapper = mounted([sleepingRow({ id: '5' })])

    await wrapper.get('[data-test="route-sleeping-remove-5"]').trigger('click')
    await flushPromises()

    expect(mocks.removeRouteSleeping).toHaveBeenCalledWith('1', '5')
    expect(wrapper.emitted('route')).toHaveLength(1)
  })

  it('диалог предлагает свои вещи нужного типа, которых ещё нет в секции', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([
        gearItem({ id: '11', title: 'Спальник летний' }),
        gearItem({ id: '12', typeCode: 'mat', typeId: 22, title: 'Коврик самонадувной' }),
        gearItem({ id: '13', typeCode: 'tent', typeName: 'Палатка', title: 'Палатка' }),
      ]),
    )

    const wrapper = mounted([sleepingRow({ gearItemId: '11' })])
    await wrapper.get('[data-test="route-sleeping-add-sleeping_bag"]').trigger('click')
    await flushPromises()

    const options = wrapper
      .get('[data-test="route-sleeping-gear"]')
      .findAll('option')
      .map((option) => option.text())

    // Свой спальник уже в ночёвке, коврик и палатка — другого типа.
    expect(options).toEqual(['выберите…'])
    expect(wrapper.get('[data-test="route-sleeping-no-gear"]').text()).toContain('заведите')
  })

  it('выбранная вещь уходит в ночёвку, диалог закрывается', async () => {
    mocks.listGear.mockResolvedValue(gearList([gearItem({ id: '11' })]))

    const wrapper = mounted()
    await wrapper.get('[data-test="route-sleeping-add-sleeping_bag"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-test="route-sleeping-gear"]').setValue('11')
    await wrapper.get('[data-test="route-sleeping-add-existing"]').trigger('click')
    await flushPromises()

    expect(mocks.addRouteSleeping).toHaveBeenCalledWith('1', '11')
    expect(wrapper.find('[data-test="route-sleeping-dialog"]').exists()).toBe(false)
    expect(wrapper.emitted('route')).toHaveLength(1)
  })

  it('новую вещь можно завести прямо здесь: каталог, потом ночёвка', async () => {
    mocks.createGearItem.mockResolvedValue(gearItem({ id: '99', title: 'Спальник новый' }))
    mocks.addRouteSleeping.mockResolvedValue(route())

    const wrapper = mounted()
    await wrapper.get('[data-test="route-sleeping-add-sleeping_bag"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-test="route-sleeping-new-title"]').setValue('Спальник новый')
    await wrapper.get('[data-test="route-sleeping-new-weight"]').setValue('1700')
    await wrapper.get('[data-test="route-sleeping-create"]').trigger('click')
    await flushPromises()

    expect(mocks.createGearItem).toHaveBeenCalledWith({
      typeId: 21,
      title: 'Спальник новый',
      weightGrams: 1700,
    })
    expect(mocks.addRouteSleeping).toHaveBeenCalledWith('1', '99')
    expect(wrapper.find('[data-test="route-sleeping-dialog"]').exists()).toBe(false)
    expect(wrapper.emitted('route')).toHaveLength(1)
  })

  it('без названия новая вещь не заводится — ошибка в диалоге', async () => {
    const wrapper = mounted()
    await wrapper.get('[data-test="route-sleeping-add-sleeping_bag"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-test="route-sleeping-create"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="route-sleeping-dialog-error"]').text()).toContain('Название')
    expect(mocks.createGearItem).not.toHaveBeenCalled()
  })

  it('мусор в весе объясняется словами, а не уходит на сервер', async () => {
    const wrapper = mounted()
    await wrapper.get('[data-test="route-sleeping-add-mat"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-test="route-sleeping-new-title"]').setValue('Коврик')
    await wrapper.get('[data-test="route-sleeping-new-weight"]').setValue('-5')
    await wrapper.get('[data-test="route-sleeping-create"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="route-sleeping-dialog-error"]').text()).toContain('Вес')
    expect(mocks.createGearItem).not.toHaveBeenCalled()
  })

  it('ошибку сервера видно в диалоге, а не под затемнением', async () => {
    mocks.listGear.mockResolvedValue(gearList([gearItem({ id: '11' })]))
    mocks.addRouteSleeping.mockRejectedValue(
      new ApiError(400, 'Спальник и коврик — вещи из вашего каталога снаряжения'),
    )

    const wrapper = mounted()
    await wrapper.get('[data-test="route-sleeping-add-sleeping_bag"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-test="route-sleeping-gear"]').setValue('11')
    await wrapper.get('[data-test="route-sleeping-add-existing"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="route-sleeping-dialog-error"]').text()).toContain(
      'из вашего каталога',
    )
    expect(wrapper.find('[data-test="route-sleeping-dialog"]').exists()).toBe(true)
  })

  it('«Отмена» закрывает диалог и ничего не отправляет', async () => {
    const wrapper = mounted()
    await wrapper.get('[data-test="route-sleeping-add-mat"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-test="route-sleeping-cancel"]').trigger('click')

    expect(wrapper.find('[data-test="route-sleeping-dialog"]').exists()).toBe(false)
    expect(mocks.addRouteSleeping).not.toHaveBeenCalled()
  })

  it('количество вещей не ограничено: две пилюли — две строки', () => {
    const wrapper = mounted([
      sleepingRow({ id: '1', gearItemId: '11' }),
      sleepingRow({ id: '2', gearItemId: '12', typeCode: 'mat', title: 'Коврик', weightGrams: 300 }),
    ])

    expect(wrapper.findAll('[data-test="route-sleeping-item"]')).toHaveLength(2)
  })
})
