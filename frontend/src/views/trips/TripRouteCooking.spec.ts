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
 * Секция «Готовка» — три группы снаряжения (01.11.2026).
 *
 * До шага это была секция «Костровое» с одним списком и шестью кнопками.
 * Заказчик переделал её целиком:
 *
 * > «Переименуй секцию „Костровое“ в „Готовка“… три группы снаряжения
 * > „Посуда“, „Костровое“ и „Горелки“, раздели их полосками и в каждой
 * > группе свои кнопки и свой список. В новой „Посуда“ — кнопки „Добавить
 * > котёл“, „Добавить половник“, „Добавить нож“».
 *
 * Тест держит то, что дешевле проверить здесь, чем снимком:
 *
 * - **три группы в порядке слов заказчика**, разделённые полосками, и у
 *   каждой свой заголовок, свой список и свой ряд кнопок;
 * - **кнопки по плану ночёвок**: костровые — при костре, горелки — при
 *   горелке, посуда — всегда (она нужна при любой готовке);
 * - **цвет кнопки — состояние группы**: цветная, пока вещи этого типа нет;
 * - **пилюля «{тип} - {вес} гр. ({хозяин})»** и крестик по правам;
 * - **«Добавить ещё»** — у каждой группы, всегда белая, открывает весь
 *   личный каталог (полки группы первыми) и помнит секцию вещи;
 * - **«Указать вручную»** — и из кнопки типа, и из «Добавить ещё»
 *   (там тип любой, а секция — группы).
 */
const mocks = vi.hoisted(() => ({
  listParticipants: vi.fn(),
  listTripGear: vi.fn(),
  listGear: vi.fn(),
  proposeTripGear: vi.fn(),
  removeTripGear: vi.fn(),
  updateTripGear: vi.fn(),
  addManualTripGear: vi.fn(),
  fetchGearTypes: vi.fn(),
  addPersonalTripGear: vi.fn(),
  removePersonalTripGear: vi.fn(),
}))

vi.mock('@/api/trips', () => ({ listParticipants: mocks.listParticipants }))

vi.mock('@/api/gear', () => ({
  listGear: mocks.listGear,
  listTripGear: mocks.listTripGear,
  proposeTripGear: mocks.proposeTripGear,
  removeTripGear: mocks.removeTripGear,
  updateTripGear: mocks.updateTripGear,
  addManualTripGear: mocks.addManualTripGear,
  addPersonalTripGear: mocks.addPersonalTripGear,
  removePersonalTripGear: mocks.removePersonalTripGear,
}))

vi.mock('@/api/gearTypes', () => ({ fetchGearTypes: mocks.fetchGearTypes }))

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
    paymentDetails: null,
    paymentBank: null,
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
    sharedSectionId: null,
    personalSectionId: null,
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
    props: {
      trip,
      fire: plan.fire ?? true,
      stove: plan.stove ?? true,
      // Право вкладки «Снаряжение»: без него карточка пилюли не даёт
      // менять статус — так же, как на живой вкладке.
      canEditGear: true,
    },
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

function groupTitles(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll('[data-test^="route-cooking-title-"]')
    .map((node) => node.text())
}

describe('секция «Готовка»', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    useAuthStore().setAuth(makeUser(), 'token')

    // «Добавить ещё» при первом открытии показывает группы свёрнутыми
    // (05.11.2026). Здесь проверяется выбор вещи, а не сворачивание.
    window.localStorage.setItem(
      'ph.tripExtraPicker.expandedGroups',
      JSON.stringify(['other', 'kitchen', 'campfire', 'dishes', 'stove']),
    )

    mocks.listParticipants.mockResolvedValue([participant(ME, 'Олег'), participant(ANNA, 'Анна')])
    mocks.listTripGear.mockResolvedValue(tripGearList([]))
    mocks.listGear.mockResolvedValue(gearList([]))
    mocks.removeTripGear.mockResolvedValue(undefined)
    mocks.fetchGearTypes.mockResolvedValue([
      { id: 3, code: 'axe', name: 'Топор', sortOrder: 3, attributes: [] },
      { id: 9, code: 'kettle', name: 'Котёл', sortOrder: 9, attributes: [] },
    ])
  })

  it('три группы в порядке заказчика: посуда, костровое, горелки', async () => {
    const wrapper = await mounted()

    expect(groupTitles(wrapper)).toEqual(['Посуда', 'Костровое', 'Горелки'])
    expect(wrapper.find('[data-test="route-cooking-group-dishes"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="route-cooking-group-campfire"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="route-cooking-group-stove"]').exists()).toBe(true)
  })

  it('группы разделены полосками', async () => {
    const wrapper = await mounted()

    // Между первой и второй, между второй и третьей — и только там.
    expect(wrapper.find('[data-test="route-cooking-divider-dishes"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="route-cooking-divider-campfire"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="route-cooking-divider-stove"]').exists()).toBe(true)
  })

  it('оба плана — кнопки всех групп в порядке заказчика, плюс «Добавить ещё» у каждой', async () => {
    const wrapper = await mounted()

    expect(addButtonTexts(wrapper)).toEqual([
      'Добавить котёл',
      'Добавить половник',
      'Добавить нож',
      'Добавить топор',
      'Добавить пилу',
      'Добавить розжиг',
      'Добавить таган',
      'Добавить горелку',
      'Добавить газовый баллон',
    ])

    expect(wrapper.findAll('[data-test^="route-cooking-extra-"]')).toHaveLength(3)
  })

  it('запланирован только костёр — газовые кнопки скрыты, посуда остаётся', async () => {
    const wrapper = await mounted({ fire: true, stove: false })

    expect(addButtonTexts(wrapper)).toEqual([
      'Добавить котёл',
      'Добавить половник',
      'Добавить нож',
      'Добавить топор',
      'Добавить пилу',
      'Добавить розжиг',
      'Добавить таган',
    ])
  })

  it('запланирована только горелка — костровые кнопки скрыты, посуда остаётся', async () => {
    const wrapper = await mounted({ fire: false, stove: true })

    expect(addButtonTexts(wrapper)).toEqual([
      'Добавить котёл',
      'Добавить половник',
      'Добавить нож',
      'Добавить горелку',
      'Добавить газовый баллон',
    ])
  })

  it('подсказка о плане стоит в шапке своей группы, отдельно от вещей', async () => {
    const wrapper = await mounted()

    expect(wrapper.get('[data-test="route-fire-hint"]').text()).toBe('Запланирован костёр.')
    // Подсказка — не пилюля и не кнопка: она в шапке группы.
    expect(
      wrapper.get('[data-test="route-cooking-group-campfire"]').get('[data-test="route-fire-hint"]'),
    ).toBeTruthy()
  })

  it('пусто: у каждой группы своя подсказка', async () => {
    const wrapper = await mounted()

    expect(wrapper.get('[data-test="route-cooking-empty-dishes"]').text()).toBe('Пока пусто.')
    expect(wrapper.get('[data-test="route-cooking-empty-campfire"]').text()).toBe('Пока пусто.')
    expect(wrapper.find('[data-test="route-cooking-items-campfire"]').exists()).toBe(false)
  })

  it('вещь попадает в свою группу по типу', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({
          id: 'g1',
          typeCode: 'kettle',
          typeName: 'Котёл',
          title: 'Котёл 5 л',
          ownerUserId: ANNA,
          weightGrams: 900,
        }),
        tripGearItem({
          id: 'g2',
          typeCode: 'axe',
          typeName: 'Топор',
          title: 'Топор Fiskars X7',
          ownerUserId: ME,
          weightGrams: 900,
        }),
        tripGearItem({
          id: 'g3',
          typeCode: 'stove',
          typeName: 'Горелка',
          title: 'Горелка BRS-3000',
          ownerUserId: ANNA,
          weightGrams: 130,
        }),
      ]),
    )

    const wrapper = await mounted()

    expect(
      wrapper.findAll('[data-test="route-cooking-item"]').map((node) => node.get('span').text()),
    ).toEqual(['Котёл - 900 гр. (Анна)', 'Топор - 900 гр. (Олег)', 'Горелка - 130 гр. (Анна)'])

    expect(wrapper.get('[data-test="route-cooking-items-dishes"]').text()).toContain('Котёл')
    expect(wrapper.get('[data-test="route-cooking-items-campfire"]').text()).toContain('Топор')
    expect(wrapper.get('[data-test="route-cooking-items-stove"]').text()).toContain('Горелка')
  })

  it('пилюли идут по порядку кнопок внутри группы', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({
          id: 'g1',
          typeCode: 'gas',
          typeName: 'Газовый баллон',
          title: 'Баллон',
          ownerUserId: ANNA,
        }),
        tripGearItem({
          id: 'g2',
          typeCode: 'stove',
          typeName: 'Горелка',
          title: 'Горелка',
          ownerUserId: ANNA,
        }),
      ]),
    )

    const wrapper = await mounted()

    expect(
      wrapper.findAll('[data-test="route-cooking-item"]').map((node) => node.get('span').text()),
    ).toEqual(['Горелка (Анна)', 'Газовый баллон (Анна)'])
  })

  it('тип решает, а не слово в названии', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({
          id: 'g1',
          typeCode: 'other',
          typeName: 'Прочее',
          title: 'Топор, который на самом деле не топор',
          ownerUserId: ME,
        }),
        tripGearItem({
          id: 'g2',
          typeCode: 'saw',
          typeName: 'Пила',
          title: 'Пилка складная',
          ownerUserId: ANNA,
        }),
      ]),
    )

    const wrapper = await mounted()

    expect(pillTexts(wrapper)).toEqual(['Пила (Анна)'])
  })

  it('палатки и спальники в готовку не попадают, а «не берём» — остаётся зачёркнутым', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({
          id: 'g1',
          typeCode: 'tent',
          typeName: 'Палатка',
          title: 'Палатка',
          ownerUserId: ME,
        }),
        tripGearItem({
          id: 'g2',
          typeCode: 'sleeping_bag',
          typeName: 'Спальник',
          title: 'Спальник',
          ownerUserId: ME,
        }),
        tripGearItem({
          id: 'g3',
          typeCode: 'stove',
          typeName: 'Горелка',
          title: 'Горелка, которую не берём',
          ownerUserId: ME,
          status: 'declined',
        }),
      ]),
    )

    const wrapper = await mounted()

    /**
     * 06.11.2026: «отображение неодобренных вещей как в Снаряжении» —
     * отказанная вещь не исчезает из своей группы, а стоит зачёркнутой.
     */
    const stove = wrapper.get('[data-test="route-cooking-items-stove"]')
    expect(stove.text()).toContain('Горелка (Олег)')
    expect(stove.get('[data-test="route-cooking-item"]').classes()).toContain('line-through')
    // Отклонённая горелка не делает кнопку «есть»: брать по-прежнему нечего.
    expect(
      wrapper.get('[data-test="route-cooking-add-stove"]').classes(),
    ).toContain('bg-red-600')
  })

  it('пилюля открывает карточку вещи, организатор меняет статус', async () => {
    const item = tripGearItem({
      id: 'g1',
      typeCode: 'axe',
      typeName: 'Топор',
      title: 'Топор Fiskars X7',
      ownerUserId: ME,
      status: 'proposed',
    })
    mocks.listTripGear.mockResolvedValue(tripGearList([item]))
    mocks.updateTripGear.mockResolvedValue({ ...item, status: 'declined' })

    const wrapper = await mounted()
    await wrapper.get('[data-test="route-cooking-item"]').trigger('click')

    // Карточка — общая с вкладкой «Снаряжение»: характеристики и решение.
    const dialog = wrapper.get('[data-test="gear-item-dialog"]')
    expect(dialog.text()).toContain('Топор Fiskars X7')

    await wrapper.get('[data-test="gear-item-status-declined"]').trigger('click')
    await flushPromises()

    expect(mocks.updateTripGear).toHaveBeenCalledWith('1', 'g1', { status: 'declined' })
    // Статус сменился — пилюля в группе стала зачёркнутой.
    expect(
      wrapper.get('[data-test="route-cooking-item"]').classes(),
    ).toContain('line-through')
  })

  it('кнопка цветная, пока вещи этого типа нет, и белая, когда она есть', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({
          id: 'g1',
          typeCode: 'axe',
          typeName: 'Топор',
          title: 'Топор Fiskars X7',
          ownerUserId: ME,
        }),
      ]),
    )

    const wrapper = await mounted()

    expect(wrapper.get('[data-test="route-cooking-add-axe"]').classes()).toContain('bg-field')
    expect(wrapper.get('[data-test="route-cooking-add-saw"]').classes()).toContain('bg-red-600')
  })

  it('«Добавить топор» предлагает только вещи типа «Топор» из моего каталога', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([
        gearItem({ id: '40', typeCode: 'axe', typeName: 'Топор', title: 'Топор Fiskars X7' }),
        gearItem({ id: '41', typeCode: 'stove', typeName: 'Горелка', title: 'Горелка BRS-3000' }),
        gearItem({ id: '42', typeCode: 'other', typeName: 'Прочее', title: 'Топор-сувенир' }),
      ]),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-add-axe"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="route-cooking-dialog"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="route-cooking-dialog"] h3').text()).toBe('Топор')
    expect(
      wrapper.get('[data-test="route-cooking-gear"]').findAll('option').map((node) => node.text()),
    ).toEqual(['выбери…', 'Топор Fiskars X7'])
  })

  it('предложение уходит на сервер, вещь появляется пилюлей и кнопка белеет', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([
        gearItem({
          id: '40',
          typeCode: 'axe',
          typeName: 'Топор',
          title: 'Топор Fiskars X7',
          weightGrams: 900,
        }),
      ]),
    )
    mocks.proposeTripGear.mockResolvedValue(
      tripGearItem({
        id: 'g40',
        gearItemId: '40',
        typeCode: 'axe',
        typeName: 'Топор',
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

    // Обычная кнопка секцию не присылает: место вещи определяет её тип.
    expect(mocks.proposeTripGear).toHaveBeenCalledWith('1', '40')
    expect(wrapper.find('[data-test="route-cooking-dialog"]').exists()).toBe(false)
    expect(pillTexts(wrapper)).toEqual(['Топор - 900 гр. (Олег)'])
    expect(wrapper.get('[data-test="route-cooking-add-axe"]').classes()).toContain('bg-field')
  })

  it('уже предложенную вещь второй раз не предлагают', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([
        gearItem({ id: '40', typeCode: 'axe', typeName: 'Топор', title: 'Топор, который уже в походе' }),
        gearItem({ id: '41', typeCode: 'saw', typeName: 'Пила', title: 'Пила' }),
      ]),
    )
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({
          id: 'g40',
          gearItemId: '40',
          typeCode: 'axe',
          typeName: 'Топор',
          title: 'Топор',
          ownerUserId: ME,
        }),
      ]),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-add-axe"]').trigger('click')
    await flushPromises()

    expect(
      wrapper.get('[data-test="route-cooking-gear"]').findAll('option').map((node) => node.text()),
    ).toEqual(['выбери…'])
  })

  it('нет подходящей вещи — подсказка, а не пустой список', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([gearItem({ id: '41', typeCode: 'stove', typeName: 'Горелка', title: 'Горелка' })]),
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
      gearList([gearItem({ id: '40', typeCode: 'axe', typeName: 'Топор', title: 'Топор' })]),
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

  it('владелец убирает свою вещь крестиком: настоящий DELETE', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({
          id: 'g1',
          typeCode: 'axe',
          typeName: 'Топор',
          title: 'Топор Fiskars X7',
          ownerUserId: ME,
        }),
      ]),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-remove-g1"]').trigger('click')
    await flushPromises()

    expect(mocks.removeTripGear).toHaveBeenCalledWith('1', 'g1')
    expect(wrapper.find('[data-test="route-cooking-items-campfire"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="route-cooking-empty-campfire"]').text()).toBe('Пока пусто.')
  })

  it('организатор убирает чужую вещь тем же DELETE', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({
          id: 'g1',
          typeCode: 'stove',
          typeName: 'Горелка',
          title: 'Горелка Анны',
          ownerUserId: ANNA,
          weightGrams: 150,
        }),
      ]),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-remove-g1"]').trigger('click')
    await flushPromises()

    expect(mocks.removeTripGear).toHaveBeenCalledWith('1', 'g1')
    expect(wrapper.find('[data-test="route-cooking-items-stove"]').exists()).toBe(false)
  })

  it('сервер отказал в удалении — текст ошибки, вещь на месте', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({
          id: 'g1',
          typeCode: 'stove',
          typeName: 'Горелка',
          title: 'Горелка Анны',
          ownerUserId: ANNA,
        }),
      ]),
    )
    mocks.removeTripGear.mockRejectedValue(
      new ApiError(403, 'Чужую вещь убирает владелец или тот, кто ведёт снаряжение похода'),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-remove-g1"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="route-cooking-remove-error"]').text()).toContain(
      'тот, кто ведёт снаряжение',
    )
    expect(pillTexts(wrapper)).toEqual(['Горелка (Анна)'])
  })

  it('крестика нет ни у владельца чужой вещи, ни у постороннего участника', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({
          id: 'g1',
          typeCode: 'stove',
          typeName: 'Горелка',
          title: 'Горелка Анны',
          ownerUserId: ANNA,
        }),
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
    expect(wrapper.find('[data-test="route-cooking-buttons-dishes"]').exists()).toBe(false)
  })

  it('«Указать вручную» у кнопки добавляет одноразовую вещь в секцию', async () => {
    mocks.addManualTripGear.mockResolvedValue(
      tripGearItem({
        id: 'g-manual',
        gearItemId: 'gi-manual',
        typeCode: 'axe',
        typeName: 'Топор',
        title: 'Топор',
        ownerUserId: ME,
        isTripOnly: true,
      }),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-add-axe"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="route-cooking-manual"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="manual-gear-dialog"]').exists()).toBe(true)

    await wrapper.get('[data-test="manual-save"]').trigger('click')
    await flushPromises()

    expect(mocks.addManualTripGear).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({
        typeId: 3,
        title: null,
        ownerUserId: null,
        addToCatalog: false,
      }),
    )
    expect(pillTexts(wrapper)).toEqual(['Топор (Олег)'])
  })

  // ───────────────────────────── «Добавить ещё» ─────────────────────────────

  it('«Добавить ещё» есть в каждой группе и всегда белая', async () => {
    const wrapper = await mounted()

    for (const code of ['dishes', 'campfire', 'stove']) {
      const button = wrapper.get(`[data-test="route-cooking-extra-${code}"]`)

      expect(button.text()).toBe('Добавить ещё')
      expect(button.classes()).toContain('bg-field')
      expect(button.classes()).not.toContain('bg-red-600')
    }
  })

  it('«Добавить ещё» открывает весь каталог: полки группы первыми, можно взять что угодно', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([
        gearItem({ id: '60', groupCode: 'other', groupName: 'Прочее', typeCode: 'other', typeName: 'Прочее', title: 'Лодка надувная' }),
        gearItem({ id: '61', groupCode: 'kitchen', groupName: 'Кухня', typeCode: 'kettle', typeName: 'Котёл', title: 'Котёл 5 л' }),
      ]),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-extra-dishes"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="route-extra-picker"]').exists()).toBe(true)

    // «Кухня» — полка группы «Посуда» — идёт первой, «Прочее» после неё.
    const groupNames = wrapper
      .findAll('[data-test^="route-extra-group-"]')
      .map((node) => node.get('span').text())

    expect(groupNames).toEqual(['Кухня', 'Прочее'])
  })

  it('вещь из «Добавить ещё» уходит на сервер с пометкой секции и появляется пилюлей', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([
        gearItem({
          id: '60',
          typeCode: 'other',
          typeName: 'Прочее',
          title: 'Губка для мытья посуды',
          weightGrams: 20,
        }),
      ]),
    )
    mocks.proposeTripGear.mockResolvedValue(
      tripGearItem({
        id: 'g60',
        gearItemId: '60',
        typeCode: 'other',
        typeName: 'Прочее',
        title: 'Губка для мытья посуды',
        ownerUserId: ME,
        weightGrams: 20,
        routeSection: 'dishes',
      }),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-extra-dishes"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="route-extra-item-60"]').trigger('click')
    await flushPromises()

    expect(mocks.proposeTripGear).toHaveBeenCalledWith('1', '60', 'dishes')
    expect(wrapper.find('[data-test="route-extra-picker"]').exists()).toBe(false)

    // Пилюля подписана названием, а не типом: тип у такой вещи общий.
    expect(pillTexts(wrapper)).toEqual(['Губка для мытья посуды - 20 гр. (Олег)'])
    expect(wrapper.get('[data-test="route-cooking-items-dishes"]').text()).toContain('Губка')
  })

  it('вещь с пометкой секции показывает только эта группа, даже если её тип чужой', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([
        tripGearItem({
          id: 'g1',
          typeCode: 'axe',
          typeName: 'Топор',
          title: 'Топор, который положили в горелки',
          ownerUserId: ME,
          routeSection: 'stove',
        }),
      ]),
    )

    const wrapper = await mounted()

    expect(wrapper.find('[data-test="route-cooking-items-campfire"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="route-cooking-items-stove"]').text()).toContain(
      'Топор, который положили в горелки',
    )
    // Кнопка «Добавить топор» остаётся цветной: в «Костровом» топора нет.
    expect(wrapper.get('[data-test="route-cooking-add-axe"]').classes()).toContain('bg-red-600')
  })

  it('«Добавить вручную» из «Добавить ещё»: любой тип и пометка группы', async () => {
    mocks.addManualTripGear.mockResolvedValue(
      tripGearItem({
        id: 'g-manual',
        gearItemId: 'gi-manual',
        typeCode: 'kettle',
        typeName: 'Котёл',
        title: 'Котёл походный',
        ownerUserId: ME,
        isTripOnly: true,
        routeSection: 'dishes',
      }),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-extra-dishes"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="route-extra-manual"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="manual-gear-dialog"]').exists()).toBe(true)

    // Тип не задан кнопкой: справочник целиком, а не один тип.
    expect(wrapper.get('[data-test="manual-type"]').findAll('option').map((node) => node.text())).toEqual([
      'Топор',
      'Котёл',
    ])

    await wrapper.get('[data-test="manual-save"]').trigger('click')
    await flushPromises()

    expect(mocks.addManualTripGear).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ typeId: 3, routeSection: 'dishes' }),
    )
    expect(pillTexts(wrapper)).toEqual(['Котёл походный (Олег)'])
  })

  it('«Отмена» в ручной форме возвращает к выбору вещи с тем же поиском', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([
        gearItem({
          id: '60',
          typeCode: 'kettle',
          typeName: 'Котёл',
          title: 'Котёл 5 л',
        }),
      ]),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-extra-dishes"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="route-extra-search"]').setValue('котёл')
    await wrapper.get('[data-test="route-extra-manual"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="manual-gear-dialog"]').exists()).toBe(true)

    await wrapper.get('[data-test="manual-cancel"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="manual-gear-dialog"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="route-extra-picker"]').exists()).toBe(true)
    expect(
      (wrapper.get('[data-test="route-extra-search"]').element as HTMLInputElement).value,
    ).toBe('котёл')
  })

  it('ошибка «Добавить ещё» видна строкой, вещи в секции нет', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([gearItem({ id: '60', typeCode: 'other', typeName: 'Прочее', title: 'Лодка' })]),
    )
    mocks.proposeTripGear.mockRejectedValue(new ApiError(409, 'Этот предмет уже предложен в походе'))

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-extra-campfire"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="route-extra-item-60"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="route-cooking-extra-error"]').text()).toContain(
      'уже предложен в походе',
    )
  })

  /**
   * «Взять личную посуду» (09.11.2026). Заказчик: синяя кнопка в группе
   * «Посуда», по ней выбор снаряжения типа «КЛМН», вещь личная — как спальник.
   */
  it('«Взять личную посуду» — синяя кнопка только в «Посуде»', async () => {
    const wrapper = await mounted()

    const button = wrapper.get('[data-test="route-cooking-personal-dishes-add"]')
    expect(button.text()).toBe('Взять личную посуду')
    expect(button.classes()).toContain('bg-blue-600')

    expect(
      wrapper.find('[data-test="route-cooking-group-campfire"] [data-test="route-cooking-personal-dishes-add"]')
        .exists(),
    ).toBe(false)
  })

  it('личная посуда выбирается из типа «КЛМН» и уходит в личные вещи', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([
        gearItem({
          id: 'k1',
          typeCode: 'klmn',
          typeName: 'КЛМН',
          title: 'Набор КЛМН',
          weightGrams: 120,
        }),
      ]),
    )
    mocks.addPersonalTripGear.mockResolvedValue(
      tripGearItem({
        id: 'p1',
        gearItemId: 'k1',
        typeCode: 'klmn',
        typeName: 'КЛМН',
        title: 'Набор КЛМН',
        weightGrams: 120,
        ownerUserId: ME,
      }),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-cooking-personal-dishes-add"]').trigger('click')
    await flushPromises()

    const select = wrapper.get('[data-test="route-cooking-dishes-gear"]')
    expect(select.findAll('option').map((option) => option.text())).toContain(
      'Набор КЛМН · 120 гр.',
    )

    await select.setValue('k1')
    await wrapper.get('[data-test="route-cooking-dishes-save"]').trigger('click')
    await flushPromises()

    // Ручка личная, а не `proposeTripGear`: вещь не должна попасть
    // в снаряжение похода и в распределение.
    expect(mocks.addPersonalTripGear).toHaveBeenCalledWith('1', { gearItemId: 'k1' })
    expect(mocks.proposeTripGear).not.toHaveBeenCalled()
    expect(wrapper.get('[data-test="route-cooking-personal-dish"]').text()).toContain(
      'Набор КЛМН - 120 гр.',
    )
  })

  it('своя личная посуда приезжает из ответа и убирается крестиком', async () => {
    mocks.listTripGear.mockResolvedValue({
      ...tripGearList([]),
      personalItems: [
        tripGearItem({
          id: 'p1',
          gearItemId: 'k1',
          typeCode: 'klmn',
          typeName: 'КЛМН',
          title: 'Набор КЛМН',
          ownerUserId: ME,
        }),
      ],
    })
    mocks.removePersonalTripGear.mockResolvedValue(undefined)

    const wrapper = await mounted()

    expect(wrapper.get('[data-test="route-cooking-personal-dish"]').text()).toContain(
      'Набор КЛМН',
    )

    await wrapper.get('[data-test="route-cooking-remove-dish-p1"]').trigger('click')
    await flushPromises()

    expect(mocks.removePersonalTripGear).toHaveBeenCalledWith('1', 'p1')
    expect(wrapper.find('[data-test="route-cooking-personal-dish"]').exists()).toBe(false)
  })
})
