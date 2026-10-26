import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import SiteSidebar from '@/components/layout/SiteSidebar.vue'

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
    ],
  })
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
