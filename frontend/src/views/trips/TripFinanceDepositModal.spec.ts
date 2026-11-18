import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { DepositRecipient, DepositSender, TripFinance } from '@/types/finance'
import TripFinanceDepositModal from '@/views/trips/TripFinanceDepositModal.vue'

/**
 * Модалка «Перевести залог» (v3, 18.11.2026).
 *
 * Заказчик: «если потратился, но меньше залога, кнопка есть, а в модалке
 * перевода подставим недостающую сумму, её конечно же можно изменить
 * на любую, может решит перевести организатору с запасом». Поэтому тест
 * держит четыре вещи: подставленную недостачу, возможность её увеличить,
 * отдельный список получателей у человека без аккаунта и 400 «залог
 * уже покрыт», который перечитывает вкладку.
 */
const mocks = vi.hoisted(() => ({
  transferTripDeposit: vi.fn(),
}))

vi.mock('@/api/finance', () => ({
  transferTripDeposit: mocks.transferTripDeposit,
}))

const ME = 'me-1'
const VIRTUAL = 'virtual-1'

function recipient(overrides: Partial<DepositRecipient> = {}): DepositRecipient {
  return {
    userId: 'org-1',
    displayName: 'Организатор',
    role: 'organizer',
    gender: 'm',
    paymentDetails: '+7 999 111-22-33',
    paymentBank: 'Сбер',
    ...overrides,
  }
}

function sender(overrides: Partial<DepositSender> = {}): DepositSender {
  return {
    userId: ME,
    displayName: 'Я',
    isMe: true,
    dueRub: 2000,
    recipients: [recipient()],
    ...overrides,
  }
}

function state(): TripFinance {
  return {
    expenses: [],
    compensations: [],
    members: [],
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
      suggestions: [],
    },
  }
}

function mountModal(senders: DepositSender[]) {
  return mount(TripFinanceDepositModal, {
    props: { tripId: '7', amountRub: 2000, senders },
  })
}

describe('модалка «Перевести залог»', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.transferTripDeposit.mockResolvedValue(state())
  })

  it('по умолчанию переводит сам участник и подставляет недостачу', async () => {
    const wrapper = mountModal([sender()])
    await flushPromises()

    expect(wrapper.get('[data-test="finance-deposit-details"]').text()).toBe(
      '+7 999 111-22-33',
    )
    // Список отправителей из одного себя не занимает место.
    expect(wrapper.find('[data-test="finance-deposit-senders"]').exists()).toBe(false)

    const amount = wrapper.get('[data-test="finance-deposit-amount"]')
    expect((amount.element as HTMLInputElement).value).toBe('2000')
    expect(wrapper.get('[data-test="finance-deposit-save"]').text()).toBe(
      'Я передал 2 000 ₽',
    )

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.transferTripDeposit).toHaveBeenCalledWith('7', 'org-1', 2000, undefined)
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('сумму можно увеличить «с запасом»', async () => {
    const wrapper = mountModal([sender()])
    await flushPromises()

    await wrapper.get('[data-test="finance-deposit-amount"]').setValue('3000')
    await flushPromises()

    expect(wrapper.get('[data-test="finance-deposit-excess"]').text()).toContain(
      'Сверх остатка — 1 000 ₽',
    )

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.transferTripDeposit).toHaveBeenCalledWith('7', 'org-1', 3000, undefined)
  })

  it('частичный перевод: подставлена недостача, можно уменьшить', async () => {
    const wrapper = mountModal([sender({ dueRub: 150 })])
    await flushPromises()

    const amount = wrapper.get('[data-test="finance-deposit-amount"]')
    expect((amount.element as HTMLInputElement).value).toBe('150')

    await amount.setValue('100')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.transferTripDeposit).toHaveBeenCalledWith('7', 'org-1', 100, undefined)
  })

  it('сумма меньше рубля не отправляется', async () => {
    const wrapper = mountModal([sender()])
    await flushPromises()

    await wrapper.get('[data-test="finance-deposit-amount"]').setValue('0')
    await flushPromises()

    expect(
      wrapper.get('[data-test="finance-deposit-save"]').attributes('disabled'),
    ).toBeDefined()
    expect(wrapper.find('[data-test="finance-deposit-amount-error"]').exists()).toBe(true)

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.transferTripDeposit).not.toHaveBeenCalled()
  })

  it('за человека без аккаунта переводит ведущий, и его недостача своя', async () => {
    const wrapper = mountModal([
      sender(),
      sender({
        userId: VIRTUAL,
        displayName: 'Дядя Витя',
        isMe: false,
        // Виртуальный платит организатору, который его ведёт.
        dueRub: 150,
        recipients: [recipient()],
      }),
    ])
    await flushPromises()

    expect(wrapper.find('[data-test="finance-deposit-senders"]').exists()).toBe(true)

    await wrapper
      .get(`[data-test="finance-deposit-from-${VIRTUAL}"]`)
      .setValue()
    await flushPromises()

    // Недостача пересчиталась вместе с отправителем.
    expect(
      (wrapper.get('[data-test="finance-deposit-amount"]').element as HTMLInputElement)
        .value,
    ).toBe('150')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.transferTripDeposit).toHaveBeenCalledWith('7', 'org-1', 150, VIRTUAL)
  })

  it('без реквизитов объясняет словами заказчика, по полу', async () => {
    const wrapper = mountModal([
      sender({
        recipients: [
          recipient({
            displayName: 'Анна',
            gender: 'f',
            paymentDetails: null,
            paymentBank: null,
          }),
        ],
      }),
    ])
    await flushPromises()

    expect(
      wrapper.get('[data-test="finance-deposit-no-requisites"]').text(),
    ).toBe(
      'Анна не указала реквизиты в своём профиле, придётся спросить у неё самой.',
    )
  })

  it('400 «залог покрыт» показывает ответ сервера и просит перечитать вкладку', async () => {
    mocks.transferTripDeposit.mockRejectedValue(
      new ApiError(400, 'Залог уже покрыт — переводить нечего'),
    )

    const wrapper = mountModal([sender()])
    await flushPromises()

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-test="finance-deposit-error"]').text()).toBe(
      'Залог уже покрыт — переводить нечего',
    )
    expect(wrapper.emitted('stale')).toHaveLength(1)
  })
})
