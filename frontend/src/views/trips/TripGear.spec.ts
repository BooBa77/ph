import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import TripGear from '@/views/trips/TripGear.vue'
import type { GearItem, TripGearItem } from '@/types/gear'
import type { Trip, TripParticipant } from '@/types/trips'
import type { User } from '@/api/types'

/**
 * Вкладка «Снаряжение» похода — первый проход по фронту (05.11.2026).
 *
 * Проверяем то, что заказчик увидит первым: две большие секции, «Берём»
 * с решением «берём / не берём», «Распределение» по «иду» и личные
 * «Взял» / «Мой рюкзак». Права на статус — из пропа `canEdit`, как и на
 * остальных вкладках: их считает сервер.
 *
 * «Список» этого шага не рисуется: логику чек-листов заказчик ещё не
 * описал (`docs/ph/gear-tab.md` §2), и придумывать её в тестах нечего.
 */
const mocks = vi.hoisted(() => ({
  listTripGear: vi.fn(),
  listParticipants: vi.fn(),
  listGear: vi.fn(),
  proposeTripGear: vi.fn(),
  removeTripGear: vi.fn(),
  updateTripGear: vi.fn(),
  addManualTripGear: vi.fn(),
  createGearItem: vi.fn(),
  fetchGearTypes: vi.fn(),
}))

vi.mock('@/api/gear', () => ({
  listGear: mocks.listGear,
  listTripGear: mocks.listTripGear,
  proposeTripGear: mocks.proposeTripGear,
  removeTripGear: mocks.removeTripGear,
  updateTripGear: mocks.updateTripGear,
  addManualTripGear: mocks.addManualTripGear,
  createGearItem: mocks.createGearItem,
}))

vi.mock('@/api/trips', () => ({ listParticipants: mocks.listParticipants }))
vi.mock('@/api/gearTypes', () => ({ fetchGearTypes: mocks.fetchGearTypes }))

const ME = 'demo-me'
const ANNA = 'demo-anna'
const PETYA = 'demo-petya'

function makeUser(): User {
  return {
    id: ME,
    displayName: 'Олег',
    location: null,
    avatarUrl: null,
    gender: 'm',
    isVegetarian: false,
    allergies: null,
    sportExperience: null,
    isAdmin: false,
  }
}

function makeTrip(): Trip {
  return {
    id: '1',
    organizerUserId: ME,
    goalObjectId: '10',
    goalObject: { id: '10', name: 'Витязь', type: 'скальник', url: null },
    announcement: null,
    routeText: '',
    requirementsText: null,
    hasGuitar: false,
    visibility: 'public',
    isRecruitmentClosed: false,
    activityTypeIds: [],
    status: 'decided',
    startsAt: '2026-10-29T00:00:00.000Z',
    endsAt: '2026-10-31T00:00:00.000Z',
    dateVariants: [],
    actualStartedAt: null,
    actualFinishedAt: null,
    isCommercial: false,
    isOfficial: false,
    priceRub: null,
    priceNote: null,
    cancelledAt: null,
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
  }
}

function participant(
  userId: string,
  displayName: string,
  status: TripParticipant['status'] = 'going',
  isOrganizer = false,
): TripParticipant {
  return {
    userId,
    displayName,
    avatarUrl: null,
    status,
    roles: [],
    isOrganizer,
    isVirtual: false,
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
  }
}

function tripGearItem(
  overrides: Partial<TripGearItem> &
    Pick<TripGearItem, 'id' | 'typeCode' | 'typeName' | 'title' | 'ownerUserId'>,
): TripGearItem {
  return {
    gearItemId: overrides.id,
    typeId: 1,
    attributes: [],
    weightGrams: null,
    note: null,
    isTripOnly: false,
    status: 'approved',
    routeSection: null,
    assignedUserId: null,
    createdAt: '2026-10-29T10:00:00.000Z',
    ...overrides,
  }
}

function gearItem(
  overrides: Partial<GearItem> & Pick<GearItem, 'id' | 'typeCode' | 'typeName' | 'title'>,
): GearItem {
  return {
    typeId: 1,
    groupId: 4,
    groupCode: 'other',
    groupName: 'Прочее',
    sortOrder: 10,
    attributes: [],
    weightGrams: null,
    note: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  }
}

function tripGearList(items: TripGearItem[]): {
  items: TripGearItem[]
  totalWeightGrams: number
  itemsWithoutWeight: number
} {
  return { items, totalWeightGrams: 0, itemsWithoutWeight: 0 }
}

/**
 * Набор похода: палатка моя (несу я), топор не распределён, котёл ждёт
 * решения, лодку уже отклонили, спальник едет Анне. Этого хватает на все
 * ветки: статусы, плитки, «Взял» и итог веса.
 */
function defaultItems(): TripGearItem[] {
  return [
    tripGearItem({
      id: 'g1',
      typeCode: 'tent',
      typeName: 'Палатка',
      title: 'Палатка',
      ownerUserId: ANNA,
      assignedUserId: ME,
      weightGrams: 2600,
      status: 'approved',
    }),
    tripGearItem({
      id: 'g2',
      typeCode: 'axe',
      typeName: 'Топор',
      title: 'Топор',
      ownerUserId: ME,
      assignedUserId: null,
      weightGrams: 900,
      status: 'approved',
    }),
    tripGearItem({
      id: 'g3',
      typeCode: 'kettle',
      typeName: 'Котёл',
      title: 'Котёл',
      ownerUserId: ANNA,
      assignedUserId: ANNA,
      weightGrams: 1200,
      status: 'proposed',
    }),
    tripGearItem({
      id: 'g4',
      typeCode: 'other',
      typeName: 'Прочее',
      title: 'Лодка',
      ownerUserId: ME,
      assignedUserId: null,
      weightGrams: null,
      status: 'declined',
    }),
    tripGearItem({
      id: 'g5',
      typeCode: 'sleeping_bag',
      typeName: 'Спальник',
      title: 'Спальник',
      ownerUserId: ANNA,
      assignedUserId: ANNA,
      weightGrams: 800,
      status: 'approved',
    }),
  ]
}

async function mounted(canEdit = false): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(TripGear, {
    props: { trip: makeTrip(), canEdit },
  })
  await flushPromises()

  return wrapper
}

function textOf(wrapper: ReturnType<typeof mount>, selector: string): string {
  return wrapper.get(selector).text()
}

describe('вкладка «Снаряжение» похода', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    useAuthStore().setAuth(makeUser(), 'token')

    mocks.listTripGear.mockResolvedValue(tripGearList(defaultItems()))
    mocks.listParticipants.mockResolvedValue([
      participant(ME, 'Олег', 'going', true),
      participant(ANNA, 'Анна'),
      participant(PETYA, 'Петя', 'maybe'),
    ])
    mocks.listGear.mockResolvedValue({ items: [], totalWeightGrams: 0, itemsWithoutWeight: 0 })
    mocks.removeTripGear.mockResolvedValue(undefined)
    mocks.updateTripGear.mockImplementation(
      async (_tripId: string, gearId: string, body: Record<string, unknown>) => {
        const row = defaultItems().find((item) => item.id === gearId)

        return { ...(row as TripGearItem), ...body }
      },
    )
  })

  it('две большие секции и вложенные подписи на месте', async () => {
    const wrapper = await mounted()

    expect(textOf(wrapper, '[data-test="gear-public-section"] summary')).toContain(
      'Общественное снаряжение',
    )
    expect(textOf(wrapper, '[data-test="gear-personal-section"] summary')).toContain(
      'Личное снаряжение',
    )

    expect(wrapper.find('[data-test="gear-taking"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-distribution"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-taken"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-backpack"]').exists()).toBe(true)
  })

  it('«Берём»: утверждённое и предложенное, без прав — подпись «ждёт решения»', async () => {
    const wrapper = await mounted()

    const pills = wrapper.findAll('[data-test^="gear-taking-item-"]')
    expect(pills.map((pill) => pill.text())).toHaveLength(4)
    expect(wrapper.find('[data-test="gear-taking-item-g1"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-taking-item-g3"]').exists()).toBe(true)

    expect(wrapper.find('[data-test="gear-taking-pending-g3"]').text()).toContain(
      'ждёт решения',
    )
    // Без права вкладки статус не поменять: списка выбора нет вовсе.
    expect(wrapper.find('[data-test="gear-taking-status-g3"]').exists()).toBe(false)
  })

  it('«Берём»: ведущий меняет статус, и вещь переезжает в утверждённые', async () => {
    const wrapper = await mounted(true)

    const status = wrapper.get('[data-test="gear-taking-status-g3"]')
    await status.setValue('approved')
    await flushPromises()

    expect(mocks.updateTripGear).toHaveBeenCalledWith('1', 'g3', { status: 'approved' })
    expect(wrapper.find('[data-test="gear-taking-pending-g3"]').exists()).toBe(false)
    expect(
      (wrapper.get('[data-test="gear-taking-status-g3"]').element as HTMLSelectElement).value,
    ).toBe('approved')
  })

  it('отклонённое уходит в «Не берём» и возвращается решением ведущего', async () => {
    const wrapper = await mounted(true)

    expect(wrapper.find('[data-test="gear-declined"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-declined-item-g4"]').text()).toContain('Лодка')

    await wrapper.get('[data-test="gear-declined-restore-g4"]').trigger('click')
    await flushPromises()

    expect(mocks.updateTripGear).toHaveBeenCalledWith('1', 'g4', { status: 'proposed' })
    expect(wrapper.find('[data-test="gear-declined"]').exists()).toBe(false)
  })

  it('«Распределение» строит плитки только по идущим и считает вес', async () => {
    const wrapper = await mounted()

    expect(wrapper.find(`[data-test="gear-bag-${ME}"]`).exists()).toBe(true)
    expect(wrapper.find(`[data-test="gear-bag-${ANNA}"]`).exists()).toBe(true)
    // «Пока не решил» ещё не несёт груз.
    expect(wrapper.find(`[data-test="gear-bag-${PETYA}"]`).exists()).toBe(false)

    expect(textOf(wrapper, `[data-test="gear-bag-${ME}"]`)).toContain('Всего: 2,6 кг')
    expect(textOf(wrapper, `[data-test="gear-bag-${ANNA}"]`)).toContain('Всего: 800 г')

    expect(wrapper.find('[data-test="gear-unassigned"]').text()).toContain('Не распределено · 1')
    expect(wrapper.find('[data-test="gear-unassigned-item-g2"]').exists()).toBe(true)
  })

  it('вещь переносится между рюкзаками выпадающим списком', async () => {
    const wrapper = await mounted()

    await wrapper.get('[data-test="gear-assign-g5"]').setValue(ME)
    await flushPromises()

    expect(mocks.updateTripGear).toHaveBeenCalledWith('1', 'g5', { assignedUserId: ME })
    expect(wrapper.find(`[data-test="gear-bag-${ME}"]`).text()).toContain('Спальник')
  })

  it('вещь переносится перетаскиванием на плитку', async () => {
    const wrapper = await mounted()

    await wrapper.get('[data-test="gear-bag-item-g5"]').trigger('dragstart')
    await wrapper.get(`[data-test="gear-bag-${ME}"]`).trigger('drop')
    await flushPromises()

    expect(mocks.updateTripGear).toHaveBeenCalledWith('1', 'g5', { assignedUserId: ME })
  })

  it('«Взял» и «Мой рюкзак» — только мои вещи и их итог', async () => {
    const wrapper = await mounted()

    expect(wrapper.find('[data-test="gear-taken-item-g1"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-taken-item-g2"]').exists()).toBe(false)

    expect(wrapper.find('[data-test="gear-backpack-item-g1"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-backpack-item-g2"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="gear-backpack-total"]').text()).toBe('Всего: 2,6 кг')
  })

  it('«Добавить снаряжение» открывает общий каталог и предлагает вещь', async () => {
    const catalog = [
      gearItem({ id: 'cat-1', typeCode: 'other', typeName: 'Прочее', title: 'Грелка' }),
    ]
    mocks.listGear.mockResolvedValue({ items: catalog, totalWeightGrams: 0, itemsWithoutWeight: 0 })
    mocks.proposeTripGear.mockResolvedValue(
      tripGearItem({
        id: 'g6',
        gearItemId: 'cat-1',
        typeCode: 'other',
        typeName: 'Прочее',
        title: 'Грелка',
        ownerUserId: ME,
        assignedUserId: ME,
        weightGrams: 150,
        status: 'proposed',
      }),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="gear-add"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="route-extra-picker"]').exists()).toBe(true)

    await wrapper.get('[data-test="route-extra-search"]').setValue('Грелка')
    await flushPromises()
    await wrapper.get('[data-test="route-extra-item-cat-1"]').trigger('click')
    await flushPromises()

    expect(mocks.proposeTripGear).toHaveBeenCalledWith('1', 'cat-1')
    expect(wrapper.find('[data-test="route-extra-picker"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="gear-taking-item-g6"]').exists()).toBe(true)
  })

  it('«Добавить вручную» открывает общую форму поверх выбора', async () => {
    mocks.fetchGearTypes.mockResolvedValue([])

    const wrapper = await mounted()

    await wrapper.get('[data-test="gear-add"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="route-extra-manual"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="manual-gear-dialog"]').exists()).toBe(true)
  })

  it('своя вещь убирается из похода, чужая — только с правом вкладки', async () => {
    const wrapper = await mounted()

    // Топор мой — крестик есть и без права вкладки.
    expect(wrapper.find('[data-test="gear-taking-remove-g2"]').exists()).toBe(true)
    // Палатка Анны — без права вкладки крестика нет.
    expect(wrapper.find('[data-test="gear-taking-remove-g1"]').exists()).toBe(false)

    await wrapper.get('[data-test="gear-taking-remove-g2"]').trigger('click')
    await flushPromises()

    expect(mocks.removeTripGear).toHaveBeenCalledWith('1', 'g2')
    expect(wrapper.find('[data-test="gear-taking-item-g2"]').exists()).toBe(false)
  })

  it('ошибку правки показывает словами сервера', async () => {
    mocks.updateTripGear.mockRejectedValue(
      new ApiError(403, '«Берём / не берём» решает тот, кто ведёт снаряжение похода'),
    )

    const wrapper = await mounted(true)

    await wrapper.get('[data-test="gear-taking-status-g3"]').setValue('declined')
    await flushPromises()

    expect(wrapper.find('[data-test="gear-action-error"]').text()).toContain(
      'решает тот, кто ведёт снаряжение',
    )
  })

  it('пустое снаряжение приглашает добавить, а не показывает пустые списки', async () => {
    mocks.listTripGear.mockResolvedValue(tripGearList([]))

    const wrapper = await mounted()

    expect(wrapper.find('[data-test="gear-taking-empty"]').text()).toContain(
      'Пока ничего не собрано',
    )
    expect(wrapper.find('[data-test="gear-distribution-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-taken-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-backpack-empty"]').exists()).toBe(true)
  })
})
