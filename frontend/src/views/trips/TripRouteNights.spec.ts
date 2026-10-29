import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import type { Trip } from '@/types/trips'
import TripRouteNights from '@/views/trips/TripRouteNights.vue'

/**
 * Плашки ночёвок (29.10.2026, шаг 2) — макет без данных.
 *
 * Тест держит три вещи, которые заказчик продиктовал словами и которые
 * дешевле проверить здесь, чем снимком: словарь вариантов и его порядок
 * («палатка / гостиница / изба / машина / идём всю ночь»), «идём всю ночь —
 * больше ничего не делается» и «готовка есть у всех, кроме гостиницы».
 *
 * Ночи считаются из дат похода, поэтому 29–31 октября — это две ночи:
 * 29-го и 30-го. Строка даты — та же `shortDate`, что в календаре:
 * «29 октября».
 */
function trip(dates: Partial<Pick<Trip, 'startsAt' | 'endsAt'>> = {}): Trip {
  return { id: '1', ...dates } as Trip
}

function titles(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('[data-test="route-night-title"]').map((node) => node.text())
}

describe('плашки ночёвок', () => {
  enableAutoUnmount(afterEach)

  it('у похода 29–31 октября две ночи, первая — «Ночь 1. 29 октября»', () => {
    const wrapper = mount(TripRouteNights, {
      props: {
        trip: trip({
          startsAt: '2026-10-29T00:00:00.000Z',
          endsAt: '2026-10-31T00:00:00.000Z',
        }),
      },
    })

    expect(titles(wrapper)).toEqual(['Ночь 1. 29 октября', 'Ночь 2. 30 октября'])
    // Дат хватает — подписи «для примера» быть не должно.
    expect(wrapper.find('[data-test="route-nights-note"]').exists()).toBe(false)
  })

  it('без дат показывает три ночи и честно подписывает их примером', () => {
    const wrapper = mount(TripRouteNights, { props: { trip: trip() } })

    expect(titles(wrapper)).toHaveLength(3)
    expect(wrapper.get('[data-test="route-nights-note"]').text()).toContain('для примера')
  })

  it('варианты идут в порядке заказчика: палатка, гостиница, изба, машина, всю ночь', () => {
    const wrapper = mount(TripRouteNights, { props: { trip: trip() } })

    const options = wrapper
      .get('[data-test="route-night-kind"]')
      .findAll('option')
      .map((option) => option.text())

    expect(options).toEqual([
      'Не выбрано',
      'Палатка',
      'Гостиница',
      'Изба',
      'Машина',
      'Идём всю ночь',
    ])
  })

  it('«идём всю ночь» — больше ничего не спрашивает', async () => {
    const wrapper = mount(TripRouteNights, { props: { trip: trip() } })

    await wrapper.get('[data-test="route-night-kind"]').setValue('allnight')

    expect(wrapper.find('[data-test="route-night-cooking"]').exists()).toBe(false)
  })

  it('«гостиница» — тоже ничего, готовку не спрашивает', async () => {
    const wrapper = mount(TripRouteNights, { props: { trip: trip() } })

    await wrapper.get('[data-test="route-night-kind"]').setValue('hotel')

    expect(wrapper.find('[data-test="route-night-cooking"]').exists()).toBe(false)
  })

  it('палатка, изба и машина спрашивают готовку: костёр или горелка', async () => {
    const wrapper = mount(TripRouteNights, { props: { trip: trip() } })

    for (const kind of ['tent', 'hut', 'car']) {
      await wrapper.get('[data-test="route-night-kind"]').setValue(kind)

      const cooking = wrapper.findAll('[data-test="route-night-cooking"] option')
      expect(cooking.map((option) => option.text())).toEqual([
        'Не выбрано',
        'Костёр',
        'Горелка',
      ])
    }
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
})
