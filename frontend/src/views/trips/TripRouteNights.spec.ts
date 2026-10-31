import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { TripGearItem } from '@/types/gear'
import type {
  RouteNight,
  RouteNightInput,
  RouteOption,
  Trip,
  TripRoute,
  TripTransferLeg,
} from '@/types/trips'
import TripRouteNights from '@/views/trips/TripRouteNights.vue'

/**
 * Таблица ночёвок — на ручках бэкенда (31.10.2026).
 *
 * Спека держит то, что заказчик продиктовал словами и что дешевле проверить
 * здесь, чем снимком: словарь вариантов и его порядок («палатка / гостиница /
 * изба / машина / идём всю ночь / в пути»), «идём всю ночь» и «в пути» —
 * ничего дальше, «пустое считается как „идём всю ночь“», готовка есть у всех,
 * кроме гостиницы и дороги, место — только у ночи с ночлегом, и две секции,
 * которые открываются выбором.
 *
 * **Что изменилось с переводом на API.** Данные приходят из `GET /route`,
 * правка уходит таблицей целиком (`PUT /route/nights`). Поэтому:
 *
 * - ночи без дат похода рисуются по датам (три «для примера», как раньше),
 *   но **записанные ночи берутся из ответа сервера** — с его номерами,
 *   датами и местом;
 * - сохранение — отдельное действие: у сетки есть промежуточные
 *   недопустимые состояния («Палатка» без выбранной палатки), и сервер
 *   отбивает их 400-м;
 * - права — из `canEdit` ответа, а не из локального счёта;
 * - «Палатка» и «Машина» — ссылки: списки палаток и своего ТС экран
 *   загружает сам (`GET /trips/:id/gear` и `GET /trips/:id/transfer`).
 *
 * Секции «Палатки» и «Костровое» подгружают своё: палатки — состав похода,
 * костровое — снаряжение похода. Здесь важна раскладка ночёвок, поэтому
 * запросы заглушены: пустой состав и пустое снаряжение — тоже законные
 * состояния.
 */
const mocks = vi.hoisted(() => ({
  fetchTripRoute: vi.fn(),
  fetchTripTransfer: vi.fn(),
  saveRouteNights: vi.fn(),
  lodgeRoute: vi.fn(),
  acceptRouteLodger: vi.fn(),
  releaseRouteLodger: vi.fn(),
  listParticipants: vi.fn(),
  listTripGear: vi.fn(),
  listGear: vi.fn(),
  proposeTripGear: vi.fn(),
  removeTripGear: vi.fn(),
}))

vi.mock('@/api/trips', () => ({
  fetchTripRoute: mocks.fetchTripRoute,
  fetchTripTransfer: mocks.fetchTripTransfer,
  saveRouteNights: mocks.saveRouteNights,
  lodgeRoute: mocks.lodgeRoute,
  acceptRouteLodger: mocks.acceptRouteLodger,
  releaseRouteLodger: mocks.releaseRouteLodger,
  listParticipants: mocks.listParticipants,
}))

vi.mock('@/api/gear', () => ({
  listGear: mocks.listGear,
  listTripGear: mocks.listTripGear,
  proposeTripGear: mocks.proposeTripGear,
  removeTripGear: mocks.removeTripGear,
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
  return { canEdit: true, nights: [], lodgers: [], travelers: [], ...overrides }
}

function routeOption(overrides: Partial<RouteOption> = {}): RouteOption {
  return {
    id: '1',
    kind: 'tent',
    tentGearId: null,
    tentTitle: null,
    carLegId: null,
    carTitle: null,
    cooking: null,
    ...overrides,
  }
}

function routeNight(overrides: Partial<RouteNight> = {}): RouteNight {
  return { id: '1', position: 1, date: null, place: null, options: [], ...overrides }
}

/** Палатка в снаряжении похода: вариант «Палатка» ссылается на неё. */
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

/** Карточка перемещения: своё ТС — машина, автобус — нет. */
function transferLeg(overrides: Partial<TripTransferLeg> = {}): TripTransferLeg {
  return {
    id: 'l1',
    direction: 'there',
    position: 1,
    isStage: false,
    mode: 'car',
    departsAt: '2026-10-29T08:00:00.000Z',
    fromPlace: 'Иркутск',
    toPlace: 'Ольхон',
    isOwnVehicle: true,
    ownerUserId: ME,
    ownerName: 'Олег',
    seats: 4,
    vehicleId: null,
    vehicleTitle: null,
    vehiclePlate: null,
    sourceLegId: null,
    occupied: 0,
    compensation: 'free',
    compensationAmountRub: null,
    isRoundTrip: false,
    note: null,
    canEdit: true,
    joinStatus: null,
    passengers: [],
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

function transferList(legs: TripTransferLeg[]): {
  canEdit: boolean
  travelers: { userId: string; displayName: string }[]
  legs: TripTransferLeg[]
} {
  return { canEdit: true, travelers: [], legs }
}

/** Текст заголовка без переносов шаблона: в разметке он разбит на две части. */
function titles(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll('[data-test="route-night-title"]')
    .map((node) => node.text().replace(/\s+/g, ' ').trim())
}

/** Селекты «Где ночуем» по порядку ночей (первая строка вариантов). */
function nightKinds(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('[data-test="route-night-kind"]')
}

/**
 * Элемент по индексу: `noUncheckedIndexedAccess` не разрешает брать массив
 * наугад, а `!` в тестах прячет опечатку до первого «нет такого элемента».
 */
function at<T>(items: T[], index: number): T {
  const item = items[index]

  if (item === undefined) throw new Error(`нет элемента с индексом ${index}`)

  return item
}

/**
 * Проставить вариант всем ночам и, если попросили, готовку каждой.
 *
 * Список селектов готовки короче списка ночей: он есть только у палатки,
 * избы и машины, поэтому индексы совпадают лишь когда готовку спрашивают
 * все ночи — так тесты и поступают.
 */
async function chooseAll(
  wrapper: ReturnType<typeof mount>,
  kind: string,
  cooking?: string,
): Promise<void> {
  for (const select of nightKinds(wrapper)) await select.setValue(kind)

  if (cooking === undefined) return

  for (const select of wrapper.findAll('[data-test="route-night-cooking"]')) {
    await select.setValue(cooking)
  }
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
 *
 * Без неё после `PUT` экран остался бы с черновиком и подписью
 * «несохранённые изменения», хотя таблица уже сохранена.
 */
function echoNights(nights: RouteNightInput[]): TripRoute {
  return emptyRoute({
    nights: nights.map((night, index) => ({
      id: String(index + 1),
      position: night.position,
      date: night.date ?? null,
      place: night.place ?? null,
      options: night.options.map((option, optionIndex) => ({
        id: `${index + 1}-${optionIndex + 1}`,
        kind: option.kind,
        tentGearId: option.tentGearId ?? null,
        tentTitle: option.tentGearId === null || option.tentGearId === undefined ? null : 'Палатка на четверых',
        carLegId: option.carLegId ?? null,
        carTitle: null,
        cooking: option.cooking ?? null,
      })),
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
    mocks.fetchTripTransfer.mockResolvedValue(transferList([]))
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

  it('«Палатки» и «Костровое» скрыты, пока в ночёвках ничего не выбрано', async () => {
    const wrapper = await mounted(trip())

    expect(wrapper.find('[data-test="route-tents-section"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="route-cooking-section"]').exists()).toBe(false)
  })

  it('«Палатка» открывает зелёные «Палатки», готовка — красное «Костровое»', async () => {
    const wrapper = await mounted(trip())
    const kind = wrapper.get('[data-test="route-night-kind"]')

    await kind.setValue('tent')
    expect(wrapper.find('[data-test="route-tents-section"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="route-cooking-section"]').exists()).toBe(false)

    await wrapper.get('[data-test="route-night-cooking"]').setValue('stove')
    expect(wrapper.find('[data-test="route-cooking-section"]').exists()).toBe(true)

    // Секции читаются сверху вниз: ночёвки, палатки, костровое.
    const sections = wrapper.findAll('details').map((node) => node.get('summary').text())
    expect(sections).toEqual(['Ночёвки', 'Палатки', 'Костровое'])
  })

  it('без палатки зелёной секции нет, даже если готовка выбрана', async () => {
    const wrapper = await mounted(trip())
    const kind = wrapper.get('[data-test="route-night-kind"]')

    await kind.setValue('hut')
    await wrapper.get('[data-test="route-night-cooking"]').setValue('fire')

    expect(wrapper.find('[data-test="route-tents-section"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="route-cooking-section"]').exists()).toBe(true)
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

    // «Костровое снаряжение» убрано 29.10.2026: секция и так не видна пустой,
    // а что она про костровое — видно из названия. Вместо текста — кнопки.
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

    // Разделитель — между подсказками и пилюлями: иначе «Запланирован костёр»
    // и «Горелка - 130 гр. (Анна)» слипаются в один текст.
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

    await chooseAll(wrapper, 'car', 'stove')

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

    await chooseAll(oneNight, 'tent', 'stove')
    expect(oneNight.get('[data-test="route-stove-hint"]').text()).toBe(
      'Запланированы 2 готовки на горелках',
    )

    // Шесть ночей, но сперва газ нужен только в первой: по-прежнему две
    // готовки — счёт идёт по ночам с горелкой, а не по длине похода.
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
    await chooseAll(sixNights, 'tent', 'stove')
    expect(sixNights.get('[data-test="route-stove-hint"]').text()).toBe(
      'Запланированы 12 готовок на горелках',
    )
  })

  it('место ночёвки — поле с подписью в строке заголовка', async () => {
    const wrapper = await mounted(trip(TWO_NIGHTS))
    const kinds = nightKinds(wrapper)

    // Место спрашивают все варианты с ночлегом — берём два разных.
    await at(kinds, 0).setValue('tent')
    await at(kinds, 1).setValue('car')

    const heads = wrapper.findAll('[data-test="route-night-head"]')
    expect(heads).toHaveLength(2)

    // У каждой ночи своя строка: заголовок и поле рядом, а не друг под другом.
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

    // Вернулись к палатке — района нет: его никто не подтверждал обратно.
    expect((wrapper.get('[data-test="route-night-place"]').element as HTMLInputElement).value).toBe(
      '',
    )
  })
})

describe('таблица на ручках бэкенда', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    mocks.listParticipants.mockResolvedValue([])
    mocks.listTripGear.mockResolvedValue(gearList([]))
    mocks.fetchTripTransfer.mockResolvedValue(transferList([]))
    mocks.saveRouteNights.mockImplementation((_: string, nights: RouteNightInput[]) =>
      Promise.resolve(echoNights(nights)),
    )
  })

  it('ночи берутся из ответа сервера: номера, даты и место его, а не дат похода', async () => {
    const wrapper = await mounted(
      trip(TWO_NIGHTS),
      emptyRoute({
        nights: [
          routeNight({
            id: '7',
            position: 1,
            date: '2026-11-05',
            place: 'Слюдянка',
            options: [routeOption({ kind: 'hut', cooking: 'fire' })],
          }),
          routeNight({
            id: '8',
            position: 2,
            date: '2026-11-06',
            place: null,
            options: [routeOption({ id: '2', kind: 'hotel' })],
          }),
        ],
      }),
    )

    // Даты — из таблицы (5 и 6 ноября), а не из дат похода (29–31 октября).
    expect(titles(wrapper)).toEqual(['Ночь 1 · 5 ноября', 'Ночь 2 · 6 ноября'])

    const places = wrapper.findAll('[data-test="route-night-place"]')
    expect((at(places, 0).element as HTMLInputElement).value).toBe('Слюдянка')
    expect((at(places, 1).element as HTMLInputElement).value).toBe('')

    // Изба спрашивает готовку — значение тоже пришло с сервера.
    expect((at(nightKinds(wrapper), 0).element as HTMLSelectElement).value).toBe('hut')
    expect(
      (wrapper.get('[data-test="route-night-cooking"]').element as HTMLSelectElement).value,
    ).toBe('fire')
  })

  it('сохранение уходит таблицей целиком, а не одной ночью', async () => {
    mocks.listTripGear.mockResolvedValue(gearList([tripGearItem()]))
    const wrapper = await mounted(
      trip({
        startsAt: '2026-10-29T00:00:00.000Z',
        endsAt: '2026-10-31T00:00:00.000Z',
      }),
    )

    // Пока ничего не меняли — сохранять нечего.
    expect(wrapper.get('[data-test="route-nights-save"]').attributes('disabled')).toBeDefined()

    await at(nightKinds(wrapper), 0).setValue('tent')
    await wrapper.get('[data-test="route-night-tent"]').setValue('g1')
    await wrapper.get('[data-test="route-night-place"]').setValue('Слюдянка')
    await wrapper.get('[data-test="route-night-cooking"]').setValue('fire')

    expect(wrapper.find('[data-test="route-nights-dirty"]').exists()).toBe(true)

    await wrapper.get('[data-test="route-nights-save"]').trigger('click')
    await flushPromises()

    // В запросе — обе ночи по номерам: вторая пустая остаётся пустой.
    expect(mocks.saveRouteNights).toHaveBeenCalledWith('1', [
      {
        position: 1,
        date: '2026-10-29',
        place: 'Слюдянка',
        options: [{ kind: 'tent', tentGearId: 'g1', cooking: 'fire' }],
      },
      { position: 2, date: '2026-10-30', place: null, options: [] },
    ])

    // Ответ сервера становится новым состоянием: черновик больше не «грязный».
    expect(wrapper.find('[data-test="route-nights-dirty"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="route-nights-saved"]').text()).toBe('Сохранено')
    expect(wrapper.get('[data-test="route-nights-save"]').attributes('disabled')).toBeDefined()
  })

  it('ошибку сервера видно текстом, а черновик не теряется', async () => {
    mocks.saveRouteNights.mockRejectedValue(
      new ApiError(400, 'У «Палатки» выберите палатку из снаряжения похода'),
    )

    const wrapper = await mounted(trip())
    await wrapper.get('[data-test="route-night-kind"]').setValue('tent')
    await wrapper.get('[data-test="route-nights-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="route-nights-error"]').text()).toContain(
      'выберите палатку из снаряжения похода',
    )

    // Выбор остался на месте: правка не пропала вместе с ошибкой.
    expect(
      (wrapper.get('[data-test="route-night-kind"]').element as HTMLSelectElement).value,
    ).toBe('tent')
    expect(wrapper.find('[data-test="route-nights-dirty"]').exists()).toBe(true)
  })

  it('без права на вкладку поля заблокированы, кнопки сохранения нет', async () => {
    const wrapper = await mounted(trip(), emptyRoute({ canEdit: false }))

    const kind = wrapper.get('[data-test="route-night-kind"]')
    expect(kind.attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="route-nights-save"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="route-nights-readonly"]').text()).toContain(
      'кто ведёт вкладку',
    )
  })

  it('«Палатка» предлагает вещи похода, «Машина» — только своё ТС', async () => {
    mocks.listTripGear.mockResolvedValue(
      gearList([
        tripGearItem(),
        tripGearItem({
          id: 'g2',
          typeCode: 'tent',
          title: 'Палатка, которую не берём',
          status: 'declined',
        }),
        tripGearItem({ id: 'g3', typeCode: 'shelter', typeName: 'Тент', title: 'Тент 3×4' }),
      ]),
    )
    mocks.fetchTripTransfer.mockResolvedValue(
      transferList([
        transferLeg(),
        transferLeg({
          id: 'l2',
          mode: 'bus',
          fromPlace: 'Иркутск',
          toPlace: 'Ольхон',
          isOwnVehicle: false,
        }),
      ]),
    )

    const wrapper = await mounted(trip())
    const kind = wrapper.get('[data-test="route-night-kind"]')

    await kind.setValue('tent')
    expect(
      wrapper.get('[data-test="route-night-tent"]').findAll('option').map((node) => node.text()),
    ).toEqual(['выберите…', 'Палатка на четверых'])

    await kind.setValue('car')
    // Автобус ночлегом не считается: в списке только своё ТС.
    expect(
      wrapper.get('[data-test="route-night-car"]').findAll('option').map((node) => node.text()),
    ).toEqual(['выберите…', 'Иркутск → Ольхон'])
  })

  it('«Ещё вариант» добавляет строку, а «идём всю ночь» вытесняет остальные', async () => {
    const wrapper = await mounted(trip(TWO_NIGHTS))
    // У ночи своя сетка вариантов: вторая ночь в счёте не участвует.
    const night = wrapper.get('[data-test="route-night"]')

    // У одной ночи одна пустая строка — крестика у неё нет.
    expect(night.findAll('[data-test="route-night-option"]')).toHaveLength(1)
    expect(night.find('[data-test="route-night-option-remove"]').exists()).toBe(false)

    // Вторая строка — «Гостиница»: ночь стала комбинированной.
    await night.get('[data-test="route-night-add-option"]').trigger('click')
    expect(night.findAll('[data-test="route-night-option"]')).toHaveLength(2)
    await at(night.findAll('[data-test="route-night-kind"]'), 1).setValue('hotel')
    expect(night.findAll('[data-test="route-night-kind"]')).toHaveLength(2)

    // «Идём всю ночь» не смешивается с другими вариантами: остаётся одна строка.
    await at(night.findAll('[data-test="route-night-kind"]'), 0).setValue('allnight')
    expect(night.findAll('[data-test="route-night-option"]')).toHaveLength(1)
    expect(
      (night.get('[data-test="route-night-kind"]').element as HTMLSelectElement).value,
    ).toBe('allnight')
  })

  it('крестик убирает вариант комбинированной ночи', async () => {
    const wrapper = await mounted(trip(TWO_NIGHTS))
    const night = wrapper.get('[data-test="route-night"]')

    await night.get('[data-test="route-night-add-option"]').trigger('click')
    await at(night.findAll('[data-test="route-night-kind"]'), 0).setValue('tent')
    await at(night.findAll('[data-test="route-night-kind"]'), 1).setValue('hotel')

    await at(night.findAll('[data-test="route-night-option-remove"]'), 1).trigger('click')

    expect(night.findAll('[data-test="route-night-kind"]')).toHaveLength(1)
    expect(
      (night.get('[data-test="route-night-kind"]').element as HTMLSelectElement).value,
    ).toBe('tent')
  })

  it('«Отменить» возвращает сохранённое состояние', async () => {
    const wrapper = await mounted(
      trip(TWO_NIGHTS),
      emptyRoute({
        nights: [routeNight({ id: '1', position: 1, date: '2026-10-29', options: [] })],
      }),
    )

    await wrapper.get('[data-test="route-night-kind"]').setValue('hotel')
    expect(wrapper.find('[data-test="route-nights-revert"]').exists()).toBe(true)

    await wrapper.get('[data-test="route-nights-revert"]').trigger('click')

    expect(
      (wrapper.get('[data-test="route-night-kind"]').element as HTMLSelectElement).value,
    ).toBe('')
    expect(wrapper.find('[data-test="route-nights-dirty"]').exists()).toBe(false)
  })

  it('снаряжение не загрузилось — ночи на месте, а список палаток объяснён', async () => {
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
