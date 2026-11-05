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

describe('выбор пунктов из личных чек-листов', () => {
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

  function mounted() {
    return mount(ChecklistTemplatePicker, {
      props: { note: 'Проверка подписи' },
    })
  }

  it('показывает шаблоны, пункты и чем станет вещь', async () => {
    const wrapper = mounted()
    await flushPromises()

    expect(wrapper.text()).toContain('Костровое')
    expect(wrapper.text()).toContain('Топор Fixars 1243')
    expect(wrapper.text()).toContain('Топор · 900 г · из снаряжения')
    expect(wrapper.text()).toContain('спички')
    expect(wrapper.text()).toContain('свободный текст')
    expect(wrapper.text()).toContain('Проверка подписи')
  })

  it('выбранные пункты уходят событием, а не пишутся сразу', async () => {
    const wrapper = mounted()
    await flushPromises()

    await wrapper.get('[data-test="template-item-111"] input').setValue(true)
    await wrapper.get('[data-test="template-item-113"] input').setValue(true)

    expect(wrapper.get('[data-test="template-selected"]').text()).toContain('2')

    await wrapper.get('[data-test="template-apply"]').trigger('click')

    expect(wrapper.emitted('apply')?.[0]).toEqual([['111', '113']])
    expect(mocks.listTemplates).toHaveBeenCalledTimes(1)
  })

  it('«Выбрать все» берёт весь шаблон, «Снять все» — очищает', async () => {
    const wrapper = mounted()
    await flushPromises()

    await wrapper.get('[data-test="template-all-t-Костровое"]').trigger('click')
    expect(wrapper.get('[data-test="template-selected"]').text()).toContain('2')

    await wrapper.get('[data-test="template-all-t-Костровое"]').trigger('click')
    expect(wrapper.get('[data-test="template-selected"]').text()).toContain('0')
  })

  it('пустой выбор не отправляется', async () => {
    const wrapper = mounted()
    await flushPromises()

    expect(
      (wrapper.get('[data-test="template-apply"]').element as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('пустой профиль объясняет, где завести чек-лист', async () => {
    mocks.listTemplates.mockResolvedValue([])

    const wrapper = mounted()
    await flushPromises()

    expect(wrapper.find('[data-test="template-empty"]').text()).toContain('Чек-листы')
  })
})
