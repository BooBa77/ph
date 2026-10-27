import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { User } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import type { Trip } from '@/types/trips'
import TripTransfer from '@/views/trips/TripTransfer.vue'

/**
 * Макет вкладки «Трансфер».
 *
 * Пока у вкладки нет API, проверяется не «сохранилось ли», а **правила,
 * которые экран обязан показать**: маршрут строки, места в машине считаются
 * вместе с водителем, «без машины» — это `carId: null`, «вернуться так же»
 * копирует строку с обратными точками и без даты, убрать машину — значит
 * освободить её пассажиров, а не выкинуть их из строки.
 *
 * Отдельная пара тестов — про права: свою машину водитель правит и без
 * права на вкладку, чужую наёмную — нет, а снять себя со строки человек
 * может всегда (это и есть «пассажир может отказаться»).
 */
function makeUser(): User {
  return {
    id: 'demo-me',
    displayName: 'Олег',
    location: null,
    avatarUrl: null,
    gender: 'm',
    isVegetarian: false,
    allergies: null,
    sportExperience: null,
  }
}

const TRIP: Trip = {
  id: '1',
  organizerUserId: 'demo-anna',
  goalObjectId: '10',
  goalObject: { id: '10', name: 'Витязь', type: 'скальник', url: null },
  announcement: null,
  routeText: '',
  requirementsText: null,
  meetingPlace: null,
  hasGuitar: false,
  visibility: 'public',
  isRecruitmentClosed: false,
  activityTypeIds: [],
  status: 'decided',
  startsAt: null,
  endsAt: null,
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

function mountTransfer(options: { canEdit?: boolean; trip?: Partial<Trip> } = {}) {
  return mount(TripTransfer, {
    props: { trip: { ...TRIP, ...options.trip }, canEdit: options.canEdit ?? true },
  })
}

describe('TripTransfer', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
    useAuthStore().setAuth(makeUser(), 'token')
  })

  it('показывает строки заброски, машины и состав', async () => {
    const wrapper = mountTransfer()
    await flushPromises()

    expect(wrapper.findAll('[data-test="transfer-leg"]')).toHaveLength(2)

    const legs = wrapper.findAll('[data-test="transfer-leg"]')
    expect(legs[0]?.find('[data-test="transfer-leg-mode"]').text()).toContain('Авто')
    expect(legs[0]?.find('[data-test="transfer-leg-places"]').text()).toContain(
      'Иркутск, автовокзал → Олхинское плато, Витязь',
    )
    expect(legs[1]?.find('[data-test="transfer-leg-mode"]').text()).toContain('Автобус')

    expect(wrapper.findAll('[data-test="transfer-car"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('Анна')
    expect(wrapper.text()).toContain('Сергей')
  })

  it('считает места вместе с водителем: у наёмной он тоже занимает место', async () => {
    const wrapper = mountTransfer()
    await flushPromises()

    const seats = wrapper.findAll('[data-test="transfer-car-seats"]')
    // Своя машина: я и Анна, водитель — я, отдельного места ему не нужно.
    expect(seats[0]?.text()).toBe('2 из 5')
    // Наёмная: Пётр и Игорь плюс водитель без аккаунта.
    expect(seats[1]?.text()).toBe('3 из 4')
  })

  it('показывает место сбора отдельной строкой и честно молчит, когда его нет', async () => {
    const empty = mountTransfer()
    await flushPromises()
    expect(empty.find('[data-test="transfer-meeting-text"]').text()).toBe('не указано')

    const filled = mountTransfer({ trip: { meetingPlace: 'Иркутск, платформа 1' } })
    await flushPromises()
    expect(filled.find('[data-test="transfer-meeting-text"]').text()).toBe('Иркутск, платформа 1')
  })

  it('подписывает «без машины» тех, кому места не досталось', async () => {
    const wrapper = mountTransfer()
    await flushPromises()

    const firstLeg = wrapper.findAll('[data-test="transfer-leg"]')[0]
    expect(firstLeg?.text()).toContain('Без машины')
    expect(firstLeg?.findAll('[data-test="transfer-passenger"]').map((item) => item.text())).toEqual([
      expect.stringContaining('Марина'),
    ])
  })

  it('сажает нераспределённого в машину', async () => {
    const wrapper = mountTransfer()
    await flushPromises()

    const choose = wrapper.find('[data-test="transfer-choose-car-demo-marina"]')
    await choose.setValue('11')

    const firstLeg = wrapper.findAll('[data-test="transfer-leg"]')[0]
    expect(firstLeg?.findAll('[data-test="transfer-car"]')[0]?.text()).toContain('Марина')
    // В строке нераспределённых не осталось — «все по машинам».
    expect(firstLeg?.findAll('[data-test="transfer-passenger"]')).toHaveLength(0)
    expect(firstLeg?.text()).toContain('все по машинам')
  })

  it('снятие пассажира возвращает его в «без машины»', async () => {
    const wrapper = mountTransfer()
    await flushPromises()

    await wrapper.find('[data-test="transfer-unseat-demo-anna"]').trigger('click')

    const firstLeg = wrapper.findAll('[data-test="transfer-leg"]')[0]
    // Анна больше не сидит в машине: её крестика там нет, а в списке
    // нераспределённых она есть.
    expect(wrapper.find('[data-test="transfer-unseat-demo-anna"]').exists()).toBe(false)
    expect(firstLeg?.findAll('[data-test="transfer-passenger"]').map((item) => item.text())).toEqual(
      expect.arrayContaining([expect.stringContaining('Анна'), expect.stringContaining('Марина')]),
    )
  })

  it('убранная машина оставляет своих пассажиров в строке нераспределёнными', async () => {
    const wrapper = mountTransfer()
    await flushPromises()

    await wrapper.find('[data-test="transfer-remove-car-12"]').trigger('click')

    expect(wrapper.findAll('[data-test="transfer-car"]')).toHaveLength(1)
    // Пётр и Игорь ехали наёмной — теперь их можно посадить в оставшуюся.
    expect(wrapper.find('[data-test="transfer-choose-car-demo-petr"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="transfer-choose-car-demo-igor"]').exists()).toBe(true)
  })

  it('«вернуться так же» копирует строку с обратными точками и без даты', async () => {
    const wrapper = mountTransfer()
    await flushPromises()

    await wrapper.findAll('[data-test="transfer-return"]')[0]?.trigger('click')

    const legs = wrapper.findAll('[data-test="transfer-leg"]')
    expect(legs).toHaveLength(3)
    expect(legs[2]?.find('[data-test="transfer-leg-places"]').text()).toContain(
      'Олхинское плато, Витязь → Иркутск, автовокзал',
    )
    // Дату обратного выезда не выдумываем: «время уточняется».
    expect(legs[2]?.find('[data-test="transfer-leg-mode"]').text()).toContain('время уточняется')
    // Машины и люди — «так же»: две машины и весь состав строки.
    expect(legs[2]?.findAll('[data-test="transfer-car"]')).toHaveLength(2)
  })

  it('без права на вкладку правится только своя машина', async () => {
    const wrapper = mountTransfer({ canEdit: false })
    await flushPromises()

    expect(wrapper.find('[data-test="transfer-add-leg"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="transfer-add-car"]').exists()).toBe(false)
    // Своя машина (id 11) — можно снять пассажира; наёмная (12) — нет.
    expect(wrapper.find('[data-test="transfer-unseat-demo-anna"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="transfer-unseat-demo-petr"]').exists()).toBe(false)
  })

  it('снять себя со строки можно даже без права на вкладку', async () => {
    const wrapper = mountTransfer({ canEdit: false })
    await flushPromises()

    await wrapper.find('[data-test="transfer-unseat-demo-me"]').trigger('click')
    await flushPromises()

    // Я в «без машины», и крестик у меня есть, хотя прав на вкладку нет.
    expect(wrapper.find('[data-test="transfer-drop-demo-me"]').exists()).toBe(true)
    // У чужого человека крестика нет — снимать его может только ведущий.
    expect(wrapper.find('[data-test="transfer-drop-demo-anna"]').exists()).toBe(false)
  })

  it('добавляет строку: точки обязательны, дата необязательна', async () => {
    const wrapper = mountTransfer()
    await flushPromises()

    await wrapper.find('[data-test="transfer-add-leg"]').trigger('click')
    await wrapper.find('[data-test="transfer-leg-save"]').trigger('click')

    expect(wrapper.find('[data-test="transfer-leg-error"]').text()).toContain('откуда и куда')

    await wrapper.find('[data-test="transfer-from-input"]').setValue('Иркутск')
    await wrapper.find('[data-test="transfer-to-input"]').setValue('Большое Голоустное')
    await wrapper.find('[data-test="transfer-leg-save"]').trigger('click')

    const legs = wrapper.findAll('[data-test="transfer-leg"]')
    expect(legs).toHaveLength(3)
    expect(legs[2]?.text()).toContain('Иркутск → Большое Голоустное')
    expect(legs[2]?.text()).toContain('время уточняется')
  })

  it('наёмной машине нужно имя водителя, а места считаются', async () => {
    const wrapper = mountTransfer()
    await flushPromises()

    await wrapper.findAll('[data-test="transfer-add-car"]')[0]?.trigger('click')
    await wrapper.find('[data-test="transfer-ownership-input"]').setValue('hired')
    await wrapper.find('[data-test="transfer-car-save"]').trigger('click')

    expect(wrapper.find('[data-test="transfer-car-error"]').text()).toContain('имя водителя')

    await wrapper.find('[data-test="transfer-driver-name-input"]').setValue('Гарик')
    await wrapper.find('[data-test="transfer-driver-phone-input"]').setValue('+7 902 000-00-00')
    await wrapper.find('[data-test="transfer-seats-input"]').setValue('3')
    await wrapper.find('[data-test="transfer-car-save"]').trigger('click')

    expect(wrapper.findAll('[data-test="transfer-car"]')).toHaveLength(3)
    const legs = wrapper.findAll('[data-test="transfer-leg"]')
    expect(legs[0]?.text()).toContain('Наёмная')
    expect(legs[0]?.text()).toContain('+7 902 000-00-00')
    // Место водителя занято сразу, даже если он не в составе.
    expect(wrapper.findAll('[data-test="transfer-car-seats"]')[2]?.text()).toBe('1 из 3')
  })
})
