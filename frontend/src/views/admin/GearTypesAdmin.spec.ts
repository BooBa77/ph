import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { AdminGearType, AdminGearTypeAttribute } from '@/types/gearTypes'
import GearTypesAdmin from '@/views/admin/GearTypesAdmin.vue'

/**
 * Тесты админки справочника типов снаряжения.
 *
 * Проверяем то, что видит админ: список с архивными строками, создание
 * и правку типа, создание и правку характеристики, замещающее значение при
 * включении обязательности, варианты списка (создание вместе
 * с характеристикой, чипы, форма варианта, архив), ошибки 400/409 —
 * **в модалке**. Права (403) и сами данные — бэкенд, они покрыты e2e;
 * здесь API подменён.
 */
vi.mock('@/api/gearTypes', () => ({
  fetchGearTypes: vi.fn(),
  fetchAdminGearTypes: vi.fn(),
  createGearType: vi.fn(),
  updateGearType: vi.fn(),
  archiveGearType: vi.fn(),
  createGearTypeAttribute: vi.fn(),
  updateGearTypeAttribute: vi.fn(),
  archiveGearTypeAttribute: vi.fn(),
  createGearAttributeOption: vi.fn(),
  updateGearAttributeOption: vi.fn(),
  archiveGearAttributeOption: vi.fn(),
}))

import * as api from '@/api/gearTypes'

const mocked = vi.mocked(api)

function makeAttribute(overrides: Partial<AdminGearTypeAttribute> = {}): AdminGearTypeAttribute {
  return {
    id: 1,
    code: 'seats',
    name: 'Вместимость',
    valueKind: 'number',
    unit: 'мест',
    allowCustomValue: false,
    isRequired: true,
    sortOrder: 0,
    isActive: true,
    options: [],
    ...overrides,
  }
}

/** Характеристика-список: «Соединение» с вариантами. */
function makeListAttribute(overrides: Partial<AdminGearTypeAttribute> = {}): AdminGearTypeAttribute {
  return makeAttribute({
    id: 2,
    code: 'connection',
    name: 'Соединение',
    valueKind: 'select',
    unit: null,
    allowCustomValue: false,
    isRequired: false,
    options: [
      { id: 11, code: 'thread', name: 'резьбовой', sortOrder: 10, isActive: true },
      { id: 12, code: 'collet', name: 'цанговый', sortOrder: 20, isActive: false },
    ],
    ...overrides,
  })
}

function makeType(overrides: Partial<AdminGearType> = {}): AdminGearType {
  return {
    id: 1,
    code: 'tent',
    name: 'Палатка',
    sortOrder: 0,
    isActive: true,
    attributes: [makeAttribute()],
    ...overrides,
  }
}

async function mountAdmin(types: AdminGearType[] = [makeType()]): Promise<VueWrapper> {
  mocked.fetchAdminGearTypes.mockResolvedValue(types)

  const wrapper = mount(GearTypesAdmin)
  await flushPromises()

  return wrapper
}

/** Заполнить и отправить форму типа. */
async function submitType(
  wrapper: VueWrapper,
  values: { code?: string; name: string; sort?: string },
): Promise<void> {
  if (values.code !== undefined) {
    await wrapper.find('[data-test="type-form-code"]').setValue(values.code)
  }
  await wrapper.find('[data-test="type-form-name"]').setValue(values.name)
  if (values.sort !== undefined) {
    await wrapper.find('[data-test="type-form-sort"]').setValue(values.sort)
  }
  await wrapper.find('[data-test="type-form"]').trigger('submit')
  await flushPromises()
}

describe('GearTypesAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.createGearType.mockResolvedValue(makeType())
    mocked.updateGearType.mockResolvedValue(makeType())
    mocked.createGearTypeAttribute.mockResolvedValue(makeAttribute())
    mocked.updateGearTypeAttribute.mockResolvedValue(makeAttribute())
    mocked.createGearAttributeOption.mockResolvedValue(makeListAttribute().options[0]!)
    mocked.updateGearAttributeOption.mockResolvedValue(makeListAttribute().options[0]!)
    mocked.archiveGearType.mockResolvedValue(undefined)
    mocked.archiveGearTypeAttribute.mockResolvedValue(undefined)
    mocked.archiveGearAttributeOption.mockResolvedValue(undefined)
  })

  it('показывает типы с характеристиками: активные сверху, архивные приглушённо', async () => {
    const wrapper = await mountAdmin([
      makeType({
        attributes: [
          makeAttribute(),
          makeAttribute({ id: 2, code: 'model', name: 'Модель', valueKind: 'text', unit: null, isRequired: false, isActive: false }),
        ],
      }),
      makeType({ id: 2, code: 'axe', name: 'Топор', isActive: false, attributes: [] }),
    ])

    const rows = wrapper.findAll('[data-test="type-row"]')
    expect(rows).toHaveLength(2)

    // Активный тип: имя, код, счётчики характеристик (одна в архиве).
    expect(rows[0]!.find('[data-test="type-name"]').text()).toBe('Палатка')
    expect(rows[0]!.find('[data-test="type-meta"]').text()).toBe('tent · характеристик: 1 · в архиве: 1')
    expect(rows[0]!.findAll('[data-test="attribute-row"]')).toHaveLength(2)
    expect(rows[0]!.find('[data-test="attribute-meta"]').text()).toBe(
      'seats · Число · мест · обязательная',
    )

    // Архивный тип: помечен и предлагает вернуть, а не архивировать.
    expect(rows[1]!.find('[data-test="type-archived"]').text()).toBe('в архиве')
    expect(rows[1]!.find('[data-test="type-archive"]').exists()).toBe(false)
    expect(rows[1]!.find('[data-test="type-restore"]').exists()).toBe(true)
    expect(rows[1]!.find('[data-test="attributes-empty"]').exists()).toBe(true)
  })

  it('замещающее значение спрашивают только у обязательной характеристики', async () => {
    const wrapper = await mountAdmin()

    expect(wrapper.find('[data-test="attr-form-fill-number"]').exists()).toBe(false)

    await wrapper.find('[data-test="type-add-attribute"]').trigger('click')
    expect(wrapper.find('[data-test="attr-form-fill-number"]').exists()).toBe(false)

    await wrapper.find('[data-test="attr-form-required"]').setValue(true)
    expect(wrapper.find('[data-test="attr-form-fill-number"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="attr-form-fill-hint"]').text()).toContain(
      'В Stage A не применяется',
    )
  })

  it('пустой справочник объясняет, откуда берутся типы', async () => {
    const wrapper = await mountAdmin([])

    expect(wrapper.find('[data-test="types-empty"]').text()).toContain('seed:gear-types')
    expect(wrapper.find('[data-test="types-list"]').exists()).toBe(false)
  })

  it('403 от бэкенда показывается его сообщением', async () => {
    mocked.fetchAdminGearTypes.mockRejectedValue(
      new ApiError(403, 'Раздел только для администратора', null),
    )

    const wrapper = mount(GearTypesAdmin)
    await flushPromises()

    expect(wrapper.find('[data-test="gear-types-error"]').text()).toBe(
      'Раздел только для администратора',
    )
  })

  it('создаёт тип из формы и перезагружает список', async () => {
    const wrapper = await mountAdmin()

    await wrapper.find('[data-test="add-type"]').trigger('click')
    await submitType(wrapper, { code: ' sleeping ', name: ' Спальник ', sort: '20' })

    expect(mocked.createGearType).toHaveBeenCalledWith({
      code: 'sleeping',
      name: 'Спальник',
      sortOrder: 20,
    })
    // Форма закрылась, список перечитан.
    expect(wrapper.find('[data-test="type-form"]').exists()).toBe(false)
    expect(mocked.fetchAdminGearTypes).toHaveBeenCalledTimes(2)
  })

  it('409 «код занят» виден в модалке, форма не закрывается', async () => {
    mocked.createGearType.mockRejectedValue(
      new ApiError(409, 'Тип с кодом «tent» уже есть', null),
    )
    const wrapper = await mountAdmin()

    await wrapper.find('[data-test="add-type"]').trigger('click')
    await submitType(wrapper, { code: 'tent', name: 'Палатка' })

    expect(wrapper.find('[data-test="type-form-error"]').text()).toContain('уже есть')
    expect(wrapper.find('[data-test="type-form"]').exists()).toBe(true)
  })

  it('код не по латинице до сервера не доходит', async () => {
    const wrapper = await mountAdmin()

    await wrapper.find('[data-test="add-type"]').trigger('click')
    await submitType(wrapper, { code: 'Палатка', name: 'Палатка' })

    expect(mocked.createGearType).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="type-form-error"]').text()).toContain('латиница')
  })

  it('пустое название не отправляется', async () => {
    const wrapper = await mountAdmin()

    await wrapper.find('[data-test="add-type"]').trigger('click')
    await submitType(wrapper, { code: 'tent', name: '   ' })

    expect(mocked.createGearType).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="type-form-error"]').text()).toBe('Название не может быть пустым')
  })

  it('в правке типа код только для чтения, а имя и порядок уходят PATCH-ом', async () => {
    const wrapper = await mountAdmin()

    await wrapper.find('[data-test="type-edit"]').trigger('click')

    const code = wrapper.find('[data-test="type-form-code"]')
    expect((code.element as HTMLInputElement).disabled).toBe(true)
    expect((code.element as HTMLInputElement).value).toBe('tent')
    expect(wrapper.find('[data-test="type-form"]').text()).toContain('Код не меняется')

    await wrapper.find('[data-test="type-form-name"]').setValue('Палатка 2')
    await wrapper.find('[data-test="type-form-sort"]').setValue('5')
    await wrapper.find('[data-test="type-form"]').trigger('submit')
    await flushPromises()

    expect(mocked.updateGearType).toHaveBeenCalledWith(1, {
      name: 'Палатка 2',
      sortOrder: 5,
      isActive: true,
    })
  })

  it('архивирует тип из списка и перечитывает справочник', async () => {
    const wrapper = await mountAdmin()

    await wrapper.find('[data-test="type-archive"]').trigger('click')
    await flushPromises()

    expect(mocked.archiveGearType).toHaveBeenCalledWith(1)
    expect(mocked.fetchAdminGearTypes).toHaveBeenCalledTimes(2)
  })

  it('возвращает тип из архива через PATCH isActive', async () => {
    const wrapper = await mountAdmin([makeType({ isActive: false })])

    await wrapper.find('[data-test="type-restore"]').trigger('click')
    await flushPromises()

    expect(mocked.updateGearType).toHaveBeenCalledWith(1, { isActive: true })
  })

  it('после архивации типа кнопка «Вернуть» на месте', async () => {
    const wrapper = await mountAdmin()
    mocked.fetchAdminGearTypes.mockResolvedValue([makeType({ isActive: false })])

    await wrapper.find('[data-test="type-archive"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="type-restore"]').exists()).toBe(true)
  })

  it('создаёт характеристику с видом, единицей и замещающим значением', async () => {
    const wrapper = await mountAdmin()

    await wrapper.find('[data-test="type-add-attribute"]').trigger('click')
    await wrapper.find('[data-test="attr-form-code"]').setValue('volume')
    await wrapper.find('[data-test="attr-form-name"]').setValue('Объём')
    await wrapper.find('[data-test="attr-form-unit"]').setValue('л')
    await wrapper.find('[data-test="attr-form-required"]').setValue(true)
    await wrapper.find('[data-test="attr-form-fill-number"]').setValue('5')
    await wrapper.find('[data-test="attr-form"]').trigger('submit')
    await flushPromises()

    expect(mocked.createGearTypeAttribute).toHaveBeenCalledWith(1, {
      code: 'volume',
      name: 'Объём',
      valueKind: 'number',
      unit: 'л',
      isRequired: true,
      sortOrder: 0,
      fillMissing: 5,
    })
    expect(wrapper.find('[data-test="attr-form"]').exists()).toBe(false)
  })

  it('обязательная характеристика без замещающего значения не уходит на сервер', async () => {
    const wrapper = await mountAdmin()

    await wrapper.find('[data-test="type-add-attribute"]').trigger('click')
    await wrapper.find('[data-test="attr-form-code"]').setValue('volume')
    await wrapper.find('[data-test="attr-form-name"]').setValue('Объём')
    await wrapper.find('[data-test="attr-form-required"]').setValue(true)
    await wrapper.find('[data-test="attr-form"]').trigger('submit')
    await flushPromises()

    expect(mocked.createGearTypeAttribute).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="attr-form-error"]').text()).toContain('замещающее значение')
  })

  it('уже обязательная характеристика не спрашивает замещающее значение', async () => {
    const wrapper = await mountAdmin()

    await wrapper.find('[data-test="attribute-edit"]').trigger('click')

    expect(wrapper.find('[data-test="attr-form-fill-number"]').exists()).toBe(false)
    expect((wrapper.find('[data-test="attr-form-code"]').element as HTMLInputElement).disabled).toBe(
      true,
    )
    expect((wrapper.find('[data-test="attr-form-kind"]').element as HTMLSelectElement).disabled).toBe(
      true,
    )

    await wrapper.find('[data-test="attr-form-name"]').setValue('Вместимость мест')
    await wrapper.find('[data-test="attr-form"]').trigger('submit')
    await flushPromises()

    expect(mocked.updateGearTypeAttribute).toHaveBeenCalledWith(1, 1, {
      name: 'Вместимость мест',
      unit: 'мест',
      isRequired: true,
      sortOrder: 0,
      isActive: true,
    })
  })

  it('включение обязательности при правке требует значение, запятая считается', async () => {
    const wrapper = await mountAdmin([
      makeType({
        attributes: [
          makeAttribute({
            id: 3,
            code: 'length',
            name: 'Длина',
            unit: null,
            isRequired: false,
          }),
        ],
      }),
    ])

    await wrapper.find('[data-test="attribute-edit"]').trigger('click')
    await wrapper.find('[data-test="attr-form-required"]').setValue(true)

    await wrapper.find('[data-test="attr-form"]').trigger('submit')
    await flushPromises()
    expect(mocked.updateGearTypeAttribute).not.toHaveBeenCalled()

    await wrapper.find('[data-test="attr-form-fill-number"]').setValue('2,5')
    await wrapper.find('[data-test="attr-form"]').trigger('submit')
    await flushPromises()

    expect(mocked.updateGearTypeAttribute).toHaveBeenCalledWith(1, 3, {
      name: 'Длина',
      unit: null,
      isRequired: true,
      sortOrder: 0,
      isActive: true,
      fillMissing: 2.5,
    })
  })

  it('409 «вид менять нельзя» показывается в модалке с советом про архив', async () => {
    mocked.updateGearTypeAttribute.mockRejectedValue(
      new ApiError(409, 'Вид характеристики менять нельзя: заведите в архив и новую характеристику с новым кодом', null),
    )
    const wrapper = await mountAdmin()

    await wrapper.find('[data-test="attribute-edit"]').trigger('click')
    await wrapper.find('[data-test="attr-form-name"]').setValue('Вместимость')
    await wrapper.find('[data-test="attr-form"]').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-test="attr-form-error"]').text()).toContain('Вид характеристики менять нельзя')
    expect(wrapper.find('[data-test="attr-form"]').text()).toContain('архив')
  })

  it('архивирует характеристику из списка', async () => {
    const wrapper = await mountAdmin()

    await wrapper.find('[data-test="attribute-archive"]').trigger('click')
    await flushPromises()

    expect(mocked.archiveGearTypeAttribute).toHaveBeenCalledWith(1, 1)
    expect(mocked.fetchAdminGearTypes).toHaveBeenCalledTimes(2)
  })

  it('архивная характеристика помечена и возвращается в работу', async () => {
    const wrapper = await mountAdmin([makeType({ attributes: [makeAttribute({ isActive: false })] })])

    expect(wrapper.find('[data-test="attribute-archived"]').text()).toBe('в архиве')
    expect(wrapper.find('[data-test="attribute-archive"]').exists()).toBe(false)

    await wrapper.find('[data-test="attribute-restore"]').trigger('click')
    await flushPromises()

    expect(mocked.updateGearTypeAttribute).toHaveBeenCalledWith(1, 1, { isActive: true })
  })

  it('Escape закрывает открытую форму', async () => {
    const wrapper = await mountAdmin()

    await wrapper.find('[data-test="add-type"]').trigger('click')
    expect(wrapper.find('[data-test="type-form"]').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(wrapper.find('[data-test="type-form"]').exists()).toBe(false)
  })

  // ───────────────────── варианты списка (select) ─────────────────────

  it('строка списка: варианты чипами, архивный приглушён, «можно своё» в мете', async () => {
    const wrapper = await mountAdmin([
      makeType({ attributes: [makeListAttribute({ allowCustomValue: true })] }),
    ])

    expect(wrapper.find('[data-test="attribute-meta"]').text()).toBe(
      'connection · Список вариантов · 1 вариант · можно своё · необязательная',
    )

    const chips = wrapper.findAll('[data-test="option-chip"]')
    expect(chips).toHaveLength(2)
    expect(chips[0]!.text()).toBe('резьбовой')
    expect(chips[1]!.text()).toContain('цанговый')
    expect(chips[1]!.text()).toContain('в архиве')
    expect(chips[1]!.classes()).toContain('line-through')
  })

  it('вид «Список вариантов» показывает строку вариантов и флаг своего значения', async () => {
    const wrapper = await mountAdmin()

    await wrapper.find('[data-test="type-add-attribute"]').trigger('click')
    expect(wrapper.find('[data-test="option-draft"]').exists()).toBe(false)

    await wrapper.find('[data-test="attr-form-kind"]').setValue('select')

    // Одна пустая строка сразу: пустая форма без вариантов — «мёртвый» список.
    expect(wrapper.findAll('[data-test="option-draft"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="attr-form-allow-custom"]').exists()).toBe(true)
    // Единица у списка не спрашивается.
    expect(wrapper.find('[data-test="attr-form-unit"]').exists()).toBe(false)

    await wrapper.find('[data-test="attr-form-kind"]').setValue('number')
    expect(wrapper.find('[data-test="option-draft"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="attr-form-unit"]').exists()).toBe(true)
  })

  it('список без вариантов и без своего значения на сервер не уходит', async () => {
    const wrapper = await mountAdmin()

    await wrapper.find('[data-test="type-add-attribute"]').trigger('click')
    await wrapper.find('[data-test="attr-form-code"]').setValue('connection')
    await wrapper.find('[data-test="attr-form-name"]').setValue('Соединение')
    await wrapper.find('[data-test="attr-form-kind"]').setValue('select')

    // Строка варианта пустая — это не вариант.
    await wrapper.find('[data-test="attr-form"]').trigger('submit')
    await flushPromises()

    expect(mocked.createGearTypeAttribute).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="attr-form-error"]').text()).toContain('хотя бы один вариант')
  })

  it('варианты уходят вместе с характеристикой: коды, имена, порядок', async () => {
    const wrapper = await mountAdmin()

    await wrapper.find('[data-test="type-add-attribute"]').trigger('click')
    await wrapper.find('[data-test="attr-form-code"]').setValue('connection')
    await wrapper.find('[data-test="attr-form-name"]').setValue('Соединение')
    await wrapper.find('[data-test="attr-form-kind"]').setValue('select')

    const first = wrapper.findAll('[data-test="option-draft"]')[0]!
    await first.find('[data-test="option-draft-code"]').setValue(' thread ')
    await first.find('[data-test="option-draft-name"]').setValue(' резьбовой ')
    await first.find('[data-test="option-draft-sort"]').setValue('10')

    await wrapper.find('[data-test="option-draft-add"]').trigger('click')
    const second = wrapper.findAll('[data-test="option-draft"]')[1]!
    await second.find('[data-test="option-draft-code"]').setValue('collet')
    await second.find('[data-test="option-draft-name"]').setValue('цанговый')

    await wrapper.find('[data-test="attr-form"]').trigger('submit')
    await flushPromises()

    expect(mocked.createGearTypeAttribute).toHaveBeenCalledWith(1, {
      code: 'connection',
      name: 'Соединение',
      valueKind: 'select',
      unit: null,
      isRequired: false,
      sortOrder: 0,
      allowCustomValue: false,
      options: [
        { code: 'thread', name: 'резьбовой', sortOrder: 10 },
        { code: 'collet', name: 'цанговый', sortOrder: 0 },
      ],
    })
    expect(wrapper.find('[data-test="attr-form"]').exists()).toBe(false)
  })

  it('список только со своим значением создаётся без вариантов', async () => {
    const wrapper = await mountAdmin()

    await wrapper.find('[data-test="type-add-attribute"]').trigger('click')
    await wrapper.find('[data-test="attr-form-code"]').setValue('fuel')
    await wrapper.find('[data-test="attr-form-name"]').setValue('Топливо')
    await wrapper.find('[data-test="attr-form-kind"]').setValue('select')
    await wrapper.find('[data-test="attr-form-allow-custom"]').setValue(true)

    await wrapper.find('[data-test="attr-form"]').trigger('submit')
    await flushPromises()

    expect(mocked.createGearTypeAttribute).toHaveBeenCalledWith(1, {
      code: 'fuel',
      name: 'Топливо',
      valueKind: 'select',
      unit: null,
      isRequired: false,
      sortOrder: 0,
      allowCustomValue: true,
      options: [],
    })
  })

  it('повтор кода варианта в форме ловится до запроса', async () => {
    const wrapper = await mountAdmin()

    await wrapper.find('[data-test="type-add-attribute"]').trigger('click')
    await wrapper.find('[data-test="attr-form-code"]').setValue('connection')
    await wrapper.find('[data-test="attr-form-name"]').setValue('Соединение')
    await wrapper.find('[data-test="attr-form-kind"]').setValue('select')

    const first = wrapper.findAll('[data-test="option-draft"]')[0]!
    await first.find('[data-test="option-draft-code"]').setValue('thread')
    await first.find('[data-test="option-draft-name"]').setValue('резьбовой')

    await wrapper.find('[data-test="option-draft-add"]').trigger('click')
    const second = wrapper.findAll('[data-test="option-draft"]')[1]!
    await second.find('[data-test="option-draft-code"]').setValue('thread')
    await second.find('[data-test="option-draft-name"]').setValue('резьбовое')

    await wrapper.find('[data-test="attr-form"]').trigger('submit')
    await flushPromises()

    expect(mocked.createGearTypeAttribute).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="attr-form-error"]').text()).toContain('повторяется')
  })

  it('у списка своё значение требует совпадения с вариантом; своё — пропускает', async () => {
    const wrapper = await mountAdmin()

    const openWithOption = async (codes: string[]) => {
      await wrapper.find('[data-test="type-add-attribute"]').trigger('click')
      await wrapper.find('[data-test="attr-form-code"]').setValue('adapter')
      await wrapper.find('[data-test="attr-form-name"]').setValue('Переходник')
      await wrapper.find('[data-test="attr-form-kind"]').setValue('select')

      const first = wrapper.findAll('[data-test="option-draft"]')[0]!
      await first.find('[data-test="option-draft-code"]').setValue(codes[0])
      await first.find('[data-test="option-draft-name"]').setValue('прямой')
      await wrapper.find('[data-test="attr-form-required"]').setValue(true)
    }

    await openWithOption(['straight'])

    await wrapper.find('[data-test="attr-form-fill-select"]').setValue('угловой')
    await wrapper.find('[data-test="attr-form"]').trigger('submit')
    await flushPromises()

    expect(mocked.createGearTypeAttribute).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="attr-form-error"]').text()).toContain('один из вариантов')

    await wrapper.find('[data-test="attr-form-fill-select"]').setValue('прямой')
    await wrapper.find('[data-test="attr-form"]').trigger('submit')
    await flushPromises()

    expect(mocked.createGearTypeAttribute).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ fillMissing: 'прямой', isRequired: true }),
    )
  })

  it('чип открывает форму варианта: код только для чтения, имя уходит PATCH-ом', async () => {
    const wrapper = await mountAdmin([makeType({ attributes: [makeListAttribute()] })])

    await wrapper.findAll('[data-test="option-chip"]')[0]!.trigger('click')

    const code = wrapper.find('[data-test="option-form-code"]')
    expect((code.element as HTMLInputElement).disabled).toBe(true)
    expect((code.element as HTMLInputElement).value).toBe('thread')

    await wrapper.find('[data-test="option-form-name"]').setValue('резьбовое')
    await wrapper.find('[data-test="option-form"]').trigger('submit')
    await flushPromises()

    expect(mocked.updateGearAttributeOption).toHaveBeenCalledWith(1, 2, 11, {
      name: 'резьбовое',
      sortOrder: 10,
      isActive: true,
    })
    expect(wrapper.find('[data-test="option-form"]').exists()).toBe(false)
    expect(mocked.fetchAdminGearTypes).toHaveBeenCalledTimes(2)
  })

  it('архивный вариант возвращается галочкой «Активен»', async () => {
    const wrapper = await mountAdmin([makeType({ attributes: [makeListAttribute()] })])

    await wrapper.findAll('[data-test="option-chip"]')[1]!.trigger('click')

    const active = wrapper.find('[data-test="option-form-active"]')
    expect((active.element as HTMLInputElement).checked).toBe(false)

    await active.setValue(true)
    await wrapper.find('[data-test="option-form"]').trigger('submit')
    await flushPromises()

    expect(mocked.updateGearAttributeOption).toHaveBeenCalledWith(1, 2, 12, {
      name: 'цанговый',
      sortOrder: 20,
      isActive: true,
    })
  })

  it('«+ вариант» создаёт новый вариант у списка', async () => {
    const wrapper = await mountAdmin([makeType({ attributes: [makeListAttribute()] })])

    await wrapper.find('[data-test="option-add"]').trigger('click')
    await wrapper.find('[data-test="option-form-code"]').setValue(' gravity ')
    await wrapper.find('[data-test="option-form-name"]').setValue(' гравитационный ')
    await wrapper.find('[data-test="option-form-sort"]').setValue('30')
    await wrapper.find('[data-test="option-form"]').trigger('submit')
    await flushPromises()

    expect(mocked.createGearAttributeOption).toHaveBeenCalledWith(1, 2, {
      code: 'gravity',
      name: 'гравитационный',
      sortOrder: 30,
    })
  })

  it('409 «последний вариант» показывается в форме варианта', async () => {
    mocked.updateGearAttributeOption.mockRejectedValue(
      new ApiError(
        409,
        'Нельзя убрать последний вариант: выбирать будет не из чего. Разрешите своё значение или уберите характеристику в архив',
        null,
      ),
    )
    const wrapper = await mountAdmin([makeType({ attributes: [makeListAttribute()] })])

    await wrapper.findAll('[data-test="option-chip"]')[0]!.trigger('click')
    await wrapper.find('[data-test="option-form-active"]').setValue(false)
    await wrapper.find('[data-test="option-form"]').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-test="option-form-error"]').text()).toContain('последний вариант')
    expect(wrapper.find('[data-test="option-form"]').exists()).toBe(true)
  })
})
