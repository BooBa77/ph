import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { CompensationOption, TripFinance } from '@/types/finance'
import TripFinanceCompensationModal from '@/views/trips/TripFinanceCompensationModal.vue'

/**
 * Модалка «Компенсация» (12.11.2026).
 *
 * Слова заказчика: «выбор участника, кому должен пользователь и сумма
 * (подставляется автоматически, можно редактировать). По выбранному
 * участнику отображается его реквизиты из Профиля в виде подсказки, если
 * нет, то надпись „получатель <имя>“».
 *
 * Тест держит: подсказка подставляется, но её можно уменьшить; больше
 * остатка не уходит; переключение кредитора меняет и сумму, и реквизиты;
 * отсутствие реквизитов объясняется словами заказчика.
 */
const mocks = vi.hoisted(() => ({
  createTripCompensation: vi.fn(),
}))

vi.mock('@/api/finance', () => ({
  createTripCompensation: mocks.createTripCompensation,
}))

function option(overrides: Partial<CompensationOption> = {}): CompensationOption {
  return {
    userId: 'anna',
    displayName: 'Анна',
    amountRub: 1000,
    paymentDetails: '+7 999 000-00-00',
    paymentBank: 'Сбер',
    ...overrides,
  }
}

function view(): TripFinance {
  return {
    expenses: [],
    compensations: [],
    members: [],
    me: { balanceRub: 0, remainingRub: 0, canSpend: true, suggestions: [] },
  }
}

const SUGGESTIONS = [
  option(),
  option({
    userId: 'boris',
    displayName: 'Борис',
    amountRub: 400,
    paymentDetails: null,
    paymentBank: null,
  }),
]

function mountModal(suggestions = SUGGESTIONS) {
  return mount(TripFinanceCompensationModal, {
    props: { tripId: '7', suggestions },
  })
}

describe('модалка компенсации', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createTripCompensation.mockResolvedValue(view())
  })

  it('первый кредитор и его сумма подставлены, реквизиты на месте', async () => {
    const wrapper = mountModal()

    expect(
      (wrapper.get('[data-test="finance-compensation-to-anna"]').element as HTMLInputElement)
        .checked,
    ).toBe(true)
    expect(
      (wrapper.get('[data-test="finance-compensation-amount"]').element as HTMLInputElement)
        .value,
    ).toBe('1000')
    expect(wrapper.get('[data-test="finance-compensation-details"]').text()).toBe(
      '+7 999 000-00-00',
    )
    expect(wrapper.get('[data-test="finance-compensation-bank"]').text()).toBe('Сбер')
  })

  it('без реквизитов — фраза заказчика и имя получателя', async () => {
    const wrapper = mountModal([SUGGESTIONS[1]!])

    expect(wrapper.get('[data-test="finance-compensation-no-requisites"]').text()).toBe(
      'Борис не указал(а) реквизиты в своём профиле, спроси у него/неё самого/самой.',
    )
    expect(wrapper.find('[data-test="finance-compensation-details"]').exists()).toBe(false)
  })

  it('переключение кредитора подставляет его сумму и его реквизиты', async () => {
    const wrapper = mountModal()

    await wrapper.get('[data-test="finance-compensation-to-boris"]').setValue(true)

    expect(
      (wrapper.get('[data-test="finance-compensation-amount"]').element as HTMLInputElement)
        .value,
    ).toBe('400')
    expect(wrapper.find('[data-test="finance-compensation-details"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="finance-compensation-no-requisites"]').text()).toContain(
      'Борис',
    )
  })

  it('больше остатка не отправляет и объясняет, сколько осталось', async () => {
    const wrapper = mountModal()

    await wrapper.get('[data-test="finance-compensation-amount"]').setValue('1500')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-test="finance-compensation-error"]').text()).toBe(
      'Больше остатка: этому человеку вы должны 1 000 ₽',
    )
    expect(mocks.createTripCompensation).not.toHaveBeenCalled()
  })

  it('меньше остатка разрешено: сумма редактируемая', async () => {
    const wrapper = mountModal()
    const next = view()
    mocks.createTripCompensation.mockResolvedValue(next)

    await wrapper.get('[data-test="finance-compensation-amount"]').setValue('600')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.createTripCompensation).toHaveBeenCalledWith('7', {
      toUserId: 'anna',
      amountRub: 600,
    })
    expect(wrapper.emitted('saved')?.[0]?.[0]).toEqual(next)
  })

  it('ошибку сервера показывает словами', async () => {
    const wrapper = mountModal()
    mocks.createTripCompensation.mockRejectedValue(
      new ApiError(400, 'Этому человеку вы ничего не должны', null),
    )

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-test="finance-compensation-error"]').text()).toBe(
      'Этому человеку вы ничего не должны',
    )
  })

  it('некому переводить — список пуст и объясняет почему', async () => {
    const wrapper = mountModal([])

    expect(wrapper.get('[data-test="finance-compensation-empty"]').text()).toContain(
      'Переводить некому',
    )
    expect(wrapper.find('[data-test="finance-compensation-save"]').exists()).toBe(false)
  })

  it('весь долг целиком — законная компенсация', async () => {
    // Значение по умолчанию и есть весь остаток: проверяем, что оно уходит
    // без правки, — это самый частый случай «все в раз на обратной дороге».
    const wrapper = mountModal()

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.createTripCompensation).toHaveBeenCalledWith('7', {
      toUserId: 'anna',
      amountRub: 1000,
    })
  })
})
