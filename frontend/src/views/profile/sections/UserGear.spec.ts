import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { GearGroup, GearItem, GearItemAttribute, GearList } from '@/types/gear'
import type { GearType, GearTypeAttribute } from '@/types/gearTypes'
import type { Vehicle } from '@/types/trips'
import UserGear from '@/views/profile/sections/UserGear.vue'

/**
 * Тесты раздела «Снаряжение».
 *
 * **Группы стали личными (02.11.2026).** Заказчик: «Типы… группировать их
 * разрешим самостоятельно… можно переименовывать, удалять, перекидывать
 * содержащиеся типы». Поэтому здесь проверяется то, что изменилось:
 *
 * - секции собираются по личным группам, **пустые группы и типы не видны**;
 * - группы сворачиваются по одной и все разом, как в «Питании»;
 * - фильтр по наименованию и местоположению работает сразу;
 * - вещь заводится без выбора группы — группа следует из типа;
 * - местоположение правится на месте и уходит `null`-ом, когда поле пустое;
 * - «Настройка группировки» открывается диалогом.
 *
 * Прежнее тоже под проверкой: характеристики спрашиваются по типу, вес
 * складывается только из известных, стрелки меняют личный порядок внутри
 * группы.
 *
 * API подменён: проверяем аргументы запросов и состояние экрана, а не
 * разметку целиком.
 */
vi.mock('@/api/gear', () => ({
  listGear: vi.fn(),
  createGearItem: vi.fn(),
  updateGearItem: vi.fn(),
  deleteGearItem: vi.fn(),
  fetchGearGroups: vi.fn(),
  moveGearItem: vi.fn(),
  createGearGroup: vi.fn(),
  updateGearGroup: vi.fn(),
  deleteGearGroup: vi.fn(),
  moveGearGroup: vi.fn(),
  assignGearGroupType: vi.fn(),
}))

vi.mock('@/api/gearTypes', () => ({
  fetchGearTypes: vi.fn(),
}))

vi.mock('@/api/vehicles', () => ({
  fetchVehicles: vi.fn(),
  createVehicle: vi.fn(),
  updateVehicle: vi.fn(),
  removeVehicle: vi.fn(),
}))

import * as api from '@/api/gear'
import * as gearTypesApi from '@/api/gearTypes'
import * as vehiclesApi from '@/api/vehicles'

const mocked = vi.mocked(api)
const mockedTypes = vi.mocked(gearTypesApi)
const mockedVehicles = vi.mocked(vehiclesApi)

function attribute(
  overrides: Partial<GearTypeAttribute> &
    Pick<GearTypeAttribute, 'id' | 'code' | 'name' | 'valueKind'>,
): GearTypeAttribute {
  return {
    unit: null,
    allowCustomValue: false,
    isRequired: false,
    sortOrder: 0,
    options: [],
    ...overrides,
  }
}

/** «Палатка»: обязательная вместимость и необязательная модель. */
const TENT: GearType = {
  id: 1,
  code: 'tent',
  name: 'Палатка',
  sortOrder: 10,
  recommendedGroupId: 1,
  attributes: [
    attribute({
      id: 1,
      code: 'seats',
      name: 'Вместимость',
      valueKind: 'number',
      unit: 'мест',
      isRequired: true,
    }),
    attribute({ id: 2, code: 'model', name: 'Модель', valueKind: 'text' }),
  ],
}

/** «Газовый баллон»: обязательный объём и галочка «Новый». */
const GAS: GearType = {
  id: 2,
  code: 'gas',
  name: 'Газовый баллон',
  sortOrder: 30,
  recommendedGroupId: 3,
  attributes: [
    attribute({
      id: 3,
      code: 'volume',
      name: 'Объём',
      valueKind: 'number',
      unit: 'л',
      isRequired: true,
    }),
    attribute({ id: 4, code: 'is_new', name: 'Новый', valueKind: 'bool' }),
  ],
}

/** «Горелка»: список вариантов. */
const STOVE: GearType = {
  id: 3,
  code: 'stove',
  name: 'Горелка',
  sortOrder: 40,
  recommendedGroupId: 3,
  attributes: [
    attribute({
      id: 5,
      code: 'connection',
      name: 'Соединение',
      valueKind: 'select',
      options: [
        { id: 1, code: 'thread', name: 'резьбовой', sortOrder: 10 },
        { id: 2, code: 'collet', name: 'цанговый', sortOrder: 20 },
      ],
    }),
  ],
}

/** «Топор»: характеристик нет вообще — форма не должна рисовать пустоту. */
const AXE: GearType = {
  id: 4,
  code: 'axe',
  name: 'Топор',
  sortOrder: 20,
  recommendedGroupId: 2,
  attributes: [],
}

const TYPES = [TENT, AXE, GAS, STOVE]

/**
 * Личные группы: «Кров», «Костровое», «Кухня» и последнее «Прочее».
 *
 * У каждой группы свои типы — именно они решают, куда попадёт вещь.
 * «Костровое» пустое: секция с ним не должна рисоваться.
 */
const GROUPS: GearGroup[] = [
  {
    id: 1,
    name: 'Кров',
    sortOrder: 10,
    templateCode: 'roof',
    isDefault: false,
    types: [{ id: 1, code: 'tent', name: 'Палатка', isActive: true }],
  },
  {
    id: 2,
    name: 'Костровое',
    sortOrder: 20,
    templateCode: 'campfire',
    isDefault: false,
    types: [{ id: 4, code: 'axe', name: 'Топор', isActive: true }],
  },
  {
    id: 3,
    name: 'Кухня',
    sortOrder: 30,
    templateCode: 'kitchen',
    isDefault: false,
    types: [
      { id: 2, code: 'gas', name: 'Газовый баллон', isActive: true },
      { id: 3, code: 'stove', name: 'Горелка', isActive: true },
    ],
  },
  {
    id: 4,
    name: 'Прочее',
    sortOrder: 100,
    templateCode: 'other',
    isDefault: true,
    types: [],
  },
]

function savedAttribute(
  overrides: Partial<GearItemAttribute> &
    Pick<GearItemAttribute, 'code' | 'name' | 'valueKind' | 'value'>,
): GearItemAttribute {
  return { attributeId: 1, unit: null, ...overrides }
}

function makeItem(overrides: Partial<GearItem> = {}): GearItem {
  return {
    id: 'gear-1',
    typeId: 1,
    typeCode: 'tent',
    typeName: 'Палатка',
    groupId: 1,
    groupCode: 'roof',
    groupName: 'Кров',
    location: null,
    sortOrder: 10,
    title: 'Палатка на четверых',
    weightGrams: 2400,
    note: null,
    attributes: [
      savedAttribute({
        attributeId: 1,
        code: 'seats',
        name: 'Вместимость',
        valueKind: 'number',
        unit: 'мест',
        value: 3,
      }),
    ],
    createdAt: '2026-10-21T08:00:00.000Z',
    ...overrides,
  }
}

/** Баллон лежит в «Кухне», а не в «Прочем» — так проверяется порядок. */
function makeGas(overrides: Partial<GearItem> = {}): GearItem {
  return makeItem({
    id: 'gear-2',
    typeId: 2,
    typeCode: 'gas',
    typeName: 'Газовый баллон',
    groupId: 3,
    groupCode: 'kitchen',
    groupName: 'Кухня',
    sortOrder: 10,
    title: 'Баллон 450',
    weightGrams: 1500,
    attributes: [],
    ...overrides,
  })
}

function makeList(items: GearItem[]): GearList {
  return {
    items,
    totalWeightGrams: items.reduce((sum, item) => sum + (item.weightGrams ?? 0), 0),
    itemsWithoutWeight: items.filter((item) => item.weightGrams === null).length,
  }
}

async function mountSection(
  items: GearItem[] = [makeItem()],
  vehicles: Vehicle[] = [],
  types: GearType[] = TYPES,
  groups: GearGroup[] = GROUPS,
): Promise<VueWrapper> {
  mocked.listGear.mockResolvedValue(makeList(items))
  mockedVehicles.fetchVehicles.mockResolvedValue(vehicles)
  mockedTypes.fetchGearTypes.mockResolvedValue(types)
  mocked.fetchGearGroups.mockResolvedValue(groups)

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
    mocked.createGearItem.mockResolvedValue(
      makeItem({ id: 'gear-new', title: 'Котелок', groupId: 4, groupCode: 'other' }),
    )
    mocked.updateGearItem.mockImplementation(async (_id, patch) =>
      makeItem({
        weightGrams: patch.weightGrams === undefined ? 2400 : patch.weightGrams,
        title: patch.title ?? 'Палатка на четверых',
        location: patch.location === undefined ? null : patch.location,
      }),
    )
    mocked.deleteGearItem.mockResolvedValue(undefined)
    mocked.moveGearItem.mockResolvedValue(makeList([]))
  })

  // ───────────────────────────── список и секции ─────────────────────────────

  it('группирует вещи по личным группам и не показывает пустые', async () => {
    const wrapper = await mountSection([makeItem(), makeGas()])

    const groups = wrapper.findAll('[data-test="gear-group"]')
    expect(groups).toHaveLength(2)
    expect(groups[0]?.text()).toContain('Кров')
    expect(groups[1]?.text()).toContain('Кухня')
    // «Костровое» пустое — секции нет вовсе.
    expect(wrapper.text()).not.toContain('Костровое')
    expect(wrapper.find('[data-test="gear-total"]').text()).toBe('Всего: 3,9 кг')
  })

  it('порядок групп — из справочника, а не как пришли вещи', async () => {
    const wrapper = await mountSection([makeGas(), makeItem()])

    expect(wrapper.findAll('[data-test="gear-group-name"]')[0]?.text()).toContain('Кров')
    expect(wrapper.findAll('[data-test="gear-group-name"]')[1]?.text()).toContain('Кухня')
  })

  it('вещь без группы в справочнике не теряется', async () => {
    mocked.listGear.mockResolvedValue(
      makeList([
        makeItem({ groupId: 9, groupCode: 'custom_9', groupName: 'Рыбалка', title: 'Спиннинг' }),
      ]),
    )
    mocked.fetchGearGroups.mockResolvedValue(GROUPS)
    mockedTypes.fetchGearTypes.mockResolvedValue(TYPES)
    mockedVehicles.fetchVehicles.mockResolvedValue([])

    const wrapper = mount(UserGear)
    await flushPromises()

    expect(wrapper.find('[data-test="gear-group-name"]').text()).toContain('Рыбалка')
  })

  it('неизвестный вес не считается в итог, но виден в подписи', async () => {
    const wrapper = await mountSection([makeItem({ weightGrams: null, title: 'Котелок' })])

    expect(wrapper.find('[data-test="gear-total"]').text()).toBe(
      'Всего: 0 г · без веса: 1',
    )
  })

  it('пустой список приглашает начать', async () => {
    const wrapper = await mountSection([])

    expect(wrapper.find('[data-test="gear-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-total"]').text()).toBe('Всего: 0 г')
  })

  // ───────────────────────────── сворачивание ─────────────────────────────

  it('сворачивает одну группу и разворачивает её обратно', async () => {
    const wrapper = await mountSection([makeItem(), makeGas()])

    await wrapper.find('[data-test="group-toggle-1"]').trigger('click')
    expect(titles(wrapper)).toEqual(['Баллон 450'])
    expect(wrapper.find('[data-test="group-toggle-1"]').text()).toBe('Развернуть группу')

    await wrapper.find('[data-test="group-toggle-1"]').trigger('click')
    expect(titles(wrapper)).toEqual(['Палатка на четверых', 'Баллон 450'])
  })

  it('сворачивает и разворачивает все группы одной кнопкой', async () => {
    const wrapper = await mountSection([makeItem(), makeGas()])

    const all = wrapper.find('[data-test="groups-collapse-all"]')
    expect(all.text()).toBe('Свернуть все группы')

    await all.trigger('click')
    expect(titles(wrapper)).toEqual([])
    expect(wrapper.find('[data-test="groups-collapse-all"]').text()).toBe(
      'Развернуть все группы',
    )

    await wrapper.find('[data-test="groups-collapse-all"]').trigger('click')
    expect(titles(wrapper)).toHaveLength(2)
  })

  // ───────────────────────────── фильтр ─────────────────────────────

  it('фильтрует по наименованию сразу', async () => {
    const wrapper = await mountSection([makeItem(), makeGas()])

    await wrapper.find('[data-test="gear-filter-title"]').setValue('баллон')

    expect(titles(wrapper)).toEqual(['Баллон 450'])
    expect(wrapper.findAll('[data-test="gear-group"]')).toHaveLength(1)
  })

  it('фильтрует по местоположению, не трогая пустые', async () => {
    const wrapper = await mountSection([
      makeItem({ location: 'гараж' }),
      makeGas({ location: 'балкон' }),
    ])

    await wrapper.find('[data-test="gear-filter-location"]').setValue('ГАРАЖ')

    expect(titles(wrapper)).toEqual(['Палатка на четверых'])
  })

  it('оба фильтра работают вместе', async () => {
    const wrapper = await mountSection([
      makeItem({ title: 'Палатка', location: 'гараж' }),
      makeItem({ id: 'g3', title: 'Спальник', location: 'гараж' }),
      makeGas({ location: 'балкон' }),
    ])

    await wrapper.find('[data-test="gear-filter-title"]').setValue('спал')
    await wrapper.find('[data-test="gear-filter-location"]').setValue('гараж')

    expect(titles(wrapper)).toEqual(['Спальник'])
  })

  it('пустой результат фильтра объясняется и сбрасывается', async () => {
    const wrapper = await mountSection([makeItem()])

    await wrapper.find('[data-test="gear-filter-title"]').setValue('вертолёт')
    expect(wrapper.find('[data-test="gear-filter-empty"]').exists()).toBe(true)

    await wrapper.find('[data-test="gear-filter-reset"]').trigger('click')
    expect(titles(wrapper)).toEqual(['Палатка на четверых'])
  })

  // ─────────────────────── форма нового предмета ───────────────────────

  it('форма добавления скрыта и раскрывается кнопкой «Добавить объект»', async () => {
    const wrapper = await mountSection([])

    expect(wrapper.find('[data-test="gear-add-form"]').exists()).toBe(false)

    await wrapper.find('[data-test="gear-add-toggle"]').trigger('click')
    expect(wrapper.find('[data-test="gear-add-form"]').exists()).toBe(true)
  })

  it('добавляет предмет без группы: группа следует из типа, местоположение — полем', async () => {
    const wrapper = await mountSection([])
    await wrapper.find('[data-test="gear-add-toggle"]').trigger('click')

    expect(
      (wrapper.find('[data-test="gear-type"]').element as HTMLSelectElement).value,
    ).toBe('1')

    await wrapper.find('[data-test="gear-title"]').setValue('Палатка 4')
    await wrapper.find('[data-test="gear-weight"]').setValue('450')
    await wrapper.find('[data-test="gear-location"]').setValue('гараж')
    await wrapper.find('[data-test="gear-note"]').setValue('алюминиевая')
    await wrapper.find('[data-test="new-seats"]').setValue('4')
    await wrapper.find('[data-test="new-model"]').setValue('MSR')

    // Группу не выбирают — экран подсказывает, куда тип её положит.
    expect(wrapper.find('[data-test="gear-new-group-hint"]').text()).toContain('Кров')

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocked.createGearItem).toHaveBeenCalledWith({
      typeId: 1,
      title: 'Палатка 4',
      weightGrams: 450,
      location: 'гараж',
      note: 'алюминиевая',
      attributes: { seats: 4, model: 'MSR' },
    })
    expect(wrapper.find('[data-test="gear-add-form"]').exists()).toBe(false)
  })

  it('без веса и местоположения добавить можно', async () => {
    const wrapper = await mountSection([])
    await wrapper.find('[data-test="gear-add-toggle"]').trigger('click')

    await wrapper.find('[data-test="gear-title"]').setValue('Верёвка')
    await wrapper.find('[data-test="new-seats"]').setValue('2')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocked.createGearItem).toHaveBeenCalledWith({
      typeId: 1,
      title: 'Верёвка',
      weightGrams: null,
      location: null,
      note: null,
      attributes: { seats: 2, model: null },
    })
  })

  it('обязательная характеристика не даёт отправить вещь без значения', async () => {
    const wrapper = await mountSection([])
    await wrapper.find('[data-test="gear-add-toggle"]').trigger('click')

    await wrapper.find('[data-test="gear-title"]').setValue('Палатка')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocked.createGearItem).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="gear-error"]').text()).toContain(
      'Заполните обязательные характеристики: «Вместимость»',
    )
  })

  it('мусор в весе не отправляется', async () => {
    const wrapper = await mountSection([])
    await wrapper.find('[data-test="gear-add-toggle"]').trigger('click')

    await wrapper.find('[data-test="gear-title"]').setValue('Гитара')
    await wrapper.find('[data-test="gear-weight"]').setValue('0')
    await wrapper.find('[data-test="new-seats"]').setValue('1')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocked.createGearItem).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="gear-error"]').text()).toContain('целое число')
  })

  it('при смене типа поля меняются на характеристики нового типа', async () => {
    const wrapper = await mountSection([])
    await wrapper.find('[data-test="gear-add-toggle"]').trigger('click')

    await wrapper.find('[data-test="gear-type"]').setValue(4)
    await flushPromises()
    expect(wrapper.find('[data-test="gear-attributes"]').exists()).toBe(false)

    await wrapper.find('[data-test="gear-type"]').setValue(3)
    await flushPromises()
    await wrapper.find('[data-test="gear-title"]').setValue('Горелка')
    await wrapper.find('[data-test="new-connection"]').setValue('цанговый')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocked.createGearItem).toHaveBeenCalledWith({
      typeId: 3,
      title: 'Горелка',
      weightGrams: null,
      location: null,
      note: null,
      attributes: { connection: 'цанговый' },
    })
  })

  it('ошибку сервера показывает словами бэкенда', async () => {
    const wrapper = await mountSection([])
    await wrapper.find('[data-test="gear-add-toggle"]').trigger('click')
    mocked.createGearItem.mockRejectedValue(
      new ApiError(400, 'У предмета должно быть название', null),
    )

    await wrapper.find('[data-test="gear-title"]').setValue('Палатка')
    await wrapper.find('[data-test="new-seats"]').setValue('3')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-test="gear-error"]').text()).toContain(
      'У предмета должно быть название',
    )
  })

  it('ошибку загрузки типов показывает отдельно от списка', async () => {
    mocked.listGear.mockResolvedValue(makeList([]))
    mockedVehicles.fetchVehicles.mockResolvedValue([])
    mocked.fetchGearGroups.mockResolvedValue(GROUPS)
    mockedTypes.fetchGearTypes.mockRejectedValue(
      new ApiError(500, 'Справочник недоступен', null),
    )

    const wrapper = mount(UserGear)
    await flushPromises()

    expect(wrapper.find('[data-test="gear-types-error"]').text()).toContain(
      'Справочник недоступен',
    )
    expect(wrapper.find('[data-test="gear-empty"]').exists()).toBe(true)
  })

  // ─────────────────────── правка на месте и значения ───────────────────────

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

  it('местоположение правится на месте, пустое — null', async () => {
    const wrapper = await mountSection([makeItem({ location: 'балкон' })])

    const location = wrapper.find('[data-test="item-location"]')
    await location.setValue('гараж')
    await location.trigger('change')
    await flushPromises()

    expect(mocked.updateGearItem).toHaveBeenCalledWith('gear-1', { location: 'гараж' })

    await location.setValue('  ')
    await location.trigger('change')
    await flushPromises()

    expect(mocked.updateGearItem).toHaveBeenLastCalledWith('gear-1', { location: null })
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

  it('характеристики видны под предметом словами', async () => {
    const wrapper = await mountSection()

    expect(wrapper.find('[data-test="item-attributes-summary"]').text()).toContain(
      'Палатка · Вместимость: 3 мест',
    )
  })

  it('в правке нет выбора группы — группа объясняется словами', async () => {
    const wrapper = await mountSection()

    await wrapper.find('[data-test="item-attributes"]').trigger('click')

    expect(wrapper.find('[data-test="item-group"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="item-group-hint"]').text()).toContain('Кров')
  })

  it('правка характеристик уходит картой, без группы', async () => {
    const wrapper = await mountSection()

    expect(wrapper.find('[data-test="item-attributes-editor"]').exists()).toBe(false)

    await wrapper.find('[data-test="item-attributes"]').trigger('click')
    expect((wrapper.find('[data-test="edit-seats"]').element as HTMLInputElement).value).toBe('3')

    await wrapper.find('[data-test="edit-seats"]').setValue('4')
    await wrapper.find('[data-test="item-attributes-save"]').trigger('click')
    await flushPromises()

    expect(mocked.updateGearItem).toHaveBeenCalledWith('gear-1', {
      attributes: { seats: 4, model: null },
    })
  })

  it('смена типа в правке стирает прежние значения и уходит с typeId', async () => {
    const wrapper = await mountSection()

    await wrapper.find('[data-test="item-attributes"]').trigger('click')
    await wrapper.find('[data-test="item-type"]').setValue(2)
    await flushPromises()

    expect(wrapper.find('[data-test="edit-seats"]').exists()).toBe(false)
    expect((wrapper.find('[data-test="edit-volume"]').element as HTMLInputElement).value).toBe('')

    await wrapper.find('[data-test="item-attributes-save"]').trigger('click')
    await flushPromises()
    expect(mocked.updateGearItem).not.toHaveBeenCalled()

    await wrapper.find('[data-test="edit-volume"]').setValue('450')
    await wrapper.find('[data-test="item-attributes-save"]').trigger('click')
    await flushPromises()

    expect(mocked.updateGearItem).toHaveBeenCalledWith('gear-1', {
      typeId: 2,
      attributes: { volume: 450, is_new: false },
    })
  })

  it('вещь в архивном типе: экран объясняет и не даёт сохранить', async () => {
    const wrapper = await mountSection([makeItem()], [], [AXE, GAS, STOVE])

    await wrapper.find('[data-test="item-attributes"]').trigger('click')

    expect(wrapper.find('[data-test="item-type-archived"]').exists()).toBe(true)
    expect(
      (wrapper.find('[data-test="item-attributes-save"]').element as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('удаляет предмет из списка, спросив подтверждение', async () => {
    const wrapper = await mountSection()

    await wrapper.find('[data-test="item-delete"]').trigger('click')
    expect(mocked.deleteGearItem).not.toHaveBeenCalled()

    await wrapper.find('[data-test="item-delete-cancel"]').trigger('click')
    expect(wrapper.find('[data-test="item-delete"]').exists()).toBe(true)

    await wrapper.find('[data-test="item-delete"]').trigger('click')
    await wrapper.find('[data-test="item-delete-confirm"]').trigger('click')
    await flushPromises()

    expect(mocked.deleteGearItem).toHaveBeenCalledWith('gear-1')
    expect(wrapper.find('[data-test="gear-empty"]').exists()).toBe(true)
  })

  // ───────────────────────────── личный порядок ─────────────────────────────

  it('стрелки меняют личный порядок внутри полки', async () => {
    mocked.listGear.mockResolvedValue(
      makeList([
        makeItem({ id: 'g1', title: 'Первая', sortOrder: 10 }),
        makeItem({ id: 'g2', title: 'Вторая', sortOrder: 20 }),
      ]),
    )
    mocked.fetchGearGroups.mockResolvedValue(GROUPS)
    mockedVehicles.fetchVehicles.mockResolvedValue([])
    mockedTypes.fetchGearTypes.mockResolvedValue(TYPES)
    mocked.moveGearItem.mockResolvedValue(
      makeList([
        makeItem({ id: 'g2', title: 'Вторая', sortOrder: 10 }),
        makeItem({ id: 'g1', title: 'Первая', sortOrder: 20 }),
      ]),
    )

    const wrapper = mount(UserGear)
    await flushPromises()

    const ups = wrapper.findAll('[data-test="item-move-up"]')
    expect((ups[0]?.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.findAll('[data-test="item-move-down"]')[0]?.trigger('click')
    await flushPromises()

    expect(mocked.moveGearItem).toHaveBeenCalledWith('g1', 'down')
    expect(titles(wrapper)).toEqual(['Вторая', 'Первая'])
  })

  it('в полке из одной вещи обе стрелки выключены', async () => {
    const wrapper = await mountSection()

    expect(
      (wrapper.find('[data-test="item-move-up"]').element as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (wrapper.find('[data-test="item-move-down"]').element as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(mocked.moveGearItem).not.toHaveBeenCalled()
  })

  // ───────────────────────────── настройка групп ─────────────────────────────

  it('кнопка «Настройка группировки» открывает диалог с личными группами', async () => {
    const wrapper = await mountSection()

    expect(wrapper.find('[data-test="grouping-dialog"]').exists()).toBe(false)

    await wrapper.find('[data-test="grouping-open"]').trigger('click')

    expect(wrapper.find('[data-test="grouping-dialog"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-test="grouping-group"]')).toHaveLength(4)
    expect(wrapper.find('[data-test="grouping-default"]').exists()).toBe(true)

    const names = wrapper
      .findAll('[data-test="grouping-name"]')
      .map((input) => (input.element as HTMLInputElement).value)
    expect(names).toEqual(['Кров', 'Костровое', 'Кухня', 'Прочее'])
  })

  it('диалог группировки не перечитывает группы своим запросом', async () => {
    const wrapper = await mountSection()

    await wrapper.find('[data-test="grouping-open"]').trigger('click')

    // Список пришёл из каталога — второй запрос при открытии не нужен.
    expect(mocked.fetchGearGroups).toHaveBeenCalledTimes(1)
  })

  // ───────────────────────────── моя техника ─────────────────────────────

  it('показывает технику отдельной секцией, без вместимости', async () => {
    const wrapper = await mountSection(
      [makeItem()],
      [
        {
          id: 'veh-1',
          kind: 'car',
          brand: 'Нива',
          plate: 'А123ВС38',
          seats: 4,
          createdAt: '2026-10-21T08:00:00.000Z',
        },
      ],
    )

    const section = wrapper.find('[data-test="vehicles"]')
    expect(section.exists()).toBe(true)
    expect(section.text()).toContain('Автомобиль')
    expect(section.text()).toContain('А123ВС38')
    expect(section.text()).not.toContain('4 мест')
    expect(section.text()).not.toContain('вместимость')
  })

  it('заводит технику с типом, маркой и номером — без вместимости', async () => {
    const wrapper = await mountSection()

    mockedVehicles.createVehicle.mockResolvedValue({
      id: 'veh-2',
      kind: 'snowmobile',
      brand: 'Буран',
      plate: null,
      seats: null,
      createdAt: '2026-10-21T09:00:00.000Z',
    })

    expect(wrapper.find('[data-test="vehicle-seats"]').exists()).toBe(false)

    await wrapper.find('[data-test="vehicle-kind"]').setValue('snowmobile')
    await wrapper.find('[data-test="vehicle-brand"]').setValue('Буран')
    await wrapper.find('[data-test="vehicle-add"]').trigger('click')
    await flushPromises()

    expect(mockedVehicles.createVehicle).toHaveBeenCalledWith({
      kind: 'snowmobile',
      brand: 'Буран',
      plate: null,
    })

    expect(wrapper.find('[data-test="vehicles-list"]').text()).toContain('Снегоход')
  })

  it('убирает технику из списка, спросив подтверждение', async () => {
    mockedVehicles.removeVehicle.mockResolvedValue(undefined)

    const wrapper = await mountSection(
      [makeItem()],
      [
        {
          id: 'veh-1',
          kind: 'boat',
          brand: 'Прогресс',
          plate: null,
          seats: 3,
          createdAt: '2026-10-21T08:00:00.000Z',
        },
      ],
    )

    await wrapper.find('[data-test="vehicle-delete"]').trigger('click')
    expect(mockedVehicles.removeVehicle).not.toHaveBeenCalled()

    await wrapper.find('[data-test="vehicle-delete-confirm"]').trigger('click')
    await flushPromises()

    expect(mockedVehicles.removeVehicle).toHaveBeenCalledWith('veh-1')
    expect(wrapper.find('[data-test="vehicles-empty"]').exists()).toBe(true)
  })
})
