import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * Глобальный store приложения.
 * Пока — только флаг занятости пользователя (isUserBusy),
 * который понадобится для отложенного обновления PWA.
 */
export const useAppStore = defineStore('app', () => {
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

  return { busyCount, isUserBusy, setBusy, resetBusy }
})