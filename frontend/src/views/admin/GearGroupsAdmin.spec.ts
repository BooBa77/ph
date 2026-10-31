import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { AdminGearGroup } from '@/types/gear'
import GearGroupsAdmin from '@/views/admin/GearGroupsAdmin.vue'

/**
 * Тесты админки групп снаряжения (31.10.2026).
 *
 * Проверяем то, что видит админ: список полок с архивом и числом вещей,
 * создание и правку, архив и возврат, «Прочее» без кнопки архива (это
 * умолчание — сервер ответил бы 409), ошибки 400/409 **в модалке**.
 * Права (403) и данные — бэкенд, они покрыты e2e; здесь API подменён.
 *
 * Отдельная спека, а не добавка к `GearTypesAdmin.spec.ts`: типы и группы
 * — разные справочники со своими формами, и один файл на оба стал бы
 * свалкой.
 */
const mocks = vi.hoisted(() => ({
  fetchAdminGearGroups: vi.fn(),
  createGearGroup: vi.fn(),
  updateGearGroup: vi.fn(),
  archiveGearGroup: vi.fn(),
}))

vi.mock('@/api/gearGroups', () => ({
  fetchAdminGearGroups: mocks.fetchAdminGearGroups,
  createGearGroup: mocks.createGearGroup,
  updateGearGroup: mocks.updateGearGroup,
  archiveGearGroup: mocks.archiveGearGroup,
}))

function makeGroup(overrides: Partial<AdminGearGroup> = {}): AdminGearGroup {
  return {
    id: 1,
    code: 'roof',
    name: 'Кров',
    sortOrder: 10,
    isActive: true,
    itemsCount: 2,
    ...overrides,
  }
}

const GROUPS: AdminGearGroup[] = [
  makeGroup(),
  makeGroup({
    id: 2,
    code: 'campfire',
    name: 'Костровое',
    sortOrder: 20,
    itemsCount: 3,
  }),
  makeGroup({
    id: 3,
    code: 'other',
    name: 'Прочее',
    sortOrder: 100,
    itemsCount: 0,
  }),
]

async function mounted(groups: AdminGearGroup[] = GROUPS): Promise<VueWrapper> {
  mocks.fetchAdminGearGroups.mockResolvedValue(groups)

  const wrapper = mount(GearGroupsAdmin)
  await flushPromises()

  return wrapper
}

/** Все кнопки строки по её коду в тексте. */
function rowOf(wrapper: VueWrapper, code: string) {
  return wrapper
    .findAll('[data-test="group-row"]')
    .find((row) => row.get('[data-test="group-meta"]').text().startsWith(code))
}

describe('Админка групп снаряжения', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createGearGroup.mockResolvedValue(makeGroup({ id: 9 }))
    mocks.updateGearGroup.mockResolvedValue(makeGroup())
    mocks.archiveGearGroup.mockResolvedValue(undefined)
  })

  // ─────────────────────────── список ───────────────────────────

  it('показывает полки с кодом, порядком и числом вещей', async () => {
    const wrapper = await mounted()

    const rows = wrapper.findAll('[data-test="group-row"]')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.text()).toContain('Кров')
    expect(rows[1]?.text()).toContain('Костровое')
    expect(rows[2]?.text()).toContain('Прочее')
    expect(rows[0]?.get('[data-test="group-meta"]').text()).toContain(
      'roof · порядок 10 · вещей 2',
    )
  })

  it('архивная полка приглушена и помечена', async () => {
    const wrapper = await mounted([
      makeGroup({ isActive: false, name: 'Рыбалка', code: 'fishing' }),
    ])

    expect(wrapper.get('[data-test="group-row"]').classes()).toContain('opacity-60')
    expect(wrapper.get('[data-test="group-archived"]').text()).toBe('в архиве')
    expect(wrapper.find('[data-test="group-restore"]').exists()).toBe(true)
  })

  it('«Прочее» помечено умолчанием и без кнопки архива', async () => {
    const wrapper = await mounted()
    const row = rowOf(wrapper, 'other')

    expect(row?.get('[data-test="group-default"]').text()).toBe('умолчание')
    expect(row?.find('[data-test="group-archive"]').exists()).toBe(false)
  })

  it('пустой справочник объясняет, откуда берутся базовые полки', async () => {
    const wrapper = await mounted([])

    expect(wrapper.get('[data-test="groups-empty"]').text()).toContain('seed:gear-groups')
    expect(wrapper.find('[data-test="groups-list"]').exists()).toBe(false)
  })

  it('ошибку загрузки показывает строкой сверху', async () => {
    mocks.fetchAdminGearGroups.mockRejectedValue(new ApiError(403, 'Раздел только для администратора'))

    const wrapper = mount(GearGroupsAdmin)
    await flushPromises()

    expect(wrapper.get('[data-test="gear-groups-error"]').text()).toBe(
      'Раздел только для администратора',
    )
  })

  // ─────────────────────────── создание ───────────────────────────

  it('создаёт группу и перечитывает список', async () => {
    const wrapper = await mounted()

    await wrapper.get('[data-test="add-group"]').trigger('click')
    await wrapper.get('[data-test="group-form-code"]').setValue('Fishing')
    await wrapper.get('[data-test="group-form-name"]').setValue('Рыбалка')
    await wrapper.get('[data-test="group-form-sort"]').setValue('40')
    await wrapper.get('[data-test="group-form"]').trigger('submit')
    await flushPromises()

    expect(mocks.createGearGroup).toHaveBeenCalledWith({
      code: 'fishing',
      name: 'Рыбалка',
      sortOrder: 40,
    })
    expect(wrapper.find('[data-test="group-form"]').exists()).toBe(false)
    expect(mocks.fetchAdminGearGroups).toHaveBeenCalledTimes(2)
  })

  it('кириллица в коде до сервера не доходит', async () => {
    const wrapper = await mounted()

    await wrapper.get('[data-test="add-group"]').trigger('click')
    await wrapper.get('[data-test="group-form-code"]').setValue('рыбалка')
    await wrapper.get('[data-test="group-form-name"]').setValue('Рыбалка')
    await wrapper.get('[data-test="group-form"]').trigger('submit')
    await flushPromises()

    expect(mocks.createGearGroup).not.toHaveBeenCalled()
    expect(wrapper.get('[data-test="group-form-error"]').text()).toContain('латиница')
  })

  it('пустое название и мусор в порядке не уходят на сервер', async () => {
    const wrapper = await mounted()

    await wrapper.get('[data-test="add-group"]').trigger('click')
    await wrapper.get('[data-test="group-form-code"]').setValue('fishing')
    await wrapper.get('[data-test="group-form"]').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-test="group-form-error"]').text()).toContain('название')

    await wrapper.get('[data-test="group-form-name"]').setValue('Рыбалка')
    await wrapper.get('[data-test="group-form-sort"]').setValue('-5')
    await wrapper.get('[data-test="group-form"]').trigger('submit')
    await flushPromises()

    expect(mocks.createGearGroup).not.toHaveBeenCalled()
    expect(wrapper.get('[data-test="group-form-error"]').text()).toContain('Порядок')
  })

  it('409 «код занят» показывается в модалке, форма не закрывается', async () => {
    mocks.createGearGroup.mockRejectedValue(
      new ApiError(409, 'Группа с кодом «fishing» уже есть — код занимается навсегда'),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="add-group"]').trigger('click')
    await wrapper.get('[data-test="group-form-code"]').setValue('fishing')
    await wrapper.get('[data-test="group-form-name"]').setValue('Рыбалка')
    await wrapper.get('[data-test="group-form"]').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-test="group-form-error"]').text()).toContain('уже есть')
    expect(wrapper.find('[data-test="group-form"]').exists()).toBe(true)
  })

  // ─────────────────────────── правка и архив ───────────────────────────

  it('в правке код только для чтения, меняются имя и порядок', async () => {
    const wrapper = await mounted()

    await rowOf(wrapper, 'roof')?.get('[data-test="group-edit"]').trigger('click')

    expect(
      (wrapper.get('[data-test="group-form-code"]').element as HTMLInputElement).readOnly,
    ).toBe(true)

    await wrapper.get('[data-test="group-form-name"]').setValue('Ночлег')
    await wrapper.get('[data-test="group-form-sort"]').setValue('5')
    await wrapper.get('[data-test="group-form"]').trigger('submit')
    await flushPromises()

    expect(mocks.updateGearGroup).toHaveBeenCalledWith(1, {
      name: 'Ночлег',
      sortOrder: 5,
      isActive: true,
    })
  })

  it('архивирует и возвращает полку', async () => {
    const wrapper = await mounted()

    await rowOf(wrapper, 'campfire')?.get('[data-test="group-archive"]').trigger('click')
    await flushPromises()

    expect(mocks.archiveGearGroup).toHaveBeenCalledWith(2)

    const archived = await mounted([
      makeGroup({ id: 2, code: 'campfire', name: 'Костровое', isActive: false }),
    ])
    await archived.get('[data-test="group-restore"]').trigger('click')
    await flushPromises()

    expect(mocks.updateGearGroup).toHaveBeenCalledWith(2, { isActive: true })
  })

  it('ошибку архива показывает строкой, а не молчанием', async () => {
    mocks.archiveGearGroup.mockRejectedValue(
      new ApiError(409, '«Прочее» — группа по умолчанию: её нельзя убрать в архив'),
    )

    const wrapper = await mounted()

    await rowOf(wrapper, 'campfire')?.get('[data-test="group-archive"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="gear-groups-error"]').text()).toContain('по умолчанию')
  })

  it('Escape закрывает форму', async () => {
    const wrapper = await mounted()

    await wrapper.get('[data-test="add-group"]').trigger('click')
    expect(wrapper.find('[data-test="group-form"]').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(wrapper.find('[data-test="group-form"]').exists()).toBe(false)
  })
})
