import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  expenseOutboxKey,
  expenseOutboxTripIds,
  flushExpenseOutboxes,
  newExpenseClientId,
  pendingForLedger,
  pruneExpenseOutbox,
  pushExpenseOutbox,
  queueExpense,
  readExpenseOutbox,
  removeQueuedExpense,
  writeExpenseOutbox,
  type ExpenseOutboxEntry,
} from '@/offline/expenseOutbox'
import type { TripFinance } from '@/types/finance'

/**
 * Очередь офлайн-чеков (19.11.2026).
 *
 * Проверяем то, ради чего она нужна: чек без связи остаётся на устройстве,
 * уходит при возврате связи, повтор с тем же ключом не создаёт дубль,
 * а отказ сервера по одному чеку не держит остальные. IndexedDB
 * подменяется картой, как в `presenceOutbox.spec.ts`: в jsdom настоящей
 * базы нет, а проверяем логику, а не браузер.
 */
const mocks = vi.hoisted(() => ({
  syncTripExpenses: vi.fn(),
  responses: new Map<string, unknown>(),
  state: new Map<string, unknown>(),
}))

vi.mock('@/api/finance', () => ({ syncTripExpenses: mocks.syncTripExpenses }))

vi.mock('@/offline/indexedDb', () => ({
  RESPONSES_STORE: 'responses',
  STATE_STORE: 'state',
  getRecord: async (store: string, key: string) => {
    const source = store === 'responses' ? mocks.responses : mocks.state
    return source.get(key) ?? null
  },
  putRecord: async (store: string, value: Record<string, unknown>) => {
    const source = store === 'responses' ? mocks.responses : mocks.state
    const key = store === 'responses' ? String(value.path) : String(value.key)
    source.set(key, value)
    return true
  },
  deleteRecord: async (store: string, key: string) => {
    const source = store === 'responses' ? mocks.responses : mocks.state
    source.delete(key)
  },
  getAllRecords: async (store: string) =>
    [...(store === 'responses' ? mocks.responses : mocks.state).values()],
  deleteByIndex: async () => undefined,
  clearStore: async () => undefined,
}))

function cheque(overrides: Partial<ExpenseOutboxEntry> = {}): ExpenseOutboxEntry {
  return {
    clientId: 'c-1',
    amountRub: 500,
    split: 'all',
    spentAt: '2026-11-19',
    queuedAt: '2026-11-19T08:00:00.000Z',
    ...overrides,
  }
}

/** Минимальная вкладка: очереди достаточно, чтобы положить ответ в кеш. */
function view(): TripFinance {
  return {
    expenses: [],
    compensations: [],
    members: [],
    families: [],
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
    managedSenders: [],
  }
}

describe('очередь офлайн-чеков', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.responses.clear()
    mocks.state.clear()
    mocks.syncTripExpenses.mockResolvedValue({
      ...view(),
      results: [{ clientId: 'c-1', status: 'accepted' }],
    })
  })

  it('ключ очереди — свой у каждого похода', () => {
    expect(expenseOutboxKey('7')).toBe('expenseOutbox:7')
    expect(expenseOutboxKey('8')).not.toBe(expenseOutboxKey('7'))
  })

  it('пустая очередь читается как пустой список', async () => {
    expect(await readExpenseOutbox('7')).toEqual([])
  })

  it('повтор с тем же ключом заменяет чек, а не копится', async () => {
    await queueExpense('7', cheque({ amountRub: 500 }))
    await queueExpense('7', cheque({ amountRub: 700 }))

    const queue = await readExpenseOutbox('7')
    expect(queue).toHaveLength(1)
    expect(queue[0]?.amountRub).toBe(700)
  })

  it('мусор в хранилище не ломает чтение очереди', async () => {
    await writeExpenseOutbox('7', [cheque()])
    mocks.state.set(expenseOutboxKey('7'), {
      key: expenseOutboxKey('7'),
      value: [{ nope: true }, { ...cheque(), split: 'куда-то' }],
    })

    expect(await readExpenseOutbox('7')).toEqual([])
  })

  it('отправка снимает принятые чеки и кладёт вкладку в кеш', async () => {
    await queueExpense('7', cheque())
    mocks.syncTripExpenses.mockResolvedValue({
      ...view(),
      results: [{ clientId: 'c-1', status: 'accepted' }],
    })

    const result = await pushExpenseOutbox('7')

    expect(mocks.syncTripExpenses).toHaveBeenCalledWith('7', [
      {
        clientId: 'c-1',
        amountRub: 500,
        split: 'all',
        spentAt: '2026-11-19',
      },
    ])
    expect(result?.pending).toEqual([])
    expect(await readExpenseOutbox('7')).toEqual([])
    expect(mocks.responses.has('/trips/7/finance')).toBe(true)
  })

  it('отклонённый чек остаётся с причиной и больше не отправляется', async () => {
    await queueExpense('7', cheque())
    mocks.syncTripExpenses.mockResolvedValue({
      ...view(),
      results: [
        {
          clientId: 'c-1',
          status: 'rejected',
          message: 'Плательщик не идёт в этом походе',
        },
      ],
    })

    const result = await pushExpenseOutbox('7')

    expect(result?.pending).toHaveLength(1)
    expect(result?.pending[0]?.error).toBe('Плательщик не идёт в этом походе')

    // Повторно такой чек на сервер не уходит: человек решает сам.
    expect(await pushExpenseOutbox('7')).toBeNull()
    expect(mocks.syncTripExpenses).toHaveBeenCalledTimes(1)
  })

  it('обрыв связи оставляет чек в очереди', async () => {
    await queueExpense('7', cheque())
    mocks.syncTripExpenses.mockRejectedValue(new Error('нет связи'))

    await expect(pushExpenseOutbox('7')).rejects.toThrow('нет связи')
    expect(await readExpenseOutbox('7')).toHaveLength(1)
  })

  it('чек можно убрать из очереди вручную', async () => {
    await queueExpense('7', cheque())

    await removeQueuedExpense('7', 'c-1')

    expect(await readExpenseOutbox('7')).toEqual([])
  })

  it('находит походы с неотправленными чеками', async () => {
    await queueExpense('7', cheque())
    await queueExpense('8', cheque({ clientId: 'c-2' }))

    expect((await expenseOutboxTripIds()).sort()).toEqual(['7', '8'])
  })

  it('пустая очередь удаляет ключ из хранилища', async () => {
    await queueExpense('7', cheque())
    await pruneExpenseOutbox('7', ['c-1'])

    expect(mocks.state.has(expenseOutboxKey('7'))).toBe(false)
  })

  it('в ленту не попадает чек, который сервер уже отдал', () => {
    const pending = pendingForLedger(
      [{ clientId: 'c-1' }, { clientId: null }, {}],
      [
        cheque({ clientId: 'c-1' }),
        cheque({ clientId: 'c-2', spentAt: '2026-11-20' }),
      ],
    )

    expect(pending.map((entry) => entry.clientId)).toEqual(['c-2'])
  })

  it('в ленте офлайн-чеки стоят по дате траты, свежие сверху', () => {
    const pending = pendingForLedger([], [
      cheque({ clientId: 'c-old', spentAt: '2026-11-18' }),
      cheque({ clientId: 'c-new', spentAt: '2026-11-20' }),
    ])

    expect(pending.map((entry) => entry.clientId)).toEqual(['c-new', 'c-old'])
  })

  it('при возврате связи уходит всё, что накопилось', async () => {
    await queueExpense('7', cheque())
    await queueExpense('8', cheque({ clientId: 'c-2' }))
    mocks.syncTripExpenses.mockImplementation(async (_tripId: string, entries: { clientId: string }[]) => ({
      ...view(),
      results: entries.map((entry) => ({ clientId: entry.clientId, status: 'accepted' })),
    }))

    const trips = await flushExpenseOutboxes()

    expect(trips).toBe(2)
    expect(mocks.syncTripExpenses).toHaveBeenCalledTimes(2)
    expect(await readExpenseOutbox('7')).toEqual([])
  })

  it('новый ключ чека — UUID', () => {
    expect(newExpenseClientId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })
})
