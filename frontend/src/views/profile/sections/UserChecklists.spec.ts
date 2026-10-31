import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { ApiError } from '@/api/errors'
import type { Checklist, ChecklistItem, ChecklistItemGear } from '@/types/checklists'
import type { GearItem } from '@/types/gear'
import UserChecklists from '@/views/profile/sections/UserChecklists.vue'

/**
 * Тесты раздела «Чек-листы» (личные списки-шаблоны).
 *
 * API подменён: проверяем то, что легко сломать незаметно, — что действия
 * уходят на сервер с правильными аргументами, что состояние обновляется
 * **по ответу**, а не догадкой клиента, и что у шаблона нет отметок
 * «взял»: они появляются только в походе (решение заказчика 31.10.2026).
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

vi.mock('@/api/gear', () => ({
  listGear: vi.fn(),
}))

import * as api from '@/api/checklists'
import * as gearApi from '@/api/gear'

const mocked = vi.mocked(api)

function makeGearItem(overrides: Partial<GearItem> = {}): GearItem {
  return {
    id: '5',
    typeId: 1,
    typeCode: 'tent',
    typeName: 'Палатка',
    groupId: 1,
    groupCode: 'roof',
    groupName: 'Кров',
    sortOrder: 10,
    title: 'Палатка Анны',
    weightGrams: 2400,
    note: null,
    attributes: [],
    createdAt: '2026-10-31T08:00:00.000Z',
    ...overrides,
  }
}

function makeItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: 'item-1',
    title: 'Палатка',
    isDone: false,
    doneByUserId: null,
    doneAt: null,
    createdByUserId: 'u-1',
    gear: null,
    createdAt: '2026-10-21T08:00:00.000Z',
    ...overrides,
  }
}

function makeGearRef(overrides: Partial<ChecklistItemGear> = {}): ChecklistItemGear {
  return {
    id: '5',
    title: 'Палатка Анны',
    typeCode: 'tent',
    typeName: 'Палатка',
    weightGrams: 2400,
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

  const wrapper = mount(UserChecklists, {
    // Пикер в пустом каталоге показывает ссылку в «Снаряжение».
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
  await flushPromises()

  return wrapper
}

describe('UserChecklists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(gearApi.listGear).mockResolvedValue({
      items: [makeGearItem()],
      totalWeightGrams: 2400,
      itemsWithoutWeight: 0,
    })

    mocked.createTemplate.mockResolvedValue(makeChecklist({ id: 'new', title: 'Аптечка' }))
    mocked.renameChecklist.mockResolvedValue(makeChecklist({ title: 'Новое имя' }))
    mocked.deleteChecklist.mockResolvedValue(undefined)
    mocked.addChecklistItem.mockResolvedValue(makeItem({ id: 'item-2', title: 'Газ' }))
    mocked.updateChecklistItem.mockResolvedValue(makeItem({ title: 'Новый текст' }))
    mocked.deleteChecklistItem.mockResolvedValue(undefined)
  })

  it('показывает шаблоны с пунктами и без отметок', async () => {
    const wrapper = await mountSection([
      makeChecklist(),
      makeChecklist({ id: 'checklist-2', title: 'Аптечка', items: [] }),
    ])

    const cards = wrapper.findAll('[data-test="checklist-card"]')
    expect(cards).toHaveLength(2)
    expect(cards[0]?.find('[data-test="checklist-title"]').text()).toBe('Снаряжение, лето')
    expect(cards[0]?.text()).toContain('Палатка')
    expect(cards[1]?.find('[data-test="checklist-items-empty"]').exists()).toBe(true)

    // Отметок «взял» в шаблоне нет: это состояние похода, а не заготовки.
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
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

  it('добавляет текстовый пункт и очищает поле ввода', async () => {
    const wrapper = await mountSection()

    const input = wrapper.find('[data-test="new-item-input"]')
    await input.setValue('Газ')
    // Формы: 0 — создание шаблона, 1 — добавление пункта.
    await wrapper.findAll('form')[1]?.trigger('submit')
    await flushPromises()

    expect(mocked.addChecklistItem).toHaveBeenCalledWith('checklist-1', { title: 'Газ' })
    expect(wrapper.findAll('[data-test="checklist-item"]')).toHaveLength(2)
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('правит текст пункта', async () => {
    const wrapper = await mountSection()

    await wrapper.find('[data-test="item-edit"]').trigger('click')
    await wrapper.find('[data-test="item-title-input"]').setValue('Новый текст')
    // Формы: 0 — создание шаблона, 1 — правка пункта, 2 — добавление пункта.
    await wrapper.findAll('form')[1]?.trigger('submit')
    await flushPromises()

    expect(mocked.updateChecklistItem).toHaveBeenCalledWith('item-1', {
      title: 'Новый текст',
    })
    expect(wrapper.find('[data-test="item-title"]').text()).toBe('Новый текст')
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

  it('добавляет пункт-ссылку на вещь через выбор из снаряжения', async () => {
    const wrapper = await mountSection()

    mocked.addChecklistItem.mockResolvedValue(
      makeItem({ id: 'item-gear', title: 'Палатка Анны', gear: makeGearRef() }),
    )

    await wrapper.find('[data-test="add-from-gear"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="gear-picker"]').exists()).toBe(true)

    await wrapper.find('[data-test="gear-option"]').trigger('click')
    await flushPromises()

    expect(mocked.addChecklistItem).toHaveBeenCalledWith('checklist-1', { gearItemId: 5 })
    expect(wrapper.find('[data-test="gear-picker"]').exists()).toBe(false)

    const gearLine = wrapper.find('[data-test="item-gear"]')
    expect(gearLine.exists()).toBe(true)
    expect(gearLine.text()).toContain('Палатка · 2,4 кг')
    expect(gearLine.text()).toContain('из снаряжения')
  })

  it('ошибка привязки видна в модалке и не закрывает выбор', async () => {
    const wrapper = await mountSection()
    mocked.addChecklistItem.mockRejectedValue(new ApiError(404, 'Вещь не найдена', null))

    await wrapper.find('[data-test="add-from-gear"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-test="gear-option"]').trigger('click')
    await flushPromises()

    // Модалка осталась: закрыть её значило бы потерять выбор из-за отказа.
    expect(wrapper.find('[data-test="gear-picker"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-attach-error"]').text()).toContain(
      'Вещь не найдена',
    )
  })

  it('пункт-ссылка показывает название вещи, а править можно только текст', async () => {
    const wrapper = await mountSection([
      makeChecklist({
        items: [makeItem({ title: 'Палатка Анны', gear: makeGearRef() })],
      }),
    ])

    expect(wrapper.find('[data-test="item-title"]').text()).toBe('Палатка Анны')
    expect(wrapper.find('[data-test="item-edit"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="item-replace"]').exists()).toBe(true)
  })

  it('заменяет вещь у существующего пункта', async () => {
    const wrapper = await mountSection([
      makeChecklist({
        items: [makeItem({ title: 'Палатка Анны', gear: makeGearRef() })],
      }),
    ])

    vi.mocked(gearApi.listGear).mockResolvedValue({
      items: [makeGearItem({ id: '7', title: 'Палатка Петра', weightGrams: 3100 })],
      totalWeightGrams: 3100,
      itemsWithoutWeight: 0,
    })

    mocked.updateChecklistItem.mockResolvedValue(
      makeItem({
        title: 'Палатка Петра',
        gear: makeGearRef({ id: '7', title: 'Палатка Петра', weightGrams: 3100 }),
      }),
    )

    await wrapper.find('[data-test="item-replace"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-test="gear-option"]').trigger('click')
    await flushPromises()

    expect(mocked.updateChecklistItem).toHaveBeenCalledWith('item-1', { gearItemId: 7 })
    expect(wrapper.find('[data-test="item-title"]').text()).toBe('Палатка Петра')
  })

  it('после удаления вещи пункт остаётся текстом типа', async () => {
    // Сервер уже превратил ссылку в текст: `gear` null, `title` — тип.
    const wrapper = await mountSection([
      makeChecklist({ items: [makeItem({ title: 'Палатка', gear: null })] }),
    ])

    expect(wrapper.find('[data-test="item-title"]').text()).toBe('Палатка')
    expect(wrapper.find('[data-test="item-gear"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="item-edit"]').exists()).toBe(true)
  })
})
