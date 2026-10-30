import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import SiteSidebar from '@/components/layout/SiteSidebar.vue'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/api/types'

/**
 * Тесты колонки меню на десктопе.
 *
 * Меню одно на всё приложение: разделы сайта и аккаунта в одном списке.
 * **Мобильной полосы ярлыков здесь больше нет** (26.10.2026): её заменил
 * гамбургер в шапке, и его поведение проверяет `MobileMenu.spec.ts`.
 * Осталось проверить состав разделов, ссылку на главную и выход.
 */
vi.mock('@/api/auth', () => ({
  logout: vi.fn().mockResolvedValue(undefined),
}))

import { logout } from '@/api/auth'

const mockedLogout = vi.mocked(logout)

/** Минимальный роутер: ссылкам нужно куда вести, а тесту — куда перейти. */
function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/auth', name: 'auth', component: { template: '<div />' } },
      { path: '/trips', name: 'trips-mine', component: { template: '<div />' } },
      {
        path: '/profile/personal',
        name: 'profile-personal',
        component: { template: '<div />' },
      },
      {
        // Админка — раздел с оглавлением и дочерними экранами: на вложенном
        // адресе пункт меню должен остаться подсвеченным.
        path: '/admin',
        component: { template: '<div><RouterView /></div>' },
        children: [
          { path: '', name: 'admin-home', component: { template: '<div />' } },
          { path: 'gear', name: 'admin-gear', component: { template: '<div />' } },
        ],
      },
    ],
  })
}

/** Профиль для теста: остальное — как отдаёт бэкенд. */
function makeUser(isAdmin: boolean): User {
  return {
    id: 'u1',
    displayName: 'Тест',
    location: null,
    avatarUrl: null,
    gender: 'm',
    isVegetarian: false,
    allergies: null,
    sportExperience: null,
    isAdmin,
  }
}

async function mountSidebar(router: Router = makeRouter()) {
  await router.push('/')
  await router.isReady()

  const wrapper = mount(SiteSidebar, {
    global: { plugins: [router] },
  })
  await flushPromises()
  return { wrapper, router }
}

describe('SiteSidebar', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('показывает все разделы сайта', async () => {
    const { wrapper } = await mountSidebar()

    const labels = wrapper.findAll('a').map((link) => link.attributes('aria-label'))

    expect(labels).toEqual([
      'Главная',
      'Походы',
      'Профиль',
      'Календарь',
      'Спорт',
      'Снаряжение',
      'Кулинарная книга',
      'Чек-листы',
      'Контакты',
      'Настройки',
    ])
  })

  it('ведёт на главную первой ссылкой', async () => {
    const { wrapper } = await mountSidebar()

    expect(wrapper.findAll('a')[0]?.attributes('href')).toBe('/')
  })

  it('обычному пользователю админку не показывает', async () => {
    useAuthStore().setAuth(makeUser(false), 'token')
    const { wrapper } = await mountSidebar()

    const labels = wrapper.findAll('a').map((link) => link.attributes('aria-label'))

    expect(labels).toHaveLength(10)
    expect(labels).not.toContain('Админка')
  })

  it('админу добавляет «Админку» последним пунктом', async () => {
    useAuthStore().setAuth(makeUser(true), 'token')
    const { wrapper } = await mountSidebar()

    const links = wrapper.findAll('a')
    const labels = links.map((link) => link.attributes('aria-label'))

    // Пункт стоит после «Настроек»: это не раздел аккаунта, а служебный
    // вход, и место у него — на отшибе.
    expect(labels).toHaveLength(11)
    expect(labels.at(-1)).toBe('Админка')
    expect(links.at(-1)?.attributes('href')).toBe('/admin')
  })

  it('подсвечивает «Админку» и на вложенном экране', async () => {
    useAuthStore().setAuth(makeUser(true), 'token')

    const router = makeRouter()
    await router.push('/admin/gear')
    await router.isReady()

    const wrapper = mount(SiteSidebar, { global: { plugins: [router] } })
    await flushPromises()

    const link = wrapper.findAll('a').find((item) => item.attributes('aria-label') === 'Админка')

    // Подсветка корня на дочерних адресах — то, ради чего админка собрана
    // вложенными маршрутами, а не двумя отдельными.
    expect(link?.classes()).toContain('text-primary')
  })

  it('виден только от md и скрыт на мобиле', async () => {
    const { wrapper } = await mountSidebar()

    // На мобиле меню открывается гамбургером: колонка не должна занимать
    // место в потоке узкого экрана.
    expect(wrapper.get('nav').classes()).toContain('hidden')
    expect(wrapper.get('nav').classes()).toContain('md:flex')
  })

  it('спрашивает подтверждение перед выходом', async () => {
    const { wrapper } = await mountSidebar()

    const logoutButton = wrapper.findAll('button').find((item) => item.text() === 'Выйти')
    if (!logoutButton) throw new Error('Нет кнопки «Выйти»')

    await logoutButton.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Выйти из аккаунта?')
    expect(mockedLogout).not.toHaveBeenCalled()
  })

  it('выходит по подтверждению и уводит на страницу входа', async () => {
    const { wrapper, router } = await mountSidebar()

    await wrapper
      .findAll('button')
      .find((item) => item.text() === 'Выйти')
      ?.trigger('click')
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((item) => item.text() === 'Да')
      ?.trigger('click')
    await flushPromises()

    expect(mockedLogout).toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('auth')
  })
})
