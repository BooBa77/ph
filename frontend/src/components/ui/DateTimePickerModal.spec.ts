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

  it('вне дат похода «ОК» не срабатывает, а причина видна', async () => {
    const wrapper = mountPicker({
      value: '2026-10-05T10:00',
      min: '2026-10-04T00:00',
      max: '2026-10-06T23:59',
    })

    await wrapper.find('[data-test="datetime-day-9"]').trigger('click')

    expect(wrapper.find('[data-test="datetime-range"]').exists()).toBe(true)

    const ok = wrapper.find('[data-test="datetime-ok"]')
    expect(ok.attributes('disabled')).toBeDefined()

    await ok.trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
  })
})
