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

/**
 * Свежие модули для одного теста.
 *
 * Модуль перезагружаем, чтобы не тащить состояние предыдущего теста
 * (становится актуальнее, когда в composable появится подписка или
 * кэш). Заодно и store: после `resetModules` composable получил бы свой
 * экземпляр модуля store, а тест — свой, и проверки смотрели бы не туда.
 */
async function freshModules() {
  vi.resetModules()
  const [{ useTheme }, { useAppStore }] = await Promise.all([
    import('@/composables/useTheme'),
    import('@/stores/app'),
  ])
  setActivePinia(createPinia())
  return { useTheme, useAppStore }
}

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('зимой ставит сезон 1 и атрибут data-theme', async () => {
    freezeDate(2026, 0, 15)

    const { useTheme, useAppStore } = await freshModules()
    useTheme()

    expect(useAppStore().currentTheme).toBe(1)
    expect(document.documentElement.getAttribute('data-theme')).toBe('1')
  })

  it('летом ставит сезон 3', async () => {
    freezeDate(2026, 6, 15)

    const { useTheme, useAppStore } = await freshModules()
    useTheme()

    expect(useAppStore().currentTheme).toBe(3)
  })

  it('8 ноября — уже зима', async () => {
    freezeDate(2026, 10, 8)

    const { useTheme, useAppStore } = await freshModules()
    useTheme()

    expect(useAppStore().currentTheme).toBe(1)
  })

  it('7 ноября — ещё осень', async () => {
    freezeDate(2026, 10, 7)

    const { useTheme, useAppStore } = await freshModules()
    useTheme()

    expect(useAppStore().currentTheme).toBe(4)
  })

  it('25 мая — уже лето', async () => {
    freezeDate(2026, 4, 25)

    const { useTheme, useAppStore } = await freshModules()
    useTheme()

    expect(useAppStore().currentTheme).toBe(3)
  })

  it('невалидную тему в store откатывает к сезону по дате', async () => {
    freezeDate(2026, 6, 15)

    const { useTheme, useAppStore } = await freshModules()
    useTheme()
    const store = useAppStore()

    // Имитируем правку напрямую, мимо setTheme — так выглядит запись
    // невалидного значения через DevTools. setTheme такое отверг бы.
    store.currentTheme = 99 as never

    await nextTick()

    expect(store.currentTheme).toBe(3)
  })

  it('сезон не выбирается вручную: localStorage ни при чём', async () => {
    freezeDate(2026, 0, 15)

    // Значение, которое оставила бы прежняя версия с переключателем.
    // Тема — только автоматическая, поэтому старый ключ игнорируется,
    // а не «подхватывается как настройка».
    localStorage.setItem('themeOverride', '3')

    const { useTheme, useAppStore } = await freshModules()
    useTheme()

    expect(useAppStore().currentTheme).toBe(1)
    expect(document.documentElement.getAttribute('data-theme')).toBe('1')
  })
})
