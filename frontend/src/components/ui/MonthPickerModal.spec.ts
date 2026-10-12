import { enableAutoUnmount, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MonthPickerModal from '@/components/ui/MonthPickerModal.vue'

/**
 * Тесты модалки выбора месяца.
 *
 * Главное, что здесь проверяется: список месяцев, подсветка показанного
 * месяца (только в его году), точка на текущем месяце и то, что год
 * внутри модалки живёт своей жизнью — наружу уходит лишь вместе
 * с выбранным месяцем.
 */
enableAutoUnmount(afterEach)

describe('MonthPickerModal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 7 октября 2026 — календарь показывает октябрь 2026.
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function monthButton(wrapper: VueWrapper, name: string) {
    const found = wrapper.findAll('button').find((item) => item.text() === name)
    if (!found) throw new Error(`В модалке нет месяца ${name}`)
    return found
  }

  function mountPicker(year = 2026, month = 9) {
    return mount(MonthPickerModal, { props: { year, month } })
  }

  it('показывает двенадцать месяцев', () => {
    const wrapper = mountPicker()
    const names = wrapper
      .findAll('button')
      .map((item) => item.text())
      .filter((text) => text !== '‹' && text !== '›' && text !== 'Отмена')

    expect(names).toEqual([
      'Январь',
      'Февраль',
      'Март',
      'Апрель',
      'Май',
      'Июнь',
      'Июль',
      'Август',
      'Сентябрь',
      'Октябрь',
      'Ноябрь',
      'Декабрь',
    ])
  })

  it('начинает со года, который показан в календаре', () => {
    const wrapper = mountPicker()

    expect(wrapper.text()).toContain('2026')
  })

  it('подсвечивает показанный месяц', () => {
    const wrapper = mountPicker()

    expect(monthButton(wrapper, 'Октябрь').classes()).toContain('text-primary')
    expect(monthButton(wrapper, 'Ноябрь').classes()).not.toContain('text-primary')
  })

  it('в чужом году показанного месяца нет', async () => {
    const wrapper = mountPicker()

    await wrapper.get('[aria-label="Следующий год"]').trigger('click')

    // Октябрь 2027 — не тот октябрь, что сейчас в календаре.
    expect(wrapper.text()).toContain('2027')
    expect(monthButton(wrapper, 'Октябрь').classes()).not.toContain('text-primary')
  })

  it('отмечает текущий месяц, пока показывается текущий год', async () => {
    const wrapper = mountPicker()
    const dot = (name: string) => monthButton(wrapper, name).find('span')

    // Точка — единственный потомок внутри кнопки месяца.
    expect(dot('Октябрь').exists()).toBe(true)
    expect(dot('Ноябрь').exists()).toBe(false)

    await wrapper.get('[aria-label="Следующий год"]').trigger('click')

    // В 2027 году текущего месяца нет ни у одного месяца.
    expect(dot('Октябрь').exists()).toBe(false)
  })

  it('клик по месяцу отдаёт год и номер месяца', async () => {
    const wrapper = mountPicker()

    await monthButton(wrapper, 'Март').trigger('click')

    expect(wrapper.emitted('select')).toEqual([[2026, 2]])
  })

  it('после смены года отдаёт новый год', async () => {
    const wrapper = mountPicker()

    await wrapper.get('[aria-label="Следующий год"]').trigger('click')
    await monthButton(wrapper, 'Май').trigger('click')

    expect(wrapper.emitted('select')).toEqual([[2027, 4]])
  })

  it('листает год в обе стороны', async () => {
    const wrapper = mountPicker()

    await wrapper.get('[aria-label="Предыдущий год"]').trigger('click')
    expect(wrapper.text()).toContain('2025')

    await wrapper.get('[aria-label="Следующий год"]').trigger('click')
    await wrapper.get('[aria-label="Следующий год"]').trigger('click')
    expect(wrapper.text()).toContain('2027')

    // Ни одного выбора наружу не ушло: год листали, но месяц не выбирали.
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('это диалог: role, aria-modal и ссылка на заголовок', () => {
    const wrapper = mountPicker()
    const dialog = wrapper.get('[role="dialog"]')

    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBe('month-picker-title')
    expect(wrapper.get('#month-picker-title').text()).toBe('Выбор месяца')
  })

  it('подпись месяца для скринридера называет год и состояние', () => {
    const wrapper = mountPicker()

    expect(monthButton(wrapper, 'Октябрь').attributes('aria-label')).toBe(
      'Октябрь 2026, показан в календаре, текущий месяц',
    )
    expect(monthButton(wrapper, 'Март').attributes('aria-label')).toBe('Март 2026')
  })

  it('Escape и «Отмена» закрывают, клик по карточке — нет', async () => {
    const wrapper = mountPicker()

    await wrapper.get('h2').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper
      .findAll('button')
      .find((item) => item.text() === 'Отмена')
      ?.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  it('клик по затемнению закрывает модалку', async () => {
    const wrapper = mountPicker()

    await wrapper.get('[role="dialog"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
