import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Сезонные анимации оформления (листья, будущие снежинки).
 *
 * Своя настройка, а не системная `prefers-reduced-motion`.
 *
 * Почему: раньше я уважал системную просьбу «меньше движения» и прятал
 * слой целиком — и на машине с выключенной анимацией в Windows (Chrome
 * наследует эту настройку) сезонного оформления не было вовсе. Выглядит
 * это как поломка, а не как забота. Решено: системную настройку
 * игнорируем, а отключение делаем своим переключателем — его видно,
 * он рядом, и он работает одинаково во всех браузерах.
 *
 * Значение по умолчанию — включено. Хранится в localStorage: это
 * настройка конкретного браузера, на сервер ей незачем.
 */

const ANIMATIONS_KEY = 'ph.seasonAnimations'

/** Читаем сохранённый выбор. Мусор в хранилище считаем «включено». */
function readEnabled(): boolean {
  try {
    return localStorage.getItem(ANIMATIONS_KEY) !== 'off'
  } catch {
    // Приватный режим или отключённое хранилище — не повод падать.
    return true
  }
}

export const usePreferencesStore = defineStore('preferences', () => {
  const seasonAnimations = ref(readEnabled())

  function setSeasonAnimations(enabled: boolean) {
    seasonAnimations.value = enabled
    try {
      localStorage.setItem(ANIMATIONS_KEY, enabled ? 'on' : 'off')
    } catch {
      // Не сохранилось — в этой сессии переключатель всё равно работает.
    }
  }

  function toggleSeasonAnimations() {
    setSeasonAnimations(!seasonAnimations.value)
  }

  return { seasonAnimations, setSeasonAnimations, toggleSeasonAnimations }
})
