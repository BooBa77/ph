import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/api/types'
import type { GearType, GearTypeAttribute } from '@/types/gearTypes'
import type { TripGearItem } from '@/types/gear'
import TripGearManualModal from '@/components/gear/TripGearManualModal.vue'

/**
 * «Указать вручную» — вещь, которой нет в каталоге (31.10.2026).
 *
 * Проверяется то, что заказчик продиктовал словами и что нельзя увидеть
 * на пустом экране: тип берётся из справочника и задаёт набор характеристик,
 * обязательные не отправляются пустыми, а хозяин и флаг «в каталог» ведут
 * себя по правилам бэкенда — виртуальному каталога не заводят, чужому
 * настоящему участнику вещь не добавляют.
 *
 * Модалка одна на «Палатки», «Тент» и «Костровое», поэтому и проверяется
 * отдельно от них: секции отличаются только списком допустимых типов.
 */
const mocks = vi.hoisted(() => ({
  addManualTripGear: vi.fn(),
  fetchGearTypes: vi.fn(),
}))

vi.mock('@/api/gear', () => ({ addManualTripGear: mocks.addManualTripGear }))
vi.mock('@/api/gearTypes', () => ({ fetchGearTypes: mocks.fetchGearTypes }))

const ME = 'demo-me'
const VIRTUAL = 'demo-virtual'

function makeUser(): User {
  return {
    id: ME,
    displayName: 'Олег',
    location: null,
    avatarUrl: null,
    gender: 'm',
    isVegetarian: false,
    allergies: null,
    sportExperience: null,
    isAdmin: false,
  }
}

function attribute(
  overrides: Partial<GearTypeAttribute> & Pick<GearTypeAttribute, 'code' | 'name' | 'valueKind'>,
): GearTypeAttribute {
  return {
    id: 1,
    unit: null,
    allowCustomValue: false,
    isRequired: false,
    sortOrder: 0,
    options: [],
    ...overrides,
  }
}

/** Типы, как их отдаёт `GET /api/gear-types`: палатка, тент и топор. */
function gearTypes(): GearType[] {
  return [
    {
      id: 1,
      code: 'tent',
      name: 'Палатка',
      sortOrder: 1,
      attributes: [
        attribute({
          id: 11,
          code: 'seats',
          name: 'Вместимость',
          valueKind: 'number',
          unit: 'мест',
          isRequired: true,
        }),
      ],
    },
    {
      id: 2,
      code: 'shelter',
      name: 'Тент',
      sortOrder: 2,
      attributes: [attribute({ id: 21, code: 'size', name: 'Размер', valueKind: 'text' })],
    },
    {
      id: 3,
      code: 'axe',
      name: 'Топор',
      sortOrder: 3,
      attributes: [],
    },
  ]
}

/** Строка снаряжения похода, как её отдаёт `POST .../gear/manual`. */
function manualItem(overrides: Partial<TripGearItem> = {}): TripGearItem {
  return {
    id: 'tg-1',
    gearItemId: 'gi-1',
    typeId: 1,
    typeCode: 'tent',
    typeName: 'Палатка',
    title: 'Палатка',
    attributes: [],
    weightGrams: null,
    note: null,
    isTripOnly: true,
    status: 'proposed',
    ownerUserId: ME,
    assignedUserId: null,
    createdAt: '2026-10-31T10:00:00.000Z',
    ...overrides,
  }
}

interface Props {
  tripId: string
  typeCodes: readonly string[]
  defaultTypeCode: string
  ownerOptions: readonly { userId: string; displayName: string }[]
}

async function open(overrides: Partial<Props> = {}): Promise<VueWrapper> {
  const props: Props = {
    tripId: '7',
    typeCodes: ['tent', 'shelter'],
    defaultTypeCode: 'tent',
    ownerOptions: [],
    ...overrides,
  }

  const wrapper = mount(TripGearManualModal, { props })
  await flushPromises()

  return wrapper
}

describe('TripGearManualModal («указать вручную»)', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    useAuthStore().setAuth(makeUser(), 'token')

    mocks.fetchGearTypes.mockResolvedValue(gearTypes())
    mocks.addManualTripGear.mockResolvedValue(manualItem())
  })

  it('показывает только типы контекста и выбирает тип по умолчанию', async () => {
    const wrapper = await open()

    const options = wrapper.findAll('[data-test="manual-type"] option')

    expect(options.map((option) => option.text())).toEqual(['Палатка', 'Тент'])
    expect(
      (wrapper.find('[data-test="manual-type"]').element as HTMLSelectElement).value,
    ).toBe('1')
    // Обязательная характеристика типа «Палатка» — сразу на экране.
    expect(wrapper.find('[data-test="manual-seats"]').exists()).toBe(true)
  })

  it('не отправляет вещь без обязательной характеристики', async () => {
    const wrapper = await open()

    await wrapper.find('[data-test="manual-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="manual-error"]').text()).toContain(
      'Заполните обязательные характеристики: «Вместимость»',
    )
    expect(mocks.addManualTripGear).not.toHaveBeenCalled()
  })

  it('отправляет тип, значения, вес и пустое название как null', async () => {
    const wrapper = await open()

    await wrapper.find('[data-test="manual-seats"]').setValue('3')
    await wrapper.find('[data-test="manual-weight"]').setValue('2400')
    await wrapper.find('[data-test="manual-save"]').trigger('click')
    await flushPromises()

    expect(mocks.addManualTripGear).toHaveBeenCalledWith('7', {
      typeId: 1,
      attributes: { seats: 3 },
      title: null,
      weightGrams: 2400,
      ownerUserId: null,
      addToCatalog: false,
    })
    expect(wrapper.emitted('created')?.[0]?.[0]).toMatchObject({ id: 'tg-1' })
  })

  it('флаг «в каталог» уходит только по галочке', async () => {
    const wrapper = await open()

    await wrapper.find('[data-test="manual-seats"]').setValue('2')
    await wrapper.find('[data-test="manual-catalog"]').setValue(true)
    await wrapper.find('[data-test="manual-save"]').trigger('click')
    await flushPromises()

    expect(mocks.addManualTripGear).toHaveBeenCalledWith(
      '7',
      expect.objectContaining({ addToCatalog: true, ownerUserId: null }),
    )
  })

  it('смена типа стирает значения прежнего типа', async () => {
    const wrapper = await open()

    await wrapper.find('[data-test="manual-seats"]').setValue('3')
    await wrapper.find('[data-test="manual-type"]').setValue('2')
    await flushPromises()

    expect(wrapper.find('[data-test="manual-seats"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="manual-size"]').exists()).toBe(true)
  })

  it('мусор в весе не отправляется', async () => {
    const wrapper = await open()

    await wrapper.find('[data-test="manual-seats"]').setValue('2')
    await wrapper.find('[data-test="manual-weight"]').setValue('0')
    await wrapper.find('[data-test="manual-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="manual-error"]').text()).toContain('целое число')
    expect(mocks.addManualTripGear).not.toHaveBeenCalled()
  })

  it('выбора хозяина нет, если в походе нет людей без аккаунта', async () => {
    const wrapper = await open()

    expect(wrapper.find('[data-test="manual-owner-field"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="manual-catalog-field"]').exists()).toBe(true)
  })

  it('организатор отдаёт вещь человеку без аккаунта — без флага каталога', async () => {
    const wrapper = await open({
      ownerOptions: [
        { userId: ME, displayName: 'Олег (я)' },
        { userId: VIRTUAL, displayName: 'Дядя Витя (без аккаунта)' },
      ],
    })

    await wrapper.find('[data-test="manual-owner"]').setValue(VIRTUAL)
    await flushPromises()

    expect(wrapper.find('[data-test="manual-catalog-field"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="manual-virtual-hint"]').exists()).toBe(true)

    await wrapper.find('[data-test="manual-seats"]').setValue('2')
    await wrapper.find('[data-test="manual-save"]').trigger('click')
    await flushPromises()

    expect(mocks.addManualTripGear).toHaveBeenCalledWith(
      '7',
      expect.objectContaining({ ownerUserId: VIRTUAL, addToCatalog: false }),
    )
  })

  it('хозяин по умолчанию — сам смотрящий', async () => {
    const wrapper = await open({
      ownerOptions: [{ userId: ME, displayName: 'Олег (я)' }],
    })

    expect(
      (wrapper.find('[data-test="manual-owner"]').element as HTMLSelectElement).value,
    ).toBe(ME)
  })

  it('ошибку сервера показывает в модалке, а не под затемнением', async () => {
    mocks.addManualTripGear.mockRejectedValue(
      new ApiError(403, 'Добавлять вещи другим участникам может только организатор'),
    )

    const wrapper = await open()

    await wrapper.find('[data-test="manual-seats"]').setValue('3')
    await wrapper.find('[data-test="manual-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="manual-error"]').text()).toContain(
      'Добавлять вещи другим участникам может только организатор',
    )
    expect(wrapper.emitted('created')).toBeUndefined()
  })
})
