import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import TripGearExtraPicker from '@/components/gear/TripGearExtraPicker.vue'
import type { GearItem } from '@/types/gear'

/**
 * Выбор вещи для кнопки «Добавить ещё» (01.11.2026).
 *
 * Заказчик: «выбор из личного снаряжения… предлагать в фильтре выбора
 * сначала соответствующую группу, но вообще, может хоть лодку выбрать».
 * Спека держит три правила:
 *
 * - список — **весь** каталог, без фильтра по типам секции;
 * - полки секции идут первыми, остальные — после;
 * - вещь, которая уже в походе, не предлагается; поиск ищет по названию,
 *   типу и полке.
 */
function gearItem(
  overrides: Partial<GearItem> & Pick<GearItem, 'id' | 'title'>,
): GearItem {
  return {
    typeId: 1,
    typeCode: 'other',
    typeName: 'Прочее',
    groupId: 4,
    groupCode: 'other',
    groupName: 'Прочее',
    sortOrder: 0,
    weightGrams: null,
    note: null,
    attributes: [],
    createdAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  }
}

function groupsText(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll('[data-test^="route-extra-group-"]')
    .map((node) => node.get('span').text())
}

function itemsText(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll('[data-test^="route-extra-item-"]')
    .map((node) => node.text())
}

function mounted(props: Record<string, unknown> = {}): ReturnType<typeof mount> {
  return mount(TripGearExtraPicker, {
    props: {
      items: [
        gearItem({
          id: '1',
          title: 'Котёл 5 л',
          typeCode: 'kettle',
          typeName: 'Котёл',
          groupCode: 'kitchen',
          groupName: 'Кухня',
        }),
        gearItem({ id: '2', title: 'Лодка надувная' }),
      ],
      ...props,
    },
  })
}

describe('TripGearExtraPicker («Добавить ещё»)', () => {
  enableAutoUnmount(afterEach)

  it('полка секции идёт первой, остальные — после', () => {
    const wrapper = mounted({ preferredGroupCodes: ['kitchen'] })

    expect(groupsText(wrapper)).toEqual(['Кухня', 'Прочее'])
  })

  it('внутри полки первыми стоят типы секции', () => {
    const wrapper = mounted({
      items: [
        gearItem({ id: '1', title: 'Лодка', typeCode: 'other', typeName: 'Прочее' }),
        gearItem({
          id: '2',
          title: 'Котёл 5 л',
          typeCode: 'kettle',
          typeName: 'Котёл',
        }),
      ],
      preferredTypeCodes: ['kettle'],
    })

    expect(itemsText(wrapper)).toEqual(['Котёл 5 л · Котёл', 'Лодка · Прочее'])
  })

  it('вещь, которая уже в походе, не предлагается', () => {
    const wrapper = mounted({ excludeIds: ['1'] })

    expect(itemsText(wrapper)).toEqual(['Лодка надувная · Прочее'])
  })

  it('поиск ищет по названию, типу и полке', async () => {
    const wrapper = mounted()

    await wrapper.get('[data-test="route-extra-search"]').setValue('кухня')

    expect(itemsText(wrapper)).toEqual(['Котёл 5 л · Котёл'])

    await wrapper.get('[data-test="route-extra-search"]').setValue('ничего такого')

    expect(wrapper.find('[data-test="route-extra-not-found"]').exists()).toBe(true)
  })

  it('пустой каталог объясняется словами', () => {
    const wrapper = mounted({ items: [] })

    expect(wrapper.get('[data-test="route-extra-empty"]').text()).toContain('ничего не осталось')
  })

  it('выбор вещи, «вручную» и «Отмена» — события, компонент ничего не сохраняет', async () => {
    const wrapper = mounted()

    await wrapper.get('[data-test="route-extra-item-2"]').trigger('click')

    expect(wrapper.emitted('pick')?.[0]?.[0]).toMatchObject({ id: '2' })

    await wrapper.get('[data-test="route-extra-manual"]').trigger('click')
    expect(wrapper.emitted('manual')).toHaveLength(1)

    await wrapper.get('[data-test="route-extra-cancel"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('пока каталог едет — «Загружаем…», а не пустой список', () => {
    const wrapper = mounted({ loading: true })

    expect(wrapper.get('[data-test="route-extra-loading"]').text()).toContain('Загружаем')
    expect(wrapper.find('[data-test^="route-extra-group-"]').exists()).toBe(false)
  })
})
