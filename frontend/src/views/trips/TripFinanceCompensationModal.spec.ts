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
 * нет, то надпись «получатель <имя>»». Семейный случай: получатель —
 * одна строка «Вася и Аня», сумма — общий долг семьи, реквизиты всех,
 * у кого они есть.
 *
 * Тест держит: подсказка подставляется, но её можно уменьшить; больше
 * остатка не уходит; переключение меняет и сумму, и реквизиты; отсутствие
 * реквизитов объясняется словами заказчика — по полу и для семьи.
 */
const mocks = vi.hoisted(() => ({
  createTripCompensation: vi.fn(),
}))

vi.mock('@/api/finance', () => ({
  createTripCompensation: mocks.createTripCompensation,
}))

function option(overrides: Partial<CompensationOption> = {}): CompensationOption {
  return {
    userIds: ['anna'],
    displayName: 'Анна',
    amountRub: 1000,
    members: [
      {
        userId: 'anna',
        displayName: 'Анна',
        gender: 'f',
        paymentDetails: '+7 999 000-00-00',
        paymentBank: 'Сбер',
      },
    ],
    ...overrides,
  }
}

/** Вася и Аня — семья: у Васи реквизиты есть, у Ани нет. */
function familyOption(overrides: Partial<CompensationOption> = {}): CompensationOption {
  return option({
    userIds: ['vasya', 'anya'],
    displayName: 'Вася и Аня',
    amountRub: 1500,
    members: [
      {
        userId: 'vasya',
        displayName: 'Вася',
        gender: 'm',
        paymentDetails: '+7 902 111-22-33',
        paymentBank: 'Тинькофф',
      },
      {
        userId: 'anya',
        displayName: 'Аня',
        gender: 'f',
        paymentDetails: null,
        paymentBank: null,
      },
    ],
    ...overrides,
  })
}

function view(): TripFinance {
  return {
    expenses: [],
    compensations: [],
    members: [],
    managedSenders: [],
    me: {
      balanceRub: 0,
      remainingRub: 0,
      familyDebtRub: 0,
      familyCreditRub: 0,
      canSpend: true,
      suggestions: [],
    },
  }
}

const SUGGESTIONS = [
  option(),
  option({
    userIds: ['boris'],
    displayName: 'Борис',
    amountRub: 400,
    members: [
      {
        userId: 'boris',
        displayName: 'Борис',
        gender: 'm',
        paymentDetails: null,
        paymentBank: null,
      },
    ],
  }),
]

function mountWithSenders(
  senders: {
    userId: string
    displayName: string
    familyDebtRub: number
    familyCreditRub: number
    suggestions: CompensationOption[]
  }[],
) {
  return mount(TripFinanceCompensationModal, {
    props: { tripId: '7', meId: 'me', senders },
  })
}

function mountModal(suggestions = SUGGESTIONS) {
  return mountWithSenders([
    {
      userId: 'me',
      displayName: 'Я',
      familyDebtRub: 0,
      familyCreditRub: 0,
      suggestions,
    },
  ])
}

describe('модалка компенсации', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createTripCompensation.mockResolvedValue(view())
  })

  it('текст заказчика дословно: про подтверждение, расчёт и Васю с Колей', () => {
    const wrapper = mountModal()

    const note = wrapper.get('[data-test="finance-compensation-note"]').text()
    expect(note).toContain('Запись значит «я перевёл». Получателю требуется подтвердить получение.')
    expect(note).toContain(
      'Расчёт произведён по всем расходам и оптимизирован для наименьшего количества транзакций.',
    )
    expect(note).toContain(
      'Не смущайся если Вася оплатил твой шулэн, а предлагается перевод Коле, значит Вася должен Коле',
    )
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

  it('в списке сумма без «не больше», а реквизиты без «спроси у него/неё»', () => {
    const wrapper = mountModal()

    expect(wrapper.get('[data-test="finance-compensation-people"]').text()).toContain('1 000 ₽')
    expect(wrapper.get('[data-test="finance-compensation-people"]').text()).not.toContain('не больше')
    expect(wrapper.text()).not.toContain('указал(а)')
    expect(wrapper.text()).not.toContain('него/неё')
  })

  it('без реквизитов — фраза заказчика, глагол по полу', async () => {
    const wrapper = mountModal([SUGGESTIONS[1]!])

    expect(wrapper.get('[data-test="finance-compensation-no-requisites"]').text()).toBe(
      'Борис не указал реквизиты в своём профиле, придётся спросить у них самих.',
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

  it('семья одной строкой: сумма общая, реквизиты всех, у кого они есть', () => {
    const wrapper = mountModal([familyOption()])

    expect(wrapper.get('[data-test="finance-compensation-people"]').text()).toContain('Вася и Аня')
    expect(
      (wrapper.get('[data-test="finance-compensation-amount"]').element as HTMLInputElement)
        .value,
    ).toBe('1500')
    expect(wrapper.get('[data-test="finance-compensation-details"]').text()).toBe(
      '+7 902 111-22-33',
    )
    expect(wrapper.get('[data-test="finance-compensation-bank"]').text()).toBe('Тинькофф')
    // У Ани реквизитов нет — её имени в блоке перевода быть не должно.
    expect(wrapper.get('[data-test="finance-compensation-requisites"]').text()).not.toContain('Аня')
  })

  it('у семьи без реквизитов — фраза во множественном числе', () => {
    const wrapper = mountModal([
      familyOption({
        members: [
          { userId: 'vasya', displayName: 'Вася', gender: 'm', paymentDetails: null, paymentBank: null },
          { userId: 'anya', displayName: 'Аня', gender: 'f', paymentDetails: null, paymentBank: null },
        ],
      }),
    ])

    expect(wrapper.get('[data-test="finance-compensation-no-requisites"]').text()).toBe(
      'Вася и Аня не указали реквизиты в своих профилях, придётся спросить у них самих.',
    )
  })

  it('семейный перевод уходит первым человеком семьи — сервер найдёт остальных', async () => {
    const wrapper = mountModal([familyOption()])

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.createTripCompensation).toHaveBeenCalledWith('7', {
      toUserId: 'vasya',
      amountRub: 1500,
    })
  })

  it('больше остатка не отправляет и объясняет, сколько осталось', async () => {
    const wrapper = mountModal()

    await wrapper.get('[data-test="finance-compensation-amount"]').setValue('1500')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-test="finance-compensation-error"]').text()).toBe(
      'Больше остатка — можно 1 000 ₽',
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

  /**
   * Баг 12.11.2026: сервер отказывал «Вам не нужно ничего компенсировать»,
   * хотя на экране был долг. Экран и модалка должны узнать, что подсказки
   * устарели, и перечитать вкладку.
   */
  it('отказ 400 просит родителя перечитать вкладку', async () => {
    const wrapper = mountModal()
    mocks.createTripCompensation.mockRejectedValue(
      new ApiError(400, 'Вам не нужно ничего компенсировать', null),
    )

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('stale')).toHaveLength(1)
  })

  it('если свежие подсказки изменились, выбор не остаётся на исчезнувшей семье', async () => {
    const wrapper = mountModal()

    await wrapper.setProps({
      senders: [
        {
          userId: 'me',
          displayName: 'Я',
          familyDebtRub: 1500,
          familyCreditRub: 0,
          suggestions: [familyOption()],
        },
      ],
    })
    await flushPromises()

    expect(
      (wrapper.get('[data-test="finance-compensation-to-vasya"]').element as HTMLInputElement)
        .checked,
    ).toBe(true)
    expect(
      (wrapper.get('[data-test="finance-compensation-amount"]').element as HTMLInputElement)
        .value,
    ).toBe('1500')
  })

  it('перевод можно записать от своего человека без аккаунта', async () => {
    const wrapper = mountWithSenders([
      {
        userId: 'me',
        displayName: 'Я',
        familyDebtRub: 0,
        familyCreditRub: 0,
        suggestions: [],
      },
      {
        userId: 'vitya',
        displayName: 'Дядя Витя',
        familyDebtRub: 500,
        familyCreditRub: 0,
        suggestions: [option({ userIds: ['anya'], displayName: 'Аня', amountRub: 500 })],
      },
    ])

    await wrapper.get('[data-test="finance-compensation-sender-select"]').setValue('vitya')

    expect(
      (wrapper.get('[data-test="finance-compensation-amount"]').element as HTMLInputElement)
        .value,
    ).toBe('500')
    expect(wrapper.get('[data-test="finance-compensation-people"]').text()).toContain('Аня')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.createTripCompensation).toHaveBeenCalledWith('7', {
      toUserId: 'anya',
      amountRub: 500,
      fromUserId: 'vitya',
    })
  })

  it('некому переводить — список пуст и объясняет почему', () => {
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
