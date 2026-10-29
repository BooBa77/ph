import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Trip } from '@/types/trips'
import TripRouteNights from '@/views/trips/TripRouteNights.vue'

/**
 * Секции «Палатки» и «Костровое» подгружают свои данные, как только
 * открылись: палатки — участников и снаряжение похода, костровое — то же
 * самое. Здесь важна раскладка ночёвок, поэтому запросы заглушены: пустой
 * состав и пустое снаряжение — тоже законные состояния («пока никто не взял
 * палатку», «пока никто не взял костровое снаряжение»).
 */
const mocks = vi.hoisted(() => ({
  listParticipants: vi.fn(),
  listTripGear: vi.fn(),
  listGear: vi.fn(),
  proposeTripGear: vi.fn(),
}))

vi.mock('@/api/trips', () => ({ listParticipants: mocks.listParticipants }))

vi.mock('@/api/gear', () => ({
  listGear: mocks.listGear,
  listTripGear: mocks.listTripGear,
  proposeTripGear: mocks.proposeTripGear,
}))

/**
 * Плашки ночёвок (29.10.2026, шаг 2) — макет без данных.
 *
 * Тест держит то, что заказчик продиктовал словами и что дешевле проверить
 * здесь, чем снимком: словарь вариантов и его порядок («палатка / гостиница /
 * изба / машина / идём всю ночь / в пути»), «идём всю ночь» и «в пути» —
 * ничего дальше, «пустое считается как „идём всю ночь“», готовка есть у всех,
 * кроме гостиницы и дороги, и две секции, которые открываются выбором.
 *
 * Ночи считаются из дат похода, поэтому 29–31 октября — это две ночи:
 * 29-го и 30-го. Заголовок — как «День 1 · 23 октября» в «Питании»:
 * номер обычным текстом, дата серым после разделителя. Справа в той же
 * строке — поле «Место»: район ночёвки словами (29.10.2026).
 *
 * Готовки на горелках считаются только по «горелочным» ночам × 2 (уточнение
 * заказчика 29.10.2026): поход, где газ нужен в одной ночи из шести, — это
 * две готовки, а не двенадцать.
 */
function trip(dates: Partial<Pick<Trip, 'startsAt' | 'endsAt'>> = {}): Trip {
  return { id: '1', ...dates } as Trip
}

/** Две ночи: 29 и 30 октября. */
const TWO_NIGHTS = {
  startsAt: '2026-10-29T00:00:00.000Z',
  endsAt: '2026-10-31T00:00:00.000Z',
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

describe('плашки ночёвок', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    mocks.listParticipants.mockResolvedValue([])
    mocks.listTripGear.mockResolvedValue({
      items: [],
      totalWeightGrams: 0,
      itemsWithoutWeight: 0,
    })
  })

  it('у похода 29–31 октября две ночи, заголовок как в «Питании»', () => {
    const wrapper = mount(TripRouteNights, {
      props: {
        trip: trip({
          startsAt: '2026-10-29T00:00:00.000Z',
          endsAt: '2026-10-31T00:00:00.000Z',
        }),
      },
    })

    expect(titles(wrapper)).toEqual(['Ночь 1 · 29 октября', 'Ночь 2 · 30 октября'])
    // Дат хватает — подписи «для примера» быть не должно.
    expect(wrapper.find('[data-test="route-nights-note"]').exists()).toBe(false)
  })

  it('без дат показывает три ночи и честно подписывает их примером', () => {
    const wrapper = mount(TripRouteNights, { props: { trip: trip() } })

    expect(titles(wrapper)).toHaveLength(3)
    expect(wrapper.get('[data-test="route-nights-note"]').text()).toContain('для примера')
  })

  it('плашки живут в сворачиваемой секции «Ночёвки»', () => {
    const wrapper = mount(TripRouteNights, { props: { trip: trip() } })
    const section = wrapper.get('[data-test="route-nights-section"]')

    expect(section.element.tagName).toBe('DETAILS')
    expect(section.attributes('open')).toBeDefined()
    expect(section.get('summary').text()).toBe('Ночёвки')
  })

  it('варианты идут в порядке заказчика, «в пути» — в конце', () => {
    const wrapper = mount(TripRouteNights, { props: { trip: trip() } })

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
    const wrapper = mount(TripRouteNights, { props: { trip: trip() } })
    const kind = wrapper.get('[data-test="route-night-kind"]')

    for (const value of ['allnight', 'transit', 'hotel']) {
      await kind.setValue(value)
      expect(wrapper.find('[data-test="route-night-cooking"]').exists()).toBe(false)
    }
  })

  it('палатка, изба и машина спрашивают готовку: костёр, горелка, два сразу', async () => {
    const wrapper = mount(TripRouteNights, { props: { trip: trip() } })
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
    const wrapper = mount(TripRouteNights, { props: { trip: trip() } })
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
    const wrapper = mount(TripRouteNights, { props: { trip: trip() } })
    const kind = wrapper.get('[data-test="route-night-kind"]')

    await kind.setValue('tent')
    await wrapper.get('[data-test="route-night-cooking"]').setValue('fire')

    await kind.setValue('hotel')
    await kind.setValue('tent')

    const cooking = wrapper.get('[data-test="route-night-cooking"]').element as HTMLSelectElement
    expect(cooking.value).toBe('')
  })

  it('«Палатки» и «Костровое» скрыты, пока в ночёвках ничего не выбрано', () => {
    const wrapper = mount(TripRouteNights, { props: { trip: trip() } })

    expect(wrapper.find('[data-test="route-tents-section"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="route-cooking-section"]').exists()).toBe(false)
  })

  it('«Палатка» открывает зелёные «Палатки», готовка — жёлтое «Костровое»', async () => {
    const wrapper = mount(TripRouteNights, { props: { trip: trip() } })
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
    const wrapper = mount(TripRouteNights, { props: { trip: trip() } })
    const kind = wrapper.get('[data-test="route-night-kind"]')

    await kind.setValue('hut')
    await wrapper.get('[data-test="route-night-cooking"]').setValue('fire')

    expect(wrapper.find('[data-test="route-tents-section"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="route-cooking-section"]').exists()).toBe(true)
  })

  it('«Палатки» подписаны словами заказчика, а в «Костровом» лишнего текста нет', async () => {
    const wrapper = mount(TripRouteNights, {
      props: {
        trip: trip({
          startsAt: '2026-10-29T00:00:00.000Z',
          endsAt: '2026-10-31T00:00:00.000Z',
        }),
      },
    })

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

  it('костёр просит топор, пилу и розжиг', async () => {
    const wrapper = mount(TripRouteNights, { props: { trip: trip() } })
    await wrapper.get('[data-test="route-night-kind"]').setValue('tent')
    await wrapper.get('[data-test="route-night-cooking"]').setValue('fire')

    expect(wrapper.get('[data-test="route-fire-hint"]').text()).toBe(
      'Запланирован костёр. Топор, пила, розжиг',
    )
    expect(wrapper.find('[data-test="route-stove-hint"]').exists()).toBe(false)
  })

  it('горелка считает только горелочные ночи: одна из двух — две готовки', async () => {
    const wrapper = mount(TripRouteNights, { props: { trip: trip(TWO_NIGHTS) } })

    await at(nightKinds(wrapper), 0).setValue('car')
    await wrapper.get('[data-test="route-night-cooking"]').setValue('stove')

    // Вторая ночь пустая — это «идём всю ночь», газа в ней нет.
    expect(wrapper.get('[data-test="route-stove-hint"]').text()).toBe(
      'Запланированы 2 готовки на горелках',
    )
    expect(wrapper.find('[data-test="route-fire-hint"]').exists()).toBe(false)
  })

  it('две ночи с горелкой — четыре готовки', async () => {
    const wrapper = mount(TripRouteNights, { props: { trip: trip(TWO_NIGHTS) } })

    await chooseAll(wrapper, 'car', 'stove')

    expect(wrapper.findAll('[data-test="route-night-cooking"]')).toHaveLength(2)
    expect(wrapper.get('[data-test="route-stove-hint"]').text()).toBe(
      'Запланированы 4 готовки на горелках',
    )
  })

  it('«Костёр+Горелка» показывает обе подсказки и тоже считается горелочной ночью', async () => {
    const wrapper = mount(TripRouteNights, { props: { trip: trip(TWO_NIGHTS) } })

    await at(nightKinds(wrapper), 0).setValue('tent')
    await wrapper.get('[data-test="route-night-cooking"]').setValue('both')

    expect(wrapper.find('[data-test="route-fire-hint"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="route-stove-hint"]').text()).toBe(
      'Запланированы 2 готовки на горелках',
    )
  })

  it('одна ночь с горелкой — «2 готовки», шесть — «12 готовок»', async () => {
    const oneNight = mount(TripRouteNights, {
      props: {
        trip: trip({
          startsAt: '2026-10-29T00:00:00.000Z',
          endsAt: '2026-10-30T00:00:00.000Z',
        }),
      },
    })

    await chooseAll(oneNight, 'tent', 'stove')
    expect(oneNight.get('[data-test="route-stove-hint"]').text()).toBe(
      'Запланированы 2 готовки на горелках',
    )

    // Шесть ночей, но сперва газ нужен только в первой: по-прежнему две
    // готовки — счёт идёт по ночам с горелкой, а не по длине похода.
    const sixNights = mount(TripRouteNights, {
      props: {
        trip: trip({
          startsAt: '2026-10-29T00:00:00.000Z',
          endsAt: '2026-11-04T00:00:00.000Z',
        }),
      },
    })

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
    const wrapper = mount(TripRouteNights, { props: { trip: trip(TWO_NIGHTS) } })
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
})
