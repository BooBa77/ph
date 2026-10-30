import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import type { User } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import AdminHome from '@/views/admin/AdminHome.vue'

/**
 * Тесты оглавления админки.
 *
 * Решение заказчика 30.10.2026: ссылка на админку — в общем меню, а ведёт она
 * в `/admin` со списком экранов. Проверяем ровно это: админу — ссылки на оба
 * экрана, остальным — текст отказа. Данные и права экранов живут на бэкенде
 * и покрыты e2e; здесь RouterLinks и флаг профиля.
 */
function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      {
        path: '/admin',
        component: { template: '<div><RouterView /></div>' },
        children: [
          { path: '', name: 'admin-home', component: { template: '<div />' } },
          { path: 'gear', name: 'admin-gear', component: { template: '<div />' } },
          {
            path: 'activities',
            name: 'admin-activities',
            component: { template: '<div />' },
          },
        ],
      },
    ],
  })
}

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

async function mountHome(): Promise<ReturnType<typeof mount>> {
  const router = makeRouter()
  await router.push('/admin')
  await router.isReady()

  const wrapper = mount(AdminHome, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('AdminHome', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('не пускает в список никого, кроме админа, — гость видит отказ', async () => {
    const wrapper = await mountHome()

    expect(wrapper.find('[data-test="admin-sections"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="admin-forbidden"]').text()).toBe(
      'Раздел только для администратора.',
    )
  })

  it('обычному пользователю списка разделов не показывает', async () => {
    useAuthStore().setAuth(makeUser(false), 'token')
    const wrapper = await mountHome()

    expect(wrapper.find('[data-test="admin-sections"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="admin-forbidden"]').exists()).toBe(true)
  })

  it('админу показывает оба раздела админки ссылками', async () => {
    useAuthStore().setAuth(makeUser(true), 'token')
    const wrapper = await mountHome()

    const links = wrapper.findAll('[data-test="admin-section"]')

    expect(wrapper.find('[data-test="admin-forbidden"]').exists()).toBe(false)
    expect(links.map((link) => link.attributes('href'))).toEqual([
      '/admin/gear',
      '/admin/activities',
    ])
    expect(links[0]?.text()).toContain('Типы снаряжения')
    expect(links[1]?.text()).toContain('Модерация иконок')
  })
})
