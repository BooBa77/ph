import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import AppHeader from '@/components/layout/AppHeader.vue'
import type { User } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { useMobileMenuStore } from '@/stores/mobileMenu'

/**
 * Тесты шапки.
 *
 * Знак в шапке уже однажды пропадал незамеченным (его убрали «на время»,
 * а вернуть забыли) — поэтому здесь проверяется именно он: картинка
 * на месте, ведёт на главную, у неё пустой alt (рядом текстовая подпись).
 */
function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      {
        path: '/profile/personal',
        name: 'profile-personal',
        component: { template: '<div />' },
      },
      { path: '/auth', name: 'auth', component: { template: '<div />' } },
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
  }
}

async function mountHeader(loggedIn = true) {
  const router = makeRouter()
  await router.push('/')
  await router.isReady()

  if (loggedIn) useAuthStore().setAuth(makeUser(), 'token')

  return mount(AppHeader, { global: { plugins: [router] } })
}

describe('AppHeader', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('показывает знак проекта и ведёт им на главную', async () => {
    const wrapper = await mountHeader()

    const link = wrapper.get('a[aria-label="На главную"]')
    const logo = link.get('img')

    expect(link.attributes('href')).toBe('/')
    expect(logo.attributes('src')).toBeTruthy()
    // alt пустой: подпись «PeakHunter» стоит рядом, дубль читался бы дважды.
    expect(logo.attributes('alt')).toBe('')
  })

  it('подписывает знак названием на широких экранах', async () => {
    const wrapper = await mountHeader()

    const link = wrapper.get('a[aria-label="На главную"]')
    expect(link.text()).toContain('PeakHunter')
  })

  it('без входа аватарки нет', async () => {
    const wrapper = await mountHeader(false)

    expect(wrapper.find('a[aria-label="Личный кабинет"]').exists()).toBe(false)
  })

  it('с входом аватарка ведёт в последний раздел кабинета', async () => {
    const wrapper = await mountHeader()

    const profileLink = wrapper.get('a[aria-label="Личный кабинет"]')
    expect(profileLink.attributes('href')).toBe('/profile/personal')
    expect(profileLink.text()).toContain('Тест')
  })

  it('открывает мобильное меню кнопкой-гамбургером', async () => {
    const wrapper = await mountHeader()
    const menu = useMobileMenuStore()

    const button = wrapper.get('[data-test="menu-button"]')
    expect(button.attributes('aria-label')).toBe('Меню')
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(button.attributes('aria-controls')).toBe('site-mobile-menu')

    await button.trigger('click')

    expect(menu.isSiteOpen).toBe(true)
    expect(button.attributes('aria-expanded')).toBe('true')

    // Повторный клик закрывает: кнопка одна.
    await button.trigger('click')
    expect(menu.isOpen).toBe(false)
  })

  it('стоит в углу, сразу за кнопкой профиля', async () => {
    const wrapper = await mountHeader()

    const profile = wrapper.get('a[aria-label="Личный кабинет"]')
    const button = wrapper.get('[data-test="menu-button"]')

    // Порядок в шапке — требование заказчика: сначала человек, потом меню,
    // и меню у самого края экрана.
    expect(profile.element.nextElementSibling).toBe(button.element)
  })

  it('прячет гамбургер на десктопе', async () => {
    const wrapper = await mountHeader()

    // На широком экране разделы стоят колонкой слева: вторая кнопка для них
    // заставляла бы выбирать между двумя одинаковыми меню.
    expect(wrapper.get('[data-test="menu-button"]').classes()).toContain('md:hidden')
  })
})
