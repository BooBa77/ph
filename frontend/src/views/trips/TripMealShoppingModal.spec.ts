import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { User } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import type { TripMealCheck, TripParticipant } from '@/types/trips'
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
 * коллеги перечитывает список; своё действие тоже (13.11.2026) — `actorId`
 * не различает вкладки одного аккаунта. Третий блок — правила 13.11.2026:
 * осиротевшая строка красная, снять «куплено» может только купивший.
 */
const mocks = vi.hoisted(() => ({
  fetchMealChecks: vi.fn(),
  fetchMyMealChecks: vi.fn(),
  listParticipants: vi.fn(),
  updateMealCheck: vi.fn(),
  createTripExpense: vi.fn(),
  subscribeTripEvents: vi.fn(),
  stopLiveEvents: vi.fn(),
}))

vi.mock('@/api/trips', () => ({
  fetchMealChecks: mocks.fetchMealChecks,
  fetchMyMealChecks: mocks.fetchMyMealChecks,
  listParticipants: mocks.listParticipants,
  updateMealCheck: mocks.updateMealCheck,
  updateMyMealCheck: vi.fn(),
}))

vi.mock('@/api/finance', () => ({
  createTripExpense: mocks.createTripExpense,
}))

vi.mock('@/api/events', () => ({
  subscribeTripEvents: mocks.subscribeTripEvents,
}))

enableAutoUnmount(afterEach)

function check(overrides: Partial<TripMealCheck> = {}): TripMealCheck {
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
    boughtByUserId: null,
    boughtAt: null,
    isOrphaned: false,
    ...overrides,
  }
}

function participant(
  userId: string,
  displayName: string,
  isVirtual = false,
): TripParticipant {
  return { userId, displayName, isVirtual } as TripParticipant
}

const PARTICIPANTS = [
  participant('me-1', 'Я'),
  participant('friend', 'Борис'),
  participant('virtual-1', 'Виктор', true),
]

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
    mocks.listParticipants.mockResolvedValue(PARTICIPANTS)
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
    mocks.listParticipants.mockResolvedValue(PARTICIPANTS)
    mocks.subscribeTripEvents.mockReturnValue(mocks.stopLiveEvents)
  })

  it('пока модалка открыта, слушает поток «Питания» и отписывается при закрытии', async () => {
    const wrapper = mountModal()
    await flushPromises()

    expect(mocks.subscribeTripEvents).toHaveBeenCalledWith('7', expect.any(Function), 'meals')

    wrapper.unmount()
    expect(mocks.stopLiveEvents).toHaveBeenCalledTimes(1)
  })

  it('любое событие «Питания» перечитывает список — своё тоже, чужая вкладка нет', async () => {
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

      onEvent({ scope: 'finance', actorId: 'other', at: '2026-11-13T10:00:00Z' })
      await vi.advanceTimersByTimeAsync(400)
      expect(mocks.fetchMealChecks).not.toHaveBeenCalled()

      // Своё действие: вторая вкладка того же аккаунта тоже должна обновиться.
      onEvent({ scope: 'meals', actorId: 'me-1', at: '2026-11-13T10:00:01Z' })
      await vi.advanceTimersByTimeAsync(400)
      await flushPromises()
      expect(mocks.fetchMealChecks).toHaveBeenCalledTimes(1)

      onEvent({ scope: 'meals', actorId: 'other', at: '2026-11-13T10:00:02Z' })
      await vi.advanceTimersByTimeAsync(400)
      await flushPromises()
      expect(mocks.fetchMealChecks).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('выбор покупателя в «Списке общих продуктов» (26.11.2026)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    useAuthStore().user = { id: 'me-1', displayName: 'Я' } as User
    mocks.fetchMealChecks.mockResolvedValue([check()])
    mocks.fetchMyMealChecks.mockResolvedValue([check()])
    mocks.listParticipants.mockResolvedValue(PARTICIPANTS)
    mocks.updateMealCheck.mockResolvedValue([
      check({ isBought: true, boughtByUserId: 'virtual-1', boughtByName: 'Виктор' }),
    ])
    mocks.subscribeTripEvents.mockReturnValue(mocks.stopLiveEvents)
  })

  it('по умолчанию выбран текущий аккаунт, в списке — все, включая виртуального', async () => {
    const wrapper = mountModal()
    await flushPromises()

    const select = wrapper.get('[data-test="buyer-select"]')
    expect((select.element as HTMLSelectElement).value).toBe('me-1')
    expect(select.text()).toContain('Борис')
    expect(select.text()).toContain('Виктор (без аккаунта)')
    expect(wrapper.get('[data-test="buyer-hint"]').text()).toContain(
      'снять «куплено» сможет он',
    )
  })

  it('отметка «куплено» отправляет выбранного покупателя', async () => {
    const wrapper = mountModal()
    await flushPromises()

    await wrapper.get('[data-test="buyer-select"]').setValue('virtual-1')
    await wrapper.get('[data-test="check-bought"]').trigger('change')
    await flushPromises()

    expect(mocks.updateMealCheck).toHaveBeenCalledWith('7', 1, {
      isBought: true,
      boughtByUserId: 'virtual-1',
    })
  })

  it('снятие отметки покупателя не шлёт', async () => {
    mocks.fetchMealChecks.mockResolvedValue([
      check({ isBought: true, boughtByUserId: 'me-1' }),
    ])

    const wrapper = mountModal()
    await flushPromises()

    await wrapper.get('[data-test="check-bought"]').trigger('change')
    await flushPromises()

    expect(mocks.updateMealCheck).toHaveBeenCalledWith('7', 1, { isBought: false })
  })

  it('в личном списке выбора покупателя нет, состав не запрашивается', async () => {
    const wrapper = mountModal({ personal: true })
    await flushPromises()

    expect(wrapper.find('[data-test="buyer-block"]').exists()).toBe(false)
    expect(mocks.listParticipants).not.toHaveBeenCalled()
  })
})

describe('правила 13.11.2026: осиротевшая строка и чужое «куплено»', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    useAuthStore().user = { id: 'me-1', displayName: 'Я' } as User
    mocks.fetchMealChecks.mockResolvedValue([check()])
    mocks.fetchMyMealChecks.mockResolvedValue([check()])
    mocks.listParticipants.mockResolvedValue(PARTICIPANTS)
    mocks.subscribeTripEvents.mockReturnValue(mocks.stopLiveEvents)
  })

  it('строка «куплено, а в плане нет» стоит красной с подписью', async () => {
    mocks.fetchMealChecks.mockResolvedValue([
      check({ isBought: true, isOrphaned: true, boughtByUserId: 'me-1' }),
    ])

    const wrapper = mountModal()
    await flushPromises()

    const row = wrapper.get('[data-test="check-row"]')
    expect(row.classes()).toContain('text-red-600')
    expect(row.text()).toContain('нет в плане')
  })

  it('у чужой покупки галочка выключена и объясняет почему', async () => {
    mocks.fetchMealChecks.mockResolvedValue([
      check({ isBought: true, boughtByUserId: 'other' }),
    ])

    const wrapper = mountModal()
    await flushPromises()

    const box = wrapper.get('[data-test="check-bought"]')
    expect(box.attributes('disabled')).toBeDefined()
    expect(wrapper.get('label[title]').attributes('title')).toBe(
      'Снять отметку может тот, кто купил',
    )
  })

  it('свою покупку снять можно', async () => {
    mocks.fetchMealChecks.mockResolvedValue([
      check({ isBought: true, boughtByUserId: 'me-1' }),
    ])

    const wrapper = mountModal()
    await flushPromises()

    expect(
      wrapper.get('[data-test="check-bought"]').attributes('disabled'),
    ).toBeUndefined()
  })
})
