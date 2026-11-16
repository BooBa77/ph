import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import OfflineBanner from '@/components/offline/OfflineBanner.vue'
import { useOfflineStore } from '@/stores/offline'
import type { Trip } from '@/types/trips'

/**
 * Полоса «нет связи».
 *
 * Проверяется главное обещание: в офлайне человек видит, что связи нет
 * и что доступен только текущий поход. Ссылка должна вести именно в поход,
 * а не в раздел, который guard всё равно развернёт.
 */
const TRIP = {
  id: '679',
  status: 'decided',
  goalObject: { id: '1', name: 'Витязь', type: 'скальник', url: null },
  startsAt: '2020-01-01T00:00:00.000Z',
  endsAt: null,
  actualStartedAt: null,
  actualFinishedAt: null,
  cancelledAt: null,
} as Trip

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/offline', name: 'offline', component: { template: '<div />' } },
      { path: '/trips/:id', name: 'trip', component: { template: '<div />' } },
    ],
  })
}

async function open() {
  const store = useOfflineStore()
  const router = makeRouter()
  await router.push('/')

  const wrapper = mount(OfflineBanner, { global: { plugins: [router] } })
  return { wrapper, store, router }
}

describe('OfflineBanner', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('онлайн не показывается', async () => {
    const { wrapper } = await open()

    expect(wrapper.find('[data-test="offline-banner"]').exists()).toBe(false)
  })

  it('в офлайне объясняет режим и ведёт в сохранённый поход', async () => {
    const { wrapper, store } = await open()
    store.isOnline = false
    await store.rememberTrip(TRIP)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-test="offline-banner"]').text()).toContain('Нет связи')
    expect(wrapper.find('[data-test="offline-banner"]').text()).toContain(
      'Доступны сохранённые походы',
    )

    const link = wrapper.find('[data-test="offline-banner-link"]')
    expect(link.text()).toContain('Витязь')
    expect(link.attributes('href')).toBe('/trips/679')
  })

  it('без сохранённых походов ведёт на экран «нет связи»', async () => {
    const { wrapper, store } = await open()
    store.isOnline = false
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-test="offline-banner-link"]').attributes('href')).toBe('/offline')
  })
})
