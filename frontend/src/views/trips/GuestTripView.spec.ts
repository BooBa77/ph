import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { ApiError } from '@/api/errors'
import type { GuestTrip } from '@/types/trips'
import GuestTripView from '@/views/trips/GuestTripView.vue'

/**
 * Тесты «Гостевой» вкладки.
 *
 * Главное — что гость видит обзор, но **не видит** того, что решено
 * скрыть: места сбора и состава. Первое обеспечивается DTO на бэкенде
 * (e2e `access.e2e-spec.ts`), второе — тем, что экран рисует ровно
 * гостевые поля.
 */
vi.mock('@/api/trips', () => ({ fetchGuestTrip: vi.fn() }))
vi.mock('@/api/objects', () => ({ listObjectsByIds: vi.fn() }))

import * as api from '@/api/trips'
import * as objects from '@/api/objects'

const mocked = vi.mocked(api)
const mockedObjects = vi.mocked(objects)

function makeGuest(overrides: Partial<GuestTrip> = {}): GuestTrip {
  return {
    id: '7',
    goalObject: { id: '10', name: 'Витязь', type: 'скальник', url: null },
    announcement: 'Идём на майские',
    routeText: 'Подход от станции',
    requirementsText: 'Свои кошки',
    status: 'decided',
    startsAt: '2027-05-05T00:00:00.000Z',
    endsAt: '2027-05-09T00:00:00.000Z',
    isCommercial: true,
    priceRub: 5000,
    priceNote: 'Заброска и питание',
    isOfficial: false,
    isRecruitmentClosed: false,
    ...overrides,
  }
}

async function mountView(): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(GuestTripView, { props: { tripId: '7' } })
  await flushPromises()

  return wrapper
}

describe('GuestTripView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.fetchGuestTrip.mockResolvedValue(makeGuest())
    mockedObjects.listObjectsByIds.mockResolvedValue([])
  })

  it('показывает обзор: цель, когда, рамку, маршрут и требования', async () => {
    const wrapper = await mountView()

    expect(wrapper.find('[data-test="guest-goal"]').text()).toContain('Витязь')
    expect(wrapper.find('[data-test="guest-when"]').text()).toContain('2027')
    expect(wrapper.find('[data-test="guest-frame"]').text()).toContain('коммерческий')
    expect(wrapper.find('[data-test="guest-route"]').text()).toContain('Подход')
    expect(wrapper.find('[data-test="guest-requirements"]').text()).toContain('кошки')
  })

  it('места сбора и состава на гостевой вкладке нет', async () => {
    const wrapper = await mountView()

    const text = wrapper.text()
    expect(text).not.toContain('Место сбора')
    expect(text).not.toContain('Участники')
  })

  it('404 объясняется словами «закрыт», а не пустой страницей', async () => {
    mocked.fetchGuestTrip.mockRejectedValue(new ApiError(404, 'Поход не найден', null))

    const wrapper = await mountView()

    expect(wrapper.find('[data-test="guest-error"]').text()).toContain('закрыт')
  })
})
