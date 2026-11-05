import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TripGearChecklist from '@/components/gear/TripGearChecklist.vue'
import type { Checklist, ChecklistItem } from '@/types/checklists'

const mocks = vi.hoisted(() => ({
  listTemplates: vi.fn(),
  addChecklistItem: vi.fn(),
  updateChecklistItem: vi.fn(),
  deleteChecklistItem: vi.fn(),
  createTripChecklist: vi.fn(),
  importChecklistItems: vi.fn(),
  setRecommendationMark: vi.fn(),
}))

vi.mock('@/api/checklists', () => ({
  listTemplates: mocks.listTemplates,
  addChecklistItem: mocks.addChecklistItem,
  updateChecklistItem: mocks.updateChecklistItem,
  deleteChecklistItem: mocks.deleteChecklistItem,
}))

vi.mock('@/api/tripChecklists', () => ({
  createTripChecklist: mocks.createTripChecklist,
  importChecklistItems: mocks.importChecklistItems,
  setRecommendationMark: mocks.setRecommendationMark,
}))

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

function checklist(
  items: ChecklistItem[],
  overrides: Partial<Checklist> = {},
): Checklist {
  return {
    id: 'c1',
    scope: 'trip',
    title: '',
    tripId: '1',
    ownerUserId: null,
    items,
    createdAt: '2026-11-05T10:00:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
    ...overrides,
  }
}

function mounted(props: Record<string, unknown>) {
  return mount(TripGearChecklist, {
    props: {
      tripId: '1',
      scope: 'trip',
      checklist: checklist([]),
      canManage: true,
      canMark: true,
      canImport: true,
      ...props,
    },
  })
}

describe('чек-лист вкладки «Снаряжение» похода', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listTemplates.mockResolvedValue([])
  })

  it('пустой список не рисует пустых галочек', async () => {
    const wrapper = mounted({})
    await flushPromises()

    expect(wrapper.find('[data-test="checklist-empty"]').text()).toContain('Пунктов пока нет')
    expect(wrapper.find('[data-test="checklist-new-item"]').exists()).toBe(true)
  })

  it('без прав список только читается: ни галочек, ни кнопок', async () => {
    const wrapper = mounted({
      checklist: checklist([item('i1', 'Котёл')]),
      canManage: false,
      canMark: false,
      canImport: false,
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Котёл')
    expect(wrapper.find('[data-test="checklist-item-check-i1"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="checklist-new-item"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="checklist-item-remove"]').exists()).toBe(false)
  })

  it('заводит список, если его ещё нет', async () => {
    mocks.createTripChecklist.mockResolvedValue(checklist([]))

    const wrapper = mounted({ checklist: null })
    await flushPromises()

    await wrapper.get('[data-test="checklist-create"]').trigger('click')
    await flushPromises()

    expect(mocks.createTripChecklist).toHaveBeenCalledWith('1', 'trip')
    expect(wrapper.emitted('updated')?.[0]?.[0]).toMatchObject({ id: 'c1' })
  })

  it('добавляет пункт текстом и отдаёт обновлённый список', async () => {
    mocks.addChecklistItem.mockResolvedValue(item('i1', 'Котёл'))

    const wrapper = mounted({})
    await flushPromises()

    await wrapper.get('[data-test="checklist-new-item"]').setValue('Котёл')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.addChecklistItem).toHaveBeenCalledWith('c1', { title: 'Котёл' })
    expect(wrapper.text()).toContain('Котёл')
    expect(wrapper.emitted('updated')?.[0]?.[0]).toMatchObject({
      items: [{ title: 'Котёл' }],
    })
  })

  it('импортирует выбранные пункты шаблонов через сервер', async () => {
    mocks.listTemplates.mockResolvedValue([
      {
        ...checklist([item('111', 'Топор'), item('112', 'спички')], {
          id: 't1',
          scope: 'template',
          ownerUserId: 'me',
        }),
      },
    ])
    mocks.importChecklistItems.mockResolvedValue(
      checklist([item('i1', 'Топор'), item('i2', 'спички')]),
    )

    const wrapper = mounted({})
    await flushPromises()

    await wrapper.get('[data-test="checklist-import"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="template-picker"]').exists()).toBe(true)

    await wrapper.get('[data-test="template-item-111"] input').setValue(true)
    await wrapper.get('[data-test="template-apply"]').trigger('click')
    await flushPromises()

    expect(mocks.importChecklistItems).toHaveBeenCalledWith('1', {
      scope: 'trip',
      itemIds: [111],
    })
    expect(wrapper.find('[data-test="template-picker"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Топор')
  })

  it('отметка рекомендации идёт своей ручкой, а не общим PATCH', async () => {
    mocks.setRecommendationMark.mockResolvedValue({
      itemId: 'ri1',
      isDone: true,
      doneAt: '2026-11-05T12:00:00.000Z',
    })

    const wrapper = mounted({
      scope: 'recommendation',
      checklist: checklist([item('ri1', 'Рюкзак')], {
        scope: 'recommendation',
      }),
      canManage: false,
      canImport: false,
      canMark: true,
      variant: 'recommended',
    })
    await flushPromises()

    await wrapper.get('[data-test="checklist-item-check-ri1"]').setValue(true)
    await flushPromises()

    expect(mocks.setRecommendationMark).toHaveBeenCalledWith('1', 'ri1', true)
    expect(mocks.updateChecklistItem).not.toHaveBeenCalled()
  })

  it('ошибку сервера показывает словами и возвращает галочку', async () => {
    mocks.setRecommendationMark.mockRejectedValue(new Error('нет связи'))

    const wrapper = mounted({
      scope: 'recommendation',
      checklist: checklist([item('ri1', 'Рюкзак')], {
        scope: 'recommendation',
      }),
      canManage: false,
      canMark: true,
    })
    await flushPromises()

    await wrapper.get('[data-test="checklist-item-check-ri1"]').setValue(true)
    await flushPromises()

    expect(wrapper.find('[data-test="checklist-error"]').text()).toContain(
      'Не удалось сохранить отметку',
    )
  })
})
