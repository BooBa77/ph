import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import type { Trip } from '@/types/trips'
import TripRouteNights from '@/views/trips/TripRouteNights.vue'

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
 * номер обычным текстом, дата серым после разделителя.
 */
function trip(dates: Partial<Pick<Trip, 'startsAt' | 'endsAt'>> = {}): Trip {
  return { id: '1', ...dates } as Trip
}

/** Текст заголовка без переносов шаблона: в разметке он разбит на две части. */
function titles(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll('[data-test="route-night-title"]')
    .map((node) => node.text().replace(/\s+/g, ' ').trim())
}

describe('плашки ночёвок', () => {
  enableAutoUnmount(afterEach)

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

  it('секции подписаны словами заказчика', async () => {
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

    expect(wrapper.get('[data-test="route-tents-title"]').text()).toBe(
      'Распределение участников по палаткам',
    )
    expect(wrapper.get('[data-test="route-cooking-title"]').text()).toBe(
      'Костровое снаряжение',
    )
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

  it('горелка считает готовки по ночам: две ночи — четыре готовки', async () => {
    const wrapper = mount(TripRouteNights, {
      props: {
        trip: trip({
          startsAt: '2026-10-29T00:00:00.000Z',
          endsAt: '2026-10-31T00:00:00.000Z',
        }),
      },
    })

    await wrapper.get('[data-test="route-night-kind"]').setValue('car')
    await wrapper.get('[data-test="route-night-cooking"]').setValue('stove')

    expect(wrapper.get('[data-test="route-stove-hint"]').text()).toBe(
      'Запланированы 4 готовки на горелках',
    )
    expect(wrapper.find('[data-test="route-fire-hint"]').exists()).toBe(false)
  })

  it('«Костёр+Горелка» показывает обе подсказки', async () => {
    const wrapper = mount(TripRouteNights, {
      props: {
        trip: trip({
          startsAt: '2026-10-29T00:00:00.000Z',
          endsAt: '2026-10-31T00:00:00.000Z',
        }),
      },
    })

    await wrapper.get('[data-test="route-night-kind"]').setValue('tent')
    await wrapper.get('[data-test="route-night-cooking"]').setValue('both')

    expect(wrapper.find('[data-test="route-fire-hint"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="route-stove-hint"]').text()).toBe(
      'Запланированы 4 готовки на горелках',
    )
  })

  it('одна ночь — «2 готовки», шесть ночей — «12 готовок»', async () => {
    const oneNight = mount(TripRouteNights, {
      props: {
        trip: trip({
          startsAt: '2026-10-29T00:00:00.000Z',
          endsAt: '2026-10-30T00:00:00.000Z',
        }),
      },
    })

    await oneNight.get('[data-test="route-night-kind"]').setValue('tent')
    await oneNight.get('[data-test="route-night-cooking"]').setValue('stove')
    expect(oneNight.get('[data-test="route-stove-hint"]').text()).toBe(
      'Запланированы 2 готовки на горелках',
    )

    const sixNights = mount(TripRouteNights, {
      props: {
        trip: trip({
          startsAt: '2026-10-29T00:00:00.000Z',
          endsAt: '2026-11-04T00:00:00.000Z',
        }),
      },
    })

    await sixNights.get('[data-test="route-night-kind"]').setValue('tent')
    await sixNights.get('[data-test="route-night-cooking"]').setValue('stove')
    expect(sixNights.get('[data-test="route-stove-hint"]').text()).toBe(
      'Запланированы 12 готовок на горелках',
    )
  })
})
