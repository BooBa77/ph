import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { User } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import type { Trip, TripTransfer } from '@/types/trips'
import TripTransferView from '@/views/trips/TripTransfer.vue'

/**
 * Вкладка «Трансфер» на настоящем API (моки — только HTTP).
 *
 * Проверяется то, ради чего экран существует: места считаются вместе
 * с водителем (числа приходят с бэкенда), «без машины» — это `carId: null`,
 * «вернуться так же» уходит в свою ручку, права берутся из ответа
 * (`plan.canEdit`, `car.canEdit`), а снять себя из машины человек может
 * всегда — это и есть «пассажир может отказаться».
 */
const mocks = vi.hoisted(() => ({
  fetchTripTransfer: vi.fn(),
  createTransferLeg: vi.fn(),
  updateTransferLeg: vi.fn(),
  removeTransferLeg: vi.fn(),
  returnTransferLeg: vi.fn(),
  addTransferPassenger: vi.fn(),
  seatTransferPassenger: vi.fn(),
  removeTransferPassenger: vi.fn(),
  createTransferCar: vi.fn(),
  updateTransferCar: vi.fn(),
  removeTransferCar: vi.fn(),
  listTripMessages: vi.fn(),
  sendTripMessage: vi.fn(),
}))

vi.mock('@/api/trips', () => ({
  fetchTripTransfer: mocks.fetchTripTransfer,
  createTransferLeg: mocks.createTransferLeg,
  updateTransferLeg: mocks.updateTransferLeg,
  removeTransferLeg: mocks.removeTransferLeg,
  returnTransferLeg: mocks.returnTransferLeg,
  addTransferPassenger: mocks.addTransferPassenger,
  seatTransferPassenger: mocks.seatTransferPassenger,
  removeTransferPassenger: mocks.removeTransferPassenger,
  createTransferCar: mocks.createTransferCar,
  updateTransferCar: mocks.updateTransferCar,
  removeTransferCar: mocks.removeTransferCar,
  listTripMessages: mocks.listTripMessages,
  sendTripMessage: mocks.sendTripMessage,
}))

const ME = 'demo-me'

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
  organizerUserId: 'demo-anna',
  goalObjectId: '10',
  goalObject: { id: '10', name: 'Витязь', type: 'скальник', url: null },
  announcement: null,
  routeText: '',
  requirementsText: null,
  meetingPlace: null,
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

/**
 * Вкладка, какой её отдаёт бэкенд: две строки, своя и наёмная машины,
 * Марина «без машины». Права — как в жизни: смотрящий организатор
 * (`canEdit: true`), своя машина правится, наёмная — нет.
 */
function makePlan(overrides: Partial<TripTransfer> = {}): TripTransfer {
  const plan: TripTransfer = {
    meetingPlace: null,
    canEdit: true,
    travelers: [
      { userId: ME, displayName: 'Олег' },
      { userId: 'demo-anna', displayName: 'Анна' },
      { userId: 'demo-petr', displayName: 'Пётр' },
      { userId: 'demo-marina', displayName: 'Марина' },
    ],
    legs: [
      {
        id: '1',
        position: 1,
        departsAt: new Date(2026, 10, 7, 8, 0).toISOString(),
        fromPlace: 'Иркутск, автовокзал',
        toPlace: 'Олхинское плато, Витязь',
        mode: 'car',
        note: null,
        cars: [
          {
            id: '11',
            ownership: 'own',
            driverUserId: ME,
            driverName: 'Олег',
            driverPhone: null,
            seats: 5,
            occupied: 2,
            canEdit: true,
          },
          {
            id: '12',
            ownership: 'hired',
            driverUserId: null,
            driverName: 'Сергей',
            driverPhone: '+7 902 111-22-33',
            seats: 4,
            occupied: 3,
            canEdit: false,
          },
        ],
        passengers: [
          { userId: ME, displayName: 'Олег', carId: '11' },
          { userId: 'demo-anna', displayName: 'Анна', carId: '11' },
          { userId: 'demo-petr', displayName: 'Пётр', carId: '12' },
          { userId: 'demo-marina', displayName: 'Марина', carId: null },
        ],
      },
      {
        id: '2',
        position: 2,
        departsAt: new Date(2026, 10, 9, 18, 0).toISOString(),
        fromPlace: 'Олхинское плато, Витязь',
        toPlace: 'Иркутск, автовокзал',
        mode: 'bus',
        note: null,
        cars: [],
        passengers: [
          { userId: ME, displayName: 'Олег', carId: null },
          { userId: 'demo-anna', displayName: 'Анна', carId: null },
          { userId: 'demo-petr', displayName: 'Пётр', carId: null },
          { userId: 'demo-marina', displayName: 'Марина', carId: null },
        ],
      },
    ],
    ...overrides,
  }

  /**
   * `car.canEdit` — это ровно то, что считает бэкенд: право на вкладку
   * открывает все машины, а без него — только свою. Выводим флаг из плана,
   * чтобы фикстура не врала о правах.
   */
  for (const car of plan.legs.flatMap((leg) => leg.cars)) {
    car.canEdit = plan.canEdit || car.driverUserId === ME
  }

  return plan
}

async function mountTransfer(plan: TripTransfer = makePlan()) {
  mocks.fetchTripTransfer.mockResolvedValue(plan)
  mocks.listTripMessages.mockResolvedValue({ messages: [], hasMore: false })

  const wrapper = mount(TripTransferView, {
    props: { trip: TRIP },
  })
  await flushPromises()

  return wrapper
}

describe('TripTransfer', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
    useAuthStore().setAuth(makeUser(), 'token')
    vi.clearAllMocks()
  })

  it('показывает строки заброски, машины и состав', async () => {
    const wrapper = await mountTransfer()

    expect(mocks.fetchTripTransfer).toHaveBeenCalledWith('1')
    expect(wrapper.findAll('[data-test="transfer-leg"]')).toHaveLength(2)

    const legs = wrapper.findAll('[data-test="transfer-leg"]')
    expect(legs[0]?.find('[data-test="transfer-leg-mode"]').text()).toContain('Авто')
    expect(legs[0]?.find('[data-test="transfer-leg-places"]').text()).toContain(
      'Иркутск, автовокзал → Олхинское плато, Витязь',
    )
    expect(legs[1]?.find('[data-test="transfer-leg-mode"]').text()).toContain('Автобус')

    expect(wrapper.findAll('[data-test="transfer-car"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('Сергей')
  })

  it('места приходят с бэкенда: у наёмной машины место водителя занято', async () => {
    const wrapper = await mountTransfer()

    const seats = wrapper.findAll('[data-test="transfer-car-seats"]')
    expect(seats[0]?.text()).toBe('2 из 5')
    expect(seats[1]?.text()).toBe('3 из 4')
  })

  it('показывает место сбора из похода и честно молчит, когда его нет', async () => {
    const empty = await mountTransfer()
    expect(empty.find('[data-test="transfer-meeting-text"]').text()).toBe('не указано')

    const filled = await mountTransfer(makePlan({ meetingPlace: 'Иркутск, платформа 1' }))
    expect(filled.find('[data-test="transfer-meeting-text"]').text()).toBe('Иркутск, платформа 1')
  })

  it('подписывает «без машины» тех, кому места не досталось', async () => {
    const wrapper = await mountTransfer()

    const firstLeg = wrapper.findAll('[data-test="transfer-leg"]')[0]
    expect(firstLeg?.text()).toContain('Без машины')
    expect(firstLeg?.findAll('[data-test="transfer-passenger"]').map((item) => item.text())).toEqual([
      expect.stringContaining('Марина'),
    ])
  })

  it('сажает нераспределённого в машину через API', async () => {
    const wrapper = await mountTransfer()

    const seated = makePlan()
    seated.legs[0]!.passengers = seated.legs[0]!.passengers.map((person) =>
      person.userId === 'demo-marina' ? { ...person, carId: '11' } : person,
    )
    const car = seated.legs[0]!.cars[0]!
    car.occupied = 3
    mocks.seatTransferPassenger.mockResolvedValue(seated)

    await wrapper.find('[data-test="transfer-choose-car-demo-marina"]').setValue('11')
    await flushPromises()

    expect(mocks.seatTransferPassenger).toHaveBeenCalledWith('1', '1', 'demo-marina', '11')
    const firstLeg = wrapper.findAll('[data-test="transfer-leg"]')[0]
    expect(firstLeg?.findAll('[data-test="transfer-passenger"]')).toHaveLength(0)
    expect(firstLeg?.text()).toContain('все по машинам')
  })

  it('снятие пассажира уходит в API и возвращает его в «без машины»', async () => {
    const wrapper = await mountTransfer()

    const freed = makePlan()
    freed.legs[0]!.passengers = freed.legs[0]!.passengers.map((person) =>
      person.userId === ME ? { ...person, carId: null } : person,
    )
    mocks.seatTransferPassenger.mockResolvedValue(freed)

    await wrapper.find(`[data-test="transfer-unseat-${ME}"]`).trigger('click')
    await flushPromises()

    expect(mocks.seatTransferPassenger).toHaveBeenCalledWith('1', '1', ME, null)
    const firstLeg = wrapper.findAll('[data-test="transfer-leg"]')[0]
    expect(firstLeg?.findAll('[data-test="transfer-passenger"]').map((item) => item.text())).toEqual(
      expect.arrayContaining([expect.stringContaining('Олег'), expect.stringContaining('Марина')]),
    )
  })

  it('убирает машину запросом, а пассажиры остаются в строке', async () => {
    const wrapper = await mountTransfer()

    const withoutCar = makePlan()
    withoutCar.legs[0]!.cars = [withoutCar.legs[0]!.cars[0]!]
    withoutCar.legs[0]!.passengers = withoutCar.legs[0]!.passengers.map((person) => ({
      ...person,
      carId: person.carId === '12' ? null : person.carId,
    }))
    mocks.removeTransferCar.mockResolvedValue(withoutCar)

    await wrapper.find('[data-test="transfer-remove-car-12"]').trigger('click')
    await flushPromises()

    expect(mocks.removeTransferCar).toHaveBeenCalledWith('1', '12')
    expect(wrapper.findAll('[data-test="transfer-car"]')).toHaveLength(1)
    // Пётр ехал наёмной — теперь он в «без машины», но из строки не пропал.
    const firstLeg = wrapper.findAll('[data-test="transfer-leg"]')[0]
    expect(firstLeg?.text()).toContain('Пётр')
  })

  it('«вернуться так же» уходит в свою ручку и рисует копию', async () => {
    const wrapper = await mountTransfer()

    const copied = makePlan()
    copied.legs.push({
      ...copied.legs[0]!,
      id: '3',
      position: 3,
      departsAt: null,
      fromPlace: 'Олхинское плато, Витязь',
      toPlace: 'Иркутск, автовокзал',
    })
    mocks.returnTransferLeg.mockResolvedValue(copied)

    await wrapper.findAll('[data-test="transfer-return"]')[0]?.trigger('click')
    await flushPromises()

    expect(mocks.returnTransferLeg).toHaveBeenCalledWith('1', '1')

    const legs = wrapper.findAll('[data-test="transfer-leg"]')
    expect(legs).toHaveLength(3)
    expect(legs[2]?.find('[data-test="transfer-leg-places"]').text()).toContain(
      'Олхинское плато, Витязь → Иркутск, автовокзал',
    )
    expect(legs[2]?.find('[data-test="transfer-leg-mode"]').text()).toContain('время уточняется')
  })

  it('без права на вкладку правится только своя машина', async () => {
    const wrapper = await mountTransfer(makePlan({ canEdit: false }))

    expect(wrapper.find('[data-test="transfer-add-leg"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="transfer-remove-leg"]').exists()).toBe(false)
    // Своя машина (11) — можно снять пассажира; наёмная (12) — нет.
    expect(wrapper.find('[data-test="transfer-unseat-demo-anna"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="transfer-unseat-demo-petr"]').exists()).toBe(false)
  })

  it('себя из машины можно снять даже в чужой', async () => {
    // Наёмную машину Олег не правит, но он в ней едет — и вправе выйти.
    const plan = makePlan({ canEdit: false })
    plan.legs[0]!.passengers = plan.legs[0]!.passengers.map((person) =>
      person.userId === ME ? { ...person, carId: '12' } : person,
    )

    const wrapper = await mountTransfer(plan)

    expect(wrapper.find(`[data-test="transfer-unseat-${ME}"]`).exists()).toBe(true)
    // А снять чужого человека из чужой (наёмной) машины — нельзя.
    expect(wrapper.find('[data-test="transfer-unseat-demo-petr"]').exists()).toBe(false)
  })

  it('новая строка: точки обязательны, дата необязательна', async () => {
    const wrapper = await mountTransfer()

    await wrapper.find('[data-test="transfer-add-leg"]').trigger('click')
    await wrapper.find('[data-test="transfer-leg-save"]').trigger('click')

    expect(wrapper.find('[data-test="transfer-leg-error"]').text()).toContain('откуда и куда')
    expect(mocks.createTransferLeg).not.toHaveBeenCalled()

    mocks.createTransferLeg.mockResolvedValue(makePlan())

    await wrapper.find('[data-test="transfer-from-input"]').setValue('Иркутск')
    await wrapper.find('[data-test="transfer-to-input"]').setValue('Большое Голоустное')
    await wrapper.find('[data-test="transfer-leg-save"]').trigger('click')
    await flushPromises()

    expect(mocks.createTransferLeg).toHaveBeenCalledWith('1', {
      mode: 'car',
      fromPlace: 'Иркутск',
      toPlace: 'Большое Голоустное',
      departsAt: null,
      note: null,
    })
  })

  it('наёмной машине нужно имя водителя, и места уходят числом', async () => {
    const wrapper = await mountTransfer()

    await wrapper.findAll('[data-test="transfer-add-car"]')[0]?.trigger('click')
    await wrapper.find('[data-test="transfer-ownership-input"]').setValue('hired')
    await wrapper.find('[data-test="transfer-car-save"]').trigger('click')

    expect(wrapper.find('[data-test="transfer-car-error"]').text()).toContain('имя водителя')
    expect(mocks.createTransferCar).not.toHaveBeenCalled()

    mocks.createTransferCar.mockResolvedValue(makePlan())

    await wrapper.find('[data-test="transfer-driver-name-input"]').setValue('Гарик')
    await wrapper.find('[data-test="transfer-driver-phone-input"]').setValue('+7 902 000-00-00')
    await wrapper.find('[data-test="transfer-seats-input"]').setValue('3')
    await wrapper.find('[data-test="transfer-car-save"]').trigger('click')
    await flushPromises()

    expect(mocks.createTransferCar).toHaveBeenCalledWith('1', '1', {
      ownership: 'hired',
      driverUserId: null,
      driverName: 'Гарик',
      driverPhone: '+7 902 000-00-00',
      seats: 3,
    })
  })

  it('правит машину тем же диалогом, но без смены вида', async () => {
    const wrapper = await mountTransfer()
    mocks.updateTransferCar.mockResolvedValue(makePlan())

    await wrapper.find('[data-test="transfer-edit-car-12"]').trigger('click')

    // Вид машины при правке не меняется — это другая машина, а не поле.
    expect(wrapper.find('[data-test="transfer-ownership-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="transfer-ownership-fixed"]').text()).toContain('Наёмная')

    await wrapper.find('[data-test="transfer-seats-input"]').setValue('6')
    await wrapper.find('[data-test="transfer-car-save"]').trigger('click')
    await flushPromises()

    expect(mocks.updateTransferCar).toHaveBeenCalledWith('1', '12', {
      driverUserId: undefined,
      driverName: 'Сергей',
      driverPhone: '+7 902 111-22-33',
      seats: 6,
    })
  })

  it('показывает отказ сервера словами, а не молчит', async () => {
    const wrapper = await mountTransfer()
    mocks.removeTransferCar.mockRejectedValue(new Error('сеть'))

    await wrapper.find('[data-test="transfer-remove-car-12"]').trigger('click')
    await flushPromises()

    // Неизвестная ошибка — понятный текст, а не пустой экран.
    expect(wrapper.find('[data-test="transfer-action-error"]').text()).toContain('попробуйте')
  })

  it('чат трансфера — часть вкладки, а не отдельный раздел', async () => {
    const wrapper = await mountTransfer()

    expect(mocks.listTripMessages).toHaveBeenCalledWith('1', 'trip_transfer')
    expect(wrapper.find('[data-test="trip-chat"]').exists()).toBe(true)
  })
})
