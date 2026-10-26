// frontend/src/composables/useLogout.ts

import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { logout } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'

/**
 * Выход из аккаунта с подтверждением.
 *
 * Вынесено из меню, потому что меню теперь два: колонка на десктопе
 * (`SiteSidebar`) и панель-гамбургер на мобиле (`MobileMenu`). Две копии
 * этого сценария разошлись бы — «Да» в одной перестало бы гасить состояние.
 *
 * Порядок важен: сначала сервер (`logout`), потом локальное состояние, потом
 * переход. Если сервер упал — всё равно разлогиниваемся: сессия на сервере
 * отзовётся сама по TTL, а оставлять человека «наполовину вошедшим» нельзя.
 */
export function useLogout() {
  const auth = useAuthStore()
  const router = useRouter()

  /** Показан ли вопрос «Выйти из аккаунта?». */
  const isConfirming = ref(false)

  /** Идёт запрос к серверу: кнопки на это время блокируются. */
  const isLoggingOut = ref(false)

  /** Спросить подтверждение. */
  function ask() {
    isConfirming.value = true
  }

  /** Отменить подтверждение. */
  function cancel() {
    isConfirming.value = false
  }

  /** Выйти. Переход делает и `useAuthRedirect`, и мы — сами. */
  async function confirm() {
    isLoggingOut.value = true
    try {
      await logout()
    } catch {
      // Даже если бэк упал — локально всё равно разлогинимся.
    } finally {
      auth.clear()
      isLoggingOut.value = false
      isConfirming.value = false
      await router.push({ name: 'auth' })
    }
  }

  return { isConfirming, isLoggingOut, ask, cancel, confirm }
}
