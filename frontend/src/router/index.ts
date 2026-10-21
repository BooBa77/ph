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
          component: () => import('@/views/profile/sections/PersonalInfo.vue'),
        },
        {
          // Календарь пользователя: пока текущий месяц, дальше — отметки
          // и события по дням.
          path: 'calendar',
          name: 'profile-calendar',
          component: () => import('@/views/profile/sections/UserCalendar.vue'),
        },
        {
          // Спортивный опыт: альпинизм, скайраннинг, спортивный туризм.
          // Отдельной вкладкой, потому что это девятнадцать списков.
          path: 'sport',
          name: 'profile-sport',
          component: () => import('@/views/profile/sections/SportExperience.vue'),
        },
        {
          // Снаряжение: личный каталог предметов с весом. Из него в походе
          // собирается общественное снаряжение, а вес рюкзака считается
          // по этим числам.
          path: 'gear',
          name: 'profile-gear',
          component: () => import('@/views/profile/sections/UserGear.vue'),
        },
        {
          // Чек-листы: шаблоны снаряжения, продуктов и аптечки. В поход
          // из шаблона попадает копия, поэтому это раздел профиля, а не
          // похода — шаблон живёт вне походов.
          path: 'checklists',
          name: 'profile-checklists',
          component: () => import('@/views/profile/sections/UserChecklists.vue'),
        },
        {
          // Настройки: сессии устройств и сезонная анимация.
          path: 'settings',
          name: 'profile-settings',
          component: () => import('@/views/profile/sections/UserSettings.vue'),
        },
      ],
    },
    {
      // Раздел «Походы». Корень — свои походы, анонсы чужих — отдельной
      // страницей: смешанная лента заставляла бы искать свои походы среди
      // чужих. Адреса у разделов отдельные, поэтому переделка разметки
      // меню не трогает ссылки.
      path: '/trips',
      component: () => import('@/views/trips/TripsView.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          // Пустой путь — сам `/trips`. Отдельный redirect здесь не нужен:
          // корень раздела и есть «Мои походы».
          path: '',
          name: 'trips-mine',
          component: () => import('@/views/trips/MyTrips.vue'),
        },
        {
          path: 'announces',
          name: 'trips-announces',
          component: () => import('@/views/trips/TripAnnounces.vue'),
        },
        {
          path: 'new',
          name: 'trips-create',
          component: () => import('@/views/trips/CreateTrip.vue'),
        },
        {
          // Сам поход: общая рамка и вкладки внутри.:id объявлен после
          // статических путей — иначе '/trips/new' стал бы походом с id 'new'.
          path: ':id',
          name: 'trip',
          component: () => import('@/views/trips/TripView.vue'),
        },
        {
          // Правка похода. Отдельный адрес, а не режим внутри страницы:
          // форму можно открыть в новой вкладке, а «назад» из неё
          // возвращает в поход, а не в середину чужого экрана.
          path: ':id/edit',
          name: 'trip-edit',
          component: () => import('@/views/trips/TripEdit.vue'),
        },
      ],
    },
    {
      // Модерация иконок активностей: зародыш админки. Доступ проверяет
      // бэкенд — список админов захардкожен, чужому тут делать нечего.
      path: '/admin/activities',
      name: 'admin-activities',
      component: () => import('@/views/admin/ActivityModeration.vue'),
      meta: { requiresAuth: true },
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
