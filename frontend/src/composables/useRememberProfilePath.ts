import { watch } from 'vue'
import { useRoute } from 'vue-router'

import { useAppStore } from '@/stores/app'

/**
 * Запоминает последний открытый раздел личного кабинета.
 *
 * Нужно, чтобы клик по аватарке в шапке вёл туда, откуда пользователь
 * ушёл, а не всегда в первый раздел. Значение переживает перезагрузку
 * (см. `lastProfilePath` в stores/app).
 *
 * Почему composable, а не watcher в App.vue: логика про личный кабинет,
 * и место ей рядом с ним, а не в корневом компоненте, который про
 * кабинет ничего не знает. Вызывается из ProfileView — то есть работает
 * ровно тогда, когда кабинет открыт.
 */
export function useRememberProfilePath() {
  const route = useRoute()
  const appStore = useAppStore()

  watch(
    () => route.path,
    (path) => {
      if (path.startsWith('/profile/')) {
        appStore.setLastProfilePath(path)
      }
    },
    { immediate: true },
  )
}
