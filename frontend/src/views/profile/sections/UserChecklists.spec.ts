import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { ApiError } from '@/api/errors'
import type { Checklist, ChecklistItem } from '@/types/checklists'
import UserChecklists from '@/views/profile/sections/UserChecklists.vue'

/**
 * Тесты раздела «Чек-листы» (шаблоны).
 *
 * API подменён: проверяем то, что легко сломать незаметно, — что действия
 * уходят на сервер с правильными аргументами и что состояние обновляется
 * **по ответу**, а не догадкой клиента (иначе при отказе интерфейс врал бы).
 */
vi.mock('@/api/checklists', () => ({
  listTemplates: vi.fn(),
  createTemplate: vi.fn(),
  renameChecklist: vi.fn(),
  deleteChecklist: vi.fn(),
  addChecklistItem: vi.fn(),
  updateChecklistItem: vi.fn(),
  deleteChecklistItem: vi.fn(),
}))

import * as api from '@/api/checklists'

const mocked = vi.mocked(api)

function makeItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: 'item-1',
    title: 'Палатка',
    isDone: false,
    doneByUserId: null,
    doneAt: null,
    createdByUserId: 'u-1',
    createdAt: '2026-10-21T08:00:00.000Z',
    ...overrides,
  }
}

function makeChecklist(overrides: Partial<Checklist> = {}): Checklist {
  return {
    id: 'checklist-1',
    scope: 'template',
    title: 'Снаряжение, лето',
    tripId: null,
    ownerUserId: 'u-1',
    items: [makeItem()],
    createdAt: '2026-10-21T08:00:00.000Z',
    updatedAt: '2026-10-21T08:00:00.000Z',
    ...overrides,
  }
}

async function mountSection(checklists: Checklist[] = [makeChecklist()]): Promise<VueWrapper> {
  mocked.listTemplates.mockResolvedValue(checklists)

  const wrapper = mount(UserChecklists)
  await flushPromises()

  return wrapper
}

describe('UserChecklists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.createTemplate.mockResolvedValue(makeChecklist({ id: 'new', title: 'Аптечка' }))
    mocked.renameChecklist.mockResolvedValue(makeChecklist({ title: 'Новое имя' }))
    mocked.deleteChecklist.mockResolvedValue(undefined)
    mocked.addChecklistItem.mockResolvedValue(makeItem({ id: 'item-2', title: 'Газ' }))
    mocked.updateChecklistItem.mockResolvedValue(
      makeItem({ isDone: true, doneByUserId: 'u-1', doneAt: '2026-10-21T09:00:00.000Z' }),
    )
    mocked.deleteChecklistItem.mockResolvedValue(undefined)
  })

  it('показывает шаблоны с пунктами', async () => {
    const wrapper = await mountSection([
      makeChecklist(),
      makeChecklist({ id: 'checklist-2', title: 'Аптечка', items: [] }),
    ])

    const cards = wrapper.findAll('[data-test="checklist-card"]')
    expect(cards).toHaveLength(2)
    expect(cards[0]?.find('[data-test="checklist-title"]').text()).toBe('Снаряжение, лето')
    expect(cards[0]?.text()).toContain('Палатка')
    expect(cards[1]?.find('[data-test="checklist-items-empty"]').exists()).toBe(true)
  })

  it('без шаблонов показывает приглашение завести первый', async () => {
    const wrapper = await mountSection([])

    expect(wrapper.find('[data-test="checklists-empty"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-test="checklist-card"]')).toHaveLength(0)
  })

  it('создаёт шаблон и добавляет его в список', async () => {
    const wrapper = await mountSection([])

    await wrapper.find('[data-test="new-template-title"]').setValue('Аптечка')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocked.createTemplate).toHaveBeenCalledWith('Аптечка')
    expect(wrapper.findAll('[data-test="checklist-card"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="checklist-title"]').text()).toBe('Аптечка')
  })

  it('пустое название не отправляется', async () => {
    const wrapper = await mountSection([])

    expect(
      wrapper.find('[data-test="create-template"]').attributes('disabled'),
    ).toBeDefined()

    await wrapper.find('[data-test="new-template-title"]').setValue('   ')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocked.createTemplate).not.toHaveBeenCalled()
  })

  it('добавляет пункт и очищает поле ввода', async () => {
    const wrapper = await mountSection()

    const input = wrapper.find('[data-test="new-item-input"]')
    await input.setValue('Газ')
    await wrapper.findAll('form')[1]?.trigger('submit')
    await flushPromises()

    expect(mocked.addChecklistItem).toHaveBeenCalledWith('checklist-1', 'Газ')
    expect(wrapper.findAll('[data-test="checklist-item"]')).toHaveLength(2)
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('отметка уходит на сервер и берётся из ответа', async () => {
    const wrapper = await mountSection()

    await wrapper.find('[data-test="item-toggle"]').trigger('change')
    await flushPromises()

    expect(mocked.updateChecklistItem).toHaveBeenCalledWith('item-1', { isDone: true })
    const label = wrapper.find('[data-test="checklist-item"] label')
    expect(label.classes()).toContain('line-through')
  })

  it('убирает пункт из списка', async () => {
    const wrapper = await mountSection()

    await wrapper.find('[data-test="item-delete"]').trigger('click')
    await flushPromises()

    expect(mocked.deleteChecklistItem).toHaveBeenCalledWith('item-1')
    expect(wrapper.findAll('[data-test="checklist-item"]')).toHaveLength(0)
    expect(wrapper.find('[data-test="checklist-items-empty"]').exists()).toBe(true)
  })

  it('удаление шаблона требует подтверждения', async () => {
    const wrapper = await mountSection()

    await wrapper.find('[data-test="checklist-delete"]').trigger('click')
    expect(wrapper.find('[data-test="checklist-delete-confirm"]').exists()).toBe(true)

    // «Нет» возвращает кнопку в прежний вид и ничего не удаляет.
    await wrapper.find('[data-test="checklist-delete-cancel"]').trigger('click')
    expect(mocked.deleteChecklist).not.toHaveBeenCalled()

    await wrapper.find('[data-test="checklist-delete"]').trigger('click')
    await wrapper.find('[data-test="checklist-delete-confirm"]').trigger('click')
    await flushPromises()

    expect(mocked.deleteChecklist).toHaveBeenCalledWith('checklist-1')
    expect(wrapper.findAll('[data-test="checklist-card"]')).toHaveLength(0)
  })

  it('переименование: поле, сохранение и отмена по Escape', async () => {
    const wrapper = await mountSection()

    await wrapper.find('[data-test="checklist-rename"]').trigger('click')
    const input = wrapper.find('[data-test="rename-input"]')
    await input.setValue('Новое имя')

    // Escape выходит из режима правки и ничего не отправляет.
    await input.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[data-test="rename-input"]').exists()).toBe(false)
    expect(mocked.renameChecklist).not.toHaveBeenCalled()

    await wrapper.find('[data-test="checklist-rename"]').trigger('click')
    await wrapper.find('[data-test="rename-input"]').setValue('Новое имя')
    // Форма переименования — вторая на странице (первая создаёт шаблон).
    // Отправляем именно её: jsdom не отправляет форму по клику на кнопку.
    await wrapper.findAll('form')[1]?.trigger('submit')
    await flushPromises()

    expect(mocked.renameChecklist).toHaveBeenCalledWith('checklist-1', 'Новое имя')
    expect(wrapper.find('[data-test="checklist-title"]').text()).toBe('Новое имя')
  })

  it('пустое имя не переименовывает — выходим из режима правки', async () => {
    const wrapper = await mountSection()

    await wrapper.find('[data-test="checklist-rename"]').trigger('click')
    await wrapper.find('[data-test="rename-input"]').setValue('   ')
    await wrapper.findAll('form')[1]?.trigger('submit')
    await flushPromises()

    expect(mocked.renameChecklist).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="checklist-title"]').text()).toBe('Снаряжение, лето')
  })

  it('ошибка сервера показывается словами бэкенда', async () => {
    const wrapper = await mountSection([])
    mocked.createTemplate.mockRejectedValue(new ApiError(400, 'У шаблона должен быть заголовок', null))

    await wrapper.find('[data-test="new-template-title"]').setValue('Аптечка')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-test="checklists-error"]').text()).toContain(
      'У шаблона должен быть заголовок',
    )
  })
})
