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
 * Тест держит то, что заказчик продиктовал словами и что дешевле проверить
 * здесь, чем снимком:
 *
 * - **кнопки по плану ночёвок** (разбор 29.10.2026): топор, пила, розжиг
 *   и таган видны при запланированном костре, горелка и баллон — при горелке;
 * - **цвет кнопки — состояние секции**: цветная, пока вещи этого типа нет,
 *   белая, когда она уже предложена;
 * - **пилюля «{тип} - {вес}гр ({хозяин})»** — «Горелка - 130 гр. (Анна)»,
 *   как продиктовал заказчик, и с крестиком;
 * - **крестик по правам**: владелец убирает вещь из секции, организатор
 *   только предлагает убрать (зачёркнутая пилюля), остальным крестика нет.
 *
 * Настоящего типа вещи в модели нет, поэтому «костровое» — это виды
 * «кухня» и «техника», а тип уже предложенной вещи узнаётся по словам
 * в названии; когда появится описание снаряжения, узнавание переедет на него
 * (см. `gear.md` §8).
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
    isAdmin: false,
  }
}

function makeTrip(organizerUserId = ME): Trip {
  return {
    id: '1',
    organizerUserId,
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

/** Секция живёт под планом ночёвок: по умолчанию в плане и костёр, и горелка. */
async function mounted(
  plan: { fire?: boolean; stove?: boolean } = {},
  trip: Trip = makeTrip(),
): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(TripRouteCooking, {
    props: { trip, fire: plan.fire ?? true, stove: plan.stove ?? true },
  })
  await flushPromises()

  return wrapper
}

function addButtonTexts(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('[data-test^="route-cooking-add-"]').map((node) => node.text())
}

/** Текст пилюли без крестика: он живёт в том же элементе, но отдельной кнопкой. */
function pillTexts(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll('[data-test="route-cooking-item"]')
    .map((node) => node.get('span').text())
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

  it('оба плана — шесть кнопок в порядке заказчика: топор, пила, розжиг, таган, горелка, баллон', async () => {
    const wrapper = await mounted()

    expect(addButtonTexts(wrapper)).toEqual([
      'Добавить топор',
      'Добавить пилу',
      'Добавить розжиг',
      'Добавить таган',
      'Добавить горелку',
      'Добавить газовый баллон',
    ])
  })

  it('запланирован только костёр — только костровые кнопки', async () => {
    const wrapper = await mounted({ fire: true, stove: false })

    expect(addButtonTexts(wrapper)).toEqual([
      'Добавить топор',
      'Добавить пилу',
      'Добавить розжиг',
      'Добавить таган',
    ])
  })

  it('запланирована только горелка — только газовые кнопки', async () => {
    const wrapper = await mounted({ fire: false, stove: true })

    expect(addButtonTexts(wrapper)).toEqual(['Добавить горелку', 'Добавить газовый баллон'])
  })

  it('пусто: подсказка «Пока никто не взял костровое снаряжение»', async () => {
    const wrapper = await mounted()

    expect(wrapper.get('[data-test="route-cooking-empty"]').text()).toBe(
      'Пока никто не взял костровое снаряжение.',
    )
    expect(wrapper.find('[data-test="route-cooking-items"]').exists()).toBe(false)
  })

  it('предложенное — пилюлей «тип - вес (хозяин)»', async () => {
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

    expect(pillTexts(wrapper)).toEqual(['Горелка - 130 гр. (Анна)'])
    expect(wrapper.find('[data-test="route-cooking-empty"]').exists()).toBe(false)
  })

  it('пилюли идут по порядку кнопок, а не по порядку из снаряжения', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({ id: 'g1', kind: 'kitchen', title: 'Горелка BRS-3000', ownerUserId: ANNA }),
        tripGearItem({ id: 'g2', kind: 'technical', title: 'Топор Fiskars X7', ownerUserId: ME }),
        tripGearItem({ id: 'g3', kind: 'other', title: 'Розжиг гелевый', ownerUserId: ANNA }),
      ]),
    )

    const wrapper = await mounted()

    // Розжиг лежит в «прочем»: по одному виду он бы из секции исчез, но тип
    // узнаётся по названию, поэтому пилюля на месте и стоит второй.
    expect(pillTexts(wrapper)).toEqual(['Топор (Олег)', 'Розжиг (Анна)', 'Горелка (Анна)'])
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

  it('кнопка цветная, пока вещи этого типа нет, и белая, когда она есть', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({ id: 'g1', kind: 'technical', title: 'Топор Fiskars X7', ownerUserId: ME }),
      ]),
    )

    const wrapper = await mounted()

    expect(wrapper.get('[data-test="route-cooking-add-axe"]').classes()).toContain('bg-field')
    expect(wrapper.get('[data-test="route-cooking-add-saw"]').classes()).toContain('bg-red-600')
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

  it('предложение уходит на сервер, вещь появляется пилюлей и кнопка белеет', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([
        gearItem({ id: '40', kind: 'technical', title: 'Топор Fiskars X7', weightGrams: 900 }),
      ]),
    )
    mocks.proposeTripGear.mockResolvedValue(
      tripGearItem({
        id: 'g40',
        gearItemId: '40',
        kind: 'technical',
        title: 'Топор Fiksars, как в каталоге',
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
    expect(pillTexts(wrapper)).toEqual(['Топор - 900 гр. (Олег)'])
    expect(wrapper.get('[data-test="route-cooking-add-axe"]').classes()).toContain('bg-field')
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

  it('владелец убирает свою вещь крестиком сразу', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({ id: 'g1', kind: 'technical', title: 'Топор Fiskars X7', ownerUserId: ME }),
      ]),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-remove-g1"]').trigger('click')

    expect(wrapper.find('[data-test="route-cooking-items"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="route-cooking-empty"]').text()).toContain('Пока никто не взял')
  })

  it('организатор чужую вещь только предлагает убрать: пилюля зачёркнута', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({
          id: 'g1',
          kind: 'kitchen',
          title: 'Горелка Анны',
          ownerUserId: ANNA,
          weightGrams: 150,
        }),
      ]),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-remove-g1"]').trigger('click')

    // Вещь на месте, но зачёркнута и в пунктирной рамке — «предложено убрать».
    expect(pillTexts(wrapper)).toEqual(['Горелка - 150 гр. (Анна)'])
    expect(wrapper.get('[data-test="route-cooking-item"]').classes()).toContain('border-dashed')
    expect(wrapper.find('[data-test="route-cooking-item"] .line-through').exists()).toBe(true)

    // Повторное нажатие снимает предложение.
    await wrapper.get('[data-test="route-cooking-remove-g1"]').trigger('click')

    expect(wrapper.get('[data-test="route-cooking-item"]').classes()).toContain('bg-amber-100')
    expect(wrapper.find('[data-test="route-cooking-item"] .line-through').exists()).toBe(false)
  })

  it('крестика нет ни у владельца чужой вещи, ни у постороннего участника', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({ id: 'g1', kind: 'kitchen', title: 'Горелка Анны', ownerUserId: ANNA }),
      ]),
    )

    // Олег не организатор, а вещь Анны.
    const wrapper = await mounted({}, makeTrip(ANNA))

    expect(wrapper.find('[data-test="route-cooking-remove-g1"]').exists()).toBe(false)
  })

  it('снаряжение не загрузилось — сообщение, а не пустая секция', async () => {
    mocks.listTripGear.mockRejectedValue(new ApiError(500, 'Снаряжение недоступно'))

    const wrapper = mount(TripRouteCooking, {
      props: { trip: makeTrip(), fire: true, stove: true },
    })
    await flushPromises()

    expect(wrapper.get('[data-test="route-cooking-error"]').text()).toBe('Снаряжение недоступно')
    expect(wrapper.find('[data-test="route-cooking-buttons"]').exists()).toBe(false)
  })
})
