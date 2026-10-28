import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ActivityIcon from '@/components/ui/ActivityIcon.vue'

/**
 * Тесты иконки активности.
 *
 * Проверяем то, что ломается незаметно. Иконка — это данные: неверная
 * толщина или потерянная сетка не дают ни ошибки сборки, ни красного теста
 * страницы, просто на экране получается другое. Так уже было с «Кино»,
 * которое съела жадная замена блока (см. `docs/ph/design-icons.md` §6).
 */
describe('ActivityIcon', () => {
  it('берёт сетку рисунка, а не общие 24×24', () => {
    const wrapper = mount(ActivityIcon, { props: { name: 'hike' } })

    // Идущий с рюкзаком нарисован в 400×500 — координаты не пересчитываем.
    expect(wrapper.attributes('viewBox')).toBe('0 0 400 500')
  })

  it('у фигуры своя толщина: корпус толще ног', () => {
    const wrapper = mount(ActivityIcon, { props: { name: 'hike' } })

    // Порядок фигур в данных: нога, нога, рука, [голова], корпус, лямка.
    // Если кто-то «приведёт всё к одной толщине», сравнение упадёт — и это
    // правильно: в рисунке заказчика фигура перестаёт читаться.
    expect(wrapper.findAll('path').map((item) => item.attributes('stroke-width'))).toEqual([
      '45',
      '45',
      '40',
      '62',
      '50',
    ])
  })

  it('голова залита и не обведена', () => {
    const wrapper = mount(ActivityIcon, { props: { name: 'hike' } })
    const head = wrapper.find('circle')

    expect(head.attributes('fill')).toBe('currentColor')
    // Обводка поверх заливки раздула бы голову на полштриха.
    expect(head.attributes('stroke')).toBe('none')
  })

  it('у иконки набора толщина остаётся на уровне <svg>', () => {
    const wrapper = mount(ActivityIcon, { props: { name: 'mountain' } })

    expect(wrapper.attributes('stroke-width')).toBe('2')
    expect(wrapper.find('path').attributes('stroke-width')).toBeUndefined()
  })

  it('неизвестный ключ рисует заглушку в стандартной сетке', () => {
    const wrapper = mount(ActivityIcon, { props: { name: 'нет-такого' } })

    expect(wrapper.attributes('viewBox')).toBe('0 0 24 24')
    expect(wrapper.findAll('path')).toHaveLength(2)
    expect(wrapper.find('circle').exists()).toBe(true)
  })
})
