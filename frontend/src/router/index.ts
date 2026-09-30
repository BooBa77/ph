import { createRouter, createWebHistory } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import Home from '@/views/Home.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: Home,
      meta: { requiresAuth: true },
    },
    {
      path: '/auth',
      name: 'auth',
      // Ленивая загрузка: код AuthView попадёт в отдельный чанк,
      // который скачается только при первом заходе на /auth.
      // Home грузим жадно — это точка входа для залогиненных.
      component: () => import('@/views/AuthView.vue'),
      // hideHeader — на /auth шапку не показываем (юзер не залогинен,
      // «Выйти» и «Личный кабинет» там бессмысленны).
      meta: { requiresAuth: false, hideHeader: true },
    },
  ],
})

/**
 * Глобальный before-each guard.
 *
 * Выполняется перед каждым переходом. Задачи:
 *   1. Один раз за жизнь приложения сделать bootstrap (проверить,
 *      залогинен ли юзер, через POST /api/auth/refresh).
 *   2. Не пустить неавторизованного на requiresAuth-роут — редирект на /auth.
 *   3. Не пустить авторизованного на /auth — редирект на /.
 */
router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // Bootstrap один раз. isBootstrapped ставится в finally внутри store,
  // так что даже при падении refresh мы сюда больше не вернёмся.
  if (!auth.isBootstrapped) {
    await auth.bootstrap()
  }

  const requiresAuth = to.meta.requiresAuth === true

  // Не залогинен, а роут требует авторизации → на /auth.
  if (requiresAuth && !auth.isAuthenticated) {
    return { name: 'auth' }
  }

  // Залогинен, а идёт на /auth → на /.
  if (!requiresAuth && to.name === 'auth' && auth.isAuthenticated) {
    return { name: 'home' }
  }

  // Всё ок — пропускаем.
  return true
})

export default router