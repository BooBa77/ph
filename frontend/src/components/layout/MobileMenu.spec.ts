import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import MobileMenu from '@/components/layout/MobileMenu.vue'
import { useAuthStore } from '@/stores/auth'
import { useMobileMenuStore } from '@/stores/mobileMenu'
import type { User } from '@/api/types'

/**
 * Тесты мобильного меню-гамбургера.
 *
 * Меню одно на два случая (решение заказчика 26.10.2026): на странице похода
 * оно показывает вкладки похода, на остальных — разделы сайта. Что именно
 * показать, решает не адрес, а контекст, который положила страница, — это
 * здесь и проверяется. Плюс обычное поведение оверлея: закрытие крестиком,
 * подложкой, Escape и переходом.
 */
vi.mock('@/api/auth', () => ({
  logout: vi.fn().mockResolvedValue(undefined),
}))

import { logout } from '@/api/auth'

const mockedLogout = vi.mocked(logout)

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/auth', name: 'auth', component: { template: '<div />' } },
      {
        path: '/profile/calendar',
        name: 'profile-calendar',
        component: { template: '<div />' },
      },
      { path: '/trips/:id', name: 'trip', component: { template: '<div />' } },
    ],
  })
}

function makeUser(): User {
  return {
    id: 'u1',
    displayName: 'Тест',
    location: null,
    avatarUrl: null,
    gender: 'm',
    isVegetarian: false,
    allergies: null,
    sportExperience: null,
    isAdmin: false,
  }
}

async function mountMenu(router: Router = makeRouter()) {
  await router.push('/')
  await router.isReady()

  const wrapper = mount(MobileMenu, {
    global: { plugins: [router] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, router }
}

/** Открыть панель так же, как её открывает кнопка в шапке. */
async function openMenu(wrapper: Awaited<ReturnType<typeof mountMenu>>['wrapper']) {
  useMobileMenuStore().openSite()
  await flushPromises()
  return wrapper
}

/** Открыть вкладки похода — так же, как кнопка рядом с заголовком. */
async function openTripMenu(wrapper: Awaited<ReturnType<typeof mountMenu>>['wrapper']) {
  useMobileMenuStore().openTrip()
  await flushPromises()
  return wrapper
}

describe('MobileMenu', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('по умолчанию закрыто и ничего не рисует', async () => {
    const { wrapper } = await mountMenu()

    expect(wrapper.find('[data-test="mobile-menu"]').exists()).toBe(false)
  })

  it('без контекста показывает разделы сайта', async () => {
    const { wrapper } = await mountMenu()
    await openMenu(wrapper)

    expect(wrapper.get('[data-test="mobile-menu-title"]').text()).toBe('Разделы сайта')
    expect(wrapper.findAll('[data-test="mobile-menu-link"]')).toHaveLength(10)
    expect(wrapper.text()).toContain('Походы')
    expect(wrapper.text()).toContain('Настройки')
  })

  it('админу добавляет в разделы сайта «Админку»', async () => {
    useAuthStore().setAuth({ ...makeUser(), isAdmin: true }, 'token')
    const { wrapper } = await mountMenu()
    await openMenu(wrapper)

    const links = wrapper.findAll('[data-test="mobile-menu-link"]')

    // Тот же список, что в колонке на десктопе: один пункт добавляется
    // по флагу профиля, а не отдельным списком в этом компоненте.
    expect(links).toHaveLength(11)
    expect(links.at(-1)?.text()).toBe('Админка')
    expect(links.at(-1)?.attributes('href')).toBe('/admin')
  })

  it('обычному пользователю «Админки» в разделах нет', async () => {
    useAuthStore().setAuth(makeUser(), 'token')
    const { wrapper } = await mountMenu()
    await openMenu(wrapper)

    expect(wrapper.findAll('[data-test="mobile-menu-link"]')).toHaveLength(10)
    expect(wrapper.text()).not.toContain('Админка')
  })

  it('по кнопке похода показывает вкладки похода, а не разделы сайта', async () => {
    const { wrapper } = await mountMenu()
    useMobileMenuStore().setContext({
      title: 'Разделы похода',
      items: [
        { key: 'guest', label: 'Гостевая', icon: 'guest', iconSet: 'trip', active: true },
        { key: 'meals', label: 'Питание', icon: 'meals', iconSet: 'trip', available: true },
        { key: 'sport', label: 'Спорт', icon: 'sport', iconSet: 'trip', available: false },
      ],
    })
    await openTripMenu(wrapper)

    expect(wrapper.get('[data-test="mobile-menu-title"]').text()).toBe('Разделы похода')
    expect(wrapper.findAll('[data-test="mobile-menu-link"]')).toHaveLength(0)

    const tabs = wrapper.findAll('[data-test="mobile-menu-tab"]')
    expect(tabs.map((tab) => tab.text())).toEqual(['Гостевая', 'Питание', 'Спорт скоро'])
  })

  it('в меню сайта вкладок похода нет, даже если страница их положила', async () => {
    const { wrapper } = await mountMenu()
    useMobileMenuStore().setContext({
      title: 'Разделы похода',
      items: [{ key: 'guest', label: 'Гостевая', icon: 'guest', iconSet: 'trip' }],
    })
    await openMenu(wrapper)

    // Два меню не подменяют друг друга: шапка всегда открывает сайт.
    expect(wrapper.get('[data-test="mobile-menu-title"]').text()).toBe('Разделы сайта')
    expect(wrapper.findAll('[data-test="mobile-menu-tab"]')).toHaveLength(0)
    expect(wrapper.findAll('[data-test="mobile-menu-link"]')).toHaveLength(10)
  })

  it('подсвечивает активную вкладку похода', async () => {
    const { wrapper } = await mountMenu()
    useMobileMenuStore().setContext({
      title: 'Разделы похода',
      items: [
        { key: 'guest', label: 'Гостевая', icon: 'guest', iconSet: 'trip', active: false },
        { key: 'meals', label: 'Питание', icon: 'meals', iconSet: 'trip', active: true },
      ],
    })
    await openTripMenu(wrapper)

    const tabs = wrapper.findAll('[data-test="mobile-menu-tab"]')
    expect(tabs[1]?.attributes('aria-current')).toBe('page')
    expect(tabs[1]?.classes()).toContain('text-primary')
    expect(tabs[0]?.attributes('aria-current')).toBeUndefined()
  })

  it('недоступную вкладку нельзя нажать', async () => {
    const { wrapper } = await mountMenu()
    const onSelect = vi.fn()
    useMobileMenuStore().setContext({
      title: 'Разделы похода',
      items: [
        { key: 'sport', label: 'Спорт', icon: 'sport', iconSet: 'trip', available: false, onSelect },
      ],
    })
    await openTripMenu(wrapper)

    const tab = wrapper.get('[data-test="mobile-menu-tab"]')
    expect(tab.attributes('disabled')).toBeDefined()

    await tab.trigger('click')
    await flushPromises()

    expect(onSelect).not.toHaveBeenCalled()
    expect(useMobileMenuStore().isOpen).toBe(true)
  })

  it('нажатие вкладки переключает её и закрывает панель', async () => {
    const { wrapper } = await mountMenu()
    const onSelect = vi.fn()
    useMobileMenuStore().setContext({
      title: 'Разделы похода',
      items: [{ key: 'meals', label: 'Питание', icon: 'meals', iconSet: 'trip', onSelect }],
    })
    await openTripMenu(wrapper)

    await wrapper.get('[data-test="mobile-menu-tab"]').trigger('click')
    await flushPromises()

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(useMobileMenuStore().isOpen).toBe(false)
  })

  it('крестик закрывает панель', async () => {
    const { wrapper } = await mountMenu()
    await openMenu(wrapper)

    await wrapper.get('[aria-label="Закрыть меню"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="mobile-menu"]').exists()).toBe(false)
  })

  it('нажатие по подложке закрывает панель', async () => {
    const { wrapper } = await mountMenu()
    await openMenu(wrapper)

    await wrapper.get('[data-test="mobile-menu-backdrop"]').trigger('click')
    await flushPromises()

    expect(useMobileMenuStore().isOpen).toBe(false)
  })

  it('Escape закрывает панель', async () => {
    const { wrapper } = await mountMenu()
    await openMenu(wrapper)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(useMobileMenuStore().isOpen).toBe(false)
  })

  it('переход по ссылке закрывает панель', async () => {
    const { wrapper, router } = await mountMenu()
    await openMenu(wrapper)

    await router.push('/profile/calendar')
    await flushPromises()

    expect(useMobileMenuStore().isOpen).toBe(false)
  })

  it('не даёт прокручивать страницу под открытой панелью', async () => {
    const { wrapper } = await mountMenu()
    await openMenu(wrapper)

    expect(document.body.style.overflow).toBe('hidden')

    useMobileMenuStore().close()
    await flushPromises()

    expect(document.body.style.overflow).toBe('')
  })

  it('спрашивает подтверждение перед выходом', async () => {
    const { wrapper } = await mountMenu()
    await openMenu(wrapper)

    const logoutButton = wrapper.findAll('button').find((item) => item.text() === 'Выйти')
    if (!logoutButton) throw new Error('Нет кнопки «Выйти»')

    await logoutButton.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Выйти из аккаунта?')
    expect(mockedLogout).not.toHaveBeenCalled()
  })

  it('выходит по подтверждению и уводит на страницу входа', async () => {
    const { wrapper, router } = await mountMenu()
    useAuthStore().setAuth(makeUser(), 'token')
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

  it('в меню похода выхода нет', async () => {
    const { wrapper } = await mountMenu()
    useMobileMenuStore().setContext({
      title: 'Разделы похода',
      items: [{ key: 'guest', label: 'Гостевая', icon: 'guest', iconSet: 'trip' }],
    })
    await openTripMenu(wrapper)

    expect(wrapper.findAll('button').some((item) => item.text() === 'Выйти')).toBe(false)
  })
})
