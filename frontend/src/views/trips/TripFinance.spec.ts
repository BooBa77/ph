import { defineComponent, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { User } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import type {
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

  it('«Компенсация» выключена, когда переводить нечего', async () => {
    mocks.getTripFinance.mockResolvedValue(
      state({
        me: meQuiet(),
      }),
    )

    const wrapper = mountView()
    await flushPromises()

    // 13.11.2026: подписи «Всё в расчёте — переводить нечего» больше нет,
    // выключенной кнопки достаточно.
    expect(
      wrapper.get('[data-test="finance-compensate"]').attributes('disabled'),
    ).toBeDefined()
    expect(wrapper.find('[data-test="finance-hint"]').exists()).toBe(false)
  })

  it('долг, занятый ожидающими переводами, не открывает компенсацию', async () => {
    mocks.getTripFinance.mockResolvedValue(
      state({
        me: meQuiet({ familyDebtRub: 1000 }),
      }),
    )

    const wrapper = mountView()
    await flushPromises()

    expect(
      wrapper.get('[data-test="finance-compensate"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('плюс у меня и минус у родного: кнопка работает — папа платит за сына', async () => {
    mocks.getTripFinance.mockResolvedValue(familyDebtState())

    const wrapper = mountView()
    await flushPromises()

    // Касса семьи в минусе из-за Анны: личный плюс не должен мешать.
    expect(
      wrapper.get('[data-test="finance-compensate"]').attributes('disabled'),
    ).toBeUndefined()

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
    expect(
      wrapper.get('[data-test="finance-compensate"]').attributes('disabled'),
    ).toBeUndefined()

    await wrapper.get('[data-test="finance-compensate"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="compensation-modal-stub"]').text()).toBe('1')
  })

  it('«Вам должны» без долга у подопечных не открывает компенсацию', async () => {
    mocks.getTripFinance.mockResolvedValue(
      state({
        me: meQuiet({ balanceRub: 2000, remainingRub: 2000, familyCreditRub: 2000 }),
      }),
    )

    const wrapper = mountView()
    await flushPromises()

    // Перевод делает должник — кнопка выключена, без текста-объяснения.
    expect(
      wrapper.get('[data-test="finance-compensate"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('приглашённый видит вкладку, но кнопки выключены', async () => {
    mocks.getTripFinance.mockResolvedValue(
      state({
        me: meQuiet({ canSpend: false }),
      }),
    )

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('[data-test="finance-add-expense"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-test="finance-compensate"]').attributes('disabled')).toBeDefined()
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
})
