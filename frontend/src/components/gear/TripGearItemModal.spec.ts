import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import TripGearItemModal from '@/components/gear/TripGearItemModal.vue'
import type { TripGearItem } from '@/types/gear'

/**
 * Карточка вещи (06.11.2026).
 *
 * Здесь проверяется ровно то, что просил заказчик в этой сессии: в «Ночёвках»
 * у пилюли снаряжения **не нужно информации, кто несёт**, а у личной вещи
 * «Взял» нет статуса и несущего — её не решают «берём / не берём»,
 * а просто убирают крестиком. Остальное поведение карточки проверяется
 * через `TripGear.spec.ts`, чтобы не заводить вторую копию сценариев.
 */
function makeItem(overrides: Partial<TripGearItem> = {}): TripGearItem {
  return {
    id: 'g1',
    gearItemId: 'cat-1',
    typeId: 1,
    typeCode: 'tent',
    typeName: 'Палатка',
    title: 'Палатка на четверых',
    attributes: [],
    weightGrams: 2600,
    note: null,
    isTripOnly: false,
    status: 'approved',
    routeSection: null,
    sharedSectionId: null,
    personalSectionId: null,
    ownerUserId: 'me',
    assignedUserId: 'anna',
    createdAt: '2026-11-06T10:00:00.000Z',
    ...overrides,
  }
}

function mounted(props: Record<string, unknown> = {}) {
  return mount(TripGearItemModal, {
    props: {
      item: makeItem(),
      scope: 'shared',
      ownerName: 'Олег',
      assigneeName: 'Анна',
      assigneeChoices: [{ userId: 'anna', label: 'Анна' }],
      ...props,
    },
  })
}

describe('карточка вещи снаряжения', () => {
  enableAutoUnmount(afterEach)

  it('в «Ночёвках» не показывает, кто несёт — ни строкой, ни полем', () => {
    const wrapper = mounted({ hideAssignee: true, canAssign: true })

    expect(wrapper.find('[data-test="gear-item-assignee"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="gear-item-assignee-words"]').exists()).toBe(false)
  })

  it('без «Ночёвок» несущий остаётся полем, как в «Берём»', () => {
    const wrapper = mounted({ canAssign: true })

    expect(wrapper.find('[data-test="gear-item-assignee"]').exists()).toBe(true)
  })

  it('у личной вещи нет статуса и несущего, но есть раздел', () => {
    const wrapper = mounted({
      scope: 'personal',
      hideStatus: true,
      hideAssignee: true,
      canPlace: true,
      sectionChoices: [{ id: '12', label: 'Одежда' }],
      item: makeItem({ personalSectionId: '12' }),
    })

    expect(wrapper.find('[data-test="gear-item-status-field"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="gear-item-status-words"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="gear-item-assignee-words"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="gear-item-section"]').exists()).toBe(true)
  })

  // ───────────────────────── архив похода (11.11.2026) ─────────────────────────

  it('у удалённой вещи называет, у кого она есть', () => {
    const wrapper = mounted({
      item: makeItem({
        itemDeleted: true,
        itemHolders: [{ userId: 'ivan', name: 'Иван' }],
      }),
    })

    const text = wrapper.get('[data-test="gear-item-archive"]').text()

    expect(text).toContain('Вещь удалена из каталога владельца')
    expect(text).toContain('Она есть у Иван')
  })

  it('удалена у всех — говорит «снаряжение недоступно»', () => {
    const wrapper = mounted({
      item: makeItem({ itemDeleted: true, itemHolders: [] }),
    })

    expect(wrapper.get('[data-test="gear-item-archive"]').text()).toBe(
      'Вещь удалена из каталогов — снаряжение недоступно.',
    )
  })

  it('у живой вещи блока про удаление нет', () => {
    const wrapper = mounted()

    expect(wrapper.find('[data-test="gear-item-archive"]').exists()).toBe(false)
  })
})
