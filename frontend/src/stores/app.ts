// frontend/src/stores/app.ts

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { isValidSeason, type Season } from '@/types/theme'

/**
 * Глобальный store приложения.
 *
 * Содержит:
 *   - isUserBusy — счётчик занятости пользователя (для PWA-обновления);
 *   - currentTheme — текущий сезон (1–4), влияет на CSS через data-theme.
 */
export const useAppStore = defineStore('app', () => {
  // ─── busy (PWA) ───

  /**
   * Счётчик занятости. Счётчик, а не bool, чтобы вложенные
   * компоненты (например, форма внутри модалки) не сбивали друг друга.
   */
  const busyCount = ref(0)

  /** Пользователь занят (заполняет форму, что-то вводит). */
  const isUserBusy = computed(() => busyCount.value > 0)

  /** Пометить занятость (true) или освободить (false). */
  function setBusy(busy: boolean) {
    if (busy) busyCount.value++
    else busyCount.value = Math.max(0, busyCount.value - 1)
  }

  /** Сбросить счётчик (аварийно). */
  function resetBusy() {
    busyCount.value = 0
  }

  // ─── theme ───

  /**
   * Текущий сезон. Инициализируется значением по умолчанию (зима),
   * реальное значение ставит useTheme при старте приложения.
   *
   * В store всегда лежит валидный Season — за этим следит setTheme.
   * Прямая запись через DevTools может положить туда что угодно,
   * но useTheme имеет watcher, который откатит невалидное значение.
   */
  const currentTheme = ref<Season>(1)

  /**
   * Установить тему. Валидирует значение — если пришло что-то
   * невалидное (например, из DevTools), бросает ошибку.
   *
   * Бросает, а не молча игнорирует: вызывающий код должен знать,
   * что тема не установилась. useTheme и detectSeasonByDate всегда
   * передают валидное значение, так что для них это не сработает.
   */
  function setTheme(theme: Season) {
    if (!isValidSeason(theme)) {
      throw new Error(`Невалидный сезон: ${String(theme)}`)
    }
    currentTheme.value = theme
  }

  return {
    // busy (PWA)
    busyCount,
    isUserBusy,
    setBusy,
    resetBusy,

    // theme
    currentTheme,
    setTheme,
  }
})