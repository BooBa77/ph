import { watch } from 'vue'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import { useRoute, useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

/**
 * Уводит на страницу входа, когда пользователь перестал быть
 * авторизованным, находясь на закрытой странице.
 *
 * Зачем отдельно от ручного редиректа: выход из аккаунта делался так —
 * очистить store и позвать `window.location.assign('/auth')`. В SPA это
 * лишняя перезагрузка, и между очисткой и уходом Vue успевал отрисовать
 * уже пустой профиль: пользователь видел форму без данных и ждуна вместо
 * кнопки выхода. Если перезагрузка по какой-то причине не случалась,
 * он там и оставался.
 *
 * Теперь выход не зависит от того, сработал ли переход: состояние
 * изменилось — уходим. Это же закрывает случай, когда store очистился
 * не из-за кнопки «Выйти», а из-за неудачного обновления токена
 * (там access-токен пропадает сам).
 *
 * Разделено на две функции не для красоты: подписка живёт на уровне
 * приложения и должна быть одна, а вызывать её из теста неудобно —
 * проверять надо реакцию на смену состояния, а не факт подписки.
 * Поэтому логика вынесена в `redirectWhenSignedOut`, а `useAuthRedirect`
 * — тонкая обёртка для App.vue.
 */
export function redirectWhenSignedOut(
  auth: { isAuthenticated: boolean },
  router: Pick<Router, 'push'>,
  route: Pick<RouteLocationNormalizedLoaded, 'matched'>,
): void {
  watch(
    () => auth.isAuthenticated,
    (isAuthenticated) => {
      if (isAuthenticated) return

      // Уходим только с закрытых страниц: на самой странице входа и на
      // публичных адресах делать нечего.
      const isPrivate = route.matched.some(
        (record) => record.meta.requiresAuth === true,
      )
      if (!isPrivate) return

      void router.push({ name: 'auth' })
    },
  )
}

/** Вызывается один раз из App.vue. */
export function useAuthRedirect() {
  redirectWhenSignedOut(useAuthStore(), useRouter(), useRoute())
}
