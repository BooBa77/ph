import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { User } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import type { Trip } from '@/types/trips'
import TripEdit from '@/views/trips/TripEdit.vue'

/**
 * Тесты страницы правки похода.
 *
 * Главное здесь — что в `PATCH` уходит **разница**, а не форма целиком,
 * и что форма заполнена текущими значениями похода: пустая форма правки
 * означала бы «сохрани пустоту».
 */
const mocks = vi.hoisted(() => ({ getTrip: vi.fn(), updateTrip: vi.fn() }))

vi.mock('@/api/trips', () => ({
  getTrip: mocks.getTrip,
  updateTrip: mocks.updateTrip,
}))

const ORGANIZER = 'u-org'

const TRIP: Trip = {
  id: '7',
  organizerUserId: ORGANIZER,
  goalObjectId: '10',
  goalObject: { id: '10', name: 'Витязь', type: 'скальник', url: null },
  announcement: 'Идём на майские',
  routeText: 'Подход от станции',
  requirementsText: 'Свои кошки',
  meetingPlace: 'Иркутск, автовокзал',
  meetingAt: '2027-05-05T00:00:00.000Z',
  transferText: 'Электричка 6:40',
  visibility: 'public',
  isRecruitmentClosed: false,
  activityTypeIds: [],
  status: 'decided',
  startsAt: '2027-05-05T01:00:00.000Z',
  endsAt: '2027-05-09T10:00:00.000Z',
  actualStartedAt: null,
  actualFinishedAt: null,
  isCommercial: false,
  isOfficial: false,
  priceRub: null,
  priceNote: null,
  cancelledAt: null,
  createdAt: '2026-10-14T10:00:00.000Z',
  updatedAt: '2026-10-14T10:00:00.000Z',
}

function signIn(id: string) {
  const auth = useAuthStore()
  auth.user = {
    id,
    displayName: 'Я',
    location: null,
    avatarUrl: null,
    isVegetarian: false,
    allergies: null,
    sportExperience: null,
  } satisfies User
}

async function open(userId = ORGANIZER) {
  signIn(userId)
  mocks.getTrip.mockResolvedValue(TRIP)
  mocks.updateTrip.mockResolvedValue(TRIP)

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/trips/:id/edit', name: 'trip-edit', component: TripEdit },
      { path: '/trips/:id', name: 'trip', component: { template: '<div />' } },
    ],
  })
  await router.push('/trips/7/edit')
  await router.isReady()

  const wrapper = mount(TripEdit, { global: { plugins: [router] } })
  await flushPromises()

  return { wrapper, router }
}

describe('TripEdit', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('форма заполнена текущими значениями похода', async () => {
    const { wrapper } = await open()

    const announcement = wrapper.find('[data-test="announcement"]').element as HTMLInputElement
    const meeting = wrapper.find('[data-test="meeting-place"]').element as HTMLInputElement
    const transfer = wrapper.find('[data-test="transfer"]').element as HTMLTextAreaElement

    expect(announcement.value).toBe('Идём на майские')
    expect(meeting.value).toBe('Иркутск, автовокзал')
    expect(transfer.value).toBe('Электричка 6:40')
    expect(wrapper.find('[data-test="selected-goal"]').text()).toContain('Витязь')
  })

  it('чужому формы нет: правит только организатор', async () => {
    const { wrapper } = await open('u-other')

    expect(wrapper.find('[data-test="edit-forbidden"]').exists()).toBe(true)
    expect(wrapper.find('form').exists()).toBe(false)
  })

  it('в PATCH уходит только изменённое поле, а не форма целиком', async () => {
    const { wrapper, router } = await open()

    await wrapper.find('[data-test="announcement"]').setValue('Перенесли на июнь')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.updateTrip).toHaveBeenCalledWith('7', { announcement: 'Перенесли на июнь' })
    expect(router.currentRoute.value.name).toBe('trip')
  })

  it('очищенное поле уезжает null-ом, а не пропуском', async () => {
    const { wrapper } = await open()

    await wrapper.find('[data-test="meeting-place"]').setValue('')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.updateTrip).toHaveBeenCalledWith('7', { meetingPlace: null })
  })

  it('текст ошибки бэкенда показывается как есть', async () => {
    const { wrapper } = await open()
    mocks.updateTrip.mockRejectedValue(new Error('сеть'))

    await wrapper.find('[data-test="announcement"]').setValue('Что-то')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-test="error"]').exists()).toBe(true)
  })
})
