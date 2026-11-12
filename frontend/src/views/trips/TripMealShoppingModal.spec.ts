import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { TripMealCheck } from '@/types/trips'
import TripMealShoppingModal from '@/views/trips/TripMealShoppingModal.vue'

/**
 * «Чек» в «Списке общих продуктов» (12.11.2026).
 *
 * Заказчик: «Сразу добавить кнопку Чек в Походы → Питание → Список общих
 * продуктов: сумма и комментарий, пустой „на продукты“, делится на всех
 * питающихся с общего». Тест держит ровно это: чек — расход с
 * `split = 'commonEaters'`, пустой комментарий не отправляется вовсе (сервер
 * сам запишет «на продукты»), а если есть с кого делить — кнопки нет.
 */
const mocks = vi.hoisted(() => ({
  fetchMealChecks: vi.fn(),
  fetchMyMealChecks: vi.fn(),
  createTripExpense: vi.fn(),
}))

vi.mock('@/api/trips', () => ({
  fetchMealChecks: mocks.fetchMealChecks,
  fetchMyMealChecks: mocks.fetchMyMealChecks,
  updateMealCheck: vi.fn(),
  updateMyMealCheck: vi.fn(),
}))

vi.mock('@/api/finance', () => ({
  createTripExpense: mocks.createTripExpense,
}))

function check(): TripMealCheck {
  return {
    productId: 1,
    name: 'Гречка',
    unit: 'g',
    weightPerUnitGrams: 0,
    needAmount: 160,
    needGrams: 160,
    isBought: false,
    isHome: false,
    boughtAmount: null,
    boughtByName: null,
    boughtAt: null,
    isOrphaned: false,
  }
}

function mountModal(props: { personal?: boolean; commonEaters?: number } = {}) {
  return mount(TripMealShoppingModal, {
    props: { tripId: '7', commonEaters: 6, ...props },
  })
}

describe('чек из «Списка общих продуктов»', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchMealChecks.mockResolvedValue([check()])
    mocks.fetchMyMealChecks.mockResolvedValue([check()])
    mocks.createTripExpense.mockResolvedValue({})
  })

  it('пустой комментарий — без описания: «на продукты» дописывает сервер', async () => {
    const wrapper = mountModal()
    await flushPromises()

    await wrapper.get('[data-test="check-open"]').trigger('click')
    await wrapper.get('[data-test="check-sum"]').setValue('3500')
    await wrapper.get('[data-test="check-form"]').trigger('submit')
    await flushPromises()

    expect(mocks.createTripExpense).toHaveBeenCalledWith('7', {
      amountRub: 3500,
      split: 'commonEaters',
    })
    expect(wrapper.get('[data-test="check-saved"]').text()).toContain('Бухгалтерию')
    expect(wrapper.find('[data-test="check-form"]').exists()).toBe(false)
  })

  it('комментарий уходит описанием расхода', async () => {
    const wrapper = mountModal()
    await flushPromises()

    await wrapper.get('[data-test="check-open"]').trigger('click')
    await wrapper.get('[data-test="check-sum"]').setValue('1200')
    await wrapper.get('[data-test="check-comment"]').setValue('Бензин на заброску')
    await wrapper.get('[data-test="check-form"]').trigger('submit')
    await flushPromises()

    expect(mocks.createTripExpense).toHaveBeenCalledWith('7', {
      amountRub: 1200,
      split: 'commonEaters',
      description: 'Бензин на заброску',
    })
  })

  it('сумма проверяется до запроса', async () => {
    const wrapper = mountModal()
    await flushPromises()

    await wrapper.get('[data-test="check-open"]').trigger('click')
    await wrapper.get('[data-test="check-form"]').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-test="check-error"]').text()).toBe('Укажите сумму чека')
    expect(mocks.createTripExpense).not.toHaveBeenCalled()
  })

  it('ошибку сервера показывает словами', async () => {
    const wrapper = mountModal()
    mocks.createTripExpense.mockRejectedValue(
      new ApiError(400, 'В походе нет питающихся с общего — чек делить не на кого', null),
    )
    await flushPromises()

    await wrapper.get('[data-test="check-open"]').trigger('click')
    await wrapper.get('[data-test="check-sum"]').setValue('500')
    await wrapper.get('[data-test="check-form"]').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-test="check-error"]').text()).toBe(
      'В походе нет питающихся с общего — чек делить не на кого',
    )
  })

  it('все питаются отдельно — чек делить не на кого, кнопка выключена', async () => {
    const wrapper = mountModal({ commonEaters: 0 })
    await flushPromises()

    expect(wrapper.get('[data-test="check-open"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-test="check-unavailable"]').text()).toContain(
      'делить чек не на кого',
    )
  })

  it('в личном списке покупок чека нет', async () => {
    const wrapper = mountModal({ personal: true })
    await flushPromises()

    expect(wrapper.find('[data-test="check-block"]').exists()).toBe(false)
  })
})
