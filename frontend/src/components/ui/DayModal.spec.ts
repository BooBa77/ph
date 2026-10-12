import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CalendarDay } from '@/api/calendar'
import DayModal from '@/components/ui/DayModal.vue'
import { useCalendarStore } from '@/stores/calendar'

/**
 * Тесты модалки дня.
 *
 * День модалка берёт из стора, правки отправляет туда же, поэтому API
 * подменён, а кэш стора заполняется руками — так тест проверяет саму
 * модалку, а не загрузку данных.
 */
vi.mock('@/api/calendar', () => ({
  fetchYearState: vi.fn(),
  fetchDays: vi.fn(),
  createYear: vi.fn(),
  patchDay: vi.fn(),
  updateDays: vi.fn(),
  fetchActivityDictionary: vi.fn(),
  addActivity: vi.fn(),
  removeActivity: vi.fn(),
  saveNotes: vi.fn(),
  createActivityRequest: vi.fn(),
}))

import * as api from '@/api/calendar'

const mocked = vi.mocked(api)

describe('DayModal', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0, 0))
    mocked.fetchActivityDictionary.mockResolvedValue({
      groups: [],
      favorites: [],
      requests: [],
      isAdmin: false,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function putDay(
    date: string,
    dayType: CalendarDay['dayType'] = 'workday',
    label: string | null = 'Четверг',
  ) {
    const store = useCalendarStore()
    store.daysByDate[date] = { date, dayType, label }
    return store
  }

  function button(wrapper: ReturnType<typeof mount>, text: string) {
    const found = wrapper.findAll('button').find((item) => item.text() === text)
    if (!found) throw new Error(`Нет кнопки «${text}»`)
    return found
  }

  it('в заголовке — метка дня, ниже — дата', () => {
    putDay('2026-10-15')
    const wrapper = mount(DayModal, { props: { date: new Date(2026, 9, 15) } })

    expect(wrapper.get('#day-modal-title').text()).toBe('Четверг')
    expect(wrapper.text()).toContain('Четверг, 15 октября 2026')
  })

  it('без метки в заголовке — дата', () => {
    putDay('2026-10-15', 'workday', null)
    const wrapper = mount(DayModal, { props: { date: new Date(2026, 9, 15) } })

    expect(wrapper.get('#day-modal-title').text()).toBe('Четверг, 15 октября 2026')
  })

  it('сегодняшний день помечает', () => {
    putDay('2026-10-07', 'workday', null)
    const wrapper = mount(DayModal, { props: { date: new Date(2026, 9, 7) } })

    expect(wrapper.text()).toContain('Это сегодня')
  })

  it('подсвечивает текущий статус дня в переключателе', () => {
    putDay('2026-10-15', 'weekend')
    const wrapper = mount(DayModal, { props: { date: new Date(2026, 9, 15) } })

    expect(button(wrapper, 'ВЫХ').classes()).toContain('font-medium')
    expect(button(wrapper, 'РАБ').classes()).not.toContain('font-medium')
  })

  it('меняет статус одним кликом', async () => {
    putDay('2026-10-15')
    mocked.patchDay.mockResolvedValue({
      date: '2026-10-15',
      dayType: 'weekend',
      label: 'Четверг',
    })

    const wrapper = mount(DayModal, { props: { date: new Date(2026, 9, 15) } })
    // Переключатель виден сразу, промежуточных шагов нет.
    await button(wrapper, 'ВЫХ').trigger('click')
    await flushPromises()

    expect(mocked.patchDay).toHaveBeenCalledWith({
      date: '2026-10-15',
      dayType: 'weekend',
    })
  })

  it('на сокращённом дне «РАБ» ничего не меняет', async () => {
    putDay('2026-10-15', 'short_workday')
    const wrapper = mount(DayModal, { props: { date: new Date(2026, 9, 15) } })

    // Сокращённый день — рабочий: он и так подсвечен как РАБ, а клик по нему
    // стёр бы признак «короче на час».
    expect(button(wrapper, 'РАБ').classes()).toContain('font-medium')
    expect(wrapper.text()).toContain('Сокращённый рабочий день')

    await button(wrapper, 'РАБ').trigger('click')
    await flushPromises()

    expect(mocked.patchDay).not.toHaveBeenCalled()
  })

  it('правит метку и очищает её пустой строкой', async () => {
    putDay('2026-10-15')
    mocked.patchDay.mockResolvedValue({
      date: '2026-10-15',
      dayType: 'workday',
      label: null,
    })

    const wrapper = mount(DayModal, { props: { date: new Date(2026, 9, 15) } })
    await wrapper.get('#day-modal-title').trigger('click')
    await wrapper.get('[aria-label="Метка дня"]').setValue('')
    await button(wrapper, 'Сохранить').trigger('click')
    await flushPromises()

    expect(mocked.patchDay).toHaveBeenCalledWith({ date: '2026-10-15', label: null })
  })

  it('Escape сначала отменяет правку метки, потом закрывает', async () => {
    putDay('2026-10-15')
    const wrapper = mount(DayModal, { props: { date: new Date(2026, 9, 15) } })

    await wrapper.get('#day-modal-title').trigger('click')
    expect(wrapper.find('[aria-label="Метка дня"]').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[aria-label="Метка дня"]').exists()).toBe(false)
    expect(wrapper.emitted('close')).toBeUndefined()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('это диалог: role, aria-modal и ссылка на заголовок', () => {
    putDay('2026-10-15')
    const wrapper = mount(DayModal, { props: { date: new Date(2026, 9, 15) } })
    const dialog = wrapper.get('[role="dialog"]')

    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBe('day-modal-title')
  })

  it('кнопка «Закрыть» сообщает о закрытии', async () => {
    putDay('2026-10-15')
    const wrapper = mount(DayModal, { props: { date: new Date(2026, 9, 15) } })

    await button(wrapper, 'Закрыть').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
