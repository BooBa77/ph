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
    actualStartedAt: null,
    actualFinishedAt: null,
    participants: [],
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

  it('места сбора на обзоре нет', async () => {
    const wrapper = await mountView()

    expect(wrapper.text()).not.toContain('Место сбора')
  })

  it('состав виден всем: имя, роль и статус', async () => {
    // С 21.10.2026 «Гостевая» одна для всех: состав — часть анонса.
    mocked.fetchGuestTrip.mockResolvedValue(
      makeGuest({
        participants: [
          {
            userId: 'u-1',
            displayName: 'Ваня',
            avatarUrl: null,
            status: 'going',
            roles: [{ code: 'organizer', name: 'Организатор' }],
            isOrganizer: true,
            createdAt: '2026-10-14T10:00:00.000Z',
            updatedAt: '2026-10-14T10:00:00.000Z',
          },
        ],
      }),
    )

    const wrapper = await mountView()
    const list = wrapper.find('[data-test="guest-participants"]')

    expect(list.exists()).toBe(true)
    expect(list.text()).toContain('Ваня')
    expect(list.text()).toContain('организатор')
    expect(list.text()).toContain('Организатор')
    expect(list.text()).toContain('Идёт')
  })

  it('фактические даты видны, если поход состоялся', async () => {
    mocked.fetchGuestTrip.mockResolvedValue(
      makeGuest({
        actualStartedAt: '2027-05-05T09:00:00.000Z',
        actualFinishedAt: '2027-05-09T18:00:00.000Z',
      }),
    )

    const wrapper = await mountView()

    expect(wrapper.find('[data-test="guest-actual-dates"]').text()).toContain('2027')
  })

  it('404 объясняется словами «закрыт», а не пустой страницей', async () => {
    mocked.fetchGuestTrip.mockRejectedValue(new ApiError(404, 'Поход не найден', null))

    const wrapper = await mountView()

    expect(wrapper.find('[data-test="guest-error"]').text()).toContain('закрыт')
  })
})
