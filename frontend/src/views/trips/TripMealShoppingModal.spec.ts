import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { User } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import type { TripMealCheck } from '@/types/trips'
import TripMealShoppingModal from '@/views/trips/TripMealShoppingModal.vue'

/**
 * «Чек» в «Списке общих продуктов» (12.11.2026) и живой список.
 *
 * Заказчик: «Сразу добавить кнопку Чек в Походы → Питание → Список общих
 * продуктов: сумма и комментарий, пустой „на продукты“, делится на всех
 * питающихся с общего». Тест держит ровно это: чек — расход с
 * `split = 'commonEaters'`, пустой комментарий не отправляется вовсе (сервер
 * сам запишет «на продукты»), а если есть с кого делить — кнопки нет.
 *
 * Второй блок — SSE: две группы закупщиков в соседних магазинах. Отметка
 * коллеги перечитывает список, своё действие — нет.
 */
const mocks = vi.hoisted(() => ({
  fetchMealChecks: vi.fn(),
  fetchMyMealChecks: vi.fn(),
  createTripExpense: vi.fn(),
  subscribeTripEvents: vi.fn(),
  stopLiveEvents: vi.fn(),
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

vi.mock('@/api/events', () => ({
  subscribeTripEvents: mocks.subscribeTripEvents,
}))

enableAutoUnmount(afterEach)

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
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    useAuthStore().user = { id: 'me-1', displayName: 'Я' } as User
    mocks.fetchMealChecks.mockResolvedValue([check()])
    mocks.fetchMyMealChecks.mockResolvedValue([check()])
    mocks.createTripExpense.mockResolvedValue({})
    mocks.subscribeTripEvents.mockReturnValue(mocks.stopLiveEvents)
  })

  it('пустой комментарий — без описания: «на продукты» дописывает сервер', async () => {
    const wrapper = mountModal()
    await flushPromises()

    // 12.11.2026: вместо блока с объяснением — одна кнопка «Чек за продукты».
    expect(wrapper.get('[data-test="check-open"]').text()).toBe('Чек за продукты')
    expect(wrapper.text()).not.toContain('Купили продукты на общие деньги')

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

    expect(wrapper.get('[data-test="check-error"]').text()).toBe('Укажи сумму чека')
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

describe('живой список покупок (SSE)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    useAuthStore().user = { id: 'me-1', displayName: 'Я' } as User
    mocks.fetchMealChecks.mockResolvedValue([check()])
    mocks.fetchMyMealChecks.mockResolvedValue([check()])
    mocks.subscribeTripEvents.mockReturnValue(mocks.stopLiveEvents)
  })

  it('пока модалка открыта, слушает поток «Питания» и отписывается при закрытии', async () => {
    const wrapper = mountModal()
    await flushPromises()

    expect(mocks.subscribeTripEvents).toHaveBeenCalledWith('7', expect.any(Function), 'meals')

    wrapper.unmount()
    expect(mocks.stopLiveEvents).toHaveBeenCalledTimes(1)
  })

  it('чужая отметка перечитывает список, своё действие и чужая вкладка — нет', async () => {
    vi.useFakeTimers()

    try {
      mountModal()
      await flushPromises()

      const onEvent = mocks.subscribeTripEvents.mock.calls[0]![1] as (event: {
        scope: string
        actorId: string
        at: string
      }) => void

      mocks.fetchMealChecks.mockClear()

      onEvent({ scope: 'meals', actorId: 'me-1', at: '2026-11-12T10:00:00Z' })
      await vi.advanceTimersByTimeAsync(400)
      expect(mocks.fetchMealChecks).not.toHaveBeenCalled()

      onEvent({ scope: 'finance', actorId: 'other', at: '2026-11-12T10:00:01Z' })
      await vi.advanceTimersByTimeAsync(400)
      expect(mocks.fetchMealChecks).not.toHaveBeenCalled()

      onEvent({ scope: 'meals', actorId: 'other', at: '2026-11-12T10:00:02Z' })
      await vi.advanceTimersByTimeAsync(400)
      await flushPromises()
      expect(mocks.fetchMealChecks).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
