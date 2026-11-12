import { describe, expect, it } from 'vitest'

import {
  balancePhrase,
  formatDay,
  formatRub,
  formatRubSigned,
  localToday,
  parseRub,
} from '@/utils/money'

/**
 * Деньги словами (12.11.2026).
 *
 * Ошибка в форматировании денег не бросается в глаза: «0,9» и «0,8999999»,
 * «2 000» и «2000» читаются как одна и та же цифра, только вторая — как
 * ошибка. Здесь закреплены три правила шапки «Бухгалтерии»: рубли без
 * копеек, знак баланса словами и дата без времени.
 */
describe('formatRub', () => {
  it('группирует разряды и подписывает рубли', () => {
    expect(formatRub(0)).toBe('0 ₽')
    expect(formatRub(500)).toBe('500 ₽')
    expect(formatRub(2000)).toBe('2 000 ₽')
    expect(formatRub(1234567)).toBe('1 234 567 ₽')
  })

  it('копейки не рисует: округление до рубля — решение заказчика', () => {
    expect(formatRub(1999.6)).toBe('1 999 ₽')
  })

  it('минус — знак минус, а не дефис', () => {
    expect(formatRub(-1000)).toBe('−1 000 ₽')
  })
})

describe('баланс и его знак', () => {
  it('плюс значит «вам должны», минус — «вы должны»', () => {
    expect(formatRubSigned(2000)).toBe('+2 000 ₽')
    expect(formatRubSigned(-1000)).toBe('−1 000 ₽')
    expect(formatRubSigned(0)).toBe('0 ₽')
  })

  it('баланс одной фразой', () => {
    expect(balancePhrase(2000)).toBe('Вам должны 2 000 ₽')
    expect(balancePhrase(-1000)).toBe('Вы должны 1 000 ₽')
    expect(balancePhrase(0)).toBe('Всё в расчёте')
  })
})

describe('formatDay', () => {
  it('дата траты и момент перевода читаются одинаково', () => {
    expect(formatDay('2026-11-11')).toBe('11.11.2026')
    expect(formatDay('2026-11-11T18:30:00.000Z')).toBe('11.11.2026')
    expect(formatDay('2026-01-05')).toBe('05.01.2026')
  })

  it('мусор не превращается в «NaN.NaN.NaN»', () => {
    expect(formatDay('')).toBe('')
    expect(formatDay('11.11.2026')).toBe('')
  })
})

describe('localToday', () => {
  it('дата по местному календарю, а не по UTC', () => {
    // 23:30 по местному времени: в UTC это уже следующий день в Иркутске,
    // и `toISOString()` предложил бы завтрашнюю дату в форме расхода.
    expect(localToday(new Date(2026, 10, 11, 23, 30))).toBe('2026-11-11')
    expect(localToday(new Date(2026, 0, 5, 8, 0))).toBe('2026-01-05')
  })
})

describe('parseRub', () => {
  it('пустое поле — «не заполнил», а не ноль', () => {
    expect(parseRub('')).toBeNull()
    expect(parseRub('   ')).toBeNull()
  })

  it('целые рубли, в том числе с пробелами в разрядах', () => {
    expect(parseRub('500')).toBe(500)
    expect(parseRub('12 000')).toBe(12000)
    expect(parseRub(3000)).toBe(3000)
  })

  it('ноль, минус и копейки — не сумма расхода', () => {
    expect(parseRub('0')).toBeUndefined()
    expect(parseRub('-5')).toBeUndefined()
    expect(parseRub('12.5')).toBeUndefined()
    expect(parseRub('12,5')).toBeUndefined()
    expect(parseRub('abc')).toBeUndefined()
    // «1.000» человек прочитает как тысячу — молча записать единицу нельзя.
    expect(parseRub('1.000')).toBeUndefined()
  })
})
