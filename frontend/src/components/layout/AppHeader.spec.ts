import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory, type Router } from 'vue-router'
import { nextTick } from 'vue'

import AppHeader from '@/components/layout/AppHeader.vue'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/api/types'

// logout уходит в сеть — в тесте шапки он не нужен.
vi.mock('@/api/auth', () => ({
  logout: vi.fn().mockResolvedValue(undefined),
}))

const user: User = {
  id: 'u1',
  displayName: 'Байкальский волк',
  location: 'Иркутск',
  avatarUrl: null,
}

/**
 * Тесты поведения меню в шапке.
 *
 * Здесь проверяется конкретный баг, который нашли при тестировании:
 * при переходе на «Личный кабинет» или на главную меню оставалось
 * открытым поверх новой страницы. Причина — обработчик закрывал меню
 * только по клику мимо шапки, а ссылки находятся внутри шапки, и клик
 * по ним «мимо» не считался.
 */
function makeRouter(): Router {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>home</div>' } },
      {
        path: '/profile',
        name: 'profile',
        component: { template: '<div>profile</div>' },
      },
      {
        path: '/auth',
        name: 'auth',
        component: { template: '<div>auth</div>' },
        meta: { hideHeader: true },
      },
    ],
  })
}

describe('AppHeader — меню', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    useAuthStore().setAuth(user, 'token')

    router = makeRouter()
    router.push('/')
    await router.isReady()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mountHeader(): VueWrapper {
    return mount(AppHeader, {
      global: { plugins: [router] },
    })
  }

  /** Пункты меню — единственное место, где встречается эта подпись. */
  function menuItem(wrapper: VueWrapper, text: string) {
    return wrapper.findAll('a, button').find((el) => el.text().includes(text))
  }

  it('по умолчанию меню закрыто', () => {
    const wrapper = mountHeader()

    expect(menuItem(wrapper, 'Личный кабинет')).toBeUndefined()
  })

  it('аватарка открывает меню, повторный клик закрывает', async () => {
    const wrapper = mountHeader()
    const trigger = wrapper.get('button[aria-haspopup="menu"]')

    await trigger.trigger('click')
    expect(menuItem(wrapper, 'Личный кабинет')).toBeDefined()

    await trigger.trigger('click')
    expect(menuItem(wrapper, 'Личный кабинет')).toBeUndefined()
  })

  it('клик мимо шапки закрывает меню', async () => {
    const wrapper = mountHeader()
    await wrapper.get('button[aria-haspopup="menu"]').trigger('click')

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    expect(menuItem(wrapper, 'Личный кабинет')).toBeUndefined()
  })

  it('Escape закрывает меню', async () => {
    const wrapper = mountHeader()
    await wrapper.get('button[aria-haspopup="menu"]').trigger('click')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(menuItem(wrapper, 'Личный кабинет')).toBeUndefined()
  })

  it('переход по ссылке меню закрывает его', async () => {
    // Это и есть тот баг: раньше меню оставалось открытым, потому что
    // клик по ссылке внутри шапки не считался «кликом мимо».
    const wrapper = mountHeader()
    await wrapper.get('button[aria-haspopup="menu"]').trigger('click')
    expect(menuItem(wrapper, 'Личный кабинет')).toBeDefined()

    await router.push('/profile')
    await nextTick()

    expect(menuItem(wrapper, 'Личный кабинет')).toBeUndefined()
  })

  it('клик по логотипу закрывает меню', async () => {
    // Сам переход проверяет роутер, а не шапка: здесь важно, что клик
    // по логотипу (это ссылка на /) закрывает меню так же, как любой
    // другой переход. URL в jsdom не сверяем — у history там непрозрачный
    // origin, и currentRoute ведёт себя не как в браузере.
    await router.push('/profile')
    const wrapper = mountHeader()
    await wrapper.get('button[aria-haspopup="menu"]').trigger('click')
    expect(menuItem(wrapper, 'Личный кабинет')).toBeDefined()

    await wrapper.get('a[aria-label="На главную"]').trigger('click')
    await nextTick()

    expect(menuItem(wrapper, 'Личный кабинет')).toBeUndefined()
  })

  it('после размонтирования обработчики документа сняты', async () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const wrapper = mountHeader()

    wrapper.unmount()

    const removed = removeSpy.mock.calls.map((call) => call[0])
    expect(removed).toContain('click')
    expect(removed).toContain('keydown')
  })
})
