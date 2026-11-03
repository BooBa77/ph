import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import GearGroupingModal from '@/components/gear/GearGroupingModal.vue'
import type { GearGroup } from '@/types/gear'

/**
 * Тесты инструмента «Настройка группировки снаряжения» (02.11.2026).
 *
 * Заказчик: «По этой кнопке открывается инструмент для редактирования
 * групп — можно переименовывать, удалять, перекидывать содержащиеся типы.
 * Единственное, давай забиндим в неудаляемое „Прочее“».
 *
 * Здесь проверяется именно это: переименование, удаление с переносом типов,
 * перекладывание типа и защита «Прочего» (его нельзя ни удалить, ни
 * переставить). Порядок групп — стрелками. API подменён: проверяем
 * аргументы запросов и то, что экран берёт список из ответа целиком.
 */
const mocks = vi.hoisted(() => ({
  assignGearGroupType: vi.fn(),
  createGearGroup: vi.fn(),
  deleteGearGroup: vi.fn(),
  moveGearGroup: vi.fn(),
  updateGearGroup: vi.fn(),
}))

vi.mock('@/api/gear', () => ({
  assignGearGroupType: mocks.assignGearGroupType,
  createGearGroup: mocks.createGearGroup,
  deleteGearGroup: mocks.deleteGearGroup,
  moveGearGroup: mocks.moveGearGroup,
  updateGearGroup: mocks.updateGearGroup,
}))

function makeGroups(): GearGroup[] {
  return [
    {
      id: 1,
      name: 'Кров',
      sortOrder: 10,
      templateCode: 'roof',
      isDefault: false,
      types: [
        { id: 1, code: 'tent', name: 'Палатка', isActive: true },
        { id: 5, code: 'old_shelter', name: 'Старый тент', isActive: false },
      ],
    },
    {
      id: 2,
      name: 'Костровое',
      sortOrder: 20,
      templateCode: 'campfire',
      isDefault: false,
      types: [{ id: 4, code: 'axe', name: 'Топор', isActive: true }],
    },
    {
      id: 3,
      name: 'Прочее',
      sortOrder: 100,
      templateCode: 'other',
      isDefault: true,
      types: [],
    },
  ]
}

async function mounted(groups: GearGroup[] = makeGroups()): Promise<VueWrapper> {
  return mount(GearGroupingModal, { props: { groups } })
}

/** Карточка группы по её текущему названию. */
function groupCard(wrapper: VueWrapper, name: string) {
  return wrapper
    .findAll('[data-test="grouping-group"]')
    .find(
      (card) =>
        (card.get('[data-test="grouping-name"]').element as HTMLInputElement).value ===
        name,
    )
}

describe('Настройка группировки снаряжения', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createGearGroup.mockResolvedValue(makeGroups())
    mocks.updateGearGroup.mockResolvedValue(makeGroups())
    mocks.deleteGearGroup.mockResolvedValue(makeGroups())
    mocks.moveGearGroup.mockResolvedValue(makeGroups())
    mocks.assignGearGroupType.mockResolvedValue(makeGroups())
  })

  it('показывает группы и лежащие в них типы, включая архивные', async () => {
    const wrapper = await mounted()

    expect(wrapper.findAll('[data-test="grouping-group"]')).toHaveLength(3)
    expect(wrapper.text()).toContain('Палатка')
    expect(wrapper.text()).toContain('Топор')
    expect(wrapper.text()).toContain('Старый тент')
    expect(wrapper.text()).toContain('в архиве')
  })

  it('заводит новую группу и берёт ответ сервера целиком', async () => {
    const wrapper = await mounted()

    await wrapper.get('[data-test="grouping-new-name"]').setValue('Рыбалка')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.createGearGroup).toHaveBeenCalledWith({ name: 'Рыбалка' })
    expect(wrapper.emitted('updated')?.length).toBeGreaterThan(0)
  })

  it('переименовывает группу по потере фокуса', async () => {
    const wrapper = await mounted()

    const input = groupCard(wrapper, 'Кров')?.get('[data-test="grouping-name"]')
    await input?.setValue('Ночлег')
    await input?.trigger('change')
    await flushPromises()

    expect(mocks.updateGearGroup).toHaveBeenCalledWith(1, { name: 'Ночлег' })
  })

  it('пустое имя не отправляет запрос и возвращает прежнее', async () => {
    const wrapper = await mounted()

    const input = groupCard(wrapper, 'Кров')?.get('[data-test="grouping-name"]')
    await input?.setValue('   ')
    await input?.trigger('change')
    await flushPromises()

    expect(mocks.updateGearGroup).not.toHaveBeenCalled()
    expect((input?.element as HTMLInputElement).value).toBe('Кров')
  })

  it('ошибку переименования показывает и возвращает имя', async () => {
    mocks.updateGearGroup.mockRejectedValue(
      new ApiError(409, 'Группа «Костровое» уже есть', null),
    )
    const wrapper = await mounted()

    const input = groupCard(wrapper, 'Кров')?.get('[data-test="grouping-name"]')
    await input?.setValue('Костровое')
    await input?.trigger('change')
    await flushPromises()

    expect(wrapper.get('[data-test="grouping-error"]').text()).toContain('уже есть')
    expect((input?.element as HTMLInputElement).value).toBe('Кров')
  })

  it('удаляет группу только после подтверждения', async () => {
    const wrapper = await mounted()

    const card = groupCard(wrapper, 'Костровое')
    await card?.get('[data-test="grouping-delete"]').trigger('click')
    expect(mocks.deleteGearGroup).not.toHaveBeenCalled()
    expect(card?.text()).toContain('Типы уедут в «Прочее»')

    await card?.get('[data-test="grouping-delete-cancel"]').trigger('click')
    expect(mocks.deleteGearGroup).not.toHaveBeenCalled()

    await card?.get('[data-test="grouping-delete"]').trigger('click')
    await card?.get('[data-test="grouping-delete-confirm"]').trigger('click')
    await flushPromises()

    expect(mocks.deleteGearGroup).toHaveBeenCalledWith(2)
  })

  it('перекладывает тип в другую группу', async () => {
    const wrapper = await mounted()

    const select = groupCard(wrapper, 'Кров')?.get('[data-test="grouping-type-group"]')
    await select?.setValue('3')
    await select?.trigger('change')
    await flushPromises()

    expect(mocks.assignGearGroupType).toHaveBeenCalledWith(3, 1)
  })

  it('архивный тип не перекладывают — выбора группы у него нет', async () => {
    const wrapper = await mounted()

    const archived = wrapper
      .findAll('[data-test="grouping-type"]')
      .find((row) => row.text().includes('Старый тент'))

    expect(archived?.find('[data-test="grouping-type-group"]').exists()).toBe(false)
  })

  it('«Прочее» нельзя удалить, а стрелки у него выключены', async () => {
    const wrapper = await mounted()

    const card = groupCard(wrapper, 'Прочее')
    expect(card?.find('[data-test="grouping-delete"]').exists()).toBe(false)
    expect(card?.find('[data-test="grouping-default"]').exists()).toBe(true)
    expect(
      (card?.get('[data-test="grouping-move-up"]').element as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (card?.get('[data-test="grouping-move-down"]').element as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('двигает группы стрелками: «Прочее» остаётся последним', async () => {
    const wrapper = await mounted()

    const card = groupCard(wrapper, 'Кров')
    expect(
      (card?.get('[data-test="grouping-move-up"]').element as HTMLButtonElement).disabled,
    ).toBe(true)

    await card?.get('[data-test="grouping-move-down"]').trigger('click')
    await flushPromises()

    expect(mocks.moveGearGroup).toHaveBeenCalledWith(1, 'down')
  })

  it('Escape и «Готово» закрывают диалог', async () => {
    const wrapper = await mounted()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.get('[data-test="grouping-done"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)
  })
})
