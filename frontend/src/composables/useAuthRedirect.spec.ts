import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import { redirectWhenSignedOut } from '@/composables/useAuthRedirect'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/api/types'

const user: User = {
  id: 'u1',
  displayName: 'Тест',
  location: null,
  avatarUrl: null,
}

/**
 * Тесты ухода со страницы при потере авторизации.
 *
 * Это следствие бага при выходе: ранняя версия очищала store и звала
 * `window.location.assign` — полную перезагрузку в SPA. Между очисткой
 * и уходом Vue успевал отрисовать пустой профиль, а если перезагрузка
 * не срабатывала, пользователь там и оставался. Теперь уход обеспечивает
 * маршрутизатор.
 *
 * Проверяем `redirectWhenSignedOut` напрямую, с заглушками маршрута
 * и роутера, а не настоящий `useRouter`: так тест не зависит от
 * жизненного цикла компонентов и от того, какой экземпляр модуля
 * достался тесту.
 */
function makeRoute(requiresAuth: boolean) {
  return {
    matched: [{ meta: { requiresAuth } }],
  } as never
}

describe('redirectWhenSignedOut', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('уводит на вход, когда пользователь вышел на закрытой странице', async () => {
    const push = vi.fn()
    const auth = useAuthStore()
    auth.setAuth(user, 'token')

    redirectWhenSignedOut(auth, { push }, makeRoute(true))

    auth.clear()
    await nextTick()

    expect(push).toHaveBeenCalledWith({ name: 'auth' })
  })

  it('не трогает пользователя, который остался авторизованным', async () => {
    const push = vi.fn()
    const auth = useAuthStore()
    auth.setAuth(user, 'token')

    redirectWhenSignedOut(auth, { push }, makeRoute(true))

    // Обновление токена и профиля не должно никуда уводить.
    auth.setAuth({ ...user, displayName: 'Новое имя' }, 'token-2')
    await nextTick()

    expect(push).not.toHaveBeenCalled()
  })

  it('на публичной странице никуда не уводит', async () => {
    const push = vi.fn()
    const auth = useAuthStore()
    auth.setAuth(user, 'token')

    redirectWhenSignedOut(auth, { push }, makeRoute(false))

    auth.clear()
    await nextTick()

    expect(push).not.toHaveBeenCalled()
  })

  it('реагирует на любой источник потери авторизации', async () => {
    // Не только кнопка «Выйти»: access-токен пропадает и при неудачном
    // обновлении, и тогда со страницы тоже надо уйти.
    const push = vi.fn()
    const auth = reactive({ isAuthenticated: true })

    redirectWhenSignedOut(auth, { push }, makeRoute(true))

    auth.isAuthenticated = false
    await nextTick()

    expect(push).toHaveBeenCalledTimes(1)
  })
})
