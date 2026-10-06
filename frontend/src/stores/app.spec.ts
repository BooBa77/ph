import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_PROFILE_PATH, useAppStore } from '@/stores/app'

/**
 * Тесты состояния приложения: занятость (для PWA-обновления), сезон
 * и последний раздел личного кабинета.
 *
 * Про последний раздел отдельно: это единственное место, где store
 * пишет в localStorage, и там же единственная защита от мусора —
 * в хранилище может оказаться что угодно, а ссылка «Профиль» строится
 * прямо из него.
 */
describe('useAppStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Свежий store: начальное значение читается из localStorage при создании. */
  async function freshStore() {
    vi.resetModules()
    const mod = await import('@/stores/app')
    setActivePinia(createPinia())
    return mod
  }

  describe('занятость', () => {
    it('считает вложенные пометки, а не переключается флагом', () => {
      const store = useAppStore()

      store.setBusy(true)
      store.setBusy(true)
      expect(store.isUserBusy).toBe(true)

      store.setBusy(false)
      // Первое освобождение — от внутренней формы, внешняя ещё работает:
      // флаг-булево здесь соврал бы и разрешил перезагрузку посреди правки.
      expect(store.isUserBusy).toBe(true)

      store.setBusy(false)
      expect(store.isUserBusy).toBe(false)
    })

    it('не уходит в минус при лишнем освобождении', () => {
      const store = useAppStore()

      store.setBusy(false)
      store.setBusy(false)

      expect(store.busyCount).toBe(0)
      expect(store.isUserBusy).toBe(false)
    })
  })

  describe('сезон', () => {
    it('принимает сезон 1–4', () => {
      const store = useAppStore()

      store.setTheme(3)
      expect(store.currentTheme).toBe(3)
    })

    it('отвергает всё остальное', () => {
      const store = useAppStore()

      expect(() => store.setTheme(0 as never)).toThrow()
      expect(() => store.setTheme(5 as never)).toThrow()
      expect(() => store.setTheme('зима' as never)).toThrow()
    })
  })

  describe('последний раздел личного кабинета', () => {
    it('по умолчанию ведёт в «Профиль»', () => {
      const store = useAppStore()

      expect(store.lastProfilePath).toBe(DEFAULT_PROFILE_PATH)
    })

    it('запоминает раздел и пишет его в localStorage', () => {
      const store = useAppStore()

      store.setLastProfilePath('/profile/sessions')

      expect(store.lastProfilePath).toBe('/profile/sessions')
      expect(localStorage.getItem('ph.lastProfilePath')).toBe(
        '/profile/sessions',
      )
    })

    it('переживает перезагрузку', async () => {
      const first = await freshStore()
      first.useAppStore().setLastProfilePath('/profile/settings')

      // Перезагрузка страницы: store создаётся заново и читает хранилище.
      const second = await freshStore()

      expect(second.useAppStore().lastProfilePath).toBe('/profile/settings')
    })

    it('игнорирует чужие пути', () => {
      const store = useAppStore()

      // Ссылка «Профиль» строится из этого значения, поэтому пускать
      // сюда что попало нельзя: «/auth» или чужой домен в ссылке —
      // это уже не косметика.
      store.setLastProfilePath('/auth')
      store.setLastProfilePath('https://evil.example.com')

      expect(store.lastProfilePath).toBe(DEFAULT_PROFILE_PATH)
      expect(localStorage.getItem('ph.lastProfilePath')).toBeNull()
    })

    it('не верит мусору в localStorage', async () => {
      localStorage.setItem('ph.lastProfilePath', 'https://evil.example.com')

      const { useAppStore: store } = await freshStore()

      expect(store().lastProfilePath).toBe(DEFAULT_PROFILE_PATH)
    })
  })
})
