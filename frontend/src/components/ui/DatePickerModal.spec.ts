import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import DatePickerModal from '@/components/ui/DatePickerModal.vue'

/**
 * Тесты календаря-модалки.
 *
 * Заказчик забраковал встроенный календарь браузера: он открывался в углу
 * окна, а на странице оставался висеть текст с датой. Поэтому проверяем
 * ровно то, что важно для своей сетки: правильный первый день недели,
 * переход по месяцам, выбор дня и закрытие.
 */
describe('DatePickerModal', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('показывает выбранный месяц и сетку с понедельника', () => {
    const wrapper = mount(DatePickerModal, { props: { value: '2027-05-12' } })

    expect(wrapper.find('[data-test="date-title"]').text()).toBe('Май 2027')

    // Первый день недели — понедельник: в России неделя с него.
    const weekdays = wrapper
      .findAll('span')
      .map((item) => item.text())
      .filter((text) => ['Пн', 'Вс'].includes(text))
    expect(weekdays).toContain('Пн')
    expect(weekdays).toContain('Вс')

    // 1 мая 2027 — суббота: перед ней пять пустых клеток (пн–пт).
    const grid = wrapper.findAll('[data-test^="date-day-"]')
    expect(grid[0]?.text()).toBe('1')
    expect(grid[grid.length - 1]?.text()).toBe('31')
  })

  it('отдаёт выбранный день строкой без часового пояса', async () => {
    const wrapper = mount(DatePickerModal, { props: { value: '2027-05-12' } })

    await wrapper.find('[data-test="date-day-3"]').trigger('click')

    // Именно строка: если собирать дату через `toISOString`, восточные
    // часовые пояса сдвинули бы её на день назад.
    expect(wrapper.emitted('select')?.[0]).toEqual(['2027-05-03'])
  })

  it('листает месяцы вперёд и назад через границу года', async () => {
    const wrapper = mount(DatePickerModal, { props: { value: '2027-01-15' } })

    await wrapper.find('[data-test="date-prev"]').trigger('click')
    expect(wrapper.find('[data-test="date-title"]').text()).toBe('Декабрь 2026')

    await wrapper.find('[data-test="date-next"]').trigger('click')
    await wrapper.find('[data-test="date-next"]').trigger('click')
    expect(wrapper.find('[data-test="date-title"]').text()).toBe('Февраль 2027')
  })

  it('в коротком месяце нет лишних дней', () => {
    const wrapper = mount(DatePickerModal, { props: { value: '2027-02-10' } })

    // В феврале 2027 двадцать восемь дней, и тридцать первого быть не должно.
    expect(wrapper.find('[data-test="date-day-28"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="date-day-29"]').exists()).toBe(false)
  })

  it('закрывается крестиком, «Отменой» и Escape', async () => {
    const cross = mount(DatePickerModal, { props: { value: '2027-05-12' } })
    await cross.find('[data-test="date-close"]').trigger('click')
    expect(cross.emitted('close')).toHaveLength(1)

    const cancel = mount(DatePickerModal, { props: { value: '2027-05-12' } })
    await cancel.find('[data-test="date-cancel"]').trigger('click')
    expect(cancel.emitted('close')).toHaveLength(1)

    const escape = mount(DatePickerModal, { props: { value: '2027-05-12' } })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(escape.emitted('close')).toHaveLength(1)
  })

  it('без даты открывается на сегодняшнем месяце', () => {
    const wrapper = mount(DatePickerModal)

    const now = new Date()
    const months = [
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
    ]

    expect(wrapper.find('[data-test="date-title"]').text()).toBe(
      `${months[now.getMonth()]} ${now.getFullYear()}`,
    )
  })
})
