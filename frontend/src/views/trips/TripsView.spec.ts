import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import TripsView from '@/views/trips/TripsView.vue'
import { useMobileMenuStore } from '@/stores/mobileMenu'

/**
 * Тесты рамки раздела «Походы»: кнопка вкладок похода.
 *
 * Решение заказчика 26.10.2026: два меню — две кнопки. Гамбургер в шапке
 * всегда открывает разделы сайта, а вкладки похода — своя кнопка справа
 * от заголовка раздела. Кнопка живёт здесь, а не в шапке, поэтому и
 * проверяется здесь: появляется только когда страница похода положила
 * контекст (то есть на `/trips/:id`), и открывает именно вкладки.
 */
function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/trips',
        component: TripsView,
        children: [{ path: '', name: 'trips-mine', component: { template: '<div />' } }],
      },
      { path: '/', name: 'home', component: { template: '<div />' } },
    ],
  })
}

async function mountTrips(router: Router = makeRouter()) {
  await router.push('/trips')
  await router.isReady()

  const wrapper = mount(TripsView, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

const TRIP_CONTEXT = {
  title: 'Разделы похода',
  items: [{ key: 'guest', label: 'Гостевая', icon: 'guest', iconSet: 'trip' as const }],
}

describe('TripsView и кнопка вкладок похода', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('без контекста похода кнопки нет', async () => {
    const { wrapper } = await mountTrips()

    expect(wrapper.find('[data-test="trip-menu-button"]').exists()).toBe(false)
  })

  it('с контекстом показывает кнопку рядом с заголовком', async () => {
    useMobileMenuStore().setContext(TRIP_CONTEXT)
    const { wrapper } = await mountTrips()

    const button = wrapper.get('[data-test="trip-menu-button"]')
    expect(button.text()).toContain('Разделы похода')
    // На десктопе вкладки и так стоят строкой сверху.
    expect(button.classes()).toContain('md:hidden')
  })

  it('открывает вкладки похода, а не разделы сайта', async () => {
    useMobileMenuStore().setContext(TRIP_CONTEXT)
    const { wrapper } = await mountTrips()

    await wrapper.get('[data-test="trip-menu-button"]').trigger('click')

    expect(useMobileMenuStore().mode).toBe('trip')
  })

  it('после ухода со страницы похода кнопка исчезает', async () => {
    const menu = useMobileMenuStore()
    menu.setContext(TRIP_CONTEXT)
    const { wrapper } = await mountTrips()

    menu.clearContext()
    await flushPromises()

    expect(wrapper.find('[data-test="trip-menu-button"]').exists()).toBe(false)
  })
})
