import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { User } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import type { Trip, TripTransfer, Vehicle } from '@/types/trips'
import TripTransferView from '@/views/trips/TripTransfer.vue'

/**
 * Вкладка «Трансфер» второй редакции (27.10.2026).
 *
 * Проверяется то, ради чего экран переделан: две области «Туда» и
 * «Обратно» со своими кнопками, карточка-плашка со сворачиванием, флаг
 * «наше ТС» только у права вкладки, компенсации по способу доставки,
 * заявка на чужое ТС и самовольный уход из карточки.
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

    expect(there.text()).toContain('Туда · 2')
    expect(back.text()).toContain('Обратно · 1')

    // Карточки первой стороны — в первой области, обратная — во второй.
    expect(there.findAll('[data-test="transfer-leg"]')).toHaveLength(2)
    expect(back.findAll('[data-test="transfer-leg"]')).toHaveLength(1)
    expect(back.text()).toContain('Аэролодка')

    // В шапке карточки: способ, время, точки, счёт и компенсация.
    const first = legCard(wrapper, '1')!
    expect(first.find('[data-test="transfer-leg-mode"]').text()).toContain('Авто')
    expect(first.find('[data-test="transfer-leg-places"]').text()).toContain(
      'Иркутск, автовокзал → Олхинское плато, Витязь',
    )
    expect(first.find('[data-test="transfer-leg-own"]').text()).toContain('Наше ТС')
    expect(first.find('[data-test="transfer-leg-seats"]').text()).toBe('1 из 4')
    // Сумма форматируется с неразрывным пробелом, поэтому проверяем части.
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

  it('у рейса нет «нашего ТС» и общих расходов — только билет', async () => {
    const wrapper = await mountTransfer()

    await wrapper.find('[data-test="transfer-add-there"]').trigger('click')

    // У своего авто флаг есть, у рейса пропадает.
    expect(wrapper.find('[data-test="transfer-own-input"]').exists()).toBe(true)

    await wrapper.find('[data-test="transfer-mode-input"]').setValue('helicopter')

    expect(wrapper.find('[data-test="transfer-own-input"]').exists()).toBe(false)

    const options = wrapper
      .find('[data-test="transfer-compensation-input"]')
      .findAll('option')
      .map((option) => (option.element as HTMLOptionElement).value)
    expect(options).toEqual(['free', 'ticket'])
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
    expect(wrapper.find('[data-test="transfer-remove-1"]').exists()).toBe(false)
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

  it('карточку можно убрать и посадить в неё человека', async () => {
    const wrapper = await mountTransfer()

    mocks.addTransferPassenger.mockResolvedValue(makePlan())
    await wrapper.find('[data-test="transfer-add-passenger-1"]').setValue(PETR)
    await flushPromises()

    expect(mocks.addTransferPassenger).toHaveBeenCalledWith('1', '1', PETR)

    mocks.removeTransferLeg.mockResolvedValue(makePlan())
    await wrapper.find('[data-test="transfer-remove-2"]').trigger('click')
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

    // Каталог виден в выборе: «Нива · Авто · 4 мест».
    expect(wrapper.find('[data-test="transfer-vehicle-input"]').text()).toContain('Нива')

    // Пока транспорт не выбран, способ и места вводятся руками.
    expect(wrapper.find('[data-test="transfer-mode-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="transfer-seats-input"]').exists()).toBe(true)

    await wrapper.find('[data-test="transfer-vehicle-input"]').setValue('7')

    // Выбрали из каталога — способ и места приходят оттуда.
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

    // Новый транспорт сразу выбран в карточке — и способ уже его.
    expect(wrapper.find('[data-test="transfer-vehicle-applied"]').text()).toContain('Квадроцикл')
    expect(wrapper.find('[data-test="vehicle-form"]').exists()).toBe(false)
  })

  it('отказ сервера показывается словами', async () => {
    const wrapper = await mountTransfer()
    mocks.removeTransferLeg.mockRejectedValue(new Error('сеть'))

    await wrapper.find('[data-test="transfer-remove-1"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="transfer-action-error"]').text()).toContain('попробуйте')
  })

  it('чат трансфера — часть вкладки', async () => {
    const wrapper = await mountTransfer()

    expect(mocks.listTripMessages).toHaveBeenCalledWith('1', 'trip_transfer')
    expect(wrapper.find('[data-test="trip-chat"]').exists()).toBe(true)
  })
})
