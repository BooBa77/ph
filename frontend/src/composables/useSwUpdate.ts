import { onMounted, onUnmounted, ref } from 'vue'
import { useAppStore } from '@/stores/app'

/**
 * Логика обновления PWA.
 *
 * Как работает:
 * 1. Браузер находит новую версию SW → кладёт её в состояние waiting.
 * 2. Мы ждём, пока isUserBusy станет false.
 * 3. Шлём новому SW команду SKIP_WAITING.
 * 4. SW активируется → controllerchange → перезагружаем страницу.
 *
 * В dev-режиме SW вообще не регистрируется, хук молчит.
 */
export function useSwUpdate() {
  const appStore = useAppStore()
  const updatePending = ref(false)
  let registration: ServiceWorkerRegistration | null = null
  let reloading = false

  /** Проверить, не ждёт ли новый SW активации */
  const checkWaiting = () => {
    if (!registration) return
    if (registration.waiting) {
      updatePending.value = true
    }
  }

  /** Активировать новый SW и перезагрузить страницу */
  const applyUpdate = () => {
    if (!registration || !registration.waiting || reloading) return
    reloading = true
    registration.waiting.postMessage({ type: 'SKIP_WAITING' })
  }

  const onControllerChange = () => {
    if (reloading) {
      window.location.reload()
    }
  }

  onMounted(async () => {
    // В dev SW не регистрируется — просто выходим
    if (!('serviceWorker' in navigator)) return
    if (import.meta.env.DEV) return

    registration = (await navigator.serviceWorker.getRegistration()) ?? null
    if (!registration) return

    // Мог уже ждать к моменту монтирования
    checkWaiting()

    // Слушаем появление нового SW
    registration.addEventListener('updatefound', () => {
      const newWorker = registration!.installing
      if (!newWorker) return
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          updatePending.value = true
        }
      })
    })

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
  })

  onUnmounted(() => {
    navigator.serviceWorker?.removeEventListener('controllerchange', onControllerChange)
  })

  return { updatePending, applyUpdate }
}