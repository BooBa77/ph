import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import SiteSidebar from '@/components/layout/SiteSidebar.vue'

/**
 * Тесты меню сайта.
 *
 * Меню одно на всё приложение: разделы сайта и аккаунта в одном списке,
 * на мобиле — полоса ярлыков плюс гамбургер с остальным. Проверяем именно
 * это: состав разделов, открытие и закрытие панели (клик, Escape,
 * переход) и подтверждение выхода.
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
      {
        path: '/trips/announces',
        name: 'trips-announces',
        component: { template: '<div />' },
      },
      {
        path: '/profile/personal',
        name: 'profile-personal',
        component: { template: '<div />' },
      },
      {
        path: '/profile/calendar',
        name: 'profile-calendar',
        component: { template: '<div />' },
      },
      {
        path: '/profile/sport',
        name: 'profile-sport',
        component: { template: '<div />' },
      },
      {
        path: '/profile/settings',
        name: 'profile-settings',
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

/** Открыть панель «все разделы» (гамбургер). */
async function openMenu(wrapper: Awaited<ReturnType<typeof mountSidebar>>['wrapper']) {
  await wrapper.get('[aria-label="Все разделы"]').trigger('click')
  await flushPromises()
}

describe('SiteSidebar', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('показывает все разделы сайта', async () => {
    const { wrapper } = await mountSidebar()

    const labels = wrapper
      .findAll('a')
      .map((link) => link.attributes('aria-label'))

    expect(labels).toEqual([
      'Главная',
      'Походы',
      'Профиль',
      'Календарь',
      'Спорт',
      'Настройки',
    ])
  })

  it('ведёт на главную первой ссылкой', async () => {
    const { wrapper } = await mountSidebar()

    expect(wrapper.findAll('a')[0]?.attributes('href')).toBe('/')
  })

  it('по умолчанию панель «все разделы» закрыта', async () => {
    const { wrapper } = await mountSidebar()

    expect(wrapper.text()).not.toContain('Все разделы')
  })

  it('гамбургер открывает панель с выходом', async () => {
    const { wrapper } = await mountSidebar()

    await openMenu(wrapper)

    expect(wrapper.text()).toContain('Все разделы')
    expect(
      wrapper.findAll('button').some((item) => item.text() === 'Выйти'),
    ).toBe(true)
  })

  it('Escape закрывает панель', async () => {
    const { wrapper } = await mountSidebar()
    await openMenu(wrapper)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(wrapper.text()).not.toContain('Все разделы')
  })

  it('переход по ссылке закрывает панель', async () => {
    const { wrapper, router } = await mountSidebar()
    await openMenu(wrapper)

    await router.push('/profile/calendar')
    await flushPromises()

    expect(wrapper.text()).not.toContain('Все разделы')
  })

  it('спрашивает подтверждение перед выходом', async () => {
    const { wrapper } = await mountSidebar()
    await openMenu(wrapper)

    const logoutButton = wrapper
      .findAll('button')
      .find((item) => item.text() === 'Выйти')
    if (!logoutButton) throw new Error('Нет кнопки «Выйти»')

    await logoutButton.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Выйти из аккаунта?')
    expect(mockedLogout).not.toHaveBeenCalled()
  })

  it('выходит по подтверждению и уводит на страницу входа', async () => {
    const { wrapper, router } = await mountSidebar()
    await openMenu(wrapper)

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
