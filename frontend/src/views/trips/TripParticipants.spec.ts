import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { User } from '@/api/types'
import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import { useOfflineStore } from '@/stores/offline'
import type { Trip, TripParticipant, TripRequest } from '@/types/trips'
import TripParticipants from '@/views/trips/TripParticipants.vue'

/**
 * Тесты вкладки «Участники».
 *
 * Проверяется то, что зависит от роли человека в походе: участник меняет
 * свой статус, посторонний просится в поход, организатор разбирает заявки
 * и приглашает. Права решает бэкенд — здесь важно, что интерфейс не
 * предлагает заведомо запретного и что действия уходят в API теми самыми
 * вызовами.
 */
const mocks = vi.hoisted(() => ({
  listParticipants: vi.fn(),
  listRequests: vi.fn(),
  setMyStatus: vi.fn(),
  setParticipantStatus: vi.fn(),
  setTripPresence: vi.fn(),
  removeParticipant: vi.fn(),
  createRequest: vi.fn(),
  acceptRequest: vi.fn(),
  deleteRequest: vi.fn(),
  searchUsers: vi.fn(),
  fetchRoles: vi.fn(),
  setParticipantRoles: vi.fn(),
  listTripMessages: vi.fn(),
  sendTripMessage: vi.fn(),
  listMyVirtual: vi.fn(),
  createVirtualParticipant: vi.fn(),
  addVirtualParticipant: vi.fn(),
  updateVirtual: vi.fn(),
  removeVirtual: vi.fn(),
  getTripDeparture: vi.fn(),
}))

vi.mock('@/api/trips', () => ({
  listParticipants: mocks.listParticipants,
  listRequests: mocks.listRequests,
  setMyStatus: mocks.setMyStatus,
  setParticipantStatus: mocks.setParticipantStatus,
  setTripPresence: mocks.setTripPresence,
  removeParticipant: mocks.removeParticipant,
  createRequest: mocks.createRequest,
  acceptRequest: mocks.acceptRequest,
  deleteRequest: mocks.deleteRequest,
  fetchRoles: mocks.fetchRoles,
  setParticipantRoles: mocks.setParticipantRoles,
  listTripMessages: mocks.listTripMessages,
  sendTripMessage: mocks.sendTripMessage,
  createVirtualParticipant: mocks.createVirtualParticipant,
  addVirtualParticipant: mocks.addVirtualParticipant,
}))

vi.mock('@/api/users', () => ({
  searchUsers: mocks.searchUsers,
  listMyVirtual: mocks.listMyVirtual,
  updateVirtual: mocks.updateVirtual,
  removeVirtual: mocks.removeVirtual,
}))

vi.mock('@/api/finance', () => ({
  getTripDeparture: mocks.getTripDeparture,
}))

const ORGANIZER = 'u-org'
const ME = 'u-me'

const TRIP: Trip = {
  id: '7',
  organizerUserId: ORGANIZER,
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
  startsAt: '2027-05-05T00:00:00.000Z',
  endsAt: '2027-05-09T00:00:00.000Z',
  dateVariants: [],
  isCommercial: false,
  isOfficial: false,
  openParticipation: true,
  priceRub: null,
  priceNote: null,
  cancelledAt: null,
  createdAt: '2026-10-14T10:00:00.000Z',
  updatedAt: '2026-10-14T10:00:00.000Z',
}

function person(overrides: Partial<TripParticipant> = {}): TripParticipant {
  return {
    userId: ME,
    displayName: 'Я',
    avatarUrl: null,
    status: 'going',
    roles: [],
    isOrganizer: false,
    isVirtual: false,
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
    ...overrides,
  }
}

function ticket(overrides: Partial<TripRequest> = {}): TripRequest {
  return {
    userId: 'u-other',
    displayName: 'Другой',
    avatarUrl: null,
    direction: 'apply',
    message: null,
    // У заявки автор — сам заявитель; тесты приглашений переопределяют.
    createdByUserId: 'u-other',
    createdAt: '2026-10-14T10:00:00.000Z',
    ...overrides,
  }
}

/** Войти как конкретный человек: вкладка смотрит на id из auth-store. */
function signIn(id: string) {
  const auth = useAuthStore()
  auth.user = {
    id,
    displayName: 'Я',
    location: null,
    avatarUrl: null,
    gender: 'm',
    isVegetarian: false,
    allergies: null,
    sportExperience: null,
    paymentDetails: null,
    paymentBank: null,
    isAdmin: false,
  } satisfies User
}

async function open(
  people: TripParticipant[],
  tickets: TripRequest[] = [],
  trip: Trip = TRIP,
  canManageRoles = false,
): Promise<VueWrapper> {
  mocks.listParticipants.mockResolvedValue(people)
  mocks.listRequests.mockResolvedValue(tickets)

  const wrapper = mount(TripParticipants, { props: { trip, canManageRoles } })
  await flushPromises()
  return wrapper
}

describe('TripParticipants', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.setMyStatus.mockResolvedValue(person())
    mocks.setParticipantStatus.mockResolvedValue(person({ status: 'going' }))
    mocks.removeParticipant.mockResolvedValue(undefined)
    mocks.createRequest.mockResolvedValue(ticket())
    mocks.acceptRequest.mockResolvedValue(person())
    mocks.deleteRequest.mockResolvedValue(undefined)
    mocks.searchUsers.mockResolvedValue([])
    mocks.fetchRoles.mockResolvedValue([{ code: 'organizer', name: 'Организатор' }, { code: 'quartermaster', name: 'Завхоз' }])
    mocks.setParticipantRoles.mockResolvedValue(person())
    mocks.listTripMessages.mockResolvedValue({ messages: [], hasMore: false })
    mocks.listMyVirtual.mockResolvedValue([])
    mocks.createVirtualParticipant.mockResolvedValue(
      person({ userId: 'u-virtual', displayName: 'Дядя Витя', isVirtual: true }),
    )
    mocks.addVirtualParticipant.mockResolvedValue(
      person({ userId: 'u-virtual', displayName: 'Дядя Витя', isVirtual: true }),
    )
    mocks.updateVirtual.mockResolvedValue({
      id: 'u-virtual',
      displayName: 'Дядя Витя',
      gender: 'm',
      createdAt: '2026-10-14T10:00:00.000Z',
    })
    mocks.removeVirtual.mockResolvedValue(undefined)
    // Выход из похода спрашивает сервер о снаряжении и деньгах (20.11.2026).
    mocks.getTripDeparture.mockResolvedValue({
      gearTypes: [],
      coveredRub: 0,
      deposit: null,
    })
  })

  it('показывает состав с ролями и статусами', async () => {
    signIn('u-stranger')
    const wrapper = await open([
      person({ userId: ORGANIZER, displayName: 'Организатор', isOrganizer: true }),
      person({ userId: 'u-2', displayName: 'Медсестра', status: 'maybe', roles: [{ code: 'medic', name: 'Медик' }] }),
    ])

    expect(wrapper.find('[data-test="participants-list"]').text()).toContain('Организатор')
    expect(wrapper.find('[data-test="participants-list"]').text()).toContain('организатор')
    expect(wrapper.find('[data-test="participants-list"]').text()).toContain('Медик')
    expect(wrapper.find('[data-test="participants-list"]').text()).toContain('Пока не решил')
  })

  it('участник меняет свой статус, и это уходит в API', async () => {
    signIn(ME)
    const wrapper = await open([person({ userId: ORGANIZER, isOrganizer: true }), person()])

    await wrapper.find('[data-test="my-status-maybe"]').trigger('click')
    await flushPromises()

    expect(mocks.setMyStatus).toHaveBeenCalledWith('7', 'maybe')
    // После действия состав перечитывается: состояние тикетов и состава
    // связано, и собирать его из ответов вручную — верный способ соврать.
    expect(mocks.listParticipants).toHaveBeenCalledTimes(2)
  })

  it('посторонний просится в поход, а при закрытом наборе — не может', async () => {
    signIn('u-stranger')
    const open1 = await open([person({ userId: ORGANIZER, isOrganizer: true })])
    expect(open1.find('[data-test="apply"]').exists()).toBe(true)

    await open1.find('[data-test="apply"]').trigger('click')
    await flushPromises()
    expect(mocks.createRequest).toHaveBeenCalledWith('7', { direction: 'apply' })

    const closed = await open([person({ userId: ORGANIZER, isOrganizer: true })], [], {
      ...TRIP,
      isRecruitmentClosed: true,
    })
    expect(closed.find('[data-test="apply"]').exists()).toBe(false)
    expect(closed.find('[data-test="recruitment-closed"]').exists()).toBe(true)
  })

  /**
   * Правила после старта (20.11.2026). Заказчик: «набор закрывается
   * на старте, но организатор и соорганизатор могут добавить человека
   * и после; сам человек после старта в going не переводится».
   */
  describe('после старта похода', () => {
    const DAY = 24 * 60 * 60 * 1000
    /** Поход начался вчера и ещё идёт. */
    const LIVE: Trip = {
      ...TRIP,
      startsAt: new Date(Date.now() - DAY).toISOString(),
      endsAt: new Date(Date.now() + 3 * DAY).toISOString(),
    }
    /** Поход закончился вчера — состав закрыт, тикеты остались. */
    const OVER: Trip = {
      ...TRIP,
      startsAt: new Date(Date.now() - 5 * DAY).toISOString(),
      endsAt: new Date(Date.now() - DAY).toISOString(),
    }

    it('посторонний не просится в поход: набор закрыт стартом', async () => {
      signIn('u-stranger')
      const wrapper = await open([person({ userId: ORGANIZER, isOrganizer: true })], [], LIVE)

      expect(wrapper.find('[data-test="apply"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="recruitment-closed"]').text()).toContain(
        'поход уже начался',
      )
    })

    it('сам человек в «иду» не переводится — кнопка закрыта и объяснена', async () => {
      signIn(ME)
      const wrapper = await open(
        [person({ userId: ORGANIZER, isOrganizer: true }), person({ status: 'maybe' })],
        [],
        LIVE,
      )

      expect(wrapper.find('[data-test="my-status-going"]').attributes('disabled')).toBeDefined()
      expect(wrapper.find('[data-test="my-status-after-start"]').exists()).toBe(true)

      // «Не иду» после старта остаётся свободным: поздний отказ — сразу.
      expect(wrapper.find('[data-test="my-status-maybe"]').attributes('disabled')).toBeUndefined()
    })

    it('организатор переводит человека в «иду» — и тот сразу на маршруте', async () => {
      signIn(ORGANIZER)
      const wrapper = await open([
        person({ userId: ORGANIZER, displayName: 'Я', isOrganizer: true }),
        person({ userId: 'u-2', displayName: 'Второй', status: 'maybe' }),
      ], [], LIVE)

      await wrapper.find('[data-test="take-along-u-2"]').trigger('click')
      await flushPromises()

      expect(mocks.setParticipantStatus).toHaveBeenCalledWith('7', 'u-2', 'going')
      // Список перечитывается: отметку присутствия поставил сервер.
      expect(mocks.listParticipants).toHaveBeenCalledTimes(2)
    })

    it('после старта участник не приглашает и не заводит людей без аккаунта', async () => {
      signIn(ME)
      const wrapper = await open([person({ userId: ORGANIZER, isOrganizer: true }), person()], [], LIVE)

      expect(wrapper.find('[data-test="invite-panel"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="virtual-panel"]').exists()).toBe(false)
    })

    it('организатор после старта приглашает и заводит людей без аккаунта', async () => {
      signIn(ORGANIZER)
      const wrapper = await open([
        person({ userId: ORGANIZER, displayName: 'Я', isOrganizer: true }),
      ], [], LIVE)

      expect(wrapper.find('[data-test="invite-panel"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="virtual-panel"]').exists()).toBe(true)
    })

    it('заявки висят и после окончания похода, но подтвердить их нельзя', async () => {
      signIn(ORGANIZER)
      const wrapper = await open([
        person({ userId: ORGANIZER, displayName: 'Я', isOrganizer: true }),
      ], [ticket({ userId: 'u-1', displayName: 'Первый' })], OVER)

      expect(wrapper.findAll('[data-test="applications"] li')).toHaveLength(1)
      expect(wrapper.find('[data-test="accept-u-1"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="application-after-end"]').exists()).toBe(true)
      // Отклонить можно: тикет живёт, пока организатор не разберётся.
      expect(wrapper.find('[data-test="reject-u-1"]').exists()).toBe(true)
    })
  })

  it('своя заявка видна, и её можно отозвать', async () => {
    signIn(ME)
    const wrapper = await open([person({ userId: ORGANIZER, isOrganizer: true })], [
      ticket({ userId: ME }),
    ])

    expect(wrapper.find('[data-test="my-request"]').exists()).toBe(true)

    await wrapper.find('[data-test="withdraw-apply"]').trigger('click')
    await flushPromises()

    expect(mocks.deleteRequest).toHaveBeenCalledWith('7', ME)
  })

  it('организатор принимает и отклоняет заявки', async () => {
    signIn(ORGANIZER)
    const wrapper = await open([person({ userId: ORGANIZER, displayName: 'Я', isOrganizer: true })], [
      ticket({ userId: 'u-1', displayName: 'Первый' }),
      ticket({ userId: 'u-2', displayName: 'Второй' }),
    ])

    expect(wrapper.findAll('[data-test="applications"] li')).toHaveLength(2)

    await wrapper.find('[data-test="accept-u-1"]').trigger('click')
    await flushPromises()
    expect(mocks.acceptRequest).toHaveBeenCalledWith('7', 'u-1', 'going')

    await wrapper.find('[data-test="reject-u-2"]').trigger('click')
    await flushPromises()
    expect(mocks.deleteRequest).toHaveBeenCalledWith('7', 'u-2')
  })

  it('организатор убирает участника, но не себя', async () => {
    signIn(ORGANIZER)
    const wrapper = await open([
      person({ userId: ORGANIZER, displayName: 'Я', isOrganizer: true }),
      person({ userId: 'u-2', displayName: 'Второй' }),
    ])

    expect(wrapper.find(`[data-test="remove-${ORGANIZER}"]`).exists()).toBe(false)

    await wrapper.find('[data-test="remove-u-2"]').trigger('click')
    await flushPromises()
    expect(mocks.removeParticipant).toHaveBeenCalledWith('7', 'u-2')
  })

  /**
   * Соорганизатор (20.11.2026) — второй организатор похода.
   *
   * Заказчик: «соорганизатор равен организатору во всём, отличий ровно
   * пять», и одно из них — «организатор может снять роль соорганизатора;
   * соорганизатор — ни с себя, ни с другого». Поэтому кнопка «Убрать»
   * у него есть у всех, кроме автора похода и других соорганизаторов
   * (убрать соорганизатора — это и есть снять полномочия).
   */
  it('соорганизатор помечен бейджем и убирает участника, но не другого соорганизатора', async () => {
    signIn(ME)
    const CO = { code: 'coOrganizer', name: 'Соорганизатор' }
    const wrapper = await open([
      person({ userId: ORGANIZER, displayName: 'Автор', isOrganizer: true }),
      person({ userId: ME, displayName: 'Я', roles: [CO] }),
      person({ userId: 'u-2', displayName: 'Второй' }),
      person({ userId: 'u-3', displayName: 'Третий', roles: [CO] }),
    ])

    // Бейдж — отдельный, а не ролью в общем списке: он должен читаться.
    expect(wrapper.findAll('[data-test="participant-coorganizer"]')).toHaveLength(2)
    // Роль соорганизатора второй раз не выводится — только бейдж.
    expect(wrapper.find('[data-test="participants-list"]').text()).not.toContain(
      'Соорганизатор',
    )

    expect(wrapper.find('[data-test="remove-u-2"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="remove-u-3"]').exists()).toBe(false)
    expect(wrapper.find(`[data-test="remove-${ORGANIZER}"]`).exists()).toBe(false)

    await wrapper.find('[data-test="remove-u-2"]').trigger('click')
    await flushPromises()
    expect(mocks.removeParticipant).toHaveBeenCalledWith('7', 'u-2')
  })

  /**
   * `helping` вернулся 20.11.2026: «помогаю, но не иду» — отдельное
   * состояние, и соорганизатор может быть в нём, а не только в `going`.
   */
  it('соорганизатор ставит себе «помогаю, но не иду»', async () => {
    signIn(ME)
    const wrapper = await open([
      person({ userId: ORGANIZER, displayName: 'Автор', isOrganizer: true }),
      person({
        userId: ME,
        status: 'maybe',
        roles: [{ code: 'coOrganizer', name: 'Соорганизатор' }],
      }),
    ])

    await wrapper.find('[data-test="my-status-helping"]').trigger('click')
    await flushPromises()

    expect(mocks.setMyStatus).toHaveBeenCalledWith('7', 'helping')
  })

  it('приглашённый видит приглашение и отвечает на него', async () => {
    signIn(ME)
    const wrapper = await open([
      person({ userId: ORGANIZER, isOrganizer: true }),
      person({ status: 'invited' }),
    ])

    expect(wrapper.find('[data-test="my-invitation"]').exists()).toBe(true)
    // Свой статус кнопками не меняется, пока на приглашение не ответили.
    expect(wrapper.find('[data-test="my-status"]').exists()).toBe(false)

    await wrapper.find('[data-test="accept-invite"]').trigger('click')
    await flushPromises()
    expect(mocks.acceptRequest).toHaveBeenCalledWith('7', ME, 'going')

    await wrapper.find('[data-test="decline-invite"]').trigger('click')
    await flushPromises()
    expect(mocks.deleteRequest).toHaveBeenCalledWith('7', ME)
  })

  it('организатор ищет человека по имени и приглашает его', async () => {
    signIn(ORGANIZER)
    mocks.searchUsers.mockResolvedValue([{ id: 'u-9', displayName: 'Напарник', avatarUrl: null }])

    const wrapper = await open([person({ userId: ORGANIZER, displayName: 'Я', isOrganizer: true })])

    await wrapper.find('[data-test="invite-search"]').setValue('Напа')
    await flushPromises()
    // Поиск с задержкой: ждём её по-настоящему — таймеры здесь настоящие.
    await new Promise((resolve) => setTimeout(resolve, 400))
    await flushPromises()

    expect(mocks.searchUsers).toHaveBeenCalledWith('Напа')

    await wrapper.find('[data-test="invite-candidate"]').trigger('click')
    await flushPromises()

    expect(mocks.createRequest).toHaveBeenCalledWith('7', {
      direction: 'invite',
      userId: 'u-9',
    })
  })

  it('уже приглашённых в подсказках не повторяет', async () => {
    signIn(ORGANIZER)
    mocks.searchUsers.mockResolvedValue([{ id: 'u-9', displayName: 'Напарник', avatarUrl: null }])

    const wrapper = await open(
      [person({ userId: ORGANIZER, displayName: 'Я', isOrganizer: true })],
      [ticket({ userId: 'u-9', direction: 'invite' })],
    )

    await wrapper.find('[data-test="invite-search"]').setValue('Напа')
    await new Promise((resolve) => setTimeout(resolve, 400))
    await flushPromises()

    expect(wrapper.find('[data-test="invite-candidates"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="invite-nothing"]').exists()).toBe(true)
  })

  it('сбой действия показывается, а не глотается', async () => {
    signIn(ME)
    mocks.setMyStatus.mockRejectedValue(new Error('сеть'))

    const wrapper = await open([person({ userId: ORGANIZER, isOrganizer: true }), person()])

    // «Не иду» сначала спрашивает подтверждение (20.11.2026), и только
    // «Да» уходит в API — здесь падает уже сам запрос.
    await wrapper.find('[data-test="my-status-declined"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="leave-confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="participants-action-error"]').exists()).toBe(true)
  })

  /**
   * Уведомление при выходе (20.11.2026).
   *
   * Сначала снаряжение: если за человеком что-то закреплено, «Ты уверен?»
   * превращается в предупреждение со списком типов. Деньги — второй шаг,
   * и только у того, кто что-то вложил.
   */
  it('перед выходом спрашивает про снаряжение и не уходит без «Да»', async () => {
    signIn(ME)
    mocks.getTripDeparture.mockResolvedValue({
      gearTypes: ['Палатка', 'Топор'],
      coveredRub: 0,
      deposit: null,
    })

    const wrapper = await open([person({ userId: ORGANIZER, isOrganizer: true }), person()])

    await wrapper.find('[data-test="my-status-declined"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="leave-dialog"]').exists()).toBe(true)
    expect(mocks.getTripDeparture).toHaveBeenCalledWith('7')
    expect(wrapper.find('[data-test="leave-text"]').text()).toBe(
      'Ты уверен? Твоё снаряжение (Палатка, Топор) будет исключено из снаряжения похода. Если ты что-то даёшь группе в поход, то останься в качестве наблюдателя.',
    )
    // Пока не нажали «Да», статус не меняется.
    expect(mocks.setMyStatus).not.toHaveBeenCalled()

    await wrapper.find('[data-test="leave-confirm"]').trigger('click')
    await flushPromises()

    expect(mocks.setMyStatus).toHaveBeenCalledWith('7', 'declined')
  })

  it('без снаряжения спрашивает просто «Ты уверен?»', async () => {
    signIn(ME)
    const wrapper = await open([person({ userId: ORGANIZER, isOrganizer: true }), person()])

    await wrapper.find('[data-test="my-status-declined"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="leave-text"]').text()).toBe('Ты уверен?')
  })

  it('второй шаг — залог и остаток: удержание решает организатор', async () => {
    signIn(ME)
    mocks.getTripDeparture.mockResolvedValue({
      gearTypes: [],
      coveredRub: 250,
      deposit: { amountRub: 200, coveredRub: 250, holdRub: 200, refundRub: 50 },
    })

    const wrapper = await open([person({ userId: ORGANIZER, isOrganizer: true }), person()])

    await wrapper.find('[data-test="my-status-declined"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="leave-confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="leave-text"]').text()).toBe(
      'В походе установлен залог, удержать ли твою сумму 200 ₽, определяет организатор. Остальное, 50 ₽, будет переведено тебе от участников похода, следи за сообщениями.',
    )
    expect(mocks.setMyStatus).not.toHaveBeenCalled()

    await wrapper.find('[data-test="leave-confirm"]').trigger('click')
    await flushPromises()

    expect(mocks.setMyStatus).toHaveBeenCalledWith('7', 'declined')
  })

  it('без залога и с расходами — «расходы компенсируют участники»', async () => {
    signIn(ME)
    mocks.getTripDeparture.mockResolvedValue({
      gearTypes: [],
      coveredRub: 50,
      deposit: null,
    })

    const wrapper = await open([person({ userId: ORGANIZER, isOrganizer: true }), person()])

    await wrapper.find('[data-test="my-status-declined"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="leave-confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="leave-text"]').text()).toBe(
      'Твои расходы будут компенсированы участниками похода, следи за сообщениями.',
    )
  })

  it('без вложений второго шага нет: вышел сразу после снаряжения', async () => {
    signIn(ME)
    const wrapper = await open([person({ userId: ORGANIZER, isOrganizer: true }), person()])

    await wrapper.find('[data-test="my-status-declined"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="leave-confirm"]').trigger('click')
    await flushPromises()

    expect(mocks.setMyStatus).toHaveBeenCalledWith('7', 'declined')
  })

  it('«Нет» закрывает уведомление, статус остаётся прежним', async () => {
    signIn(ME)
    const wrapper = await open([person({ userId: ORGANIZER, isOrganizer: true }), person()])

    await wrapper.find('[data-test="my-status-declined"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="leave-cancel"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="leave-dialog"]').exists()).toBe(false)
    expect(mocks.setMyStatus).not.toHaveBeenCalled()
  })

  /**
   * Роли: назначает организатор (или соорганизатор — право даёт бэкенд),
   * сами участники ими не управляют. Поэтому кнопка «Роли» появляется
   * только по `canManageRoles`, а роль у имени видна всем.
   */
  it('без права на управление ролями кнопки нет', async () => {
    signIn(ME)
    const wrapper = await open([person({ userId: ORGANIZER, isOrganizer: true })], [], TRIP, false)

    expect(wrapper.find(`[data-test="roles-${ORGANIZER}"]`).exists()).toBe(false)
  })

  it('роль видна у имени участника', async () => {
    signIn('u-stranger')
    const wrapper = await open([
      person({
        userId: 'u-2',
        displayName: 'Петя',
        roles: [{ code: 'quartermaster', name: 'Завхоз' }],
      }),
    ])

    expect(wrapper.find('[data-test="participant-role"]').text()).toBe('Завхоз')
  })

  it('организатор назначает роль: уходит в API и закрывает диалог', async () => {
    signIn(ORGANIZER)
    const wrapper = await open(
      [person({ userId: ORGANIZER, isOrganizer: true }), person({ displayName: 'Петя' })],
      [],
      TRIP,
      true,
    )

    await wrapper.find(`[data-test="roles-${ME}"]`).trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="roles-dialog"]').exists()).toBe(true)

    await wrapper.find('[data-test="role-option-quartermaster"]').trigger('change')
    await wrapper.find('[data-test="roles-save"]').trigger('click')
    await flushPromises()

    expect(mocks.setParticipantRoles).toHaveBeenCalledWith('7', ME, ['quartermaster'])
    expect(wrapper.find('[data-test="roles-dialog"]').exists()).toBe(false)
    expect(wrapper.emitted('changed')).toBeTruthy()
  })

  // ─── люди без аккаунта (31.10.2026) ───

  /**
   * Организатор заводит человека, которого нет на сайте. Он сразу в составе,
   * статус «идёт» — приглашать его некуда, входа у него нет. Заведение идёт
   * ручкой похода, а не профиля: человек заводится «в поход».
   */
  it('организатор заводит человека без аккаунта — он сразу в составе', async () => {
    signIn(ORGANIZER)
    const wrapper = await open([person({ userId: ORGANIZER, isOrganizer: true })])

    expect(wrapper.find('[data-test="virtual-panel"]').exists()).toBe(true)

    await wrapper.find('[data-test="virtual-name"]').setValue('Дядя Витя')
    await wrapper.find('[data-test="virtual-gender"]').setValue('f')
    await wrapper.find('[data-test="virtual-form"]').trigger('submit')
    await flushPromises()

    expect(mocks.createVirtualParticipant).toHaveBeenCalledWith('7', {
      displayName: 'Дядя Витя',
      gender: 'f',
    })
  })

  it('человек без аккаунта помечен в составе, и роли ему не предлагаются', async () => {
    signIn(ORGANIZER)
    const wrapper = await open(
      [
        person({ userId: ORGANIZER, isOrganizer: true }),
        person({ userId: 'u-virtual', displayName: 'Дядя Витя', isVirtual: true }),
      ],
      [],
      TRIP,
      true,
    )

    expect(wrapper.find('[data-test="participant-virtual"]').text()).toBe('без аккаунта')
    // Решение заказчика: роль виртуальному назначается только «для информации»,
    // а все действия совершает организатор — фронт её не предлагает.
    expect(wrapper.find('[data-test="roles-u-virtual"]').exists()).toBe(false)
  })

  it('своего виртуального добавляет в поход одним нажатием', async () => {
    signIn(ORGANIZER)
    // Человек уже заведён в прошлом походе — в этом его ещё нет.
    mocks.listMyVirtual.mockResolvedValue([
      {
        id: 'u-virtual',
        displayName: 'Дядя Витя',
        gender: 'm',
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    ])

    const wrapper = await open([person({ userId: ORGANIZER, isOrganizer: true })])

    await wrapper.find('[data-test="virtual-add"]').trigger('click')
    await flushPromises()

    expect(mocks.addVirtualParticipant).toHaveBeenCalledWith('7', 'u-virtual')
  })

  it('виртуальный, который уже в походе, не предлагается второй раз', async () => {
    signIn(ORGANIZER)
    mocks.listMyVirtual.mockResolvedValue([
      {
        id: 'u-virtual',
        displayName: 'Дядя Витя',
        gender: 'm',
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    ])

    const wrapper = await open([
      person({ userId: ORGANIZER, isOrganizer: true }),
      person({ userId: 'u-virtual', displayName: 'Дядя Витя', isVirtual: true }),
    ])

    expect(wrapper.find('[data-test="virtual-add"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="virtual-in-trip"]').text()).toBe('уже в походе')
  })

  it('правка виртуального: переименование уходит в свой список', async () => {
    signIn(ORGANIZER)
    mocks.listMyVirtual.mockResolvedValue([
      {
        id: 'u-virtual',
        displayName: 'Дядя Витя',
        gender: 'm',
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    ])

    const wrapper = await open([person({ userId: ORGANIZER, isOrganizer: true })])

    await wrapper.find('[data-test="virtual-edit"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-test="virtual-edit-name"]').setValue('Дядя Пётр')
    await wrapper.find('[data-test="virtual-edit-save"]').trigger('click')
    await flushPromises()

    expect(mocks.updateVirtual).toHaveBeenCalledWith('u-virtual', {
      displayName: 'Дядя Пётр',
      gender: 'm',
    })
    expect(wrapper.find('[data-test="virtual-edit-dialog"]').exists()).toBe(false)
  })

  it('удаление из списка объясняет, почему нельзя: он уже был в походе', async () => {
    signIn(ORGANIZER)
    mocks.listMyVirtual.mockResolvedValue([
      {
        id: 'u-virtual',
        displayName: 'Дядя Витя',
        gender: 'm',
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    ])
    mocks.removeVirtual.mockRejectedValue(
      new ApiError(
        409,
        'Нельзя удалить: «Дядя Витя» уже участвовал(а) в походе «Витязь». Удалить можно только до начала похода.',
      ),
    )

    const wrapper = await open([person({ userId: ORGANIZER, isOrganizer: true })])

    await wrapper.find('[data-test="virtual-edit"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="virtual-delete"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="virtual-edit-dialog"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="virtual-edit-error"]').text()).toContain(
      'только до начала похода',
    )
  })

  it('не организатор блока «Люди без аккаунта» не видит', async () => {
    signIn(ME)
    // Меня в походе нет: посторонний не приводит людей, даже если бы флаг
    // открытого участия был включён.
    const wrapper = await open([person({ userId: ORGANIZER, isOrganizer: true })])

    expect(wrapper.find('[data-test="virtual-panel"]').exists()).toBe(false)
    expect(mocks.listMyVirtual).not.toHaveBeenCalled()
  })

  // ─── открытое участие (13.11.2026) ───

  /**
   * Заказчик: «нужен чек-бокс „Открытое участие. Участники могут приглашать
   * своих“, по умолчанию true. Без этого флага неорганизаторам скрыты секции
   * „Пригласить“ и „Люди без аккаунта“».
   */
  it('при открытом участии идущий участник видит «Пригласить» и людей без аккаунта', async () => {
    signIn(ME)
    const wrapper = await open([
      person({ userId: ORGANIZER, isOrganizer: true }),
      person({ userId: ME }),
    ])

    expect(wrapper.find('[data-test="invite-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="virtual-panel"]').exists()).toBe(true)
    expect(mocks.listMyVirtual).toHaveBeenCalled()
  })

  it('при выключенном открытом участии участник этих секций не видит, а организатор видит', async () => {
    signIn(ME)
    const closed = { ...TRIP, openParticipation: false }
    const asMember = await open(
      [person({ userId: ORGANIZER, isOrganizer: true }), person({ userId: ME })],
      [],
      closed,
    )

    expect(asMember.find('[data-test="invite-panel"]').exists()).toBe(false)
    expect(asMember.find('[data-test="virtual-panel"]').exists()).toBe(false)

    // Организатор собирает состав сам: правила похода на него не действуют.
    signIn(ORGANIZER)
    const asOrganizer = await open(
      [person({ userId: ORGANIZER, isOrganizer: true, displayName: 'Я' })],
      [],
      closed,
    )

    expect(asOrganizer.find('[data-test="invite-panel"]').exists()).toBe(true)
    expect(asOrganizer.find('[data-test="virtual-panel"]').exists()).toBe(true)
  })

  it('участник видит своё приглашение и отзывает его', async () => {
    signIn(ME)
    const wrapper = await open(
      [person({ userId: ORGANIZER, isOrganizer: true }), person({ userId: ME })],
      [ticket({ userId: 'u-9', displayName: 'Напарник', direction: 'invite', createdByUserId: ME })],
    )

    expect(wrapper.find('[data-test="invitations"]').text()).toContain('Напарник')

    await wrapper.find('[data-test="revoke-u-9"]').trigger('click')
    await flushPromises()

    expect(mocks.deleteRequest).toHaveBeenCalledWith('7', 'u-9')
  })

  // ───────────────────── присутствие (17.11.2026) ─────────────────────

  it('идущий отмечает себя «на маршруте», и это уходит в API', async () => {
    signIn(ME)
    mocks.setTripPresence.mockResolvedValue(
      person({
        userId: ME,
        presenceStatus: 'route',
        startedAt: '2026-11-17T03:00:00.000Z',
        presenceUpdatedByUserId: ME,
        presenceSource: 'self',
      }),
    )

    const wrapper = await open([person({ userId: ME })])

    await wrapper.find(`[data-test="presence-mark-${ME}"]`).trigger('click')
    await flushPromises()

    expect(mocks.setTripPresence).toHaveBeenCalledWith('7', ME, 'route')
    expect(wrapper.get('[data-test="presence-status-route"]').text()).toBe('На маршруте')
  })

  it('отметку другому подписывает автор', async () => {
    signIn(ME)
    const wrapper = await open([
      person({ userId: ME, displayName: 'Сергей' }),
      person({
        userId: 'u-2',
        displayName: 'Марина',
        presenceStatus: 'returned',
        presenceUpdatedByUserId: ME,
        presenceSource: 'other',
      }),
    ])

    const row = wrapper.findAll('[data-test="participant"]')[1]!
    expect(row.get('[data-test="presence-status-returned"]').text()).toBe('Вернулся')
    expect(row.get('[data-test="presence-updated-by"]').text()).toContain('отметил Сергей')
  })

  it('ошибочную отметку можно снять', async () => {
    signIn(ME)
    mocks.setTripPresence.mockResolvedValue(person({ userId: ME, presenceStatus: 'none' }))

    const wrapper = await open([person({ userId: ME, presenceStatus: 'route' })])

    await wrapper.find(`[data-test="presence-reset-${ME}"]`).trigger('click')
    await flushPromises()

    expect(mocks.setTripPresence).toHaveBeenCalledWith('7', ME, 'none')
  })

  it('отмечать может только идущий', async () => {
    signIn(ME)
    const wrapper = await open([
      person({ userId: ME, status: 'maybe' }),
      person({ userId: 'u-2', displayName: 'Марина' }),
    ])

    expect(wrapper.find(`[data-test="presence-mark-${ME}"]`).exists()).toBe(false)
    expect(wrapper.find('[data-test="presence-mark-u-2"]').exists()).toBe(false)
  })

  it('вышедшего из похода не отмечают', async () => {
    signIn(ME)
    const wrapper = await open([
      person({ userId: ME }),
      person({ userId: 'u-3', displayName: 'Ушёл', status: 'declined' }),
    ])

    expect(wrapper.find('[data-test="presence-mark-u-3"]').exists()).toBe(false)
  })

  it('чужое возвращение не предлагается, а приход — предлагается', async () => {
    signIn(ME)
    const wrapper = await open([
      person({ userId: ME, presenceStatus: 'route' }),
      person({ userId: 'u-2', displayName: 'Марина', presenceStatus: 'route' }),
      person({ userId: 'u-3', displayName: 'Петя', presenceStatus: 'none' }),
    ])

    // Своё возвращение — можно.
    expect(wrapper.find(`[data-test="presence-mark-${ME}"]`).exists()).toBe(true)
    // Чужое возвращение живой участник не ставит: «Вернулся» тут нет.
    expect(wrapper.find('[data-test="presence-mark-u-2"]').exists()).toBe(false)
    // Приход за другого — по-прежнему можно.
    expect(wrapper.find('[data-test="presence-mark-u-3"]').text()).toBe('На маршруте')
  })

  it('человеку без аккаунта возвращение ставит группа', async () => {
    signIn(ME)
    const wrapper = await open([
      person({ userId: ME, presenceStatus: 'route' }),
      person({
        userId: 'u-v',
        displayName: 'Дядя Витя',
        isVirtual: true,
        presenceStatus: 'route',
      }),
    ])

    expect(wrapper.find('[data-test="presence-mark-u-v"]').text()).toBe('Вернулся')
  })

  it('без связи возвращение не предлагается даже себе', async () => {
    signIn(ME)
    useOfflineStore().isOnline = false

    const wrapper = await open([person({ userId: ME, presenceStatus: 'route' })])

    expect(wrapper.find(`[data-test="presence-mark-${ME}"]`).exists()).toBe(false)
    // Снять ошибочную отметку по-прежнему можно: это не возвращение.
    expect(wrapper.find(`[data-test="presence-reset-${ME}"]`).exists()).toBe(true)
  })

  /**
   * Завершённый поход (20.11.2026): состав — история. Кнопки, которые
   * заведомо получат 409, не рисуются, а перекличка остаётся: «это не
   * содержимое, её собирают и после возвращения».
   */
  it('в завершённом походе состав не меняется, а присутствие ставится', async () => {
    signIn(ORGANIZER)

    const completed = {
      ...TRIP,
      startsAt: '2026-11-10T00:00:00.000Z',
      endsAt: '2026-11-20T00:00:00.000Z',
      completedAt: '2026-11-21T00:00:00.000Z',
    }

    const wrapper = await open(
      [
        person({ userId: ORGANIZER, displayName: 'Орг', isOrganizer: true }),
        person({ userId: 'u-2', displayName: 'Марина', presenceStatus: 'returned' }),
      ],
      [],
      completed,
      true,
    )

    expect(wrapper.find('[data-test="participants-completed"]').exists()).toBe(true)
    // Свой статус и управление составом закрыты.
    expect(wrapper.find('[data-test="my-status"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="remove-u-2"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="take-along-u-2"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="invite-panel"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="virtual-panel"]').exists()).toBe(false)
    // Перекличка остаётся: отметить присутствие можно и после завершения.
    expect(wrapper.find(`[data-test="presence-mark-${ORGANIZER}"]`).exists()).toBe(true)
  })

  /**
   * Отменённый поход (26.11.2026, §4.6): состав заморожен так же, как
   * в завершённом, но подпись другая — похода не будет.
   */
  it('в отменённом походе состав не меняется', async () => {
    signIn(ORGANIZER)

    const cancelled = {
      ...TRIP,
      cancelledAt: '2026-11-26T00:00:00.000Z',
    }

    const wrapper = await open(
      [
        person({ userId: ORGANIZER, displayName: 'Орг', isOrganizer: true }),
        person({ userId: 'u-2', displayName: 'Марина' }),
      ],
      [],
      cancelled,
      true,
    )

    expect(wrapper.find('[data-test="participants-cancelled"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="participants-completed"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="my-status"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="remove-u-2"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="invite-panel"]').exists()).toBe(false)
  })
})
