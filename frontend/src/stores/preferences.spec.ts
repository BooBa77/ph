import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePreferencesStore } from '@/stores/preferences'

/**
 * Тесты настроек оформления.
 *
 * Проверяем ровно то, из-за чего эти настройки появились: сезонные
 * анимации включаются по умолчанию и выключаются своим переключателем,
 * а не системной настройкой «уменьшить движение». Раньше слушали
 * системную — и на машине с выключенной анимацией в Windows (Chrome
 * наследует это из системы) сезонного оформления не было вовсе.
 */
describe('usePreferencesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.resetModules()
  })

  async function freshStore() {
    vi.resetModules()
    const mod = await import('@/stores/preferences')
    setActivePinia(createPinia())
    return mod.usePreferencesStore()
  }

  it('по умолчанию анимация включена', () => {
    expect(usePreferencesStore().seasonAnimations).toBe(true)
  })

  it('переключатель выключает и запоминает', () => {
    const store = usePreferencesStore()

    store.toggleSeasonAnimations()

    expect(store.seasonAnimations).toBe(false)
    expect(localStorage.getItem('ph.seasonAnimations')).toBe('off')
  })

  it('переключатель включает обратно', () => {
    const store = usePreferencesStore()

    store.toggleSeasonAnimations()
    store.toggleSeasonAnimations()

    expect(store.seasonAnimations).toBe(true)
    expect(localStorage.getItem('ph.seasonAnimations')).toBe('on')
  })

  it('выбор переживает перезагрузку', async () => {
    const store = await freshStore()
    store.setSeasonAnimations(false)

    const after = await freshStore()

    expect(after.seasonAnimations).toBe(false)
  })

  it('мусор в хранилище считается включённой анимацией', async () => {
    localStorage.setItem('ph.seasonAnimations', 'что-то не то')

    const store = await freshStore()

    // Худшее, что может случиться от такого решения, — листья продолжат
    // падать. Обратное (оформление молча исчезло) уже было проблемой.
    expect(store.seasonAnimations).toBe(true)
  })
})
