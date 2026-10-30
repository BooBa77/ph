import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { GearItem, GearItemAttribute, GearList } from '@/types/gear'
import type { GearType, GearTypeAttribute } from '@/types/gearTypes'
import type { Vehicle } from '@/types/trips'
import UserGear from '@/views/profile/sections/UserGear.vue'

/**
 * Тесты раздела «Снаряжение».
 *
 * Главное здесь — **переход на типы** (Stage B, 30.10.2026): тип выбирается
 * из справочника, его характеристики спрашиваются динамической формой,
 * а обязательные не дают отправить вещь без значения. Плюс прежнее: вес
 * складывается только из известных, правится на месте, пустое поле значит
 * «не знаю», а не ноль.
 *
 * API подменён: проверяем аргументы запросов и состояние экрана, а не
 * разметку целиком.
 */
vi.mock('@/api/gear', () => ({
  listGear: vi.fn(),
  createGearItem: vi.fn(),
  updateGearItem: vi.fn(),
  deleteGearItem: vi.fn(),
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
const AXE: GearType = { id: 4, code: 'axe', name: 'Топор', sortOrder: 20, attributes: [] }

const TYPES = [TENT, AXE, GAS, STOVE]

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
    kind: 'tent',
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
): Promise<VueWrapper> {
  mocked.listGear.mockResolvedValue(makeList(items))
  mockedVehicles.fetchVehicles.mockResolvedValue(vehicles)
  mockedTypes.fetchGearTypes.mockResolvedValue(types)

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

  // ───────────────────────────── список ─────────────────────────────

  it('группирует предметы по типам, а не по видам', async () => {
    const wrapper = await mountSection([
      makeItem(),
      makeItem({
        id: 'gear-2',
        typeId: 2,
        typeCode: 'gas',
        typeName: 'Газовый баллон',
        kind: 'kitchen',
        title: 'Баллон 450',
        weightGrams: 1500,
        attributes: [],
      }),
    ])

    const groups = wrapper.findAll('[data-test="gear-group"]')
    expect(groups).toHaveLength(2)
    expect(groups[0]?.text()).toContain('Палатка')
    expect(groups[1]?.text()).toContain('Газовый баллон')
    expect(wrapper.find('[data-test="gear-total"]').text()).toBe('Всего: 3,9 кг')
  })

  it('порядок групп — как в справочнике, а не как пришли вещи', async () => {
    const wrapper = await mountSection([
      makeItem({
        id: 'gear-2',
        typeId: 2,
        typeCode: 'gas',
        typeName: 'Газовый баллон',
        attributes: [],
      }),
      makeItem(),
    ])

    expect(wrapper.findAll('[data-test="gear-group"]')[0]?.text()).toContain('Палатка')
    expect(titles(wrapper)).toContain('Палатка на четверых')
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

  // ─────────────────────── форма нового предмета ───────────────────────

  it('добавляет предмет с типом, характеристиками, весом и заметкой', async () => {
    const wrapper = await mountSection([])

    // Первый тип справочника подставлен сразу: пустого «выберите тип» нет.
    expect(
      (wrapper.find('[data-test="gear-type"]').element as HTMLSelectElement).value,
    ).toBe('1')

    await wrapper.find('[data-test="gear-title"]').setValue('Палатка 4')
    await wrapper.find('[data-test="gear-weight"]').setValue('450')
    await wrapper.find('[data-test="gear-note"]').setValue('алюминиевая')
    await wrapper.find('[data-test="new-seats"]').setValue('4')
    await wrapper.find('[data-test="new-model"]').setValue('MSR')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocked.createGearItem).toHaveBeenCalledWith({
      typeId: 1,
      title: 'Палатка 4',
      weightGrams: 450,
      note: 'алюминиевая',
      attributes: { seats: 4, model: 'MSR' },
    })
    expect(titles(wrapper)).toContain('Котелок')
  })

  it('без веса и без необязательных характеристик добавить можно', async () => {
    const wrapper = await mountSection([])

    await wrapper.find('[data-test="gear-title"]').setValue('Верёвка')
    await wrapper.find('[data-test="new-seats"]').setValue('2')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocked.createGearItem).toHaveBeenCalledWith({
      typeId: 1,
      title: 'Верёвка',
      weightGrams: null,
      note: null,
      attributes: { seats: 2, model: null },
    })
  })

  it('обязательная характеристика не даёт отправить вещь без значения', async () => {
    const wrapper = await mountSection([])

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

    // У топора характеристик нет — блок полей исчезает целиком.
    await wrapper.find('[data-test="gear-type"]').setValue(4)
    await flushPromises()
    expect(wrapper.find('[data-test="gear-attributes"]').exists()).toBe(false)

    // У горелки — список вариантов: выбор уходит именем варианта.
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
      note: null,
      attributes: { connection: 'цанговый' },
    })
  })

  it('галочка уходит true или false, снятая — тоже значение', async () => {
    const wrapper = await mountSection([])

    await wrapper.find('[data-test="gear-type"]').setValue(2)
    await flushPromises()
    await wrapper.find('[data-test="gear-title"]').setValue('Баллон')
    await wrapper.find('[data-test="new-volume"]').setValue('450')
    await wrapper.find('[data-test="new-is_new"]').setValue(true)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocked.createGearItem).toHaveBeenCalledWith({
      typeId: 2,
      title: 'Баллон',
      weightGrams: null,
      note: null,
      attributes: { volume: 450, is_new: true },
    })
  })

  it('ошибку сервера показывает словами бэкенда', async () => {
    const wrapper = await mountSection([])
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

    expect(wrapper.find('[data-test="item-attributes-summary"]').text()).toBe(
      'Вместимость: 3 мест',
    )
  })

  it('характеристики правятся в раскрывающемся блоке и уходят картой', async () => {
    const wrapper = await mountSection()

    // До нажатия полей правки нет.
    expect(wrapper.find('[data-test="item-attributes-editor"]').exists()).toBe(false)

    await wrapper.find('[data-test="item-attributes"]').trigger('click')
    expect((wrapper.find('[data-test="edit-seats"]').element as HTMLInputElement).value).toBe('3')

    await wrapper.find('[data-test="edit-seats"]').setValue('4')
    await wrapper.find('[data-test="item-attributes-save"]').trigger('click')
    await flushPromises()

    // Тип не меняли — `typeId` не отправляется: это обычная правка значений.
    expect(mocked.updateGearItem).toHaveBeenCalledWith('gear-1', {
      attributes: { seats: 4, model: null },
    })
    expect(wrapper.find('[data-test="item-attributes-editor"]').exists()).toBe(false)
  })

  it('смена типа в правке стирает прежние значения и уходит с typeId', async () => {
    const wrapper = await mountSection()

    await wrapper.find('[data-test="item-attributes"]').trigger('click')
    await wrapper.find('[data-test="item-type"]').setValue(2)
    await flushPromises()

    // Поля прежнего типа ушли, поля нового — пустые.
    expect(wrapper.find('[data-test="edit-seats"]').exists()).toBe(false)
    expect((wrapper.find('[data-test="edit-volume"]').element as HTMLInputElement).value).toBe('')

    // Без обязательного объёма сохранить нельзя.
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
    // Справочник без «Палатки»: тип вещи туда не входит.
    const wrapper = await mountSection([makeItem()], [], [AXE, GAS, STOVE])

    await wrapper.find('[data-test="item-attributes"]').trigger('click')

    expect(wrapper.find('[data-test="item-type-archived"]').exists()).toBe(true)
    expect(
      (wrapper.find('[data-test="item-attributes-save"]').element as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('удаляет предмет из списка, спросив подтверждение', async () => {
    const wrapper = await mountSection()

    // Первый клик только спрашивает.
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

  /**
   * Техника — отдельная секция: у неё своя структура (тип, марка, номер),
   * и в одну таблицу с весом рюкзака она не ложится.
   *
   * Вместимости здесь нет (28.10.2026): места считаются у карточки
   * перемещения, а не в каталоге.
   */
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
    // Ни цифры, ни подписи «вместимость не указана» в каталоге не показываем.
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

    // Поля вместимости в форме больше нет.
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
