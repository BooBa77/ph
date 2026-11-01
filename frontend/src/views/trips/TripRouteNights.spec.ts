import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { TripGearItem } from '@/types/gear'
import type { RouteNight, RouteNightInput, Trip, TripRoute } from '@/types/trips'
import TripRouteNights from '@/views/trips/TripRouteNights.vue'

/**
 * Таблица ночёвок — **один вариант на ночь и сохранение на лету**
 * (01.11.2026).
 *
 * Спека держит то, что заказчик продиктовал словами и что дешевле проверить
 * здесь, чем снимком:
 *
 * - у ночи **один** вариант: «Ещё вариант», крестиков строк и выбора палатки
 *   в ночи больше нет;
 * - палатка и машина больше не ссылки ночи: распределение по палаткам
 *   действует на весь поход, машины с «Трансфером» не связаны;
 * - «Сохранить», «Отменить» и «Есть несохранённые изменения» удалены:
 *   каждая правка уходит на сервер сама;
 * - место, готовка и варианты подчиняются прежним правилам заказчика;
 * - личная секция «Спальник» видна при палатке, избе и машине.
 *
 * Секции «Палатки» и «Костровое» подгружают своё: состав похода и снаряжение
 * похода. Здесь важна раскладка ночёвок, поэтому их запросы заглушены.
 */
const mocks = vi.hoisted(() => ({
  fetchTripRoute: vi.fn(),
  saveRouteNights: vi.fn(),
  addRouteSleeping: vi.fn(),
  removeRouteSleeping: vi.fn(),
  lodgeRoute: vi.fn(),
  acceptRouteLodger: vi.fn(),
  releaseRouteLodger: vi.fn(),
  listParticipants: vi.fn(),
  listTripGear: vi.fn(),
  listGear: vi.fn(),
  createGearItem: vi.fn(),
  proposeTripGear: vi.fn(),
  removeTripGear: vi.fn(),
}))

vi.mock('@/api/trips', () => ({
  fetchTripRoute: mocks.fetchTripRoute,
  saveRouteNights: mocks.saveRouteNights,
  addRouteSleeping: mocks.addRouteSleeping,
  removeRouteSleeping: mocks.removeRouteSleeping,
  lodgeRoute: mocks.lodgeRoute,
  acceptRouteLodger: mocks.acceptRouteLodger,
  releaseRouteLodger: mocks.releaseRouteLodger,
  listParticipants: mocks.listParticipants,
}))

vi.mock('@/api/gear', () => ({
  listGear: mocks.listGear,
  listTripGear: mocks.listTripGear,
  createGearItem: mocks.createGearItem,
  proposeTripGear: mocks.proposeTripGear,
  removeTripGear: mocks.removeTripGear,
}))

vi.mock('@/api/gearTypes', () => ({
  fetchGearTypes: vi.fn().mockResolvedValue([]),
}))

const ME = 'demo-me'
const ANNA = 'demo-anna'

function trip(dates: Partial<Pick<Trip, 'startsAt' | 'endsAt'>> = {}): Trip {
  return { id: '1', organizerUserId: ME, ...dates } as Trip
}

/** Две ночи: 29 и 30 октября. */
const TWO_NIGHTS = {
  startsAt: '2026-10-29T00:00:00.000Z',
  endsAt: '2026-10-31T00:00:00.000Z',
}

/** Пустая вкладка: таблица ещё не записана, править можно. */
function emptyRoute(overrides: Partial<TripRoute> = {}): TripRoute {
  return {
    canEdit: true,
    nights: [],
    sleeping: [],
    lodgers: [],
    travelers: [],
    ...overrides,
  }
}

function routeNight(overrides: Partial<RouteNight> = {}): RouteNight {
  return {
    id: '1',
    position: 1,
    date: null,
    place: null,
    kind: null,
    cooking: null,
    ...overrides,
  }
}

function tripGearItem(overrides: Partial<TripGearItem> = {}): TripGearItem {
  return {
    id: 'g1',
    gearItemId: '10',
    typeId: 1,
    typeCode: 'tent',
    typeName: 'Палатка',
    title: 'Палатка на четверых',
    attributes: [],
    weightGrams: 2400,
    note: null,
    isTripOnly: false,
    status: 'approved',
    assignedUserId: null,
    ownerUserId: ANNA,
    createdAt: '2026-10-29T10:00:00.000Z',
    ...overrides,
  }
}

function gearList(items: TripGearItem[]): {
  items: TripGearItem[]
  totalWeightGrams: number
  itemsWithoutWeight: number
} {
  return { items, totalWeightGrams: 0, itemsWithoutWeight: 0 }
}

/** Текст заголовка без переносов шаблона: в разметке он разбит на две части. */
function titles(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll('[data-test="route-night-title"]')
    .map((node) => node.text().replace(/\s+/g, ' ').trim())
}

/** Селекты «Где ночуем» по порядку ночей. */
function nightKinds(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('[data-test="route-night-kind"]')
}

/** Элемент по индексу: `noUncheckedIndexedAccess` не разрешает брать наугад. */
function at<T>(items: T[], index: number): T {
  const item = items[index]

  if (item === undefined) throw new Error(`нет элемента с индексом ${index}`)

  return item
}

/**
 * Дождаться сохранения на лету.
 *
 * Выпадающие списки уходят через `setTimeout(0)`, текст — через 500 мс,
 * поэтому `flushPromises` один не помогает: он не двигает таймеры.
 */
async function settle(ms = 10): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
  await flushPromises()
}

/**
 * Смонтировать экран с готовым ответом сервера.
 *
 * Загрузка асинхронная: пока `GET /route` не ответил, разметки ночей нет,
 * поэтому каждый тест сначала ждёт прокрутку промисов.
 */
async function mounted(
  model: Trip = trip(),
  route: TripRoute = emptyRoute(),
): Promise<ReturnType<typeof mount>> {
  mocks.fetchTripRoute.mockResolvedValue(route)

  const wrapper = mount(TripRouteNights, { props: { trip: model } })
  await flushPromises()

  return wrapper
}

/**
 * Заглушка сохранения: сервер «возвращает» присланную таблицу, как настоящий.
 * Ответ обновляет вкладку, а `rows` остаются тем, что человек видит.
 */
function echoNights(nights: RouteNightInput[]): TripRoute {
  return emptyRoute({
    nights: nights.map((night, index) => ({
      id: String(index + 1),
      position: night.position,
      date: night.date ?? null,
      place: night.place ?? null,
      kind: night.kind ?? null,
      cooking: night.cooking ?? null,
    })),
  })
}

describe('плашки ночёвок', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    mocks.listParticipants.mockResolvedValue([])
    mocks.listTripGear.mockResolvedValue(gearList([]))
    mocks.saveRouteNights.mockImplementation((_: string, nights: RouteNightInput[]) =>
      Promise.resolve(echoNights(nights)),
    )
  })

  it('у похода 29–31 октября две ночи, заголовок как в «Питании»', async () => {
    const wrapper = await mounted(
      trip({
        startsAt: '2026-10-29T00:00:00.000Z',
        endsAt: '2026-10-31T00:00:00.000Z',
      }),
    )

    expect(titles(wrapper)).toEqual(['Ночь 1 · 29 октября', 'Ночь 2 · 30 октября'])
    // Дат хватает — подписи «для примера» быть не должно.
    expect(wrapper.find('[data-test="route-nights-note"]').exists()).toBe(false)
  })

  it('без дат показывает три ночи и честно подписывает их примером', async () => {
    const wrapper = await mounted(trip())

    expect(titles(wrapper)).toHaveLength(3)
    expect(wrapper.get('[data-test="route-nights-note"]').text()).toContain('для примера')
  })

  it('плашки живут в сворачиваемой секции «Ночёвки»', async () => {
    const wrapper = await mounted(trip())
    const section = wrapper.get('[data-test="route-nights-section"]')

    expect(section.element.tagName).toBe('DETAILS')
    expect(section.attributes('open')).toBeDefined()
    expect(section.get('summary').text()).toBe('Ночёвки')
  })

  it('варианты идут в порядке заказчика, «в пути» — в конце', async () => {
    const wrapper = await mounted(trip())

    const options = wrapper
      .get('[data-test="route-night-kind"]')
      .findAll('option')
      .map((option) => option.text())

    // Первый пункт пустой строкой, а не «Не выбрано»: незаполненная ночь
    // должна бросаться в глаза (заказчик, 29.10.2026).
    expect(options).toEqual([
      '',
      'Палатка',
      'Гостиница',
      'Изба',
      'Машина',
      'Идём всю ночь',
      'В пути',
    ])
  })

  it('«идём всю ночь», «в пути» и «гостиница» — больше ничего не спрашивают', async () => {
    const wrapper = await mounted(trip())
    const kind = wrapper.get('[data-test="route-night-kind"]')

    for (const value of ['allnight', 'transit', 'hotel']) {
      await kind.setValue(value)
      expect(wrapper.find('[data-test="route-night-cooking"]').exists()).toBe(false)
    }
  })

  it('палатка, изба и машина спрашивают готовку: костёр, горелка, два сразу', async () => {
    const wrapper = await mounted(trip())
    const kind = wrapper.get('[data-test="route-night-kind"]')

    for (const value of ['tent', 'hut', 'car']) {
      await kind.setValue(value)

      const cooking = wrapper.findAll('[data-test="route-night-cooking"] option')
      expect(cooking.map((option) => option.text())).toEqual([
        '',
        'Костёр',
        'Горелка',
        'Костёр+Горелка',
      ])
    }
  })

  it('пустое выглядит пустым, а считается как «идём всю ночь»', async () => {
    const wrapper = await mounted(trip())
    const kind = wrapper.get('[data-test="route-night-kind"]')

    // Пустое поле ничего не спрашивает — как ночной переход.
    expect((kind.element as HTMLSelectElement).value).toBe('')
    expect(wrapper.find('[data-test="route-night-cooking"]').exists()).toBe(false)

    // И возврат к пустому ведёт себя так же: палатка требовала готовку,
    // пустое — нет, и «Палатки» с «Костровым» закрываются.
    await kind.setValue('tent')
    await kind.setValue('')
    expect(wrapper.find('[data-test="route-night-cooking"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="route-tents-section"]').exists()).toBe(false)
  })

  it('способ готовки сбрасывается, когда вариант перестал его спрашивать', async () => {
    const wrapper = await mounted(trip())
    const kind = wrapper.get('[data-test="route-night-kind"]')

    await kind.setValue('tent')
    await wrapper.get('[data-test="route-night-cooking"]').setValue('fire')

    await kind.setValue('hotel')
    await kind.setValue('tent')

    const cooking = wrapper.get('[data-test="route-night-cooking"]').element as HTMLSelectElement
    expect(cooking.value).toBe('')
  })

  it('«Палатки», «Спальник» и «Костровое» скрыты, пока ничего не выбрано', async () => {
    const wrapper = await mounted(trip())

    expect(wrapper.find('[data-test="route-tents-section"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="route-sleeping-section"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="route-cooking-section"]').exists()).toBe(false)
  })

  it('«Палатка» открывает зелёные «Палатки» и синий «Спальник», готовка — «Костровое»', async () => {
    const wrapper = await mounted(trip())
    const kind = wrapper.get('[data-test="route-night-kind"]')

    await kind.setValue('tent')
    expect(wrapper.find('[data-test="route-tents-section"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="route-sleeping-section"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="route-cooking-section"]').exists()).toBe(false)

    await wrapper.get('[data-test="route-night-cooking"]').setValue('stove')
    expect(wrapper.find('[data-test="route-cooking-section"]').exists()).toBe(true)

    // Секции читаются сверху вниз: ночёвки, палатки, спальник, костровое.
    const sections = wrapper.findAll('details').map((node) => node.get('summary').text())
    expect(sections).toEqual(['Ночёвки', 'Палатки', 'Спальник', 'Костровое'])
  })

  it('без палатки зелёной секции нет, даже если готовка выбрана', async () => {
    const wrapper = await mounted(trip())
    const kind = wrapper.get('[data-test="route-night-kind"]')

    await kind.setValue('hut')
    await wrapper.get('[data-test="route-night-cooking"]').setValue('fire')

    expect(wrapper.find('[data-test="route-tents-section"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="route-cooking-section"]').exists()).toBe(true)
  })

  it('«Спальник» — синяя секция, видна при палатке, избе и машине', async () => {
    const wrapper = await mounted(trip())
    const kind = wrapper.get('[data-test="route-night-kind"]')

    for (const value of ['tent', 'hut', 'car']) {
      await kind.setValue(value)
      expect(wrapper.find('[data-test="route-sleeping-section"]').exists()).toBe(true)
    }

    for (const value of ['hotel', 'allnight', 'transit', '']) {
      await kind.setValue(value)
      expect(wrapper.find('[data-test="route-sleeping-section"]').exists()).toBe(false)
    }

    await kind.setValue('tent')
    const section = wrapper.get('[data-test="route-sleeping-section"]')
    expect(section.classes()).toContain('bg-blue-100')
    expect(section.get('summary').classes()).toContain('text-blue-900')
  })

  it('«Палатки» подписаны словами заказчика, а в «Костровом» лишнего текста нет', async () => {
    const wrapper = await mounted(
      trip({
        startsAt: '2026-10-29T00:00:00.000Z',
        endsAt: '2026-10-31T00:00:00.000Z',
      }),
    )

    await wrapper.get('[data-test="route-night-kind"]').setValue('tent')
    await wrapper.get('[data-test="route-night-cooking"]').setValue('fire')
    await flushPromises()

    expect(wrapper.get('[data-test="route-tents-title"]').text()).toBe(
      'Распределение участников по палаткам',
    )

    expect(wrapper.find('[data-test="route-cooking-title"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Костровое снаряжение')
    expect(wrapper.get('[data-test="route-cooking-add-axe"]').text()).toBe('Добавить топор')
  })

  it('костёр просит топор, пилу, розжиг и таган, а подсказка — только «Запланирован костёр.»', async () => {
    const wrapper = await mounted(trip())
    await wrapper.get('[data-test="route-night-kind"]').setValue('tent')
    await wrapper.get('[data-test="route-night-cooking"]').setValue('fire')
    await flushPromises()

    expect(wrapper.get('[data-test="route-fire-hint"]').text()).toBe('Запланирован костёр.')
    expect(wrapper.find('[data-test="route-stove-hint"]').exists()).toBe(false)

    const buttons = wrapper.findAll('[data-test^="route-cooking-add-"]').map((node) => node.text())
    expect(buttons).toEqual([
      'Добавить топор',
      'Добавить пилу',
      'Добавить розжиг',
      'Добавить таган',
    ])
  })

  it('запланирована горелка — газовые кнопки, а не костровые', async () => {
    const wrapper = await mounted(trip())
    await wrapper.get('[data-test="route-night-kind"]').setValue('tent')
    await wrapper.get('[data-test="route-night-cooking"]').setValue('stove')
    await flushPromises()

    expect(
      wrapper.findAll('[data-test^="route-cooking-add-"]').map((node) => node.text()),
    ).toEqual(['Добавить горелку', 'Добавить газовый баллон'])
  })

  it('«Костровое» — красная секция, подсказки отделены от вещей чертой', async () => {
    const wrapper = await mounted(trip())
    await wrapper.get('[data-test="route-night-kind"]').setValue('tent')
    await wrapper.get('[data-test="route-night-cooking"]').setValue('fire')

    const section = wrapper.get('[data-test="route-cooking-section"]')
    expect(section.classes()).toContain('bg-red-100')
    expect(section.classes()).not.toContain('bg-amber-100')
    expect(section.get('summary').classes()).toContain('text-red-900')

    expect(wrapper.find('[data-test="route-cooking-hints"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="route-cooking-divider"]').exists()).toBe(true)
  })

  it('горелка считает только горелочные ночи: одна из двух — две готовки', async () => {
    const wrapper = await mounted(trip(TWO_NIGHTS))

    await at(nightKinds(wrapper), 0).setValue('car')
    await wrapper.get('[data-test="route-night-cooking"]').setValue('stove')

    // Вторая ночь пустая — это «идём всю ночь», газа в ней нет.
    expect(wrapper.get('[data-test="route-stove-hint"]').text()).toBe(
      'Запланированы 2 готовки на горелках',
    )
    expect(wrapper.find('[data-test="route-fire-hint"]').exists()).toBe(false)
  })

  it('две ночи с горелкой — четыре готовки', async () => {
    const wrapper = await mounted(trip(TWO_NIGHTS))

    for (const select of nightKinds(wrapper)) await select.setValue('car')
    for (const select of wrapper.findAll('[data-test="route-night-cooking"]')) {
      await select.setValue('stove')
    }

    expect(wrapper.findAll('[data-test="route-night-cooking"]')).toHaveLength(2)
    expect(wrapper.get('[data-test="route-stove-hint"]').text()).toBe(
      'Запланированы 4 готовки на горелках',
    )
  })

  it('«Костёр+Горелка» показывает обе подсказки и тоже считается горелочной ночью', async () => {
    const wrapper = await mounted(trip(TWO_NIGHTS))

    await at(nightKinds(wrapper), 0).setValue('tent')
    await wrapper.get('[data-test="route-night-cooking"]').setValue('both')

    expect(wrapper.find('[data-test="route-fire-hint"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="route-stove-hint"]').text()).toBe(
      'Запланированы 2 готовки на горелках',
    )
  })

  it('одна ночь с горелкой — «2 готовки», шесть — «12 готовок»', async () => {
    const oneNight = await mounted(
      trip({
        startsAt: '2026-10-29T00:00:00.000Z',
        endsAt: '2026-10-30T00:00:00.000Z',
      }),
    )

    await at(nightKinds(oneNight), 0).setValue('tent')
    await oneNight.get('[data-test="route-night-cooking"]').setValue('stove')
    expect(oneNight.get('[data-test="route-stove-hint"]').text()).toBe(
      'Запланированы 2 готовки на горелках',
    )

    // Шесть ночей, но газ нужен только в первой: по-прежнему две готовки.
    const sixNights = await mounted(
      trip({
        startsAt: '2026-10-29T00:00:00.000Z',
        endsAt: '2026-11-04T00:00:00.000Z',
      }),
    )

    await at(nightKinds(sixNights), 0).setValue('tent')
    await sixNights.get('[data-test="route-night-cooking"]').setValue('stove')
    expect(sixNights.get('[data-test="route-stove-hint"]').text()).toBe(
      'Запланированы 2 готовки на горелках',
    )

    // Газ во всех шести ночах — двенадцать готовок и склонение «готовок».
    for (const select of nightKinds(sixNights)) await select.setValue('tent')
    for (const select of sixNights.findAll('[data-test="route-night-cooking"]')) {
      await select.setValue('stove')
    }
    expect(sixNights.get('[data-test="route-stove-hint"]').text()).toBe(
      'Запланированы 12 готовок на горелках',
    )
  })

  it('место ночёвки — поле с подписью в строке заголовка', async () => {
    const wrapper = await mounted(trip(TWO_NIGHTS))
    const kinds = nightKinds(wrapper)

    await at(kinds, 0).setValue('tent')
    await at(kinds, 1).setValue('car')

    const heads = wrapper.findAll('[data-test="route-night-head"]')
    expect(heads).toHaveLength(2)

    for (const head of heads) {
      expect(head.find('[data-test="route-night-title"]').exists()).toBe(true)
      expect(head.find('[data-test="route-night-place"]').exists()).toBe(true)
    }

    expect(at(heads, 0).text()).toContain('Место')

    await at(heads, 0).get('[data-test="route-night-place"]').setValue('Слюдянка')

    const places = wrapper.findAll('[data-test="route-night-place"]')
    expect((at(places, 0).element as HTMLInputElement).value).toBe('Слюдянка')
    // Место одной ночи не переезжает в другую.
    expect((at(places, 1).element as HTMLInputElement).value).toBe('')
  })

  it('«в пути» и «идём всю ночь» место не спрашивают, остальные — спрашивают', async () => {
    const wrapper = await mounted(trip())
    const kind = wrapper.get('[data-test="route-night-kind"]')

    for (const value of ['allnight', 'transit', '']) {
      await kind.setValue(value)
      expect(wrapper.find('[data-test="route-night-place"]').exists()).toBe(false)
    }

    for (const value of ['tent', 'hut', 'hotel', 'car']) {
      await kind.setValue(value)
      expect(wrapper.find('[data-test="route-night-place"]').exists()).toBe(true)
    }
  })

  it('место сбрасывается, когда вариант перестал его спрашивать', async () => {
    const wrapper = await mounted(trip())
    const kind = wrapper.get('[data-test="route-night-kind"]')

    await kind.setValue('tent')
    await wrapper.get('[data-test="route-night-place"]').setValue('Слюдянка')

    await kind.setValue('transit')
    await kind.setValue('tent')

    expect((wrapper.get('[data-test="route-night-place"]').element as HTMLInputElement).value).toBe(
      '',
    )
  })
})

describe('один вариант на ночь', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    mocks.listParticipants.mockResolvedValue([])
    mocks.listTripGear.mockResolvedValue(gearList([]))
    mocks.saveRouteNights.mockImplementation((_: string, nights: RouteNightInput[]) =>
      Promise.resolve(echoNights(nights)),
    )
  })

  it('у ночи ровно один селект варианта и нет «Ещё вариант»', async () => {
    const wrapper = await mounted(trip(TWO_NIGHTS))

    expect(nightKinds(wrapper)).toHaveLength(2)
    expect(wrapper.find('[data-test="route-night-add-option"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="route-night-option-remove"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="route-night-option"]')).toHaveLength(2)
  })

  it('в ночи нет выбора палатки и машины — это не её дело', async () => {
    const wrapper = await mounted(trip())
    const kind = wrapper.get('[data-test="route-night-kind"]')

    for (const value of ['tent', 'car', 'hut', 'hotel']) {
      await kind.setValue(value)
      expect(wrapper.find('[data-test="route-night-tent"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="route-night-car"]').exists()).toBe(false)
    }
  })
})

describe('сохранение на лету', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    mocks.listParticipants.mockResolvedValue([])
    mocks.listTripGear.mockResolvedValue(gearList([]))
    mocks.saveRouteNights.mockImplementation((_: string, nights: RouteNightInput[]) =>
      Promise.resolve(echoNights(nights)),
    )
  })

  it('кнопок «Сохранить», «Отменить» и подписи о несохранённом нет', async () => {
    const wrapper = await mounted(trip(TWO_NIGHTS))

    expect(wrapper.find('[data-test="route-nights-save"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="route-nights-revert"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="route-nights-dirty"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="route-nights-saved"]').exists()).toBe(false)
  })

  it('смена варианта сразу уходит таблицей целиком', async () => {
    const wrapper = await mounted(trip(TWO_NIGHTS))

    await at(nightKinds(wrapper), 0).setValue('tent')
    await settle()

    expect(mocks.saveRouteNights).toHaveBeenCalledWith('1', [
      { position: 1, date: '2026-10-29', place: null, kind: 'tent', cooking: null },
      { position: 2, date: '2026-10-30', place: null, kind: null, cooking: null },
    ])
  })

  it('готовка и место уходят тем же запросом, без кнопки', async () => {
    const wrapper = await mounted(trip(TWO_NIGHTS))

    await at(nightKinds(wrapper), 0).setValue('hut')
    await settle()
    mocks.saveRouteNights.mockClear()

    await wrapper.get('[data-test="route-night-cooking"]').setValue('both')
    await settle()
    expect(mocks.saveRouteNights).toHaveBeenLastCalledWith('1', [
      { position: 1, date: '2026-10-29', place: null, kind: 'hut', cooking: 'both' },
      { position: 2, date: '2026-10-30', place: null, kind: null, cooking: null },
    ])

    mocks.saveRouteNights.mockClear()
    await wrapper.get('[data-test="route-night-place"]').setValue('Слюдянка')
    await settle(550)

    expect(mocks.saveRouteNights).toHaveBeenLastCalledWith('1', [
      { position: 1, date: '2026-10-29', place: 'Слюдянка', kind: 'hut', cooking: 'both' },
      { position: 2, date: '2026-10-30', place: null, kind: null, cooking: null },
    ])
  })

  it('пока идёт сохранение, «Сохраняем…» видно', async () => {
    let resolveSave: ((value: TripRoute) => void) | undefined
    mocks.saveRouteNights.mockImplementation(
      () =>
        new Promise<TripRoute>((resolve) => {
          resolveSave = resolve
        }),
    )

    const wrapper = await mounted(trip(TWO_NIGHTS))
    await at(nightKinds(wrapper), 0).setValue('tent')
    await settle()

    expect(wrapper.get('[data-test="route-nights-saving"]').text()).toBe('Сохраняем…')

    resolveSave?.(emptyRoute())
    await flushPromises()

    expect(wrapper.find('[data-test="route-nights-saving"]').exists()).toBe(false)
  })

  it('ошибку сервера видно текстом, а выбор не теряется', async () => {
    mocks.saveRouteNights.mockRejectedValue(
      new ApiError(400, 'Место — только у ночи с ночлегом'),
    )

    const wrapper = await mounted(trip())
    await wrapper.get('[data-test="route-night-kind"]').setValue('tent')
    await settle()

    expect(wrapper.get('[data-test="route-nights-error"]').text()).toContain(
      'Место — только у ночи с ночлегом',
    )
    expect(
      (wrapper.get('[data-test="route-night-kind"]').element as HTMLSelectElement).value,
    ).toBe('tent')
  })

  it('без права на вкладку поля заблокированы, сохранения нет', async () => {
    const wrapper = await mounted(trip(), emptyRoute({ canEdit: false }))

    expect(wrapper.get('[data-test="route-night-kind"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-test="route-nights-readonly"]').text()).toContain(
      'кто ведёт вкладку',
    )

    await wrapper.get('[data-test="route-night-kind"]').setValue('tent')
    await settle()
    expect(mocks.saveRouteNights).not.toHaveBeenCalled()
  })

  it('ночи берутся из ответа сервера: номера, даты, вариант и место его', async () => {
    const wrapper = await mounted(
      trip(TWO_NIGHTS),
      emptyRoute({
        nights: [
          routeNight({
            id: '7',
            position: 1,
            date: '2026-11-05',
            place: 'Слюдянка',
            kind: 'hut',
            cooking: 'fire',
          }),
          routeNight({ id: '8', position: 2, date: '2026-11-06', kind: 'hotel' }),
        ],
      }),
    )

    expect(titles(wrapper)).toEqual(['Ночь 1 · 5 ноября', 'Ночь 2 · 6 ноября'])

    const places = wrapper.findAll('[data-test="route-night-place"]')
    expect(places).toHaveLength(2)
    expect((at(places, 0).element as HTMLInputElement).value).toBe('Слюдянка')
    // У гостиницы место есть, но у этой ночи его не записали.
    expect((at(places, 1).element as HTMLInputElement).value).toBe('')

    expect((at(nightKinds(wrapper), 0).element as HTMLSelectElement).value).toBe('hut')
    expect(
      (wrapper.get('[data-test="route-night-cooking"]').element as HTMLSelectElement).value,
    ).toBe('fire')
  })

  it('снаряжение не загрузилось — ночи на месте, а палатки объяснены', async () => {
    mocks.listTripGear.mockRejectedValue(new ApiError(500, 'Снаряжение недоступно'))

    const wrapper = await mounted(trip(TWO_NIGHTS))

    expect(titles(wrapper)).toHaveLength(2)
    expect(wrapper.get('[data-test="route-nights-gear-error"]').text()).toContain(
      'не загрузилось',
    )
  })

  it('вкладка не загрузилась — сообщение вместо пустой сетки', async () => {
    mocks.fetchTripRoute.mockRejectedValue(
      new ApiError(403, 'Ночёвки похода доступны только его участникам'),
    )

    const wrapper = mount(TripRouteNights, { props: { trip: trip() } })
    await flushPromises()

    expect(wrapper.get('[data-test="route-nights-load-error"]').text()).toContain(
      'только его участникам',
    )
    expect(wrapper.find('[data-test="route-night"]').exists()).toBe(false)
  })
})
