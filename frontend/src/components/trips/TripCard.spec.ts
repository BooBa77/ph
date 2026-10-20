import { RouterLinkStub, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TripCard from '@/components/trips/TripCard.vue'
import type { Trip } from '@/types/trips'

/**
 * Тесты карточки похода.
 *
 * Карточка — единственное место, где поход показывается в списке, и она же
 * ссылка на поход. Проверяем и содержание, и то, что вся карточка целиком
 * ведёт в поход: на телефоне человек жмёт по карточке, а не по её заголовку.
 */
const BASE: Trip = {
  id: '1',
  organizerUserId: 'u-1',
  goalObjectId: '10',
  goalObject: { id: '10', name: 'Витязь', type: 'скальник', url: null },
  announcement: 'Идём на майские, набор шесть человек',
  routeText: '',
  requirementsText: null,
  meetingPlace: null,
  meetingAt: null,
  transferText: null,
  visibility: 'public',
  isRecruitmentClosed: false,
  activityTypeIds: [],
  status: 'decided',
  startsAt: '2027-05-05T00:00:00.000Z',
  endsAt: '2027-05-09T00:00:00.000Z',
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

const trip = (overrides: Partial<Trip> = {}): Trip => ({ ...BASE, ...overrides })

function mountCard(value: Trip) {
  return mount(TripCard, {
    props: { trip: value },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

describe('TripCard', () => {
  it('имя похода — цель из справочника, анонс идёт подписью', () => {
    const wrapper = mountCard(trip())

    expect(wrapper.find('[data-test="trip-card-goal"]').text()).toContain('Витязь')
    expect(wrapper.find('[data-test="trip-card-goal"]').text()).toContain('скальник')
    expect(wrapper.find('[data-test="trip-card-announcement"]').text()).toContain('майские')
  })

  it('без анонса подписи нет, а не пустая строка', () => {
    const wrapper = mountCard(trip({ announcement: null }))

    expect(wrapper.find('[data-test="trip-card-announcement"]').exists()).toBe(false)
  })

  it('показывает и готовность, и даты', () => {
    const text = mountCard(trip()).find('[data-test="trip-card-when"]').text()

    expect(text).toContain('Решено')
    expect(text).toContain('2027')
  })

  it('коммерция и спортивность видны значками, цена — рядом с признаком', () => {
    const wrapper = mountCard(trip({ isCommercial: true, priceRub: 25000, isOfficial: true }))
    const badges = wrapper.findAll('[data-test="trip-card-badge"]').map((badge) => badge.text())

    expect(badges).toEqual(['коммерческий · 25000 ₽', 'официальный поход'])
  })

  it('у обычного похода значков нет', () => {
    expect(mountCard(trip()).findAll('[data-test="trip-card-badge"]')).toHaveLength(0)
  })

  it('вся карточка ведёт в поход', () => {
    const wrapper = mountCard(trip())

    expect(wrapper.findComponent(RouterLinkStub).props('to')).toEqual({
      name: 'trip',
      params: { id: '1' },
    })
  })

  it('поход без цели не ломает карточку', () => {
    const wrapper = mountCard(trip({ goalObject: null }))

    expect(wrapper.find('[data-test="trip-card-goal"]').text()).toContain('Без цели')
  })
})
