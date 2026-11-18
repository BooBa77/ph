import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { DepositRecipient, DepositSender, TripFinance } from '@/types/finance'
import TripFinanceDepositModal from '@/views/trips/TripFinanceDepositModal.vue'

/**
 * Модалка «Перевести залог» (18.11.2026).
 *
 * Заказчик: «Перевод организатору — это „залог за участие“ в движении,
 * у организатора уменьшается баланс, теперь он должен». Поэтому модалка
 * создаёт ожидающий перевод, а не отметку «сдал».
 *
 * Тест держит три вещи, на которых уже спотыкались: получатель выбирается
 * с реквизитами, за человека без аккаунта платит ведущий (и его список
 * получателей свой), а 400 «уже переведён» перечитывает вкладку.
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

  it('по умолчанию переводит сам участник и показывает реквизиты', async () => {
    const wrapper = mountModal([sender()])
    await flushPromises()

    expect(wrapper.get('[data-test="finance-deposit-details"]').text()).toBe(
      '+7 999 111-22-33',
    )
    // Список отправителей из одного себя не занимает место.
    expect(wrapper.find('[data-test="finance-deposit-senders"]').exists()).toBe(false)

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.transferTripDeposit).toHaveBeenCalledWith('7', 'org-1', undefined)
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('за человека без аккаунта переводит ведущий, и получатель — организатор', async () => {
    const wrapper = mountModal([
      sender(),
      sender({
        userId: VIRTUAL,
        displayName: 'Дядя Витя',
        isMe: false,
        // Виртуальный платит организатору, который его ведёт.
        recipients: [recipient()],
      }),
    ])
    await flushPromises()

    expect(wrapper.find('[data-test="finance-deposit-senders"]').exists()).toBe(true)

    await wrapper
      .get(`[data-test="finance-deposit-from-${VIRTUAL}"]`)
      .setValue()
    await flushPromises()

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.transferTripDeposit).toHaveBeenCalledWith('7', 'org-1', VIRTUAL)
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
      'Анна не указала реквизиты в своём профиле, придётся спросить у него самого.',
    )
  })

  it('400 «уже переведён» показывает ответ сервера и просит перечитать вкладку', async () => {
    mocks.transferTripDeposit.mockRejectedValue(
      new ApiError(400, 'Залог уже переведён или ждёт подтверждения'),
    )

    const wrapper = mountModal([sender()])
    await flushPromises()

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-test="finance-deposit-error"]').text()).toBe(
      'Залог уже переведён или ждёт подтверждения',
    )
    expect(wrapper.emitted('stale')).toHaveLength(1)
  })
})
