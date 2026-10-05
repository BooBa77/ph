import { createRouter, createWebHistory } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import HomeView from '@/views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: { requiresAuth: true },
    },
    {
      path: '/auth',
      name: 'auth',
      // Ленивая загрузка: код AuthView попадёт в отдельный чанк,
      // который скачается только при первом заходе на /auth.
      component: () => import('@/views/AuthView.vue'),
      // hideHeader — на /auth шапку не показываем (юзер не залогинен).
      meta: { requiresAuth: false, hideHeader: true },
    },
    {
      // Раздел «Личный кабинет». Родительский роут — layout (ProfileView).
      // Дети рендерятся в <RouterView> внутри ProfileView.
      path: '/profile',
      component: () => import('@/views/profile/ProfileView.vue'),
      // redirect — при заходе на /profile (без раздела) перекидываем
      // на первый раздел. Чтобы /profile не был «пустой страницей».
      redirect: '/profile/personal',
      // requiresAuth стоит на родителе. Guard проверяет через
      // to.matched.some(...) — тогда детям не надо дублировать meta.
      meta: { requiresAuth: true },
      children: [
        {
          // path БЕЗ ведущего слэша — иначе Vue Router посчитает
          // его абсолютным (/personal в корне). Так — /profile/personal.
          path: 'personal',
          name: 'profile-personal',
          component: () =>
            import('@/views/profile/sections/PersonalInfo.vue'),
        },
      ],
    },
  ],
})

/**
 * Глобальный before-each guard.
 *
 * Выполняется перед каждым переходом. Задачи:
 *   1. Один раз за жизнь приложения сделать bootstrap.
 *   2. Не пустить неавторизованного на requiresAuth-роут — редирект на /auth.
 *   3. Не пустить авторизованного на /auth — редирект на /.
 *
 * Про requiresAuth и вложенные роуты:
 *   Vue Router НЕ наследует meta от родителя к детям. Поэтому проверяем
 *   через to.matched — это массив всех роутов в цепочке (родитель + дети).
 *   Если ХОТЬ ОДИН требует авторизации — требуем. Так достаточно поставить
 *   requiresAuth один раз — на /profile, и все его дети попадают под защиту.
 */
router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // Bootstrap один раз.
  if (!auth.isBootstrapped) {
    await auth.bootstrap()
  }

  const requiresAuth = to.matched.some((r) => r.meta.requiresAuth === true)

  // Не залогинен, а роут требует авторизации → на /auth.
  if (requiresAuth && !auth.isAuthenticated) {
    return { name: 'auth' }
  }

  // Залогинен, а идёт на /auth → на /.
  if (to.name === 'auth' && auth.isAuthenticated) {
    return { name: 'home' }
  }

  return true
})

export default router