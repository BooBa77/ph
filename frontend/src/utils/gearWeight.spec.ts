import { describe, expect, it } from 'vitest'

import { formatWeight, formatWeightTotal } from '@/utils/gearWeight'

/**
 * Тесты формата веса.
 *
 * Порог «1000 г = 1 кг» и русская запятая в дроби — то, что легко
 * сломать незаметно: в интерфейсе «0.9 кг» вместо «900 г» никто не
 * назовёт ошибкой, а глаз за него цепляется.
 */
describe('gearWeight', () => {
  it('до килограмма показывает граммы', () => {
    expect(formatWeight(600)).toBe('600 г')
    expect(formatWeight(999)).toBe('999 г')
  })

  it('от килограмма показывает килограммы с запятой', () => {
    expect(formatWeight(1000)).toBe('1 кг')
    expect(formatWeight(2400)).toBe('2,4 кг')
    expect(formatWeight(12550)).toBe('12,55 кг')
  })

  it('неизвестный вес — прочерк, а не ноль', () => {
    expect(formatWeight(null)).toBe('—')
  })

  it('итог говорит, сколько предметов не взвешено', () => {
    expect(formatWeightTotal(3900, 0)).toBe('Всего: 3,9 кг')
    expect(formatWeightTotal(3900, 2)).toBe('Всего: 3,9 кг · без веса: 2')
    expect(formatWeightTotal(0, 0)).toBe('Всего: 0 г')
  })
})
