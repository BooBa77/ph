import { defineComponent, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { User } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import type {
  DepositParticipant,
  FinanceMember,
  TripCompensation,
  TripExpense,
  TripFinance,
} from '@/types/finance'
import TripFinanceView from '@/views/trips/TripFinance.vue'

/**
 * Вкладка «Бухгалтерия» (12.11.2026).
 *
 * Заказчик: «таблица движения денег… всем видны все записи, чтобы была
 * понятна арифметика; строки с расходами редактируются авторами; итоговый
 * баланс пользователя; две кнопки — Добавить расход, Компенсация».
 *
 * Тест держит то, что видно словами: баланс одной фразой, вторую цифру
 * с ожидающими переводами, строки расходов и компенсаций с подписями,
 * кнопки «Получено»/«Отменить» только у того, кому сервер разрешил,
 * выключенную «Компенсацию» с объяснением и живые обновления по SSE.
 */
const mocks = vi.hoisted(() => ({
  getTripFinance: vi.fn(),
  confirmTripCompensation: vi.fn(),
  deleteTripCompensation: vi.fn(),
  setTripDepositStatus: vi.fn(),
  transferTripDeposit: vi.fn(),
  subscribeTripEvents: vi.fn(),
  stopLiveEvents: vi.fn(),
}))

vi.mock('@/api/finance', () => ({
  getTripFinance: mocks.getTripFinance,
  createTripExpense: vi.fn(),
  updateTripExpense: vi.fn(),
  deleteTripExpense: vi.fn(),
  createTripCompensation: vi.fn(),
  confirmTripCompensation: mocks.confirmTripCompensation,
  deleteTripCompensation: mocks.deleteTripCompensation,
  setTripDepositStatus: mocks.setTripDepositStatus,
  transferTripDeposit: mocks.transferTripDeposit,
}))

vi.mock('@/api/events', () => ({
  subscribeTripEvents: mocks.subscribeTripEvents,
}))

const ME = 'me-1'
const ANNA = 'anna-1'
const BORIS = 'boris-1'

function member(
  userId: string,
  displayName: string,
  balanceRub: number,
  overrides: Partial<FinanceMember> = {},
): FinanceMember {
  return {
    userId,
    displayName,
    avatarUrl: null,
    balanceRub,
    remainingRub: balanceRub,
    isVirtual: false,
    managedByMe: false,
    paymentDetails: null,
    paymentBank: null,
    ...overrides,
  }
}

/** Расход Анны на троих: каждый должен по 1 000 ₽. */
function expense(overrides: Partial<TripExpense> = {}): TripExpense {
  return {
    id: 'e1',
    spentAt: '2026-11-11',
    authorUserId: ANNA,
    authorName: 'Анна',
    authorAvatarUrl: null,
    amountRub: 3000,
    description: 'Продукты',
    split: 'all',
    shares: [
      { userId: ME, displayName: 'Я', amountRub: 1000 },
      { userId: ANNA, displayName: 'Анна', amountRub: 1000 },
      { userId: BORIS, displayName: 'Борис', amountRub: 1000 },
    ],
    canEdit: false,
    ...overrides,
  }
}

function compensation(overrides: Partial<TripCompensation> = {}): TripCompensation {
  return {
    id: 'c1',
    createdAt: '2026-11-11T18:30:00.000Z',
    fromUserId: ANNA,
    fromName: 'Анна',
    toUserId: ME,
    toName: 'Я',
    amountRub: 1000,
    kind: 'compensation',
    status: 'pending',
    confirmedAt: null,
    canConfirm: true,
    canCancel: false,
    ...overrides,
  }
}

/** Вкладка глазами меня: я должен Анне 1 000 ₽. */
function state(overrides: Partial<TripFinance> = {}): TripFinance {
  return {
    expenses: [expense()],
    compensations: [],
    members: [
      member(ME, 'Я', -1000),
      member(ANNA, 'Анна', 2000, { paymentDetails: '+7 999 000-00-00', paymentBank: 'Сбер' }),
      member(BORIS, 'Борис', -1000),
    ],
    // Семей нет — каждый своей кассой: строка на человека.
    families: [
      { memberIds: [ME], displayName: 'Я', balanceRub: -1000, remainingRub: -1000, isMine: true },
      { memberIds: [ANNA], displayName: 'Анна', balanceRub: 2000, remainingRub: 2000, isMine: false },
      {
        memberIds: [BORIS],
        displayName: 'Борис',
        balanceRub: -1000,
        remainingRub: -1000,
        isMine: false,
      },
    ],
    managedSenders: [],
    me: {
      balanceRub: -1000,
      remainingRub: -1000,
      familyBalanceRub: -1000,
      familyRemainingRub: -1000,
      familyDebtRub: 1000,
      familyCreditRub: 0,
      canSpend: true,
      suggestions: [
        {
          userIds: [ANNA],
          displayName: 'Анна',
          amountRub: 1000,
          members: [
            {
              userId: ANNA,
              displayName: 'Анна',
              gender: 'f',
              paymentDetails: '+7 999 000-00-00',
              paymentBank: 'Сбер',
            },
          ],
        },
      ],
    },
    ...overrides,
  }
}

/** Вкладка глазами меня, где я в семье: балансы всё равно личные. */
function familyState(overrides: Partial<TripFinance> = {}): TripFinance {
  const base = state()

  return {
    ...base,
    families: [
      {
        memberIds: [ME, ANNA],
        displayName: 'Я и Анна',
        balanceRub: 1000,
        remainingRub: 0,
        isMine: true,
      },
      {
        memberIds: [BORIS],
        displayName: 'Борис',
        balanceRub: -1000,
        remainingRub: -1000,
        isMine: false,
      },
    ],
    me: {
      ...base.me,
      balanceRub: 3000,
      remainingRub: 3000,
      familyBalanceRub: 1000,
      familyRemainingRub: 0,
      familyDebtRub: 0,
      familyCreditRub: 1000,
      suggestions: [],
    },
    ...overrides,
  }
}

/**
 * Семья, где у смотрящего плюс, а у родного минус: A +1 000, Анна −1 500,
 * Борис +500. Касса семьи (Я, Анна) — −500, поэтому «Компенсация» доступна:
 * папа платит за сына (13.11.2026).
 */
function familyDebtState(): TripFinance {
  const base = state()

  return {
    ...base,
    members: [
      member(ME, 'Я', 1000),
      member(ANNA, 'Анна', -1500),
      member(BORIS, 'Борис', 500),
    ],
    families: [
      {
        memberIds: [ME, ANNA],
        displayName: 'Я и Анна',
        balanceRub: -500,
        remainingRub: -500,
        isMine: true,
      },
      {
        memberIds: [BORIS],
        displayName: 'Борис',
        balanceRub: 500,
        remainingRub: 500,
        isMine: false,
      },
    ],
    me: {
      ...base.me,
      balanceRub: 1000,
      remainingRub: 1000,
      familyBalanceRub: -500,
      familyRemainingRub: -500,
      familyDebtRub: 500,
      familyCreditRub: 0,
      suggestions: [
        {
          userIds: [BORIS],
          displayName: 'Борис',
          amountRub: 500,
          members: [
            {
              userId: BORIS,
              displayName: 'Борис',
              gender: 'm',
              paymentDetails: null,
              paymentBank: null,
            },
          ],
        },
      ],
    },
  }
}

/** «Мне нечего платить» — все три цифры по нулям и пустые подсказки. */
function meQuiet(overrides: Partial<TripFinance['me']> = {}): TripFinance['me'] {
  const balanceRub = overrides.balanceRub ?? 0

  return {
    balanceRub,
    remainingRub: 0,
    familyBalanceRub: balanceRub,
    familyRemainingRub: 0,
    familyDebtRub: 0,
    familyCreditRub: 0,
    canSpend: true,
    suggestions: [],
    ...overrides,
  }
}

/** Заглушка модалки расхода: запоминает `emit`, чтобы вернуть новый ответ. */
let expenseModalEmit: ((event: string, payload: unknown) => void) | null = null

const ExpenseModalStub = defineComponent({
  props: { tripId: String, members: Array, expense: Object },
  emits: ['saved', 'close'],
  setup(_props, { emit }) {
    expenseModalEmit = emit as (event: string, payload: unknown) => void

    return () => h('div', { 'data-test': 'expense-modal-stub' })
  },
})

/** Заглушка модалки компенсации: помнит свой `emit` и число подсказок. */
let compensationModalEmit: ((event: string) => void) | null = null

const CompensationModalStub = defineComponent({
  props: { tripId: String, senders: Array },
  emits: ['saved', 'close', 'stale'],
  setup(props, { emit }) {
    compensationModalEmit = emit as (event: string) => void

    return () =>
      h(
        'div',
        { 'data-test': 'compensation-modal-stub' },
        String(
          (props.senders as { suggestions: unknown[] }[] | undefined)?.reduce(
            (total, sender) => total + sender.suggestions.length,
            0,
          ) ?? 0,
        ),
      )
  },
})

/** Строка залога: по умолчанию — «ничего не вложил, залог не покрыт». */
function depositPerson(
  userId: string,
  displayName: string,
  status: DepositParticipant['status'],
  overrides: Partial<DepositParticipant> = {},
): DepositParticipant {
  return {
    userId,
    displayName,
    avatarUrl: null,
    status,
    updatedByName: null,
    updatedAt: null,
    isMe: false,
    investedRub: 0,
    transferredRub: 0,
    pendingRub: 0,
    coveredRub: 0,
    missingRub: 2000,
    dueRub: 2000,
    holderName: null,
    declined: false,
    hasPendingTransfer: false,
    canDecide: false,
    ...overrides,
  }
}

/**
 * Вкладка с залогом 2 000 ₽ (17.11.2026, v3 — 18.11.2026).
 *
 * Я ещё не вложил и не перевёл ничего, Анна покрыла залог расходами,
 * Борис отказался, и его залог удержан. В секции риска — Борис первым
 * и я; Анны нет: её залог покрыт расходами.
 */
function depositState(overrides: Partial<TripFinance> = {}): TripFinance {
  const base = state()

  return {
    ...base,
    deposit: {
      amountRub: 2000,
      canManage: true,
      me: {
        status: 'pending',
        amountRub: 2000,
        investedRub: 0,
        transferredRub: 0,
        pendingRub: 0,
        coveredRub: 0,
        missingRub: 2000,
        dueRub: 2000,
        canTransfer: true,
        selfHeld: false,
        holderName: null,
        hasPendingTransfer: false,
      },
      // Секция риска: отказавшиеся первыми, потом не добравшие залог.
      participants: [
        depositPerson(BORIS, 'Борис', 'forfeited', {
          declined: true,
          canDecide: true,
          investedRub: 0,
          transferredRub: 2000,
          coveredRub: 2000,
          missingRub: 0,
          dueRub: 0,
          updatedByName: 'Организатор',
          updatedAt: '2026-11-17T11:00:00.000Z',
        }),
        depositPerson(ME, 'Я', 'pending', { isMe: true }),
      ],
      senders: [
        {
          userId: ME,
          displayName: 'Я',
          isMe: true,
          dueRub: 2000,
          recipients: [
            {
              userId: 'org-1',
              displayName: 'Организатор',
              role: 'organizer',
              gender: 'm',
              paymentDetails: '+7 999 111-22-33',
              paymentBank: 'Сбер',
            },
          ],
        },
      ],
    },
    depositForfeits: [
      {
        id: 'f1',
        at: '2026-11-17T11:00:00.000Z',
        sourceUserId: BORIS,
        sourceName: 'Борис',
        amountRub: 2000,
      },
    ],
    depositReturns: [],
    ...overrides,
  }
}

/** Заглушка модалки «Перевести залог»: помнит `emit`, как соседние. */
let depositModalEmit: ((event: string, payload: unknown) => void) | null = null

const DepositModalStub = defineComponent({
  props: { tripId: String, amountRub: Number, senders: Array },
  emits: ['saved', 'close', 'stale'],
  setup(props, { emit }) {
    depositModalEmit = emit as (event: string, payload: unknown) => void

    const senders = (props.senders ?? []) as {
      recipients?: unknown[]
    }[]

    return () =>
      h(
        'div',
        { 'data-test': 'deposit-modal-stub' },
        `${senders.length}:${senders[0]?.recipients?.length ?? 0}`,
      )
  },
})

function mountView(tripId = '7') {
  return mount(TripFinanceView, {
    props: { tripId },
    global: {
      stubs: {
        TripChat: {
          props: ['tripId', 'kind'],
          template: '<div data-test="chat-stub">чат {{ kind }} похода {{ tripId }}</div>',
        },
        TripFinanceExpenseModal: ExpenseModalStub,
        TripFinanceCompensationModal: CompensationModalStub,
        TripFinanceDepositModal: DepositModalStub,
      },
    },
  })
}

describe('вкладка «Бухгалтерия»', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    expenseModalEmit = null
    compensationModalEmit = null
    depositModalEmit = null
    mocks.subscribeTripEvents.mockReturnValue(mocks.stopLiveEvents)
    mocks.getTripFinance.mockResolvedValue(state())
  })

  it('баланс цифрой в одну строку и без подписей-объяснений', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('[data-test="finance-balance"]').text()).toBe('−1 000 ₽')
    expect(wrapper.get('[data-test="finance-card-title"]').text()).toBe('Твой баланс')
    expect(wrapper.get('[data-test="finance-members"]').text()).toContain('Анна')
    expect(wrapper.get('[data-test="finance-members"]').text()).toContain('+2 000 ₽')
    expect(wrapper.get('[data-test="finance-members"]').text()).toContain('−1 000 ₽')
    // Ожидающих переводов нет — второй цифры тоже нет.
    expect(wrapper.find('[data-test="finance-remaining"]').exists()).toBe(false)
    // 13.11.2026: подписей под балансом («Перевод делает должник — не ты»)
    // больше нет — заказчик попросил убрать их совсем.
    expect(wrapper.find('[data-test="finance-hint"]').exists()).toBe(false)
  })

  it('в семье баланс тоже личный, и у каждого человека своя цифра', async () => {
    mocks.getTripFinance.mockResolvedValue(familyState())

    const wrapper = mountView()
    await flushPromises()

    // Заказчик 13.11.2026: «касса семьи» на экране только путала — цифра
    // личная. У меня +3 000, а не +1 000 общей кассы.
    expect(wrapper.get('[data-test="finance-card-title"]').text()).toBe('Твой баланс')
    expect(wrapper.get('[data-test="finance-balance"]').text()).toBe('+3 000 ₽')

    // Строки — по людям, а не по семьям: трое человек, три строки.
    const rows = wrapper.findAll('[data-test="finance-member"]')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.text()).toContain('Я')
    expect(rows[0]?.text()).toContain('−1 000 ₽')
    expect(rows[1]?.text()).toContain('Анна')
    expect(rows[1]?.text()).toContain('+2 000 ₽')
    expect(rows[2]?.text()).toContain('Борис')
    expect(rows[2]?.text()).toContain('−1 000 ₽')
  })

  it('балансы показываются персонально: минус родного не гасится плюсом', async () => {
    mocks.getTripFinance.mockResolvedValue(familyDebtState())

    const wrapper = mountView()
    await flushPromises()

    // Личный плюс — на карточке, минус Анны — отдельной строкой.
    expect(wrapper.get('[data-test="finance-balance"]').text()).toBe('+1 000 ₽')

    const rows = wrapper.findAll('[data-test="finance-member"]')
    expect(rows[1]?.text()).toContain('Анна')
    expect(rows[1]?.text()).toContain('−1 500 ₽')
  })

  it('расход подписан конкретным человеком, даже если он в семье', async () => {
    mocks.getTripFinance.mockResolvedValue(familyState())

    const wrapper = mountView()
    await flushPromises()

    const row = wrapper.get('[data-test="finance-row-expense"]')
    expect(row.text()).toContain('Анна')
    // «Расход от конкретного человека» — не от кассы семьи.
    expect(row.text()).not.toContain('Я и Анна')
  })

  it('компенсация подписана людьми, даже если они из одной семьи', async () => {
    mocks.getTripFinance.mockResolvedValue(
      familyState({
        compensations: [
          compensation({
            fromUserId: ANNA,
            fromName: 'Анна',
            toUserId: BORIS,
            toName: 'Борис',
            canConfirm: false,
          }),
        ],
      }),
    )

    const wrapper = mountView()
    await flushPromises()

    // Заказчик 13.11.2026: «в движении средств отображать персонально».
    const row = wrapper.get('[data-test="finance-row-compensation"]')
    expect(row.text()).toContain('Анна → Борис')
    expect(row.text()).not.toContain('Я и Анна')
  })

  it('вторая строка появляется, когда ожидающие переводы сдвинули баланс', async () => {
    mocks.getTripFinance.mockResolvedValue(
      state({
        me: meQuiet({ balanceRub: -1000 }),
      }),
    )

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('[data-test="finance-remaining"]').text()).toBe(
      'С учётом ожидающих — 0 ₽',
    )
  })

  it('расход в таблице подписан автором, датой и долями', async () => {
    const wrapper = mountView()
    await flushPromises()

    const row = wrapper.get('[data-test="finance-row-expense"]')
    expect(row.text()).toContain('Анна')
    expect(row.text()).toContain('11.11.2026')
    expect(row.text()).toContain('Продукты')
    expect(row.text()).toContain('на всех · по 1 000 ₽')
    expect(row.text()).toContain('3 000 ₽')
    // Расход не мой — карандаша нет.
    expect(row.find('[data-test="finance-expense-edit"]').exists()).toBe(false)
  })

  it('у автора расхода есть карандаш, и модалка получает эту запись', async () => {
    mocks.getTripFinance.mockResolvedValue(state({ expenses: [expense({ canEdit: true })] }))

    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-test="finance-expense-edit"]').trigger('click')

    expect(wrapper.find('[data-test="expense-modal-stub"]').exists()).toBe(true)
    const modal = wrapper.findComponent(ExpenseModalStub)
    expect(modal.props('expense')).toMatchObject({ id: 'e1' })
    expect(modal.props('members')).toHaveLength(3)
  })

  it('компенсация: «ждём подтверждения» и кнопка у получателя', async () => {
    mocks.getTripFinance.mockResolvedValue(state({ compensations: [compensation()] }))

    const wrapper = mountView()
    await flushPromises()

    const row = wrapper.get('[data-test="finance-row-compensation"]')
    expect(row.text()).toContain('Анна → Я')
    expect(row.text()).toContain('ждём подтверждения')
    expect(row.find('[data-test="finance-compensation-confirm"]').exists()).toBe(true)
    // Отменить может только отправитель, а отправитель здесь Анна.
    expect(row.find('[data-test="finance-compensation-cancel"]').exists()).toBe(false)
  })

  it('«Получено» подтверждает перевод и заменяет вкладку целиком', async () => {
    const pending = compensation()
    const confirmed = compensation({
      status: 'confirmed',
      confirmedAt: '2026-11-12T09:00:00.000Z',
      canConfirm: false,
    })

    mocks.getTripFinance.mockResolvedValue(state({ compensations: [pending] }))
    mocks.confirmTripCompensation.mockResolvedValue(
      state({
        compensations: [confirmed],
        me: meQuiet(),
      }),
    )

    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-test="finance-compensation-confirm"]').trigger('click')
    await flushPromises()

    expect(mocks.confirmTripCompensation).toHaveBeenCalledWith('7', 'c1')

    const row = wrapper.get('[data-test="finance-row-compensation"]')
    expect(row.text()).toContain('получено 12.11.2026')
    // Баланс пересчитан ответом сервера, а не на экране.
    expect(wrapper.get('[data-test="finance-balance"]').text()).toBe('0 ₽')
  })

  it('«Отменить» удаляет ожидающий перевод у отправителя', async () => {
    const mine = compensation({
      fromUserId: ME,
      fromName: 'Я',
      toUserId: ANNA,
      toName: 'Анна',
      canConfirm: false,
      canCancel: true,
    })

    mocks.getTripFinance.mockResolvedValue(state({ compensations: [mine] }))
    mocks.deleteTripCompensation.mockResolvedValue(state({ compensations: [] }))

    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-test="finance-compensation-cancel"]').trigger('click')
    await flushPromises()

    expect(mocks.deleteTripCompensation).toHaveBeenCalledWith('7', 'c1')
  })

  it('ошибка сервера при подтверждении остаётся на экране', async () => {
    mocks.getTripFinance.mockResolvedValue(state({ compensations: [compensation()] }))
    mocks.confirmTripCompensation.mockRejectedValue(
      new ApiError(403, 'Подтвердить получение может только получатель', null),
    )

    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-test="finance-compensation-confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="finance-action-error"]').text()).toBe(
      'Подтвердить получение может только получатель',
    )
  })

  it('«Компенсация» прячется, когда переводить нечего', async () => {
    mocks.getTripFinance.mockResolvedValue(
      state({
        me: meQuiet(),
      }),
    )

    const wrapper = mountView()
    await flushPromises()

    // 17.11.2026: заказчик разрешил скрывать кнопку в плюсе — выключенная
    // «Компенсация» занимала место и ничего не объясняла.
    expect(wrapper.find('[data-test="finance-compensate"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="finance-hint"]').exists()).toBe(false)
  })

  it('долг, занятый ожидающими переводами, не показывает компенсацию', async () => {
    mocks.getTripFinance.mockResolvedValue(
      state({
        me: meQuiet({ familyDebtRub: 1000 }),
      }),
    )

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-test="finance-compensate"]').exists()).toBe(false)
  })

  it('плюс у меня и минус у родного: кнопка работает — папа платит за сына', async () => {
    mocks.getTripFinance.mockResolvedValue(familyDebtState())

    const wrapper = mountView()
    await flushPromises()

    // Касса семьи в минусе из-за Анны: личный плюс не должен мешать.
    expect(wrapper.find('[data-test="finance-compensate"]').exists()).toBe(true)

    await wrapper.get('[data-test="finance-compensate"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="compensation-modal-stub"]').text()).toBe('1')
  })

  it('плюс у меня и минус у человека без аккаунта: кнопка работает', async () => {
    mocks.getTripFinance.mockResolvedValue(
      state({
        // Мне должны 2 000 — лично переводить нечего.
        me: meQuiet({ balanceRub: 2000, remainingRub: 2000, familyCreditRub: 2000 }),
        managedSenders: [
          {
            userId: 'vitya',
            displayName: 'Дядя Витя',
            familyDebtRub: 1000,
            familyCreditRub: 0,
            suggestions: state().me.suggestions,
          },
        ],
      }),
    )

    const wrapper = mountView()
    await flushPromises()

    // За Дядю Витю платит тот, кто его ведёт: кнопка открыта ради него.
    expect(wrapper.find('[data-test="finance-compensate"]').exists()).toBe(true)

    await wrapper.get('[data-test="finance-compensate"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="compensation-modal-stub"]').text()).toBe('1')
  })

  it('«Вам должны» без долга у подопечных не показывает компенсацию', async () => {
    mocks.getTripFinance.mockResolvedValue(
      state({
        me: meQuiet({ balanceRub: 2000, remainingRub: 2000, familyCreditRub: 2000 }),
      }),
    )

    const wrapper = mountView()
    await flushPromises()

    // Перевод делает должник — кнопки нет вовсе, без текста-объяснения.
    expect(wrapper.find('[data-test="finance-compensate"]').exists()).toBe(false)
  })

  it('приглашённый видит вкладку, но менять деньги не может', async () => {
    mocks.getTripFinance.mockResolvedValue(
      state({
        me: meQuiet({ canSpend: false }),
      }),
    )

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('[data-test="finance-add-expense"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="finance-compensate"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="finance-hint"]').exists()).toBe(false)
  })

  it('пустая вкладка приглашает записать первую трату', async () => {
    mocks.getTripFinance.mockResolvedValue(
      state({
        expenses: [],
        compensations: [],
        me: meQuiet(),
      }),
    )

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('[data-test="finance-empty"]').text()).toContain('Пока никто ничего не тратил')
    expect(wrapper.find('[data-test="finance-rows"]').exists()).toBe(false)
  })

  it('чат бухгалтерии остаётся на вкладке даже при ошибке загрузки', async () => {
    mocks.getTripFinance.mockRejectedValue(
      new ApiError(403, 'Это доступно только участнику похода', null),
    )

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('[data-test="finance-error"]').text()).toBe(
      'Это доступно только участнику похода',
    )
    expect(wrapper.get('[data-test="chat-stub"]').text()).toContain('trip_finance')
  })

  it('ответ модалки заменяет вкладку и закрывает её', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-test="finance-add-expense"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="expense-modal-stub"]').exists()).toBe(true)

    expenseModalEmit?.('saved', state({ expenses: [expense({ id: 'e2', amountRub: 900 })] }))
    await nextTick()
    await flushPromises()

    expect(wrapper.find('[data-test="expense-modal-stub"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="finance-row-expense"]').text()).toContain('900 ₽')
  })

  /**
   * Причина бага 12.11.2026: вкладка держала подсказки с прошлой загрузки,
   * а записи уже удалили — модалка предлагала перевод, сервер отвечал
   * «Вам не нужно ничего компенсировать». Открытие модалки теперь сначала
   * перечитывает вкладку.
   */
  it('«Компенсация» открывается по свежим подсказкам, а не по прошлой загрузке', async () => {
    mocks.getTripFinance
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce(
        state({
          me: {
            ...state().me,
            suggestions: [
              ...state().me.suggestions,
              {
                userIds: [BORIS],
                displayName: 'Борис',
                amountRub: 400,
                members: [
                  {
                    userId: BORIS,
                    displayName: 'Борис',
                    gender: 'm',
                    paymentDetails: null,
                    paymentBank: null,
                  },
                ],
              },
            ],
          },
        }),
      )

    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-test="finance-compensate"]').trigger('click')
    await flushPromises()

    expect(mocks.getTripFinance).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-test="compensation-modal-stub"]').text()).toBe('2')
  })

  it('если свежие данные говорят «переводить нечего», модалка не открывается', async () => {
    mocks.getTripFinance
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce(state({ me: meQuiet() }))

    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-test="finance-compensate"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="compensation-modal-stub"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="finance-action-error"]').text()).toBe(
      'Ты никому не должен.',
    )
  })

  it('отказ сервера по остатку перечитывает вкладку', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-test="finance-compensate"]').trigger('click')
    await flushPromises()
    expect(mocks.getTripFinance).toHaveBeenCalledTimes(2)

    compensationModalEmit?.('stale')
    await flushPromises()

    expect(mocks.getTripFinance).toHaveBeenCalledTimes(3)
  })

  it('подписывается на денежный поток похода и снимает подписку при уходе', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(mocks.subscribeTripEvents).toHaveBeenCalledWith(
      '7',
      expect.any(Function),
      'finance',
    )

    wrapper.unmount()

    expect(mocks.stopLiveEvents).toHaveBeenCalled()
  })

  it('чужое и своё изменение перечитывают вкладку, чужая вкладка — нет', async () => {
    // 13.11.2026: под одним аккаунтом бывает несколько вкладок браузера,
    // поэтому своё действие (actorId = я) тоже перечитывается: иначе вторая
    // вкладка показывала бы старый баланс.
    useAuthStore().user = { id: ME, displayName: 'Я' } as User

    const wrapper = mountView()
    await flushPromises()

    expect(mocks.getTripFinance).toHaveBeenCalledTimes(1)

    const liveEvent = mocks.subscribeTripEvents.mock.calls[0]?.[1] as (event: unknown) => void

    // Чужая вкладка — поток общий на поход: деньги не перечитываем.
    liveEvent({ scope: 'gear', actorId: ANNA, at: '2026-11-11T10:00:00.000Z' })

    await new Promise((resolve) => setTimeout(resolve, 400))
    await flushPromises()
    expect(mocks.getTripFinance).toHaveBeenCalledTimes(1)

    // Своё действие из соседней вкладки того же аккаунта.
    liveEvent({ scope: 'finance', actorId: ME, at: '2026-11-11T10:00:00.000Z' })

    await new Promise((resolve) => setTimeout(resolve, 400))
    await flushPromises()
    expect(mocks.getTripFinance).toHaveBeenCalledTimes(2)

    // И чужое действие — тоже.
    liveEvent({ scope: 'finance', actorId: ANNA, at: '2026-11-11T10:00:01.000Z' })

    await new Promise((resolve) => setTimeout(resolve, 400))
    await flushPromises()
    expect(mocks.getTripFinance).toHaveBeenCalledTimes(3)

    wrapper.unmount()
  })

  // ─────────────────────── залог участия (v3, 18.11.2026) ───────────────────────

  it('секция риска над «Движением денег»: отказавшиеся и идущие с недостатком', async () => {
    mocks.getTripFinance.mockResolvedValue(depositState())

    const wrapper = mountView()
    await flushPromises()

    const block = wrapper.get('[data-test="finance-deposit"]')
    expect(block.text()).toContain('Залог участия')
    expect(block.text()).toContain('2 000 ₽ с человека')

    // Счётчиков «Сдали 3 из 6» и переключателя «Только риски» больше нет:
    // заказчик просил убрать их совсем.
    expect(wrapper.find('[data-test="finance-deposit-summary"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="finance-deposit-toggle"]').exists()).toBe(false)

    // В списке только риск: отказавшийся Борис и не добравший залог я.
    // Анна покрыла залог расходами — её тут нет.
    const rows = wrapper.findAll('[data-test="finance-deposit-person"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain('Борис')
    expect(rows[0]?.text()).toContain('отказался')
    expect(rows[0]?.text()).toContain('залог удержан')
    expect(rows[1]?.text()).toContain('не перевёл залог и недостаточно вложился')
    expect(rows[1]?.text()).toContain('вложил 0 ₽ из 2 000 ₽')
    expect(block.text()).not.toContain('Анна')

    // Кнопок «Сдал» и «Снять» нет: сдачу подтверждает получатель перевода,
    // а из решения остались два сегмента — «Вернуть» и «Удержать».
    expect(wrapper.find('[data-test="finance-deposit-take"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="finance-deposit-reset"]').exists()).toBe(false)

    // Блок выше ленты: «размести это над секцией Движение денег».
    expect(wrapper.html().indexOf('finance-deposit"')).toBeLessThan(
      wrapper.html().indexOf('finance-ledger"'),
    )
  })

  it('«Снять» убран: флаг «Вернуть/Удержать» и никакого сброса', async () => {
    mocks.getTripFinance.mockResolvedValue(depositState())
    mocks.setTripDepositStatus.mockResolvedValue(depositState())

    const wrapper = mountView()
    await flushPromises()

    const flag = wrapper.get('[data-test="finance-deposit-flag"]')
    expect(flag.text()).toContain('Вернуть')
    expect(flag.text()).toContain('Удержать')
    // Сейчас удержан — выбран именно «Удержать» (класс заливки).
    expect(wrapper.get('[data-test="finance-deposit-forfeit"]').classes()).toContain(
      'bg-red-600',
    )

    await wrapper.get('[data-test="finance-deposit-return"]').trigger('click')
    await flushPromises()

    expect(mocks.setTripDepositStatus).toHaveBeenCalledWith('7', BORIS, 'returned')
  })

  it('отказавшемуся без покрытия решать нечего — флага нет', async () => {
    const view = depositState()
    view.deposit!.participants = [
      depositPerson(BORIS, 'Борис', 'pending', {
        declined: true,
        canDecide: false,
        coveredRub: 0,
        missingRub: 2000,
        dueRub: 2000,
      }),
    ]

    mocks.getTripFinance.mockResolvedValue(view)

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-test="finance-deposit-flag"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="finance-deposit-hint"]').text()).toBe(
      'залог не покрыт — решать нечего',
    )
  })

  it('удержание — строка фонда, а не пересборка личных балансов', async () => {
    mocks.getTripFinance.mockResolvedValue(depositState())

    const wrapper = mountView()
    await flushPromises()

    const forfeit = wrapper.get('[data-test="finance-ledger"] [data-test="finance-row-deposit"]')
    expect(forfeit.text()).toContain('Борис')
    expect(forfeit.text()).toContain('Залог удержан')
    expect(forfeit.text()).toContain('в фонд группы')

    const effect = wrapper.get('[data-test="finance-deposit-effect"]').text()
    expect(effect).toContain('остаётся в фонде группы')
    // Прежней формулы «−залог, каждому идущему +доля» больше нет.
    expect(effect).not.toContain('+1 000 ₽')
  })

  it('без залога блока нет вовсе — пустой карточки на экране не бывает', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-test="finance-deposit"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="finance-deposit-self"]').exists()).toBe(false)
  })

  it('перевод залога стоит в ленте строкой «Залог за участие»', async () => {
    const view = depositState()
    view.compensations = [
      ...view.compensations,
      {
        id: 'd1',
        createdAt: '2026-11-18T10:00:00.000Z',
        fromUserId: ME,
        fromName: 'Я',
        toUserId: 'org-1',
        toName: 'Организатор',
        amountRub: 2000,
        kind: 'deposit',
        status: 'pending',
        confirmedAt: null,
        canConfirm: false,
        canCancel: true,
      },
    ]

    mocks.getTripFinance.mockResolvedValue(view)

    const wrapper = mountView()
    await flushPromises()

    const row = wrapper
      .findAll('[data-test="finance-row-compensation"]')
      .find((item) => item.text().includes('Залог за участие'))

    expect(row).toBeDefined()
    expect(row!.text()).toContain('Я → Организатор')
    expect(row!.text()).toContain('ждём подтверждения')
    // Отменить ожидающий перевод может отправитель.
    expect(row!.find('[data-test="finance-compensation-cancel"]').exists()).toBe(true)
  })

  it('возврат залога объясняет, куда ушла доля ушедшего', async () => {
    const view = depositState()
    view.depositReturns = [
      {
        id: 'r1',
        at: '2026-11-18T11:00:00.000Z',
        sourceUserId: BORIS,
        sourceName: 'Борис',
        amountRub: 2000,
        shares: [
          { userId: ME, displayName: 'Я', amountRub: 1000 },
          { userId: ANNA, displayName: 'Анна', amountRub: 1000 },
        ],
      },
    ]

    mocks.getTripFinance.mockResolvedValue(view)

    const wrapper = mountView()
    await flushPromises()

    const row = wrapper.get('[data-test="finance-row-depositReturn"]')
    expect(row.text()).toContain('Залог возвращён')
    expect(row.text()).toContain('доля ушедшего · по 1 000 ₽')
  })

  it('рядовой участник: залог в «Твоём балансе», секции риска нет', async () => {
    const view = depositState()
    view.deposit!.canManage = false
    view.deposit!.participants = []

    mocks.getTripFinance.mockResolvedValue(view)

    const wrapper = mountView()
    await flushPromises()

    // Секции риска нет: она только организатору и соорганизатору.
    expect(wrapper.find('[data-test="finance-deposit"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="finance-deposit-return"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="finance-deposit-forfeit"]').exists()).toBe(false)

    // Строка залога — в карточке «Твой баланс», а не отдельным блоком.
    const self = wrapper.get('[data-test="finance-deposit-self"]')
    expect(self.text()).toContain('В походе установлен залог — 2 000 ₽')
    expect(self.text()).toContain('вложил 0 ₽ из 2 000 ₽')
    expect(self.text()).toContain('не покрыто 2 000 ₽')
    expect(wrapper.find('[data-test="finance-deposit-transfer"]').exists()).toBe(true)
  })

  it('залог покрыт расходами — кнопки нет', async () => {
    const view = depositState()
    view.deposit!.me = {
      ...view.deposit!.me!,
      status: 'held',
      investedRub: 3000,
      coveredRub: 2000,
      missingRub: 0,
      dueRub: 0,
      canTransfer: false,
    }
    view.deposit!.senders = []

    mocks.getTripFinance.mockResolvedValue(view)

    const wrapper = mountView()
    await flushPromises()

    const self = wrapper.get('[data-test="finance-deposit-self"]')
    expect(self.text()).toContain('залог покрыт')
    expect(wrapper.find('[data-test="finance-deposit-transfer"]').exists()).toBe(false)
  })

  it('частичное покрытие: вложил и перевёл, остаток виден', async () => {
    const view = depositState()
    view.deposit!.me = {
      ...view.deposit!.me!,
      investedRub: 500,
      transferredRub: 500,
      coveredRub: 1000,
      missingRub: 1000,
      dueRub: 1000,
      canTransfer: true,
    }

    mocks.getTripFinance.mockResolvedValue(view)

    const wrapper = mountView()
    await flushPromises()

    const self = wrapper.get('[data-test="finance-deposit-self"]')
    expect(self.text()).toContain('вложил 500 ₽ из 2 000 ₽')
    expect(self.text()).toContain('перевёл 500 ₽')
    expect(self.text()).toContain('не покрыто 1 000 ₽')
  })

  it('организатор с человеком без аккаунта видит «Перевести залог»', async () => {
    const view = depositState()
    view.deposit!.senders = [
      {
        userId: 'virtual-1',
        displayName: 'Дядя Витя',
        isMe: false,
        dueRub: 2000,
        recipients: [],
      },
    ]

    mocks.getTripFinance.mockResolvedValue(view)

    const wrapper = mountView()
    await flushPromises()

    // Кнопка в «Твоём балансе» — за виртуального залог передаёт ведущий.
    expect(wrapper.find('[data-test="finance-deposit-transfer"]').exists()).toBe(true)
  })

  it('«Перевести залог» открывает модалку и заменяет вкладку ответом', async () => {
    mocks.getTripFinance.mockResolvedValue(depositState())

    const wrapper = mountView()
    await flushPromises()

    const button = wrapper.get('[data-test="finance-deposit-transfer"]')
    expect(button.text()).toBe('Перевести залог')

    await button.trigger('click')
    await flushPromises()

    // Перед открытием вкладка перечитана: залог мог уже уйти.
    expect(mocks.getTripFinance).toHaveBeenCalledTimes(2)
    // В заглушку пришли получатели и отправители (1:1).
    expect(wrapper.get('[data-test="deposit-modal-stub"]').text()).toBe('1:1')

    depositModalEmit?.('saved', depositState())
    await nextTick()
    await flushPromises()

    expect(wrapper.find('[data-test="deposit-modal-stub"]').exists()).toBe(false)
  })

  it('«Перевести залог» прячется, когда передавать некому', async () => {
    const view = depositState()
    view.deposit!.senders = []
    view.deposit!.me!.status = 'held'
    view.deposit!.me!.canTransfer = false
    view.deposit!.me!.coveredRub = 2000
    view.deposit!.me!.missingRub = 0
    view.deposit!.me!.dueRub = 0
    view.deposit!.me!.holderName = 'Организатор'

    mocks.getTripFinance.mockResolvedValue(view)

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-test="finance-deposit-transfer"]').exists()).toBe(false)
  })

  it('ошибка решения остаётся на экране, а вкладка не теряется', async () => {
    mocks.getTripFinance.mockResolvedValue(depositState())
    mocks.setTripDepositStatus.mockRejectedValue(
      new ApiError(403, 'Судьбу залога решает организатор похода'),
    )

    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-test="finance-deposit-return"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="finance-action-error"]').text()).toBe(
      'Судьбу залога решает организатор похода',
    )
    expect(wrapper.find('[data-test="finance-deposit"]').exists()).toBe(true)
  })
})
