import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/api/types'
import type { GearItem, TripGearItem } from '@/types/gear'
import type { ParticipantStatus, Trip, TripParticipant } from '@/types/trips'
import TripRouteTents from '@/views/trips/TripRouteTents.vue'

/**
 * Секция «Палатки» (29.10.2026) — распределение участников по палаткам.
 *
 * Механика взята у «Трансфера» и проверяется теми же словами: плашка,
 * владелец, люди внутри, «попроситься», «принять», «уйти». Отличия, ради
 * которых тест и нужен:
 *
 * - **вместимость не блокирует**: палатка на троих спокойно принимает
 *   четвёртого — «производитель рекомендует, а живут +1»;
 * - **заголовок плашки** — «{хозяин} {основная характеристика} {вес}гр.»,
 *   как продиктовал заказчик: «Анна 3-х местная 2400 гр.»;
 * - **«Добавить тент»** — пока только кнопка: под тентом никто не ночует;
 * - **распределяем только «идёт»**: «пока не решил», «приглашён» и «не идёт»
 *   места в палатке не занимают;
 * - **палатки — из снаряжения похода**, «не берём» на экране нет.
 *
 * Данные запросов заглушены: людей и палатки экран читает из существующих
 * ручек (`participants`, `trips/:id/gear`), а кто где живёт — пока в памяти.
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
const PETR = 'demo-petr'
const IVAN = 'demo-ivan'
const OLGA = 'demo-olga'

const ME_NAME = 'Олег'
const ANNA_NAME = 'Анна'

function makeUser(): User {
  return {
    id: ME,
    displayName: ME_NAME,
    location: null,
    avatarUrl: null,
    gender: 'm',
    isVegetarian: false,
    allergies: null,
    sportExperience: null,
  }
}

function makeTrip(overrides: Partial<Trip> = {}): Trip {
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
    ...overrides,
  }
}

function participant(
  userId: string,
  displayName: string,
  status: ParticipantStatus = 'going',
): TripParticipant {
  return {
    userId,
    displayName,
    avatarUrl: null,
    status,
    roles: [],
    isOrganizer: false,
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
  }
}

/** Состав: двое идут, остальные — по одному в каждом «не идущем» статусе. */
function makePeople(): TripParticipant[] {
  return [
    participant(ME, ME_NAME, 'going'),
    participant(ANNA, ANNA_NAME, 'going'),
    participant(PETR, 'Пётр', 'maybe'),
    participant(IVAN, 'Иван', 'declined'),
    participant(OLGA, 'Ольга', 'invited'),
  ]
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

/** Палатка Анны — единственная, что «берём»: с неё начинается каждый тест. */
function annaTent(): TripGearItem {
  return tripGearItem({
    id: 'g1',
    gearItemId: '10',
    kind: 'tent',
    title: 'Палатка на четверых',
    ownerUserId: ANNA,
    weightGrams: 2400,
  })
}

function gearList(items: GearItem[]): { items: GearItem[]; totalWeightGrams: number; itemsWithoutWeight: number } {
  return { items, totalWeightGrams: 0, itemsWithoutWeight: 0 }
}

function personalTent(id: string, title: string): GearItem {
  return {
    id,
    kind: 'tent',
    title,
    weightGrams: null,
    note: null,
    createdAt: '2026-10-20T10:00:00.000Z',
  }
}

async function mounted(trip: Trip = makeTrip()): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(TripRouteTents, { props: { trip } })
  await flushPromises()

  return wrapper
}

describe('секция «Палатки»', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    useAuthStore().setAuth(makeUser(), 'token')

    mocks.listParticipants.mockResolvedValue(makePeople())
    mocks.listTripGear.mockResolvedValue({
      items: [annaTent()],
      totalWeightGrams: 0,
      itemsWithoutWeight: 0,
    })
    mocks.listGear.mockResolvedValue(gearList([]))
  })

  it('палатка — только вид «палатка» и только «берём»', async () => {
    mocks.listTripGear.mockResolvedValue({
      items: [
        annaTent(),
        tripGearItem({
          id: 'g2',
          gearItemId: '11',
          kind: 'tent',
          title: 'Палатка, которую не берём',
          ownerUserId: PETR,
          status: 'declined',
        }),
        tripGearItem({
          id: 'g3',
          gearItemId: '12',
          kind: 'sleeping',
          title: 'Спальник',
          ownerUserId: ME,
        }),
      ],
      totalWeightGrams: 0,
      itemsWithoutWeight: 0,
    })

    const wrapper = await mounted()

    expect(
      wrapper.findAll('[data-test="route-tent-title"]').map((node) => node.text()),
    ).toEqual(['Анна 3-х местная 2400 гр.'])
  })

  it('без веса в заголовке нет «гр.»: «Анна 3-х местная»', async () => {
    mocks.listTripGear.mockResolvedValue({
      items: [{ ...annaTent(), weightGrams: null }],
      totalWeightGrams: 0,
      itemsWithoutWeight: 1,
    })

    const wrapper = await mounted()

    expect(wrapper.get('[data-test="route-tent-title"]').text()).toBe('Анна 3-х местная')
  })

  it('заголовок плашки — «{хозяин} {характеристика} {вес}гр.», владелец уже живёт в ней', async () => {
    const wrapper = await mounted()

    expect(wrapper.get('[data-test="route-tent-title"]').text()).toBe(
      'Анна 3-х местная 2400 гр.',
    )
    expect(wrapper.get('[data-test="route-tent-summary"]').text()).toBe('живёт 1 (Анна)')
  })

  it('«Добавить тент» — пока только кнопка: она ничего не открывает и не добавляет', async () => {
    const wrapper = await mounted()

    const button = wrapper.get('[data-test="route-tent-awning"]')
    expect(button.text()).toBe('Добавить тент')

    await button.trigger('click')

    expect(wrapper.find('[data-test="route-tent-dialog"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="route-tent"]')).toHaveLength(1)
  })

  it('«не распределены» — только идущие: «пока не решил» и остальные не в счёте', async () => {
    const wrapper = await mounted()
    const unassigned = wrapper.get('[data-test="route-tents-unassigned"]')

    expect(unassigned.text()).toContain('Олег')
    expect(unassigned.text()).not.toContain('Пётр')
    expect(unassigned.text()).not.toContain('Ольга')
    expect(unassigned.text()).not.toContain('Иван')
  })

  it('«взять в палатку» предлагает только идущих', async () => {
    const wrapper = await mounted()

    const options = wrapper
      .get('[data-test="route-tent-add-member"]')
      .findAll('option')
      .map((option) => option.text())

    expect(options).toEqual(['взять в палатку…', 'Олег'])
  })

  it('владелец зовёт человека, и селект возвращается в пустое состояние', async () => {
    // Ещё один идущий: с одним селект после добавления исчез бы, и «сброс»
    // было бы не на чем проверить.
    mocks.listParticipants.mockResolvedValue([...makePeople(), participant('demo-vasya', 'Вася')])

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-add-member"]').setValue(ME)

    expect(wrapper.get('[data-test="route-tent-summary"]').text()).toBe('живут 2 (Анна, Олег)')
    expect(wrapper.get('[data-test="route-tents-unassigned"]').text()).toContain('Вася')

    const select = wrapper.get('[data-test="route-tent-add-member"]')
    expect((select.element as HTMLSelectElement).value).toBe('')
    // Только что добавленного в списке больше нет.
    expect(select.findAll('option').map((option) => option.text())).toEqual([
      'взять в палатку…',
      'Вася',
    ])
  })

  it('владельца из палатки не убрать, остальных — можно', async () => {
    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-add-member"]').setValue(ME)

    // У Анны крестика нет: палатка уходит из похода вместе с ней.
    expect(wrapper.find(`[data-test="route-tent-leave-${ANNA}"]`).exists()).toBe(false)

    await wrapper.get(`[data-test="route-tent-leave-${ME}"]`).trigger('click')

    expect(wrapper.get('[data-test="route-tent-summary"]').text()).toBe('живёт 1 (Анна)')
    expect(wrapper.get('[data-test="route-tents-unassigned"]').text()).toContain('Олег')
  })

  it('в чужую палатку просятся, а не входят сразу; заявку можно отменить', async () => {
    // Организатор — Анна: Олег обычный участник и прав на её палатку не имеет.
    const wrapper = await mounted(makeTrip({ organizerUserId: ANNA }))

    expect(wrapper.get('[data-test="route-tent-join"]').text()).toBe('Попроситься')

    await wrapper.get('[data-test="route-tent-join"]').trigger('click')

    const requests = wrapper.get('[data-test="route-tent-requests"]')
    expect(requests.text()).toContain('Олег')
    // Место в палатке заявка не занимает: в пилюлях спящих Олега нет.
    expect(wrapper.get('[data-test="route-tent-summary"]').text()).toBe('живёт 1 (Анна)')
    expect(wrapper.findAll('[data-test^="route-tent-accept-"]')).toHaveLength(0)
    expect(wrapper.find('[data-test="route-tent-add-member"]').exists()).toBe(false)

    await wrapper.get(`[data-test="route-tent-leave-${ME}"]`).trigger('click')

    expect(wrapper.find('[data-test="route-tent-requests"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="route-tent-join"]').exists()).toBe(true)
  })

  it('заявку принимают те, кто правит палатку', async () => {
    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-join"]').trigger('click')
    await wrapper.get(`[data-test="route-tent-accept-${ME}"]`).trigger('click')

    expect(wrapper.get('[data-test="route-tent-summary"]').text()).toBe('живут 2 (Анна, Олег)')
    expect(wrapper.find('[data-test="route-tent-requests"]').exists()).toBe(false)
    expect(wrapper.find(`[data-test="route-tent-leave-${ME}"]`).exists()).toBe(true)
  })

  it('заявку можно отклонить — человек возвращается в «не распределены»', async () => {
    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-join"]').trigger('click')
    await wrapper.get(`[data-test="route-tent-reject-${ME}"]`).trigger('click')

    expect(wrapper.find('[data-test="route-tent-requests"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="route-tents-unassigned"]').text()).toContain('Олег')
  })

  it('вместимость не блокирует: 3-х местная принимает четвёртого', async () => {
    mocks.listParticipants.mockResolvedValue([
      ...makePeople(),
      participant('demo-vasya', 'Вася'),
      participant('demo-katya', 'Катя'),
      participant('demo-lena', 'Лена'),
    ])

    const wrapper = await mounted()
    const select = wrapper.get('[data-test="route-tent-add-member"]')

    await select.setValue('demo-vasya')
    await wrapper.get('[data-test="route-tent-add-member"]').setValue('demo-katya')
    await wrapper.get('[data-test="route-tent-add-member"]').setValue('demo-lena')

    expect(wrapper.get('[data-test="route-tent-summary"]').text()).toBe(
      'живут 4 (Анна, Вася, Катя, Лена)',
    )
    expect(wrapper.get('[data-test="route-tent-over"]').text()).toBe('сверх вместимости')
    expect(wrapper.text()).not.toContain('мест нет')
  })

  it('пусто: палаток нет — подсказка и кнопка «Добавить свою палатку»', async () => {
    mocks.listTripGear.mockResolvedValue({
      items: [],
      totalWeightGrams: 0,
      itemsWithoutWeight: 0,
    })

    const wrapper = await mounted()

    expect(wrapper.get('[data-test="route-tents-empty"]').text()).toContain(
      'Пока никто не взял палатку',
    )
    expect(wrapper.find('[data-test="route-tent-add"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="route-tents-unassigned"]').text()).toContain('Олег')
  })

  it('своя палатка: спрашиваем вместимость и получаем заголовок «Олег 5-местная 1000 гр.»', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([personalTent('20', 'Палатка на пятерых'), personalTent('21', 'Односкатка')]),
    )
    mocks.proposeTripGear
      .mockResolvedValueOnce(
        tripGearItem({
          id: 'g20',
          gearItemId: '20',
          kind: 'tent',
          title: 'Палатка на пятерых',
          ownerUserId: ME,
          weightGrams: 1000,
        }),
      )
      .mockResolvedValueOnce(
        tripGearItem({
          id: 'g21',
          gearItemId: '21',
          kind: 'tent',
          title: 'Односкатка',
          ownerUserId: ME,
        }),
      )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-add"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-test="route-tent-gear"]').setValue('20')
    await wrapper.get('[data-test="route-tent-capacity"]').setValue('5')
    await wrapper.get('[data-test="route-tent-save"]').trigger('click')
    await flushPromises()

    expect(mocks.proposeTripGear).toHaveBeenCalledWith('1', '20')
    expect(wrapper.find('[data-test="route-tent-dialog"]').exists()).toBe(false)
    expect(
      wrapper.findAll('[data-test="route-tent-title"]').map((node) => node.text()),
    ).toContain('Олег 5-местная 1000 гр.')

    // Вторая палатка — на одного и без веса: «одноместная», а не «1-х
    // местная», и без «гр.», которого не из чего взять.
    await wrapper.get('[data-test="route-tent-add"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-test="route-tent-gear"]').setValue('21')
    await wrapper.get('[data-test="route-tent-capacity"]').setValue('1')
    await wrapper.get('[data-test="route-tent-save"]').trigger('click')
    await flushPromises()

    expect(
      wrapper.findAll('[data-test="route-tent-title"]').map((node) => node.text()),
    ).toContain('Олег одноместная')
  })

  it('в списке нет палаток, которые уже взяли в поход', async () => {
    // Предмет каталога 10 уже едет в походе (палатка Анны) — своей она быть
    // не может, но принцип тот же: занятые в списке не предлагаются.
    mocks.listGear.mockResolvedValue(
      gearList([personalTent('10', 'Моя палатка'), { ...personalTent('30', 'Спальник'), kind: 'sleeping' }]),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-add"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="route-tent-no-gear"]').text()).toContain('Свободной палатки')
  })

  it('ошибка добавления видна в модалке, а не под затемнением', async () => {
    mocks.listGear.mockResolvedValue(gearList([personalTent('20', 'Палатка')]))
    mocks.proposeTripGear.mockRejectedValue(new ApiError(400, 'Эта палатка уже в походе'))

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-add"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-test="route-tent-gear"]').setValue('20')
    await wrapper.get('[data-test="route-tent-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="route-tent-dialog"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="route-tent-error"]').text()).toBe(
      'Эта палатка уже в походе',
    )
  })

  it('снаряжение не загрузилось — сообщение, а не пустая зелёная секция', async () => {
    mocks.listTripGear.mockRejectedValue(new ApiError(500, 'Снаряжение недоступно'))

    const wrapper = mount(TripRouteTents, { props: { trip: makeTrip() } })
    await flushPromises()

    expect(wrapper.get('[data-test="route-tents-error"]').text()).toBe('Снаряжение недоступно')
    expect(wrapper.find('[data-test="route-tent-add"]').exists()).toBe(false)
  })
})
