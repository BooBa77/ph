import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ChecklistTemplatePicker from '@/components/checklists/ChecklistTemplatePicker.vue'
import type { Checklist, ChecklistItem } from '@/types/checklists'

const mocks = vi.hoisted(() => ({ listTemplates: vi.fn() }))

vi.mock('@/api/checklists', () => ({ listTemplates: mocks.listTemplates }))

function item(
  id: string,
  title: string,
  overrides: Partial<ChecklistItem> = {},
): ChecklistItem {
  return {
    id,
    title,
    isDone: false,
    doneByUserId: null,
    doneAt: null,
    createdByUserId: 'me',
    gear: null,
    createdAt: '2026-11-05T10:00:00.000Z',
    ...overrides,
  }
}

function template(title: string, items: ChecklistItem[]): Checklist {
  return {
    id: `t-${title}`,
    scope: 'template',
    title,
    tripId: null,
    ownerUserId: 'me',
    items,
    createdAt: '2026-11-05T10:00:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
  }
}

const KOSTROVOE = 't-Костровое'

describe('выбор чек-листа из личных чек-листов', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listTemplates.mockResolvedValue([
      template('Костровое', [
        item('111', 'Топор Fixars 1243', {
          gear: {
            id: '9',
            title: 'Топор Fixars 1243',
            typeCode: 'axe',
            typeName: 'Топор',
            weightGrams: 900,
          },
        }),
        item('112', 'спички'),
      ]),
      template('Одежда', [item('113', 'Дождевик')]),
    ])
  })

  function mounted(props: Record<string, unknown> = {}) {
    return mount(ChecklistTemplatePicker, {
      props: { note: 'Проверка подписи', ...props },
    })
  }

  it('по умолчанию чек-листы свёрнуты, пункты не показаны, ничего не выбрано', async () => {
    const wrapper = mounted()
    await flushPromises()

    expect(wrapper.text()).toContain('Костровое')
    expect(wrapper.text()).toContain('Одежда')
    expect(wrapper.text()).toContain('Проверка подписи')
    expect(wrapper.text()).toContain('Пункты берутся из одного чек-листа')

    // Пункты спрятаны до разворота: заказчик просил свёрнутые чек-листы.
    expect(wrapper.find('[data-test="template-item-111"]').exists()).toBe(false)

    const header = wrapper.get(`[data-test="template-choose-${KOSTROVOE}"]`)
      .element as HTMLInputElement
    expect(header.checked).toBe(false)

    expect(wrapper.get('[data-test="template-selected"]').text()).toBe('Выбрано: 0')
    expect(
      (wrapper.get('[data-test="template-apply"]').element as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('чекбокс чек-листа выбирает его целиком — все пункты', async () => {
    const wrapper = mounted()
    await flushPromises()

    await wrapper.get(`[data-test="template-choose-${KOSTROVOE}"]`).setValue(true)

    expect(wrapper.get('[data-test="template-selected"]').text()).toContain('Выбрано: 2')
    expect(wrapper.get('[data-test="template-selected"]').text()).toContain('«Костровое»')

    await wrapper.get('[data-test="template-apply"]').trigger('click')

    expect(wrapper.emitted('apply')?.[0]).toEqual([['111', '112']])
    expect(mocks.listTemplates).toHaveBeenCalledTimes(1)
  })

  it('разворот выбирает чек-лист, а снятый пункт делает выбор частичным', async () => {
    const wrapper = mounted()
    await flushPromises()

    await wrapper.get(`[data-test="template-expand-${KOSTROVOE}"]`).trigger('click')

    // «Выбираешь чек-лист, все позиции в true»: разворот уже выбрал всё.
    expect(wrapper.get('[data-test="template-selected"]').text()).toContain('Выбрано: 2')
    expect(wrapper.text()).toContain('Топор Fixars 1243')
    expect(wrapper.text()).toContain('Топор · 900 г · из снаряжения')
    expect(wrapper.text()).toContain('свободный текст')

    await wrapper.get('[data-test="template-item-112"] input').setValue(false)

    const header = wrapper.get(`[data-test="template-choose-${KOSTROVOE}"]`)
      .element as HTMLInputElement

    expect(header.checked).toBe(false)
    expect(header.indeterminate).toBe(true)
    expect(wrapper.get('[data-test="template-selected"]').text()).toContain('Выбрано: 1')

    await wrapper.get('[data-test="template-apply"]').trigger('click')

    expect(wrapper.emitted('apply')?.[0]).toEqual([['111']])
  })

  it('другой чек-лист заменяет выбор: пункты берутся из одного', async () => {
    const wrapper = mounted()
    await flushPromises()

    await wrapper.get(`[data-test="template-choose-${KOSTROVOE}"]`).setValue(true)
    await wrapper.get('[data-test="template-choose-t-Одежда"]').setValue(true)

    expect(wrapper.get('[data-test="template-selected"]').text()).toContain('Выбрано: 1')
    expect(wrapper.get('[data-test="template-selected"]').text()).toContain('«Одежда»')

    await wrapper.get('[data-test="template-apply"]').trigger('click')

    expect(wrapper.emitted('apply')?.[0]).toEqual([['113']])
  })

  it('снятый чекбокс очищает выбор', async () => {
    const wrapper = mounted()
    await flushPromises()

    await wrapper.get(`[data-test="template-choose-${KOSTROVOE}"]`).setValue(true)
    await wrapper.get(`[data-test="template-choose-${KOSTROVOE}"]`).setValue(false)

    expect(wrapper.get('[data-test="template-selected"]').text()).toBe('Выбрано: 0')
    expect(
      (wrapper.get('[data-test="template-apply"]').element as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('пустой выбор не отправляется, а без подписи объясняет, что выбрать чек-лист', async () => {
    const wrapper = mounted({ note: '' })
    await flushPromises()

    expect(wrapper.text()).toContain('Выберите чек-лист')
    expect(wrapper.emitted('apply')).toBeUndefined()
  })

  it('пустой профиль объясняет, где завести чек-лист', async () => {
    mocks.listTemplates.mockResolvedValue([])

    const wrapper = mounted()
    await flushPromises()

    expect(wrapper.find('[data-test="template-empty"]').text()).toContain('Чек-листы')
  })
})
