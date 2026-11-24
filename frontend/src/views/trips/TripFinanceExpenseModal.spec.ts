import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, OfflineError } from '@/api/errors'
import type { FinanceMember, TripExpense, TripFinance } from '@/types/finance'
import { localToday } from '@/utils/money'
import TripFinanceExpenseModal from '@/views/trips/TripFinanceExpenseModal.vue'

/**
 * Модалка «Добавить расход» и правка расхода (12.11.2026).
 *
 * Заказчик: «указывается общий расход или на группу участников, сумма,
 * описание» и «строки с расходами редактируются авторами». Тест держит
 * то, что легко сломать: доли показываются **до** сохранения, порядок
 * участников — как в составе, а не как нажимали галочки, пустое описание
 * у чека допустимо, а удаление спрашивает второй раз.
 */
const mocks = vi.hoisted(() => ({
  createTripExpense: vi.fn(),
  updateTripExpense: vi.fn(),
  deleteTripExpense: vi.fn(),
}))

vi.mock('@/api/finance', () => ({
  createTripExpense: mocks.createTripExpense,
  updateTripExpense: mocks.updateTripExpense,
  deleteTripExpense: mocks.deleteTripExpense,
}))

function member(userId: string, displayName: string): FinanceMember {
  return {
    userId,
    displayName,
    avatarUrl: null,
    balanceRub: 0,
    remainingRub: 0,
    isVirtual: false,
    managedByMe: false,
    paymentDetails: null,
    paymentBank: null,
  }
}

const MEMBERS = [
  member('anna', 'Анна'),
  member('boris', 'Борис'),
  member('vera', 'Вера'),
]

function view(): TripFinance {
  return {
    expenses: [],
    compensations: [],
    members: MEMBERS,
    families: [],
    managedSenders: [],
    me: {
      balanceRub: 0,
      remainingRub: 0,
      familyBalanceRub: 0,
      familyRemainingRub: 0,
      familyDebtRub: 0,
      familyCreditRub: 0,
      canSpend: true,
    canRequestPayments: false,
      suggestions: [],
    },
  }
}

function joinExpense(overrides: Partial<TripExpense> = {}): TripExpense {
  return {
    id: 'e1',
    spentAt: '2026-11-10',
    authorUserId: 'me',
    authorName: 'Я',
    authorAvatarUrl: null,
    amountRub: 1500,
    description: 'на продукты',
    split: 'commonEaters',
    shares: [
      { userId: 'anna', displayName: 'Анна', amountRub: 750 },
      { userId: 'boris', displayName: 'Борис', amountRub: 750 },
    ],
    canEdit: true,
    ...overrides,
  }
}

function mountModal(expense: TripExpense | null = null, members = MEMBERS) {
  return mount(TripFinanceExpenseModal, {
    props: { tripId: '7', meId: 'anna', members, expense },
  })
}

async function fill(
  wrapper: ReturnType<typeof mountModal>,
  amount: string,
  description = '',
): Promise<void> {
  await wrapper.get('[data-test="finance-expense-amount"]').setValue(amount)
  if (description !== '') {
    await wrapper.get('[data-test="finance-expense-description"]').setValue(description)
  }
}

describe('модалка расхода', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createTripExpense.mockResolvedValue(view())
    mocks.updateTripExpense.mockResolvedValue(view())
    mocks.deleteTripExpense.mockResolvedValue(view())
  })

  it('новый расход: «за всех», дата платежа и никаких долей до суммы', async () => {
    const wrapper = mountModal()

    // 18.11.2026: заголовок модалки говорит «чек» — как кнопка и лента.
    expect(wrapper.get('#finance-expense-title').text()).toBe('Добавить расходный чек')

    expect(wrapper.get('[data-test="finance-expense-date"]').element).toHaveProperty(
      'value',
      localToday(),
    )
    expect(wrapper.find('[data-test="finance-expense-members"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="finance-expense-preview"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="finance-expense-delete"]').exists()).toBe(false)

    // Слова заказчика 12.11.2026: «За всех» / «За группу», «Дата платежа».
    expect(wrapper.get('[data-test="finance-expense-split"]').text()).toContain('За всех')
    expect(wrapper.get('[data-test="finance-expense-split"]').text()).toContain('За группу')
    expect(wrapper.text()).toContain('Дата платежа')
    expect(wrapper.text()).not.toContain('На всех')
    expect(wrapper.text()).not.toContain('Дата траты')
  })

  it('доли видны до сохранения — остаток раскладывается по рублю', async () => {
    const wrapper = mountModal()

    await fill(wrapper, '1000')

    expect(wrapper.get('[data-test="finance-expense-preview"]').text()).toBe(
      '1 000 ₽: Анна 334 ₽, Борис 333 ₽, Вера 333 ₽',
    )
  })

  it('пустое описание у обычного расхода — ошибка, а не запись «на продукты»', async () => {
    const wrapper = mountModal()

    await fill(wrapper, '3000')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-test="finance-expense-error"]').text()).toBe(
      'Опиши, за что расход',
    )
    expect(mocks.createTripExpense).not.toHaveBeenCalled()
  })

  it('расход на всех уходит без списка участников', async () => {
    const wrapper = mountModal()
    const next = view()
    mocks.createTripExpense.mockResolvedValue(next)

    await fill(wrapper, '3000', 'Продукты')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.createTripExpense).toHaveBeenCalledWith('7', {
      amountRub: 3000,
      split: 'all',
      spentAt: localToday(),
      description: 'Продукты',
      clientId: expect.any(String),
    })
    expect(wrapper.emitted('saved')?.[0]?.[0]).toEqual(next)
  })

  it('на группу без единой галочки не отправляет', async () => {
    const wrapper = mountModal()

    await wrapper.get('[data-test="finance-expense-split-group"]').trigger('click')
    await fill(wrapper, '1000', 'Ужин')

    expect(wrapper.find('[data-test="finance-expense-members"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="finance-expense-preview"]').exists()).toBe(false)

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-test="finance-expense-error"]').text()).toBe(
      'Отметь, на кого разделить расход',
    )
    expect(mocks.createTripExpense).not.toHaveBeenCalled()
  })

  it('участники группы уходят в порядке состава, а не в порядке галочек', async () => {
    const wrapper = mountModal()

    await wrapper.get('[data-test="finance-expense-split-group"]').trigger('click')
    // Нажимаем в обратном порядке: сервер разложит остаток по составу.
    await wrapper.get('[data-test="finance-expense-member-boris"]').setValue(true)
    await wrapper.get('[data-test="finance-expense-member-anna"]').setValue(true)
    await fill(wrapper, '500', 'Ужин')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.createTripExpense).toHaveBeenCalledWith('7', {
      amountRub: 500,
      split: 'group',
      spentAt: localToday(),
      description: 'Ужин',
      participantIds: ['anna', 'boris'],
      clientId: expect.any(String),
    })
  })

  it('плательщиком можно выбрать своего человека без аккаунта', async () => {
    const virtual = member('vitya', 'Дядя Витя')
    virtual.isVirtual = true
    virtual.managedByMe = true

    const wrapper = mountModal(null, [...MEMBERS, virtual])

    expect(wrapper.find('[data-test="finance-expense-payer"]').exists()).toBe(true)
    await wrapper.get('[data-test="finance-expense-payer-select"]').setValue('vitya')
    await fill(wrapper, '900', 'Бензин')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.createTripExpense).toHaveBeenCalledWith('7', {
      amountRub: 900,
      split: 'all',
      spentAt: localToday(),
      description: 'Бензин',
      payerUserId: 'vitya',
      clientId: expect.any(String),
    })
  })

  it('без своих людей без аккаунта выбора плательщика нет', async () => {
    const wrapper = mountModal()

    expect(wrapper.find('[data-test="finance-expense-payer"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Плательщик — ты')
  })

  it('правка чека: третий сегмент на месте, пустой комментарий допустим', async () => {
    const wrapper = mountModal(joinExpense({ description: '' }))

    expect(wrapper.get('#finance-expense-title').text()).toBe('Изменить расходный чек')
    expect(wrapper.find('[data-test="finance-expense-split-commonEaters"]').exists()).toBe(true)

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.updateTripExpense).toHaveBeenCalledWith('7', 'e1', {
      amountRub: 1500,
      split: 'commonEaters',
      spentAt: '2026-11-10',
    })
  })

  it('удаление расхода спрашивает второй раз', async () => {
    const wrapper = mountModal(joinExpense())

    const remove = wrapper.get('[data-test="finance-expense-delete"]')
    expect(remove.text()).toBe('Удалить')

    await remove.trigger('click')
    expect(mocks.deleteTripExpense).not.toHaveBeenCalled()
    expect(remove.text()).toBe('Точно удалить?')

    await remove.trigger('click')
    await flushPromises()

    expect(mocks.deleteTripExpense).toHaveBeenCalledWith('7', 'e1')
    expect(wrapper.emitted('saved')).toBeTruthy()
  })

  it('ошибку сервера показывает словами, а не «что-то пошло не так»', async () => {
    const wrapper = mountModal()
    mocks.createTripExpense.mockRejectedValue(
      new ApiError(400, 'В походе нет питающихся с общего — чек делить не на кого', null),
    )

    await fill(wrapper, '3000', 'Продукты')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-test="finance-expense-error"]').text()).toBe(
      'В походе нет питающихся с общего — чек делить не на кого',
    )
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  /**
   * Офлайн-чек (19.11.2026). Заказчик: «создание расходных чеков должно
   * быть доступно оффлайн (за наличку)». Без связи чек не теряется и не
   * показывается ошибкой — он ложится в очередь устройства.
   */
  it('без связи чек уходит в очередь, а не в ошибку', async () => {
    const wrapper = mountModal()
    mocks.createTripExpense.mockRejectedValue(new OfflineError())

    await fill(wrapper, '800', 'Дрова')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-test="finance-expense-error"]').exists()).toBe(false)

    const queued = wrapper.emitted('queued')?.[0]?.[0] as
      | { amountRub: number; description?: string; spentAt: string }[]
      | undefined

    expect(queued).toHaveLength(1)
    expect(queued?.[0]?.amountRub).toBe(800)
    expect(queued?.[0]?.description).toBe('Дрова')
    expect(queued?.[0]?.spentAt).toBe(localToday())
    expect(wrapper.emitted('close')).toBeTruthy()
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('правка расхода ключа идемпотентности не присылает', async () => {
    const wrapper = mountModal(joinExpense())

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.updateTripExpense).toHaveBeenCalledWith(
      '7',
      'e1',
      expect.not.objectContaining({ clientId: expect.anything() }),
    )
  })
})
