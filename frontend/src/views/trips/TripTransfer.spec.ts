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
        isStage: false,
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
        isStage: false,
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
        isStage: false,
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

async function mountTransfer(
  plan: TripTransfer = makePlan(),
  vehicles: Vehicle[] = [],
  trip: Trip = TRIP,
) {
  mocks.fetchTripTransfer.mockResolvedValue(plan)
  mocks.fetchVehicles.mockResolvedValue(vehicles)
  mocks.listTripMessages.mockResolvedValue({ messages: [], hasMore: false })

  const wrapper = mount(TripTransferView, { props: { trip } })
  await flushPromises()

  return wrapper
}

/**
 * Выбрать время в своей модалке: день 5 текущего месяца, 09:00, «ОК».
 *
 * Встроенного `input[type=datetime-local]` больше нет — заказчик просил
 * календарь с кнопкой «ОК», поэтому значение приходит из модалки.
 */
/** Время, которое выбираем в модалке: внутри окон похода и рейсов. */
const PICKED_AT = new Date(2026, 10, 7, 9, 0)

const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

/**
 * Открыть модалку времени на нужном месяце.
 *
 * Встроенного `input[type=datetime-local]` больше нет — заказчик просил
 * календарь с кнопкой «ОК», поэтому значение приходит из модалки.
 */
async function openMonth(
  wrapper: Awaited<ReturnType<typeof mountTransfer>>,
  at: Date,
) {
  await wrapper.find('[data-test="transfer-departure-input"]').trigger('click')

  // Календарь открывается на текущем месяце, листаем вперёд до нужного.
  const title = `${MONTH_NAMES[at.getMonth()]} ${at.getFullYear()}`
  for (let step = 0; step < 36; step += 1) {
    if (wrapper.find('#datetime-picker-title').text() === title) break
    await wrapper.find('[data-test="datetime-next"]').trigger('click')
  }
}

/** Выбрать время в своей модалке: нужный месяц, день, 09:00, «ОК». */
async function pickDeparture(
  wrapper: Awaited<ReturnType<typeof mountTransfer>>,
  at: Date = PICKED_AT,
) {
  await openMonth(wrapper, at)

  await wrapper.find(`[data-test="datetime-day-${at.getDate()}"]`).trigger('click')
  await wrapper.find('[data-test="datetime-hours"]').setValue(String(at.getHours()))
  await wrapper.find('[data-test="datetime-minutes"]').setValue(String(at.getMinutes()))
  await wrapper.find('[data-test="datetime-ok"]').trigger('click')

  return at.toISOString()
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

    // Мест не указали — «0 из 0» не пишем, но и «все вместе» не говорим:
    // в автобусе едет один Пётр из трёх участников.
    expect(legCard(wrapper, '2')!.find('[data-test="transfer-leg-summary"]').text()).toBe(
      'едет 1 (Пётр)',
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

  it('«едем все вместе» — только когда едут все участники', async () => {
    // В автобусе один Пётр из трёх: «все вместе» было бы неправдой.
    const partial = await mountTransfer(makePlan())
    expect(
      legCard(partial, '2')!.find('[data-test="transfer-leg-summary"]').text(),
    ).toBe('едет 1 (Пётр)')

    // Посадили всех — теперь это действительно весь состав.
    const all = makePlan()
    all.legs[1]!.passengers = [
      { userId: ME, displayName: 'Олег', status: 'accepted' },
      { userId: ANNA, displayName: 'Анна', status: 'accepted' },
      { userId: PETR, displayName: 'Пётр', status: 'accepted' },
    ]

    const together = await mountTransfer(all)
    expect(
      legCard(together, '2')!.find('[data-test="transfer-leg-summary"]').text(),
    ).toBe('едем все вместе')
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

    expect(wrapper.find('[data-test="transfer-leg-error"]').text()).toContain(
      'Время отправления – обязательное поле',
    )
    expect(mocks.createTransferLeg).not.toHaveBeenCalled()
  })

  it('карточка уходит на сервер со стороной, временем и компенсацией', async () => {
    const wrapper = await mountTransfer()
    mocks.createTransferLeg.mockResolvedValue(makePlan())

    await wrapper.find('[data-test="transfer-add-there"]').trigger('click')
    await wrapper.find('[data-test="transfer-from-input"]').setValue('Иркутск')
    await wrapper.find('[data-test="transfer-to-input"]').setValue('Витязь')
    const departsAt = await pickDeparture(wrapper)
    await wrapper.find('[data-test="transfer-compensation-input"]').setValue('shared')
    await wrapper.find('[data-test="transfer-amount-input"]').setValue('1500')
    await wrapper.find('[data-test="transfer-round-trip-input"]').setValue(true)
    await wrapper.find('[data-test="transfer-seats-input"]').setValue('4')
    await wrapper.find('[data-test="transfer-leg-save"]').trigger('click')
    await flushPromises()

    expect(mocks.createTransferLeg).toHaveBeenCalledWith('1', {
      direction: 'there',
      isStage: false,
      mode: 'car',
      departsAt,
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

    // У рейса пара тоже бывает: «вернёмся тем же поездом» — это план.
    expect(wrapper.find('[data-test="transfer-round-trip-input"]').exists()).toBe(true)

    // А оплата по умолчанию — цена билета: бензин тут ни при чём.
    expect(wrapper.find('[data-test="transfer-compensation-input"]').element).toHaveProperty(
      'value',
      'ticket',
    )

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

    // У зеркала рейса (у общественного билеты на обоих концах) оплата есть,
    // а флага «туда-обратно» всё равно нет.
    const trainPlan = makePlan()
    trainPlan.legs[2]!.mode = 'train'
    trainPlan.legs[2]!.compensation = 'ticket'
    trainPlan.legs[2]!.sourceLegId = '1'

    const train = await mountTransfer(trainPlan)
    await train.find('[data-test="transfer-edit-3"]').trigger('click')

    expect(train.find('[data-test="transfer-compensation-input"]').exists()).toBe(true)
    expect(train.find('[data-test="transfer-round-trip-input"]').exists()).toBe(false)
  })

  it('без суммы компенсации карточку не сохранить', async () => {
    const wrapper = await mountTransfer()

    await wrapper.find('[data-test="transfer-add-there"]').trigger('click')
    await wrapper.find('[data-test="transfer-from-input"]').setValue('Иркутск')
    await wrapper.find('[data-test="transfer-to-input"]').setValue('Витязь')
    await pickDeparture(wrapper)
    await wrapper.find('[data-test="transfer-compensation-input"]').setValue('shared')
    await wrapper.find('[data-test="transfer-leg-save"]').trigger('click')

    expect(wrapper.find('[data-test="transfer-leg-error"]').text()).toContain('сумму')
    expect(mocks.createTransferLeg).not.toHaveBeenCalled()
  })

  it('этап — это рейс, и он живёт в секции «Заброска»', async () => {
    const plan = makePlan()

    plan.legs = [
      { ...plan.legs[0]!, id: 'a', isStage: true, mode: 'horses' },
      { ...plan.legs[1]!, id: 'b', isStage: true, mode: 'boat' },
      { ...plan.legs[2]!, id: 'c', isStage: false },
    ]

    const wrapper = await mountTransfer(plan)

    // В «Туда» не осталось ни одного: оба этапа ушли в свою секцию.
    expect(
      wrapper.findAll('[data-test="transfer-area-there"] [data-test="transfer-leg"]'),
    ).toHaveLength(0)

    const stages = wrapper.find('[data-test="transfer-area-stages"]')
    expect(stages.findAll('[data-test="transfer-leg"]')).toHaveLength(2)

    // Групп и номеров нет: каждый этап — отдельная плашка.
    expect(stages.find('[data-test="transfer-chain-title"]').exists()).toBe(false)
  })

  it('этап заводят из секции заброски и он уходит с флагом isStage', async () => {
    const plan = makePlan()

    const wrapper = await mountTransfer(plan)
    mocks.createTransferLeg.mockResolvedValue(plan)

    await wrapper.find('[data-test="transfer-add-stages"]').trigger('click')

    expect(wrapper.find('[data-test="transfer-leg-dialog"]').text()).toContain(
      'Новый этап заброски',
    )

    await wrapper.find('[data-test="transfer-from-input"]').setValue('Иркутск')
    await wrapper.find('[data-test="transfer-to-input"]').setValue('Витязь')
    await pickDeparture(wrapper)
    await wrapper.find('[data-test="transfer-leg-save"]').trigger('click')
    await flushPromises()

    expect(mocks.createTransferLeg).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ isStage: true }),
    )
  })

  it('у обычного рейса этап не включается, у этапа — не выключается', async () => {
    const wrapper = await mountTransfer()

    await wrapper.find('[data-test="transfer-add-there"]').trigger('click')
    await wrapper.find('[data-test="transfer-from-input"]').setValue('Иркутск')
    await wrapper.find('[data-test="transfer-to-input"]').setValue('Витязь')
    await pickDeparture(wrapper)

    mocks.createTransferLeg.mockResolvedValue(makePlan())
    await wrapper.find('[data-test="transfer-leg-save"]').trigger('click')
    await flushPromises()

    expect(mocks.createTransferLeg).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ isStage: false }),
    )
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

  it('на борт берут свободного, а удаление спрашивает подтверждение', async () => {
    const wrapper = await mountTransfer()

    mocks.addTransferPassenger.mockResolvedValue(makePlan())
    await wrapper.find('[data-test="transfer-add-passenger-2"]').setValue(ANNA)
    await flushPromises()

    expect(mocks.addTransferPassenger).toHaveBeenCalledWith('1', '2', ANNA)

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

  it('«взять на борт» предлагает только свободных в эту сторону', async () => {
    const wrapper = await mountTransfer()

    const options = (id: string) => {
      const select = wrapper.find(`[data-test="transfer-add-passenger-${id}"]`)

      return {
        exists: select.exists(),
        text: select.exists() ? select.text() : '',
        values: select.exists()
          ? select.findAll('option').map((option) => (option.element as HTMLOptionElement).value)
          : [],
      }
    }

    // В «Туда» свободных нет: Олег едет своей машиной, Пётр — автобусом,
    // а Анна просится. Поля «взять на борт» на исходной паре и на автобусе
    // тоже нет — Пётр уже в автобусе, а Олег в своей машине.
    expect(options('1').exists).toBe(false)
    expect(options('2').values).toEqual(['', ANNA])
    expect(options('2').text).toContain('взять на борт')

    // В «Обратно» пока никто не едет — свободны все.
    expect(options('3').values).toEqual(['', ME, ANNA, PETR])
  })

  it('сел — ушёл из списков, потерял ТС — вернулся', async () => {
    const plan = makePlan()
    // Вторая обратная карточка нужна, чтобы видеть перестройку соседнего списка.
    plan.legs.push({ ...plan.legs[2]!, id: '4', position: 2 })

    const wrapper = await mountTransfer(plan)

    const options = (id: string) =>
      wrapper
        .find(`[data-test="transfer-add-passenger-${id}"]`)
        .findAll('option')
        .map((option) => (option.element as HTMLOptionElement).value)

    expect(options('4')).toContain(ME)

    const after = makePlan()
    after.legs.push({ ...after.legs[2]!, id: '4', position: 2 })
    after.legs[2]!.passengers = [{ userId: ME, displayName: 'Олег', status: 'accepted' }]
    after.legs[2]!.occupied = 1

    mocks.addTransferPassenger.mockResolvedValue(after)
    await wrapper.find('[data-test="transfer-add-passenger-3"]').setValue(ME)
    await flushPromises()

    // Олег уже едет обратно — второй раз его не предлагают.
    expect(options('4')).not.toContain(ME)

    // Сошёл с рейса — снова свободен и вернулся в список.
    mocks.removeTransferPassenger.mockResolvedValue(plan)
    await wrapper.find(`[data-test="transfer-leave-3-${ME}"]`).trigger('click')
    await flushPromises()

    expect(options('4')).toContain(ME)
  })

  it('в списке владельцев ТС нет уже посаженных в эту сторону', async () => {
    const wrapper = await mountTransfer()

    await wrapper.find('[data-test="transfer-add-there"]').trigger('click')
    await wrapper.find('[data-test="transfer-own-input"]').setValue(true)

    const owner = wrapper.find('[data-test="transfer-owner-input"]')
    const values = owner
      .findAll('option')
      .map((option) => (option.element as HTMLOptionElement).value)

    // Олег едет «туда» своей машиной, Пётр — автобусом; владельцем нового
    // рейса может быть только Анна, которая ещё не едет.
    expect(values).toEqual([ANNA])
  })

  it('флаг «туда-обратно» есть только у рейса «Туда»', async () => {
    const wrapper = await mountTransfer()

    await wrapper.find('[data-test="transfer-add-there"]').trigger('click')
    expect(wrapper.find('[data-test="transfer-round-trip-input"]').exists()).toBe(true)
    await wrapper.find('[data-test="transfer-leg-cancel"]').trigger('click')

    await wrapper.find('[data-test="transfer-add-back"]').trigger('click')
    expect(wrapper.find('[data-test="transfer-round-trip-input"]').exists()).toBe(false)

    // Старая обратная карточка с флагом: в форме его нет, а при сохранении
    // уходит false — правка не блокируется, флаг снимается.
    const legacy = makePlan()
    legacy.legs[2]!.isRoundTrip = true

    const stale = await mountTransfer(legacy)
    await stale.find('[data-test="transfer-edit-3"]').trigger('click')
    expect(stale.find('[data-test="transfer-round-trip-input"]').exists()).toBe(false)

    mocks.updateTransferLeg.mockResolvedValue(legacy)
    await stale.find('[data-test="transfer-leg-save"]').trigger('click')
    await flushPromises()

    expect(mocks.updateTransferLeg).toHaveBeenCalledWith(
      '1',
      '3',
      expect.objectContaining({ direction: 'back', isRoundTrip: false }),
    )
  })

  it('заброску без участников ограничивают только даты похода', async () => {
    const trip: Trip = {
      ...TRIP,
      startsAt: new Date(2026, 10, 5, 0, 0).toISOString(),
      endsAt: new Date(2026, 10, 12, 0, 0).toISOString(),
    }

    const wrapper = await mountTransfer(makePlan(), [], trip)

    await wrapper.find('[data-test="transfer-add-stages"]').trigger('click')
    await openMonth(wrapper, new Date(2026, 10, 11))

    // 11 ноября — уже после последнего обратного рейса (9-го), но внутри
    // похода: раньше сервер и календарь её не пускали, а вещи вывозить можно.
    expect(
      wrapper.find('[data-test="datetime-day-11"]').attributes('disabled'),
    ).toBeUndefined()

    // За рамками похода календарь по-прежнему не пускает.
    expect(wrapper.find('[data-test="datetime-day-13"]').attributes('disabled')).toBeDefined()
  })

  it('отказ сервера на сохранении виден в модалке, а не под ней', async () => {
    const wrapper = await mountTransfer()

    await wrapper.find('[data-test="transfer-add-there"]').trigger('click')
    await wrapper.find('[data-test="transfer-from-input"]').setValue('Иркутск')
    await wrapper.find('[data-test="transfer-to-input"]').setValue('Витязь')
    await pickDeparture(wrapper)

    mocks.createTransferLeg.mockRejectedValue(new Error('сеть'))
    await wrapper.find('[data-test="transfer-leg-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="transfer-leg-dialog"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="transfer-leg-error"]').text()).toContain('попробуйте')
    expect(wrapper.find('[data-test="transfer-action-error"]').exists()).toBe(false)
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
    await pickDeparture(wrapper)
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
