import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { User } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import type { GearItem, TripGearItem } from '@/types/gear'
import type { Trip, TripParticipant } from '@/types/trips'
import TripRouteCooking from '@/views/trips/TripRouteCooking.vue'

/**
 * Секция «Костровое» (29.10.2026) — снаряжение для готовки.
 *
 * Заказчик продиктовал ровно две вещи: **кнопки** «Добавить топор / пилу /
 * розжиг / таган / горелку / газовый баллон» и то, что **по ним участники
 * предлагают своё снаряжение соответствующего типа**. Тест держит это:
 * шесть кнопок в его порядке, выбор из личного каталога нужного вида,
 * предложение через существующую ручку и пилюли «хозяин · название · вес».
 *
 * Настоящего типа вещи в модели нет, поэтому «костровое» — это виды
 * «кухня» и «техника»; когда появится описание снаряжения, фильтр переедет
 * на него (см. `gear.md` §8).
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

const ME = 'demo-me'
const ANNA = 'demo-anna'

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

function participant(userId: string, displayName: string): TripParticipant {
  return {
    userId,
    displayName,
    avatarUrl: null,
    status: 'going',
    roles: [],
    isOrganizer: false,
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
  }
}

function tripGearItem(
  overrides: Partial<TripGearItem> & Pick<TripGearItem, 'id' | 'kind' | 'title' | 'ownerUserId'>,
): TripGearItem {
  return {
    gearItemId: overrides.id,
    weightGrams: null,
    note: null,
    status: 'approved',
    assignedUserId: null,
    createdAt: '2026-10-29T10:00:00.000Z',
    ...overrides,
  }
}

function gearItem(
  overrides: Partial<GearItem> & Pick<GearItem, 'id' | 'kind' | 'title'>,
): GearItem {
  return {
    weightGrams: null,
    note: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  }
}

function gearList(items: GearItem[]): {
  items: GearItem[]
  totalWeightGrams: number
  itemsWithoutWeight: number
} {
  return { items, totalWeightGrams: 0, itemsWithoutWeight: 0 }
}

function tripGearList(items: TripGearItem[]): {
  items: TripGearItem[]
  totalWeightGrams: number
  itemsWithoutWeight: number
} {
  return { items, totalWeightGrams: 0, itemsWithoutWeight: 0 }
}

async function mounted(): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(TripRouteCooking, { props: { trip: makeTrip() } })
  await flushPromises()

  return wrapper
}

describe('секция «Костровое»', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    useAuthStore().setAuth(makeUser(), 'token')

    mocks.listParticipants.mockResolvedValue([participant(ME, 'Олег'), participant(ANNA, 'Анна')])
    mocks.listTripGear.mockResolvedValue(tripGearList([]))
    mocks.listGear.mockResolvedValue(gearList([]))
  })

  it('шесть кнопок в порядке заказчика: топор, пила, розжиг, таган, горелка, баллон', async () => {
    const wrapper = await mounted()

    expect(
      wrapper.findAll('[data-test^="route-cooking-add-"]').map((node) => node.text()),
    ).toEqual([
      'Добавить топор',
      'Добавить пилу',
      'Добавить розжиг',
      'Добавить таган',
      'Добавить горелку',
      'Добавить газовый баллон',
    ])
  })

  it('пусто: подсказка «Пока никто не взял костровое снаряжение»', async () => {
    const wrapper = await mounted()

    expect(wrapper.get('[data-test="route-cooking-empty"]').text()).toBe(
      'Пока никто не взял костровое снаряжение.',
    )
    expect(wrapper.find('[data-test="route-cooking-items"]').exists()).toBe(false)
  })

  it('предложенное — пилюлей «хозяин · название · вес»', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({
          id: 'g1',
          gearItemId: '11',
          kind: 'kitchen',
          title: 'Горелка BRS-3000',
          ownerUserId: ANNA,
          weightGrams: 130,
        }),
      ]),
    )

    const wrapper = await mounted()

    expect(wrapper.get('[data-test="route-cooking-item"]').text()).toBe(
      'Анна · Горелка BRS-3000 · 130 гр.',
    )
    expect(wrapper.find('[data-test="route-cooking-empty"]').exists()).toBe(false)
  })

  it('палатки и спальники в костровое не попадают, «не берём» — тоже', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({ id: 'g1', kind: 'tent', title: 'Палатка', ownerUserId: ME }),
        tripGearItem({ id: 'g2', kind: 'sleeping', title: 'Спальник', ownerUserId: ME }),
        tripGearItem({
          id: 'g3',
          kind: 'kitchen',
          title: 'Горелка, которую не берём',
          ownerUserId: ME,
          status: 'declined',
        }),
      ]),
    )

    const wrapper = await mounted()

    expect(wrapper.find('[data-test="route-cooking-items"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="route-cooking-empty"]').exists()).toBe(true)
  })

  it('«Добавить топор» предлагает только технику из моего каталога', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([
        gearItem({ id: '40', kind: 'technical', title: 'Топор Fiskars X7' }),
        gearItem({ id: '41', kind: 'kitchen', title: 'Горелка BRS-3000' }),
        gearItem({ id: '42', kind: 'tent', title: 'Палатка' }),
      ]),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-add-axe"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="route-cooking-dialog"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="route-cooking-dialog"] h3').text()).toBe('Топор')
    expect(
      wrapper.get('[data-test="route-cooking-gear"]').findAll('option').map((node) => node.text()),
    ).toEqual(['выберите…', 'Топор Fiskars X7'])
  })

  it('вес в списке выбора виден: «Пила · 240 гр.»', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([gearItem({ id: '50', kind: 'technical', title: 'Пила', weightGrams: 240 })]),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-add-saw"]').trigger('click')
    await flushPromises()

    expect(
      wrapper.get('[data-test="route-cooking-gear"]').findAll('option').map((node) => node.text()),
    ).toEqual(['выберите…', 'Пила · 240 гр.'])
  })

  it('предложение уходит на сервер и вещь появляется в секции', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([gearItem({ id: '40', kind: 'technical', title: 'Топор Fiskars X7', weightGrams: 900 })]),
    )
    mocks.proposeTripGear.mockResolvedValue(
      tripGearItem({
        id: 'g40',
        gearItemId: '40',
        kind: 'technical',
        title: 'Топор Fiskars X7',
        ownerUserId: ME,
        weightGrams: 900,
      }),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-add-axe"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-test="route-cooking-gear"]').setValue('40')
    await wrapper.get('[data-test="route-cooking-save"]').trigger('click')
    await flushPromises()

    expect(mocks.proposeTripGear).toHaveBeenCalledWith('1', '40')
    expect(wrapper.find('[data-test="route-cooking-dialog"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="route-cooking-item"]').text()).toBe(
      'Олег · Топор Fiskars X7 · 900 гр.',
    )
  })

  it('уже предложенную вещь второй раз не предлагают', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([
        gearItem({ id: '40', kind: 'technical', title: 'Топор, который уже в походе' }),
        gearItem({ id: '41', kind: 'technical', title: 'Пила' }),
      ]),
    )
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({ id: 'g40', gearItemId: '40', kind: 'technical', title: 'Топор', ownerUserId: ME }),
      ]),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-add-axe"]').trigger('click')
    await flushPromises()

    expect(
      wrapper.get('[data-test="route-cooking-gear"]').findAll('option').map((node) => node.text()),
    ).toEqual(['выберите…', 'Пила'])
  })

  it('нет подходящей вещи — подсказка, а не пустой список', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([gearItem({ id: '41', kind: 'kitchen', title: 'Горелка BRS-3000' })]),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-add-axe"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="route-cooking-no-gear"]').text()).toContain(
      'Подходящей вещи в личном снаряжении нет',
    )
  })

  it('ошибка предложения видна в модалке', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([gearItem({ id: '40', kind: 'technical', title: 'Топор' })]),
    )
    mocks.proposeTripGear.mockRejectedValue(new ApiError(400, 'Эта вещь уже в походе'))

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-add-axe"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-test="route-cooking-gear"]').setValue('40')
    await wrapper.get('[data-test="route-cooking-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="route-cooking-dialog"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="route-cooking-error-dialog"]').text()).toBe(
      'Эта вещь уже в походе',
    )
  })

  it('снаряжение не загрузилось — сообщение, а не пустая секция', async () => {
    mocks.listTripGear.mockRejectedValue(new ApiError(500, 'Снаряжение недоступно'))

    const wrapper = mount(TripRouteCooking, { props: { trip: makeTrip() } })
    await flushPromises()

    expect(wrapper.get('[data-test="route-cooking-error"]').text()).toBe('Снаряжение недоступно')
    expect(wrapper.find('[data-test="route-cooking-buttons"]').exists()).toBe(false)
  })
})
