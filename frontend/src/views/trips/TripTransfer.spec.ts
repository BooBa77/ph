import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { User } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import type { Trip, TripTransfer, Vehicle } from '@/types/trips'
import TripTransferView from '@/views/trips/TripTransfer.vue'

/**
 * Вкладка «Трансфер» (27–28.10.2026).
 *
 * Проверяется то, ради чего экран переделан: две области «Туда» и
 * «Обратно» со своими кнопками, плашка со сворачиванием и одной строкой
 * шапки, заброски-цепочки из обычных карточек, флаг «наше ТС» только у права
 * вкладки, компенсации по типу транспорта, заявка на чужое ТС и самовольный
 * уход из карточки.
 *
 * Права берутся из ответа (`plan.canEdit`, `leg.canEdit`, `leg.joinStatus`) —
 * фронт матрицу ролей не повторяет, поэтому и тесты задают их в фикстуре.
 */
const mocks = vi.hoisted(() => ({
  fetchTripTransfer: vi.fn(),
  createTransferLeg: vi.fn(),
  updateTransferLeg: vi.fn(),
  removeTransferLeg: vi.fn(),
  joinTransferLeg: vi.fn(),
  addTransferPassenger: vi.fn(),
  acceptTransferPassenger: vi.fn(),
  removeTransferPassenger: vi.fn(),
  listTripMessages: vi.fn(),
  sendTripMessage: vi.fn(),
  fetchVehicles: vi.fn(),
  createVehicle: vi.fn(),
}))

vi.mock('@/api/trips', () => ({
  fetchTripTransfer: mocks.fetchTripTransfer,
  createTransferLeg: mocks.createTransferLeg,
  updateTransferLeg: mocks.updateTransferLeg,
  removeTransferLeg: mocks.removeTransferLeg,
  joinTransferLeg: mocks.joinTransferLeg,
  addTransferPassenger: mocks.addTransferPassenger,
  acceptTransferPassenger: mocks.acceptTransferPassenger,
  removeTransferPassenger: mocks.removeTransferPassenger,
  listTripMessages: mocks.listTripMessages,
  sendTripMessage: mocks.sendTripMessage,
}))

vi.mock('@/api/vehicles', () => ({
  fetchVehicles: mocks.fetchVehicles,
  createVehicle: mocks.createVehicle,
}))

const ME = 'demo-me'
const ANNA = 'demo-anna'
const PETR = 'demo-petr'

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

const TRIP: Trip = {
  id: '1',
  organizerUserId: ANNA,
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
  startsAt: null,
  endsAt: null,
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

const THERE_AT = new Date(2026, 10, 7, 8, 0).toISOString()
const BACK_AT = new Date(2026, 10, 9, 18, 0).toISOString()

/** Вкладка, какой её отдаёт бэкенд: две стороны, своё ТС и рейс. */
function makePlan(overrides: Partial<TripTransfer> = {}): TripTransfer {
  return {
    canEdit: true,
    travelers: [
      { userId: ME, displayName: 'Олег' },
      { userId: ANNA, displayName: 'Анна' },
      { userId: PETR, displayName: 'Пётр' },
    ],
    legs: [
      {
        id: '1',
        direction: 'there',
        position: 1,
        chainId: null,
        stage: null,
        mode: 'car',
        departsAt: THERE_AT,
        fromPlace: 'Иркутск, автовокзал',
        toPlace: 'Олхинское плато, Витязь',
        isOwnVehicle: true,
        ownerUserId: ME,
        ownerName: 'Олег',
        seats: 4,
        vehicleId: null,
        vehicleTitle: null,
        vehiclePlate: null,
        sourceLegId: null,
        occupied: 1,
        compensation: 'shared',
        compensationAmountRub: 3000,
        isRoundTrip: true,
        note: 'выезд в восемь',
        canEdit: true,
        joinStatus: null,
        passengers: [
          { userId: ME, displayName: 'Олег', status: 'accepted' },
          { userId: ANNA, displayName: 'Анна', status: 'requested' },
        ],
      },
      {
        id: '2',
        direction: 'there',
        position: 2,
        chainId: null,
        stage: null,
        mode: 'bus',
        departsAt: THERE_AT,
        fromPlace: 'Иркутск, автовокзал',
        toPlace: 'Олхинское плато, Витязь',
        isOwnVehicle: false,
        ownerUserId: null,
        ownerName: null,
        seats: null,
        vehicleId: null,
        vehicleTitle: null,
        vehiclePlate: null,
        sourceLegId: null,
        occupied: 1,
        compensation: 'ticket',
        compensationAmountRub: 500,
        isRoundTrip: false,
        note: null,
        canEdit: true,
        joinStatus: null,
        passengers: [{ userId: PETR, displayName: 'Пётр', status: 'accepted' }],
      },
      {
        id: '3',
        direction: 'back',
        position: 1,
        chainId: null,
        stage: null,
        mode: 'airboat',
        departsAt: BACK_AT,
        fromPlace: 'Олхинское плато, Витязь',
        toPlace: 'Иркутск, автовокзал',
        isOwnVehicle: false,
        ownerUserId: null,
        ownerName: null,
        seats: null,
        vehicleId: null,
        vehicleTitle: null,
        vehiclePlate: null,
        sourceLegId: null,
        occupied: 0,
        compensation: 'sharedPerPassenger',
        compensationAmountRub: 1200,
        isRoundTrip: false,
        note: null,
        canEdit: true,
        joinStatus: 'accepted',
        passengers: [],
      },
    ],
    ...overrides,
  }
}

async function mountTransfer(plan: TripTransfer = makePlan(), vehicles: Vehicle[] = []) {
  mocks.fetchTripTransfer.mockResolvedValue(plan)
  mocks.fetchVehicles.mockResolvedValue(vehicles)
  mocks.listTripMessages.mockResolvedValue({ messages: [], hasMore: false })

  const wrapper = mount(TripTransferView, { props: { trip: TRIP } })
  await flushPromises()

  return wrapper
}

/** Плашка по id — в тестах так короче, чем искать по тексту. */
function legCard(wrapper: Awaited<ReturnType<typeof mountTransfer>>, id: string) {
  return wrapper.findAll('[data-test="transfer-leg"]').find((card) =>
    card.find(`[data-test="transfer-collapse-${id}"]`).exists(),
  )
}

describe('TripTransfer', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
    useAuthStore().setAuth(makeUser(), 'token')
    vi.clearAllMocks()
  })

  it('рисует две области и карточки в них', async () => {
    const wrapper = await mountTransfer()

    expect(mocks.fetchTripTransfer).toHaveBeenCalledWith('1')

    const there = wrapper.find('[data-test="transfer-area-there"]')
    const back = wrapper.find('[data-test="transfer-area-back"]')

    expect(there.text()).toContain('Туда')
    expect(back.text()).toContain('Обратно')
    // Счётчика карточек в подписи секции больше нет.
    expect(there.text()).not.toContain('Туда ·')

    // Карточки первой стороны — в первой области, обратная — во второй.
    expect(there.findAll('[data-test="transfer-leg"]')).toHaveLength(2)
    expect(back.findAll('[data-test="transfer-leg"]')).toHaveLength(1)
    expect(back.text()).toContain('Аэролодка')

    // Шапка: тип, время, точки и одна строка про людей.
    const first = legCard(wrapper, '1')!
    expect(first.find('[data-test="transfer-leg-mode"]').text()).toContain('Автомобиль')
    expect(first.find('[data-test="transfer-leg-places"]').text()).toContain(
      'Иркутск, автовокзал → Олхинское плато, Витязь',
    )
    expect(first.find('[data-test="transfer-leg-summary"]').text()).toBe(
      'Наше ТС · Олег, занято 1 из 4 (Олег) выезд в восемь',
    )

    // Мест не указали — «ноль из нуля» не пишем, а говорим «едем все вместе».
    expect(legCard(wrapper, '2')!.find('[data-test="transfer-leg-summary"]').text()).toBe(
      'едем все вместе',
    )
    // Пустая карточка — «без участников», а не «пока никого — вещи поедут без людей».
    expect(legCard(wrapper, '3')!.find('[data-test="transfer-leg-summary"]').text()).toBe(
      'без участников',
    )

    // Оплата живёт внутри плашки.
    const compensation = first.find('[data-test="transfer-leg-compensation"]').text()
    expect(compensation).toContain('Общий расход')
    expect(compensation).toContain('₽')
    expect(compensation).toContain('туда-обратно')
  })

  it('плашка сворачивается до шапки', async () => {
    const wrapper = await mountTransfer()
    const card = legCard(wrapper, '1')!

    expect(card.find('[data-test="transfer-passengers"]').exists()).toBe(true)

    await card.find('[data-test="transfer-collapse-1"]').trigger('click')

    // Подробности спрятаны, а «что, когда и куда» осталось.
    expect(legCard(wrapper, '1')!.find('[data-test="transfer-passengers"]').exists()).toBe(false)
    expect(legCard(wrapper, '1')!.find('[data-test="transfer-leg-mode"]').exists()).toBe(true)
    expect(legCard(wrapper, '1')!.find('[data-test="transfer-leg-compensation"]').exists()).toBe(
      false,
    )
  })

  it('«Добавить трансфер» открывает форму своей стороны', async () => {
    const wrapper = await mountTransfer()

    await wrapper.find('[data-test="transfer-add-back"]').trigger('click')

    expect(wrapper.find('[data-test="transfer-leg-dialog"]').text()).toContain('Обратно')
  })

  it('точки и время обязательны, и без них запроса нет', async () => {
    const wrapper = await mountTransfer()

    await wrapper.find('[data-test="transfer-add-there"]').trigger('click')
    await wrapper.find('[data-test="transfer-leg-save"]').trigger('click')

    expect(wrapper.find('[data-test="transfer-leg-error"]').text()).toContain('откуда и докуда')
    expect(mocks.createTransferLeg).not.toHaveBeenCalled()

    await wrapper.find('[data-test="transfer-from-input"]').setValue('Иркутск')
    await wrapper.find('[data-test="transfer-to-input"]').setValue('Витязь')
    await wrapper.find('[data-test="transfer-leg-save"]').trigger('click')

    expect(wrapper.find('[data-test="transfer-leg-error"]').text()).toContain('времени')
    expect(mocks.createTransferLeg).not.toHaveBeenCalled()
  })

  it('карточка уходит на сервер со стороной, временем и компенсацией', async () => {
    const wrapper = await mountTransfer()
    mocks.createTransferLeg.mockResolvedValue(makePlan())

    await wrapper.find('[data-test="transfer-add-there"]').trigger('click')
    await wrapper.find('[data-test="transfer-from-input"]').setValue('Иркутск')
    await wrapper.find('[data-test="transfer-to-input"]').setValue('Витязь')
    await wrapper.find('[data-test="transfer-departure-input"]').setValue('2027-05-05T09:00')
    await wrapper.find('[data-test="transfer-compensation-input"]').setValue('shared')
    await wrapper.find('[data-test="transfer-amount-input"]').setValue('1500')
    await wrapper.find('[data-test="transfer-round-trip-input"]').setValue(true)
    await wrapper.find('[data-test="transfer-seats-input"]').setValue('4')
    await wrapper.find('[data-test="transfer-leg-save"]').trigger('click')
    await flushPromises()

    expect(mocks.createTransferLeg).toHaveBeenCalledWith('1', {
      direction: 'there',
      chainId: null,
      mode: 'car',
      departsAt: new Date('2027-05-05T09:00').toISOString(),
      fromPlace: 'Иркутск',
      toPlace: 'Витязь',
      isOwnVehicle: false,
      ownerUserId: null,
      seats: 4,
      vehicleId: null,
      compensation: 'shared',
      compensationAmountRub: 1500,
      isRoundTrip: true,
      note: null,
    })
  })

  it('у рейса нет «нашего ТС», общих расходов и пары', async () => {
    const wrapper = await mountTransfer()

    await wrapper.find('[data-test="transfer-add-there"]').trigger('click')

    // У своего авто флаг есть, у рейса пропадает.
    expect(wrapper.find('[data-test="transfer-own-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="transfer-round-trip-input"]').exists()).toBe(true)

    await wrapper.find('[data-test="transfer-mode-input"]').setValue('helicopter')

    expect(wrapper.find('[data-test="transfer-own-input"]').exists()).toBe(false)

    // Билеты на рейс покупают раздельно в каждую сторону — пары нет.
    expect(wrapper.find('[data-test="transfer-round-trip-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="transfer-no-pair-hint"]').text()).toContain('раздельно')

    const options = wrapper
      .find('[data-test="transfer-compensation-input"]')
      .findAll('option')
      .map((option) => (option.element as HTMLOptionElement).value)
    expect(options).toEqual(['free', 'ticket'])
  })

  it('«туда-обратно» доступно при любой компенсации, но не на зеркале', async () => {
    const wrapper = await mountTransfer()

    await wrapper.find('[data-test="transfer-add-there"]').trigger('click')

    // По умолчанию «безвозмездно» — и флаг всё равно есть: билет
    // туда-обратно тоже бывает, дело не в виде компенсации.
    expect(wrapper.find('[data-test="transfer-compensation-input"]').element).toHaveProperty(
      'value',
      'free',
    )
    expect(wrapper.find('[data-test="transfer-round-trip-input"]').exists()).toBe(true)

    // У зеркала пары нет ни флага, ни своей оплаты: пара — одна поездка,
    // и деньги с флагом задаются на исходной карточке.
    const plan = makePlan()
    plan.legs[2]!.sourceLegId = '1'

    const mirror = await mountTransfer(plan)
    await mirror.find('[data-test="transfer-edit-3"]').trigger('click')

    expect(mirror.find('[data-test="transfer-round-trip-input"]').exists()).toBe(false)
    expect(mirror.find('[data-test="transfer-compensation-input"]').exists()).toBe(false)
    expect(mirror.find('[data-test="transfer-mirror-hint"]').text()).toContain('исходном')
  })

  it('без суммы компенсации карточку не сохранить', async () => {
    const wrapper = await mountTransfer()

    await wrapper.find('[data-test="transfer-add-there"]').trigger('click')
    await wrapper.find('[data-test="transfer-from-input"]').setValue('Иркутск')
    await wrapper.find('[data-test="transfer-to-input"]').setValue('Витязь')
    await wrapper.find('[data-test="transfer-departure-input"]').setValue('2027-05-05T09:00')
    await wrapper.find('[data-test="transfer-compensation-input"]').setValue('shared')
    await wrapper.find('[data-test="transfer-leg-save"]').trigger('click')

    expect(wrapper.find('[data-test="transfer-leg-error"]').text()).toContain('сумму')
    expect(mocks.createTransferLeg).not.toHaveBeenCalled()
  })

  it('этапы одной заброски собираются в блок с номерами', async () => {
    const plan = makePlan()
    const chain = '0191f0a0-0000-4000-8000-000000000001'

    plan.legs = [
      {
        ...plan.legs[0]!,
        id: 'a',
        chainId: chain,
        stage: 1,
        fromPlace: 'Иркутск',
        toPlace: 'Большое Голоустное',
      },
      {
        ...plan.legs[1]!,
        id: 'b',
        chainId: chain,
        stage: 2,
        fromPlace: 'Большое Голоустное',
        toPlace: 'Витязь',
      },
      { ...plan.legs[2]!, id: 'c', chainId: null, stage: null },
    ]

    const wrapper = await mountTransfer(plan)

    // Заброска живёт своей секцией, а не внутри «Туда».
    const stages = wrapper.find('[data-test="transfer-area-stages"]')
    expect(wrapper.find('[data-test="transfer-area-there"] [data-test="transfer-chain"]').exists()).toBe(false)
    expect(stages.findAll('[data-test="transfer-chain"]')).toHaveLength(1)

    const title = stages.find('[data-test="transfer-chain-title"]').text()
    expect(title).toContain('Заброска 1 · 2 этапа')
    expect(title).toContain('Иркутск → Витязь')

    // Номер этапа виден в шапке плашки.
    const numbers = stages
      .findAll('[data-test="transfer-leg-stage"]')
      .map((node) => node.text())
    expect(numbers[0]).toContain('этап 1')
    expect(numbers[1]).toContain('этап 2')
  })

  it('заброска может быть парой: этапы живут в одном блоке', async () => {
    const plan = makePlan()
    const chain = '0191f0a0-0000-4000-8000-000000000002'

    // Туда и обратно — одна заброска: этапы идут подряд по времени,
    // сторона у каждого своя, а блок один.
    plan.legs = [
      { ...plan.legs[0]!, id: 't1', chainId: chain, stage: 1, direction: 'there' },
      { ...plan.legs[1]!, id: 't2', chainId: chain, stage: 2, direction: 'there' },
      { ...plan.legs[2]!, id: 'b1', chainId: chain, stage: 3, direction: 'back' },
      { ...plan.legs[2]!, id: 'b2', chainId: chain, stage: 4, direction: 'back' },
    ]

    const wrapper = await mountTransfer(plan)
    const stages = wrapper.find('[data-test="transfer-area-stages"]')

    const title = stages.find('[data-test="transfer-chain-title"]').text()
    expect(title).toContain('Заброска 1 · 4 этапа')

    // Маршрут — до конечной «туда», а не «Иркутск → Иркутск».
    expect(title).toContain('Иркутск, автовокзал → Олхинское плато, Витязь')

    // Ни один этап не утёк в «Туда» или «Обратно».
    expect(wrapper.find('[data-test="transfer-area-there"] [data-test="transfer-leg"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="transfer-area-back"] [data-test="transfer-leg"]').exists()).toBe(false)
  })

  it('этап заброски заводят из её секции, цепочку выбирают там же', async () => {
    const plan = makePlan()
    plan.legs[0]!.chainId = '0191f0a0-0000-4000-8000-000000000001'
    plan.legs[0]!.stage = 1

    const wrapper = await mountTransfer(plan)
    mocks.createTransferLeg.mockResolvedValue(plan)

    await wrapper.find('[data-test="transfer-add-stages"]').trigger('click')

    const select = wrapper.find('[data-test="transfer-chain-input"]')
    expect(select.text()).toContain('Заброска 1 · 1 этап')

    await select.setValue('new')
    await wrapper.find('[data-test="transfer-from-input"]').setValue('Иркутск')
    await wrapper.find('[data-test="transfer-to-input"]').setValue('Витязь')
    await wrapper.find('[data-test="transfer-departure-input"]').setValue('2027-05-05T09:00')
    await wrapper.find('[data-test="transfer-leg-save"]').trigger('click')
    await flushPromises()

    // Новой заброске id придумывает клиент — отдельной ручки «создать» нет.
    expect(mocks.createTransferLeg).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ chainId: expect.stringMatching(/^[0-9a-f-]{36}$/) }),
    )
  })

  it('у обычного трансфера поля «Заброска» нет, а у этапа — есть', async () => {
    const wrapper = await mountTransfer()

    await wrapper.find('[data-test="transfer-add-there"]').trigger('click')
    expect(wrapper.find('[data-test="transfer-chain-input"]').exists()).toBe(false)

    await wrapper.find('[data-test="transfer-leg-cancel"]').trigger('click')
    await wrapper.find('[data-test="transfer-add-stages"]').trigger('click')

    expect(wrapper.find('[data-test="transfer-chain-input"]').exists()).toBe(true)
  })

  it('пустые секции объясняют, что это за место', async () => {
    const wrapper = await mountTransfer(makePlan({ legs: [] }))

    const there = wrapper.find('[data-test="transfer-area-there"]')
    const stages = wrapper.find('[data-test="transfer-area-stages"]')
    const back = wrapper.find('[data-test="transfer-area-back"]')

    expect(there.find('[data-test="transfer-empty"]').text()).toContain('к началу маршрута')
    expect(back.find('[data-test="transfer-empty"]').text()).toContain('до дома')
    expect(stages.find('[data-test="transfer-empty"]').text()).toBe(
      'Уазики, каюры и прочее бездорожье',
    )
    expect(stages.find('[data-test="transfer-add-stages"]').text()).toBe(
      'Добавить этап заброски',
    )
  })

  it('внизу секции видны нераспределённые участники', async () => {
    const wrapper = await mountTransfer()
    const back = wrapper.find('[data-test="transfer-area-back"]')

    // В «Обратно» никого нет — там не распределён весь состав.
    const unassigned = back.find('[data-test="transfer-unassigned"]').text()
    expect(unassigned).toContain('Не распределены')
    expect(unassigned).toContain('Анна')
    expect(unassigned).toContain('Пётр')
  })

  it('владелец принимает заявку и отклоняет её', async () => {
    const wrapper = await mountTransfer()
    const card = legCard(wrapper, '1')!

    expect(card.find('[data-test="transfer-requests"]').text()).toContain('Просятся')

    mocks.acceptTransferPassenger.mockResolvedValue(makePlan())
    await card.find(`[data-test="transfer-accept-1-${ANNA}"]`).trigger('click')
    await flushPromises()

    expect(mocks.acceptTransferPassenger).toHaveBeenCalledWith('1', '1', ANNA)

    mocks.removeTransferPassenger.mockResolvedValue(makePlan())
    await card.find(`[data-test="transfer-reject-1-${ANNA}"]`).trigger('click')
    await flushPromises()

    expect(mocks.removeTransferPassenger).toHaveBeenCalledWith('1', '1', ANNA)
  })

  it('на рейс присоединяются сразу, на чужое ТС — просятся', async () => {
    const plan = makePlan({ canEdit: false })
    plan.legs[0]!.canEdit = false
    plan.legs[0]!.joinStatus = 'requested'
    plan.legs[1]!.canEdit = false
    plan.legs[1]!.joinStatus = 'accepted'

    const wrapper = await mountTransfer(plan)

    const own = legCard(wrapper, '1')!
    const bus = legCard(wrapper, '2')!

    expect(own.find('[data-test="transfer-join-1"]').text()).toBe('Попроситься')
    expect(bus.find('[data-test="transfer-join-2"]').text()).toBe('Присоединиться')

    mocks.joinTransferLeg.mockResolvedValue(plan)
    await own.find('[data-test="transfer-join-1"]').trigger('click')
    await flushPromises()

    expect(mocks.joinTransferLeg).toHaveBeenCalledWith('1', '1')
  })

  it('свою заявку и свою поездку человек отменяет сам', async () => {
    const plan = makePlan({ canEdit: false })
    plan.legs[0]!.canEdit = false
    plan.legs[0]!.passengers = [
      { userId: ME, displayName: 'Олег', status: 'requested' },
      { userId: ANNA, displayName: 'Анна', status: 'accepted' },
    ]

    const wrapper = await mountTransfer(plan)
    const card = legCard(wrapper, '1')!

    // Свой крестик есть, чужого нет: без права вкладки убирают только себя.
    expect(card.find(`[data-test="transfer-leave-1-${ME}"]`).exists()).toBe(true)
    expect(card.find(`[data-test="transfer-leave-1-${ANNA}"]`).exists()).toBe(false)

    mocks.removeTransferPassenger.mockResolvedValue(plan)
    await card.find(`[data-test="transfer-leave-1-${ME}"]`).trigger('click')
    await flushPromises()

    expect(mocks.removeTransferPassenger).toHaveBeenCalledWith('1', '1', ME)
  })

  it('без права на вкладку чужие карточки не правятся, но добавить можно', async () => {
    const plan = makePlan({ canEdit: false })
    plan.legs.forEach((leg) => (leg.canEdit = false))

    const wrapper = await mountTransfer(plan)

    expect(wrapper.find('[data-test="transfer-edit-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="transfer-delete-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="transfer-add-passenger-1"]').exists()).toBe(false)

    // Завести свою карточку может любой участник — кнопки на месте.
    expect(wrapper.find('[data-test="transfer-add-there"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="transfer-add-back"]').exists()).toBe(true)
  })

  it('правка своей карточки идёт в PATCH с её id', async () => {
    const wrapper = await mountTransfer()
    mocks.updateTransferLeg.mockResolvedValue(makePlan())

    await wrapper.find('[data-test="transfer-edit-1"]').trigger('click')

    expect(wrapper.find('[data-test="transfer-own-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="transfer-from-input"]').element).toHaveProperty(
      'value',
      'Иркутск, автовокзал',
    )

    await wrapper.find('[data-test="transfer-seats-input"]').setValue('3')
    await wrapper.find('[data-test="transfer-leg-save"]').trigger('click')
    await flushPromises()

    expect(mocks.updateTransferLeg).toHaveBeenCalledWith(
      '1',
      '1',
      expect.objectContaining({ seats: 3, direction: 'there', mode: 'car' }),
    )
  })

  it('карточку можно посадить человека, а удаление спрашивает подтверждение', async () => {
    const wrapper = await mountTransfer()

    mocks.addTransferPassenger.mockResolvedValue(makePlan())
    await wrapper.find('[data-test="transfer-add-passenger-1"]').setValue(PETR)
    await flushPromises()

    expect(mocks.addTransferPassenger).toHaveBeenCalledWith('1', '1', PETR)

    mocks.removeTransferLeg.mockResolvedValue(makePlan())

    // Первый клик только спрашивает.
    await wrapper.find('[data-test="transfer-delete-2"]').trigger('click')
    expect(mocks.removeTransferLeg).not.toHaveBeenCalled()

    // «Нет» возвращает кнопку.
    await wrapper.find('[data-test="transfer-delete-cancel-2"]').trigger('click')
    expect(wrapper.find('[data-test="transfer-delete-2"]').exists()).toBe(true)

    // «Да» удаляет.
    await wrapper.find('[data-test="transfer-delete-2"]').trigger('click')
    await wrapper.find('[data-test="transfer-delete-confirm-2"]').trigger('click')
    await flushPromises()

    expect(mocks.removeTransferLeg).toHaveBeenCalledWith('1', '2')
  })

  it('технику выбирают из каталога, а не заполняют поля заново', async () => {
    const niva: Vehicle = {
      id: '7',
      kind: 'car',
      brand: 'Нива',
      seats: 4,
      plate: 'А123ВС38',
      createdAt: '2026-10-01T10:00:00.000Z',
    }

    const wrapper = await mountTransfer(makePlan(), [niva])

    expect(mocks.fetchVehicles).toHaveBeenCalled()

    await wrapper.find('[data-test="transfer-add-there"]').trigger('click')

    // Каталог виден в выборе: «Нива · Автомобиль · А123ВС38 · 4 мест».
    expect(wrapper.find('[data-test="transfer-vehicle-input"]').text()).toContain('Нива')

    // Пока транспорт не выбран, тип и места вводятся руками.
    expect(wrapper.find('[data-test="transfer-mode-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="transfer-seats-input"]').exists()).toBe(true)

    await wrapper.find('[data-test="transfer-vehicle-input"]').setValue('7')

    // Выбрали из каталога — тип и места приходят оттуда.
    expect(wrapper.find('[data-test="transfer-mode-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="transfer-seats-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="transfer-vehicle-applied"]').text()).toContain('4 мест')

    mocks.createTransferLeg.mockResolvedValue(makePlan())
    await wrapper.find('[data-test="transfer-from-input"]').setValue('Иркутск')
    await wrapper.find('[data-test="transfer-to-input"]').setValue('Витязь')
    await wrapper.find('[data-test="transfer-departure-input"]').setValue('2027-05-05T09:00')
    await wrapper.find('[data-test="transfer-leg-save"]').trigger('click')
    await flushPromises()

    expect(mocks.createTransferLeg).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({
        vehicleId: 7,
        mode: 'car',
        seats: 4,
        isOwnVehicle: true,
        ownerUserId: ME,
      }),
    )
  })

  it('велосипед в «Трансфере» не выбирают', async () => {
    const bike: Vehicle = {
      id: '8',
      kind: 'bicycle',
      brand: 'Стелс',
      seats: null,
      plate: null,
      createdAt: '2026-10-01T10:00:00.000Z',
    }

    const wrapper = await mountTransfer(makePlan(), [bike])

    await wrapper.find('[data-test="transfer-add-there"]').trigger('click')

    // В каталоге он есть, а в выборе карточки — нет: группу он не возит.
    expect(wrapper.find('[data-test="transfer-vehicle-input"]').text()).not.toContain('Стелс')
  })

  it('транспорт можно завести прямо в карточке', async () => {
    const wrapper = await mountTransfer()

    await wrapper.find('[data-test="transfer-add-there"]').trigger('click')
    await wrapper.find('[data-test="transfer-vehicle-new"]').trigger('click')

    expect(wrapper.find('[data-test="vehicle-form"]').exists()).toBe(true)

    mocks.createVehicle.mockResolvedValue({
      id: '9',
      kind: 'atv',
      brand: 'Квадрик',
      seats: 2,
      plate: null,
      createdAt: '2026-10-01T10:00:00.000Z',
    })

    await wrapper.find('[data-test="vehicle-brand-input"]').setValue('Квадрик')
    await wrapper.find('[data-test="vehicle-kind-input"]').setValue('atv')
    await wrapper.find('[data-test="vehicle-seats-input"]').setValue('2')
    await wrapper.find('[data-test="vehicle-save"]').trigger('click')
    await flushPromises()

    expect(mocks.createVehicle).toHaveBeenCalledWith({
      kind: 'atv',
      brand: 'Квадрик',
      seats: 2,
      plate: null,
    })

    // Новый транспорт сразу выбран в карточке — и тип уже его.
    expect(wrapper.find('[data-test="transfer-vehicle-applied"]').text()).toContain('Квадроцикл')
    expect(wrapper.find('[data-test="vehicle-form"]').exists()).toBe(false)
  })

  it('отказ сервера показывается словами', async () => {
    const wrapper = await mountTransfer()
    mocks.removeTransferLeg.mockRejectedValue(new Error('сеть'))

    await wrapper.find('[data-test="transfer-delete-1"]').trigger('click')
    await wrapper.find('[data-test="transfer-delete-confirm-1"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="transfer-action-error"]').text()).toContain('попробуйте')
  })

  it('чат трансфера — часть вкладки', async () => {
    const wrapper = await mountTransfer()

    expect(mocks.listTripMessages).toHaveBeenCalledWith('1', 'trip_transfer')
    expect(wrapper.find('[data-test="trip-chat"]').exists()).toBe(true)
  })
})
