import { describe, expect, it } from 'vitest'

import { readOnlyCopy } from '@/offline/readOnly'

/**
 * Копия ответа API с погашенными правами.
 *
 * В офлайне изменения отправить некуда, поэтому «можно править» из старого
 * ответа обязано читаться как «нельзя». Это единственное место, где права
 * превращаются в false; вкладки проверяют свои `canEdit` и не рисуют кнопки.
 */
describe('readOnlyCopy', () => {
  it('гасит флаги прав на всех уровнях', () => {
    const source = {
      canEdit: true,
      trip: { canEditGear: true, canWrite: true, name: 'Витязь' },
      permissions: [
        { code: 'meals', canEdit: true },
        { code: 'gear', canEdit: false },
      ],
      me: { canSpend: true },
    }

    const copy = readOnlyCopy(source)

    expect(copy.canEdit).toBe(false)
    expect(copy.trip.canEditGear).toBe(false)
    expect(copy.trip.canWrite).toBe(false)
    expect(copy.permissions[0]?.canEdit).toBe(false)
    expect(copy.permissions[1]?.canEdit).toBe(false)
    expect(copy.me.canSpend).toBe(false)
  })

  it('не трогает остальные поля', () => {
    const source = {
      canEdit: true,
      id: '679',
      name: 'Витязь',
      isOfficial: true,
      priceRub: 1000,
      endsAt: null,
    }

    expect(readOnlyCopy(source)).toEqual({
      ...source,
      canEdit: false,
    })
  })

  it('не мутирует исходный ответ: кеш остаётся настоящим', () => {
    const source = { canEdit: true, nested: { canEdit: true } }

    readOnlyCopy(source)

    expect(source.canEdit).toBe(true)
    expect(source.nested.canEdit).toBe(true)
  })

  it('ложные флаги и не-флаги остаются как были', () => {
    const source = { canEdit: false, canConfirm: true, enabled: true }

    // canConfirm — не флаг прав вкладки: его обрабатывают свои экраны,
    // и трогать его здесь нельзя.
    expect(readOnlyCopy(source)).toEqual({ canEdit: false, canConfirm: true, enabled: true })
  })
})
