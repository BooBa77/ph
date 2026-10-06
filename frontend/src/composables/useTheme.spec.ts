import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useTheme } from '@/composables/useTheme'
import { useAppStore } from '@/stores/app'

/**
 * Фиксируем только дату.
 *
 * Именно `toFake: ['Date']`, а не полностью фейковые таймеры: иначе
 * перестанут работать микрозадачи, на которых держится `nextTick`, и
 * проверка отката невалидной темы повиснет.
 */
function freezeDate(year: number, monthIndex: number, day: number) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(year, monthIndex, day, 12, 0, 0))
}

describe('useTheme', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('зимой ставит сезон 1 и атрибут data-theme', () => {
    freezeDate(2026, 0, 15)

    useTheme()

    expect(useAppStore().currentTheme).toBe(1)
    expect(document.documentElement.getAttribute('data-theme')).toBe('1')
  })

  it('летом ставит сезон 3', () => {
    freezeDate(2026, 6, 15)

    useTheme()

    expect(useAppStore().currentTheme).toBe(3)
  })

  it('8 ноября — уже зима', () => {
    freezeDate(2026, 10, 8)

    useTheme()

    expect(useAppStore().currentTheme).toBe(1)
  })

  it('7 ноября — ещё осень', () => {
    freezeDate(2026, 10, 7)

    useTheme()

    expect(useAppStore().currentTheme).toBe(4)
  })

  it('override из localStorage важнее даты', () => {
    freezeDate(2026, 0, 15)
    localStorage.setItem('themeOverride', '3')

    useTheme()

    expect(useAppStore().currentTheme).toBe(3)
  })

  it('мусор в override удаляется, а тема берётся по дате', () => {
    freezeDate(2026, 0, 15)
    localStorage.setItem('themeOverride', '99')

    useTheme()

    expect(localStorage.getItem('themeOverride')).toBeNull()
    expect(useAppStore().currentTheme).toBe(1)
  })

  it('невалидную тему в store откатывает к теме по дате', async () => {
    freezeDate(2026, 6, 15)
    useTheme()
    const store = useAppStore()

    // Имитируем правку напрямую, мимо setTheme — так выглядит запись
    // невалидного значения через DevTools. setTheme такое отверг бы.
    store.currentTheme = 99 as never

    await nextTick()

    expect(store.currentTheme).toBe(3)
  })
})
