import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

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
 * `useTheme` инициализирует тему ровно один раз за жизнь приложения —
 * в нём есть модульный флаг `initialized` (нужен, чтобы переключатель
 * сезона в меню не навешивал второй watcher). В тестах этот флаг делал бы
 * все последующие тесты пустышками, поэтому модули перезагружаем.
 *
 * Заодно перезагружаем и store: после `resetModules` composable получил бы
 * свой экземпляр модуля store, а тест — свой, и проверки смотрели бы
 * не туда. Именно на этом я и споткнулся: тема ставилась, а store
 * в тесте оставался прежним.
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

  it('override из localStorage важнее даты', async () => {
    freezeDate(2026, 0, 15)
    localStorage.setItem('themeOverride', '3')

    const { useTheme, useAppStore } = await freshModules()
    useTheme()

    expect(useAppStore().currentTheme).toBe(3)
  })

  it('мусор в override удаляется, а тема берётся по дате', async () => {
    freezeDate(2026, 0, 15)
    localStorage.setItem('themeOverride', '99')

    const { useTheme, useAppStore } = await freshModules()
    useTheme()

    expect(localStorage.getItem('themeOverride')).toBeNull()
    expect(useAppStore().currentTheme).toBe(1)
  })

  it('невалидную тему в store откатывает к теме по дате', async () => {
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

  it('setThemeOverride сохраняет выбор и в store, и в localStorage', async () => {
    freezeDate(2026, 0, 15)

    const first = await freshModules()
    const { setThemeOverride } = first.useTheme()
    setThemeOverride(3)

    expect(first.useAppStore().currentTheme).toBe(3)

    // Перезагрузка страницы: тема должна подняться из хранилища,
    // а не из даты — иначе выбор пользователя слетал бы.
    const afterReload = await freshModules()
    afterReload.useTheme()

    expect(localStorage.getItem('themeOverride')).toBe('3')
    expect(afterReload.useAppStore().currentTheme).toBe(3)
    expect(document.documentElement.getAttribute('data-theme')).toBe('3')
  })
})
