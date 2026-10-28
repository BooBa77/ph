import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DateTimePickerModal from '@/components/ui/DateTimePickerModal.vue'

/** Выбор даты и времени: день, часы, минуты и «ОК» вместо клика мимо. */
function mountPicker(props: Record<string, string> = {}) {
  return mount(DateTimePickerModal, { props })
}

describe('DateTimePickerModal', () => {
  it('день, часы и минуты уходят только по «ОК»', async () => {
    const wrapper = mountPicker({ value: '2026-10-05T10:00' })

    // Клик по дню окно не закрывает: время выбирают следом.
    await wrapper.find('[data-test="datetime-day-7"]').trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()

    await wrapper.find('[data-test="datetime-hours"]').setValue('18')
    await wrapper.find('[data-test="datetime-minutes"]').setValue('30')
    await wrapper.find('[data-test="datetime-ok"]').trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual(['2026-10-07T18:30'])
  })

  it('«Очистить» отдаёт пустую строку', async () => {
    const wrapper = mountPicker({ value: '2026-10-05T10:00' })

    await wrapper.find('[data-test="datetime-clear"]').trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual([''])
  })

  it('«Сегодня» переводит на текущий день', async () => {
    const wrapper = mountPicker({ value: '2020-01-01T00:00' })

    await wrapper.find('[data-test="datetime-today"]').trigger('click')
    await wrapper.find('[data-test="datetime-ok"]').trigger('click')

    const now = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    const expected = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate(),
    )}T${pad(now.getHours())}:${pad(now.getMinutes())}`

    expect(wrapper.emitted('select')?.[0]).toEqual([expected])
  })

  it('дни вне окна не нажимаются, а время вне окна не подтверждается', async () => {
    const wrapper = mountPicker({
      value: '2026-10-05T15:00',
      min: '2026-10-05T12:00',
      max: '2026-10-05T18:00',
    })

    // Соседний день за пределами окна — кнопка выключена.
    const disabled = wrapper.find('[data-test="datetime-day-9"]')
    expect(disabled.attributes('disabled')).toBeDefined()

    // Время внутри дня, но до начала окна — «ОК» не срабатывает.
    await wrapper.find('[data-test="datetime-hours"]').setValue('9')

    expect(wrapper.find('[data-test="datetime-range"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="datetime-ok"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-test="datetime-ok"]').trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()

    // Вернули время в окно — можно подтверждать.
    await wrapper.find('[data-test="datetime-hours"]').setValue('14')
    await wrapper.find('[data-test="datetime-ok"]').trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual(['2026-10-05T14:00'])
  })
})
