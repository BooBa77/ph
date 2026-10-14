import { ref } from 'vue'

import { updateMe } from '@/api/users'
import { ApiError } from '@/api/errors'
import type { UpdateUserRequest } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'

/**
 * Сохранение профиля: один PATCH, занятость, обновление стора, разбор ошибки.
 *
 * Вынесено из разделов кабинета, когда спортивный опыт уехал в свою вкладку:
 * там те же четыре шага, что и в «Профиле», и копия разошлась бы при первой
 * же правке обработки ошибок.
 *
 * `whileBusy` отдаётся наружу отдельно: им пользуется загрузка аватарки —
 * файл идёт своим эндпоинтом, а не PATCH-ом, но счётчик занятости нужен
 * тот же самый.
 */
export function useProfilePatch() {
  const auth = useAuthStore()
  const appStore = useAppStore()

  const error = ref<string | null>(null)

  /**
   * Выполнить запрос, удерживая счётчик занятости.
   *
   * Без этого остаётся дыра: правку пользователь закончил, поле освободило
   * счётчик, а запрос на сохранение ещё летит — и PWA-обновление может
   * перезагрузить страницу прямо посреди него, потеряв изменение.
   */
  async function whileBusy<T>(action: () => Promise<T>): Promise<T> {
    appStore.setBusy(true)
    try {
      return await action()
    } finally {
      appStore.setBusy(false)
    }
  }

  /** Сохранить профиль и положить ответ в стор. Ошибку показываем текстом. */
  async function saveProfile(patch: UpdateUserRequest) {
    error.value = null
    try {
      const updated = await whileBusy(() => updateMe(patch))
      auth.setUser(updated)
    } catch (e) {
      error.value =
        e instanceof ApiError
          ? e.message
          : 'Не удалось сохранить. Попробуйте ещё раз.'
    }
  }

  return { error, whileBusy, saveProfile }
}
