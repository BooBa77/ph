import { describe, expect, it } from 'vitest'

import type {
  CompensationOption,
  DepositParticipant,
  TripCompensation,
  TripDepositForfeit,
  TripDepositReturn,
  TripExpense,
  TripFinance,
} from '@/types/finance'
import {
  compensationRequisites,
  depositReturnCaption,
  depositStatusCaption,
  forfeitCaption,
  movementRows,
  noRequisitesPhrase,
  previewShares,
  sharesPreview,
  splitCaption,
  splitRub,
} from '@/utils/finance'

/**
 * Арифметика «Бухгалтерии» на фронте (12.11.2026).
 *
 * Сервер считает доли сам, и таблица показывает готовые. Но модалка
 * «Добавить расход» обещает цифры **до** сохранения, поэтому правило деления
 * повторено здесь — и держится тестом один в один с серверным: рубли,
 * остаток по рублю первым по составу.
 */
function expense(overrides: Partial<TripExpense> = {}): TripExpense {
  return {
    id: '1',
    spentAt: '2026-11-11',
    authorUserId: 'g',
    authorName: 'Григорий',
    authorAvatarUrl: null,
    amountRub: 12000,
    description: 'Продукты',
    split: 'all',
    shares: [
      { userId: 'a', displayName: 'Анна', amountRub: 2000 },
      { userId: 'b', displayName: 'Борис', amountRub: 2000 },
    ],
    canEdit: true,
    ...overrides,
  }
}

function compensation(overrides: Partial<TripCompensation> = {}): TripCompensation {
  return {
    id: '1',
    createdAt: '2026-11-11T18:30:00.000Z',
    fromUserId: 'a',
    fromName: 'Анна',
    toUserId: 'g',
    toName: 'Григорий',
    amountRub: 1000,
    kind: 'compensation',
    status: 'pending',
    confirmedAt: null,
    canConfirm: true,
    canCancel: false,
    ...overrides,
  }
}

function finance(overrides: Partial<TripFinance> = {}): TripFinance {
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
    ...overrides,
  }
}

describe('splitRub', () => {
  it('делит до рубля, остаток — первым по составу', () => {
    expect(splitRub(3000, ['a', 'b', 'c'])).toEqual([1000, 1000, 1000])
    expect(splitRub(1000, ['a', 'b', 'c'])).toEqual([334, 333, 333])
    expect(splitRub(1000, ['a', 'b', 'c', 'd', 'e', 'g'])).toEqual([
      167, 167, 167, 167, 166, 166,
    ])
  })

  it('пустой состав и один человек', () => {
    expect(splitRub(500, [])).toEqual([])
    expect(splitRub(500, ['a'])).toEqual([500])
  })
})

describe('previewShares', () => {
  it('доли в порядке состава с именами', () => {
    expect(
      previewShares(1000, [
        { userId: 'a', displayName: 'Анна' },
        { userId: 'b', displayName: 'Борис' },
        { userId: 'c', displayName: 'Вера' },
      ]),
    ).toEqual([
      { userId: 'a', displayName: 'Анна', amountRub: 334 },
      { userId: 'b', displayName: 'Борис', amountRub: 333 },
      { userId: 'c', displayName: 'Вера', amountRub: 333 },
    ])
  })
})

describe('sharesPreview', () => {
  const three = [
    { userId: 'a', displayName: 'Анна' },
    { userId: 'b', displayName: 'Борис' },
    { userId: 'c', displayName: 'Вера' },
  ]

  it('равные доли одной фразой', () => {
    expect(sharesPreview(12000, three)).toBe('Поровну: 12 000 ₽ — по 4 000 ₽')
  })

  it('неровные доли перечисляет — иначе рубль остатка не увидеть', () => {
    expect(sharesPreview(1000, three)).toBe(
      '1 000 ₽: Анна 334 ₽, Борис 333 ₽, Вера 333 ₽',
    )
  })

  it('без участников подсказки нет', () => {
    expect(sharesPreview(1000, [])).toBe('')
  })
})

describe('splitCaption', () => {
  it('«на всех» с равными долями', () => {
    expect(splitCaption(expense())).toBe('на всех · по 2 000 ₽')
  })

  it('«на всех» с остатком — одна цифра, а не список долей', () => {
    expect(
      splitCaption(
        expense({
          amountRub: 1000,
          shares: [
            { userId: 'a', displayName: 'Анна', amountRub: 334 },
            { userId: 'b', displayName: 'Борис', amountRub: 333 },
            { userId: 'c', displayName: 'Вера', amountRub: 333 },
          ],
        }),
      ),
    ).toBe('на всех · по 333 ₽')
  })

  it('на группу — имена без предлога: падежи не склоняем', () => {
    expect(
      splitCaption(
        expense({
          split: 'group',
          amountRub: 1000,
          shares: [
            { userId: 'a', displayName: 'Анна', amountRub: 500 },
            { userId: 'b', displayName: 'Борис', amountRub: 500 },
          ],
        }),
      ),
    ).toBe('Анна, Борис · по 500 ₽')
  })

  it('чек из «Питания» подписан питающимися с общего', () => {
    expect(
      splitCaption(
        expense({
          split: 'commonEaters',
          amountRub: 1500,
          shares: [
            { userId: 'a', displayName: 'Анна', amountRub: 750 },
            { userId: 'b', displayName: 'Борис', amountRub: 750 },
          ],
        }),
      ),
    ).toBe('на питающихся с общего · по 750 ₽')
  })

  it('чек с остатком от деления тоже подписан одной цифрой', () => {
    expect(
      splitCaption(
        expense({
          split: 'commonEaters',
          amountRub: 3500,
          shares: [
            { userId: 'a', displayName: 'Анна', amountRub: 584 },
            { userId: 'b', displayName: 'Борис', amountRub: 583 },
            { userId: 'c', displayName: 'Вера', amountRub: 584 },
            { userId: 'd', displayName: 'Глеб', amountRub: 583 },
            { userId: 'e', displayName: 'Дина', amountRub: 583 },
            { userId: 'f', displayName: 'Егор', amountRub: 583 },
          ],
        }),
      ),
    ).toBe('на питающихся с общего · по 583 ₽')
  })

  it('расход без долей не притворяется нулём', () => {
    expect(splitCaption(expense({ shares: [] }))).toBe('ни на кого')
  })
})

describe('movementRows', () => {
  it('расходы и компенсации одной лентой, свежие сверху', () => {
    const rows = movementRows(
      finance({
        expenses: [
          expense({ id: '10', spentAt: '2026-11-09' }),
          expense({ id: '11', spentAt: '2026-11-11' }),
        ],
        compensations: [
          compensation({ id: '20', createdAt: '2026-11-11T18:30:00.000Z' }),
          compensation({ id: '21', createdAt: '2026-11-10T08:00:00.000Z' }),
        ],
      }),
    )

    // Перевод 11-го вечером выше траты 11-го (дата без времени раньше),
    // затем сама трата 11-го, затем остальные по датам.
    expect(rows.map((row) => row.key)).toEqual([
      'compensation-20',
      'expense-11',
      'compensation-21',
      'expense-10',
    ])
  })

  it('пустая вкладка — пустая лента', () => {
    expect(movementRows(finance())).toEqual([])
  })
})

describe('залог в ленте (18.11.2026)', () => {
  const forfeit: TripDepositForfeit = {
    id: 'f1',
    at: '2026-11-17T11:00:00.000Z',
    sourceUserId: 'b',
    sourceName: 'Борис',
    amountRub: 2000,
  }

  const returned: TripDepositReturn = {
    id: 'r1',
    at: '2026-11-18T11:00:00.000Z',
    sourceUserId: 'b',
    sourceName: 'Борис',
    amountRub: 2000,
    shares: [
      { userId: 'a', displayName: 'Анна', amountRub: 1000 },
      { userId: 'g', displayName: 'Григорий', amountRub: 1000 },
    ],
  }

  it('удержание, возврат и расход стоят в ленте одной лентой', () => {
    const rows = movementRows(
      finance({
        expenses: [expense({ spentAt: '2026-11-11' })],
        depositForfeits: [forfeit],
        depositReturns: [returned],
      }),
    )

    // Свежие сверху: возврат 18.11, удержание 17.11, расход 11.11.
    expect(rows.map((row) => row.kind)).toEqual([
      'depositReturn',
      'deposit',
      'expense',
    ])
  })

  it('удержание подписано фондом группы: долей идущим больше нет', () => {
    expect(forfeitCaption()).toBe('в фонд группы')
  })

  it('возврат объясняет, по сколько разошлась доля ушедшего', () => {
    expect(depositReturnCaption(returned)).toBe('доля ушедшего · по 1 000 ₽')
  })

  it('возврат без долей не врёт про сумму', () => {
    expect(depositReturnCaption({ ...returned, shares: [] })).toBe('доля ушедшего')
  })
})

describe('вариант компенсации: реквизиты и подпись об их отсутствии', () => {
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
          paymentDetails: '+7 914 000-00-00',
          paymentBank: 'Сбер',
        },
      ],
      ...overrides,
    }
  }

  it('показывает реквизиты всех, у кого они есть', () => {
    const family = option({
      userIds: ['vasya', 'anya'],
      displayName: 'Вася и Аня',
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
    })

    expect(compensationRequisites(family).map((person) => person.displayName)).toEqual([
      'Вася',
    ])
  })

  it('один человек — глагол по полу', () => {
    expect(noRequisitesPhrase(option())).toBe(
      'Анна не указала реквизиты в своём профиле, придётся спросить у неё самой.',
    )

    const man = option({
      displayName: 'Борис',
      members: [
        {
          userId: 'boris',
          displayName: 'Борис',
          gender: 'm',
          paymentDetails: null,
          paymentBank: null,
        },
      ],
    })

    expect(noRequisitesPhrase(man)).toBe(
      'Борис не указал реквизиты в своём профиле, придётся спросить у него самого.',
    )
  })

  it('семья — общая фраза словами заказчика', () => {
    const family = option({
      userIds: ['vasya', 'anya'],
      displayName: 'Вася и Аня',
      members: [
        {
          userId: 'vasya',
          displayName: 'Вася',
          gender: 'm',
          paymentDetails: null,
          paymentBank: null,
        },
        {
          userId: 'anya',
          displayName: 'Аня',
          gender: 'f',
          paymentDetails: null,
          paymentBank: null,
        },
      ],
    })

    expect(noRequisitesPhrase(family)).toBe(
      'Вася и Аня не указали реквизиты в своих профилях, придётся спросить у них самих.',
    )
  })
})

/**
 * Подпись залога в секции организатора (v3, 18.11.2026).
 *
 * Заказчик: идущий, который не добрал залог, — «залог не покрыт». У ушедшего
 * подпись зависит от решения, потому что «не сдал» больше не описывает
 * состояние: залог мог покрыться расходами, без единого перевода.
 */
describe('depositStatusCaption', () => {
  function row(overrides: Partial<DepositParticipant> = {}): DepositParticipant {
    return {
      userId: 'b',
      displayName: 'Борис',
      avatarUrl: null,
      status: 'pending',
      updatedByName: null,
      updatedAt: null,
      isMe: false,
      investedRub: 0,
      transferredRub: 0,
      pendingRub: 0,
      coveredRub: 0,
      missingRub: 200,
      dueRub: 200,
      holderName: null,
      declined: false,
      hasPendingTransfer: false,
      canDecide: false,
      ...overrides,
    }
  }

  it('идущий с недостатком — «залог не покрыт»', () => {
    expect(depositStatusCaption(row(), 200)).toBe('залог не покрыт')
  })

  it('ушедший без решения — насколько покрыт', () => {
    expect(
      depositStatusCaption(
        row({ declined: true, status: 'held', coveredRub: 50 }),
        200,
      ),
    ).toBe('покрыто 50 ₽ из 200 ₽')

    expect(
      depositStatusCaption(
        row({ declined: true, status: 'held', coveredRub: 200, missingRub: 0 }),
        200,
      ),
    ).toBe('залог покрыт')
  })

  it('ушедший с решением — «вернули» или «удержан»', () => {
    expect(
      depositStatusCaption(row({ declined: true, status: 'returned' }), 200),
    ).toBe('залог вернули')
    expect(
      depositStatusCaption(row({ declined: true, status: 'forfeited' }), 200),
    ).toBe('залог удержан')
  })
})
