import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { User } from '@/api/types'
import DateTimePickerModal from '@/components/ui/DateTimePickerModal.vue'
import { clearTransferDatesAlert, transferDatesAlert } from '@/composables/useTransferDatesAlert'
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
  fetchTripTransfer: vi.fn(),
}))

vi.mock('@/api/trips', () => ({
  getTrip: mocks.getTrip,
  updateTrip: mocks.updateTrip,
  listTripTypes: mocks.listTripTypes,
  fetchTripTransfer: mocks.fetchTripTransfer,
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
  hasGuitar: false,
  visibility: 'public',
  isRecruitmentClosed: false,
  activityTypeIds: [19],
  status: 'decided',
  startsAt: '2027-05-05T01:00:00.000Z',
  endsAt: '2027-05-09T10:00:00.000Z',
  dateVariants: [],
  isCommercial: false,
  isOfficial: false,
  openParticipation: true,
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
    paymentDetails: null,
    paymentBank: null,
    isAdmin: false,
  } satisfies User
}

async function open(userId = ORGANIZER, trip: Trip = TRIP) {
  signIn(userId)
  mocks.getTrip.mockResolvedValue(trip)
  mocks.updateTrip.mockResolvedValue(trip)
  mocks.listTripTypes.mockResolvedValue({ types: TOURISM, defaultTypeId: 19 })
  mocks.fetchTripTransfer.mockResolvedValue({ canEdit: true, travelers: [], legs: [] })

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

  /** Поставить дату и время: кнопка и модалка с «ОК», как в `CreateTrip`. */
  async function setMoment(
    wrapper: Awaited<ReturnType<typeof open>>['wrapper'],
    field: 'starts-at' | 'ends-at',
    value: string,
  ) {
    await wrapper.find(`[data-test="${field}"]`).trigger('click')
    await wrapper.findComponent(DateTimePickerModal).vm.$emit('select', value)
    await flushPromises()
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // Тревога «даты сдвинулись» — в localStorage: между тестами её снимаем.
    clearTransferDatesAlert('7')
  })

  it('форма заполнена текущими значениями похода', async () => {
    const { wrapper } = await open()

    const announcement = wrapper.find('[data-test="announcement"]').element as HTMLInputElement

    expect(announcement.value).toBe('Идём на майские')
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

    await wrapper.find('[data-test="announcement"]').setValue('')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.updateTrip).toHaveBeenCalledWith('7', { announcement: null })
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

  /**
   * Заказчик 13.11.2026: «по умолчанию поход пеший, поэтому сделай кнопку
   * сразу активной». Речь про старые походы без типов: у них форма правки
   * показывала четыре невыбранных чипса.
   */
  it('у похода без типов сразу выбран пеший', async () => {
    const { wrapper } = await open(ORGANIZER, { ...TRIP, activityTypeIds: [] })

    expect(wrapper.find('[data-test="trip-type-19"]').attributes('aria-pressed')).toBe('true')
  })

  it('выключенное открытое участие уезжает в патч', async () => {
    const { wrapper } = await open()

    await wrapper.find('[data-test="open-participation"]').setValue(false)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.updateTrip).toHaveBeenCalledWith('7', { openParticipation: false })
  })

  it('включённое открытое участие в патч не попадает', async () => {
    const { wrapper } = await open()

    await wrapper.find('[data-test="announcement"]').setValue('Перенесли на июнь')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.updateTrip).toHaveBeenCalledWith('7', { announcement: 'Перенесли на июнь' })
  })

  it('текст ошибки бэкенда показывается как есть', async () => {
    const { wrapper } = await open()
    mocks.updateTrip.mockRejectedValue(new Error('сеть'))

    await wrapper.find('[data-test="announcement"]').setValue('Что-то')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-test="error"]').exists()).toBe(true)
  })

  // ─────────── смена дат и уже запланированные трансферы (19.11.2026) ───────────

  const withNewDates: Trip = {
    ...TRIP,
    startsAt: '2027-05-07T01:00:00.000Z',
    endsAt: '2027-05-11T10:00:00.000Z',
  }

  it('даты сдвинули, рейсы есть — ведём в «Трансфер» с тревогой', async () => {
    const { wrapper, router } = await open()

    mocks.updateTrip.mockResolvedValue(withNewDates)
    mocks.fetchTripTransfer.mockResolvedValue({
      canEdit: true,
      travelers: [],
      // Достаточно того, что рейс вообще есть: план читается ради ответа
      // «предупреждать или нет», содержимое вкладке принесёт свой запрос.
      legs: [{ id: '1' }],
    })

    await setMoment(wrapper, 'starts-at', '2027-05-07T09:00')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(transferDatesAlert('7')).toBe(true)
    expect(router.currentRoute.value.name).toBe('trip')
    expect(router.currentRoute.value.query.tab).toBe('transfer')
  })

  it('даты сдвинули, рейсов нет — обычное возвращение в поход', async () => {
    const { wrapper, router } = await open()

    mocks.updateTrip.mockResolvedValue(withNewDates)

    await setMoment(wrapper, 'starts-at', '2027-05-07T09:00')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(transferDatesAlert('7')).toBe(false)
    expect(router.currentRoute.value.name).toBe('trip')
    expect(router.currentRoute.value.query.tab).toBeUndefined()
  })

  it('правка без дат трансферы не спрашивает', async () => {
    const { wrapper } = await open()

    await wrapper.find('[data-test="announcement"]').setValue('Перенесли на июнь')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.fetchTripTransfer).not.toHaveBeenCalled()
  })
})
