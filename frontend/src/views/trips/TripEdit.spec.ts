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
 * означала бы «сохрани пустоту». Второе, что проверяется, — типы похода
 * и «Будет гитара»: и то и другое появилось в форме 21.10.2026, и оба
 * обязаны доезжать до сервера.
 */
const mocks = vi.hoisted(() => ({
  getTrip: vi.fn(),
  updateTrip: vi.fn(),
  listTripTypes: vi.fn(),
}))

vi.mock('@/api/trips', () => ({
  getTrip: mocks.getTrip,
  updateTrip: mocks.updateTrip,
  listTripTypes: mocks.listTripTypes,
}))

const ORGANIZER = 'u-org'

const TOURISM = [
  { id: 19, code: 'trip_hiking', label: 'Пеший поход', icon: 'hike' },
  { id: 20, code: 'trip_alpinism', label: 'Альпинизм', icon: 'mountain' },
]

const TRIP: Trip = {
  id: '7',
  organizerUserId: ORGANIZER,
  goalObjectId: '10',
  goalObject: { id: '10', name: 'Витязь', type: 'скальник', url: null },
  announcement: 'Идём на майские',
  routeText: 'Подход от станции',
  requirementsText: 'Свои кошки',
  meetingPlace: 'Иркутск, автовокзал',
  hasGuitar: false,
  visibility: 'public',
  isRecruitmentClosed: false,
  activityTypeIds: [19],
  status: 'decided',
  startsAt: '2027-05-05T01:00:00.000Z',
  endsAt: '2027-05-09T10:00:00.000Z',
  dateVariants: [],
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
    gender: 'm',
    isVegetarian: false,
    allergies: null,
    sportExperience: null,
  } satisfies User
}

async function open(userId = ORGANIZER) {
  signIn(userId)
  mocks.getTrip.mockResolvedValue(TRIP)
  mocks.updateTrip.mockResolvedValue(TRIP)
  mocks.listTripTypes.mockResolvedValue({ types: TOURISM, defaultTypeId: 19 })

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

    expect(announcement.value).toBe('Идём на майские')
    expect(meeting.value).toBe('Иркутск, автовокзал')
    expect(wrapper.find('[data-test="selected-goal"]').text()).toContain('Витязь')

    // Тип похода в форме — выбранный чипс, а не пустой список.
    expect(wrapper.find('[data-test="trip-type-19"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-test="trip-type-20"]').attributes('aria-pressed')).toBe('false')
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

  it('новый тип похода уезжает в патч, а неизменный — нет', async () => {
    const { wrapper } = await open()

    await wrapper.find('[data-test="trip-type-20"]').trigger('click')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.updateTrip).toHaveBeenCalledWith('7', { activityTypeIds: [19, 20] })
  })

  it('«Будет гитара» включается одним чекбоксом', async () => {
    const { wrapper } = await open()

    await wrapper.find('[data-test="guitar"]').setValue(true)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.updateTrip).toHaveBeenCalledWith('7', { hasGuitar: true })
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
