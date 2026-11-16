import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import OfflineView from '@/views/OfflineView.vue'
import { useOfflineStore } from '@/stores/offline'
import type { Trip } from '@/types/trips'

/**
 * Экран «нет связи».
 *
 * Он обязан честно говорить две вещи: что делать, если текущий поход
 * не сохранён, и что именно лежит на устройстве, если сохранён.
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
      { path: '/offline', name: 'offline', component: OfflineView },
      { path: '/trips/:id', name: 'trip', component: { template: '<div />' } },
    ],
  })
}

async function open() {
  const store = useOfflineStore()
  const router = makeRouter()
  await router.push('/offline')

  const wrapper = mount(OfflineView, { global: { plugins: [router] } })
  return { wrapper, store }
}

describe('OfflineView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('без сохранённого похода объясняет, как сохранить', async () => {
    const { wrapper } = await open()

    const empty = wrapper.find('[data-test="offline-empty"]')
    expect(empty.exists()).toBe(true)
    expect(empty.text()).toContain('сохранённых походов на устройстве нет')
    expect(wrapper.find('[data-test="offline-trip-list"]').exists()).toBe(false)
  })

  it('показывает сохранённый текущий поход, его даты и время сохранения', async () => {
    const { wrapper, store } = await open()
    await store.rememberTrip(TRIP)
    await store.markSaved('679', Date.parse('2026-11-16T02:20:00.000Z'))
    await wrapper.vm.$nextTick()

    const link = wrapper.find('[data-test="offline-trip-link"]')
    expect(link.text()).toContain('Витязь')
    expect(link.text()).toContain('Сохранено:')
    expect(link.attributes('href')).toBe('/trips/679')
  })
})
