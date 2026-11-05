import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import TripGear from '@/views/trips/TripGear.vue'
import type { Checklist, ChecklistItem, TripChecklists } from '@/types/checklists'
import type { GearItem, TripGearItem } from '@/types/gear'
import type { Trip, TripParticipant } from '@/types/trips'
import type { User } from '@/api/types'

/**
 * Вкладка «Снаряжение» похода — первый проход по фронту (05.11.2026).
 *
 * Проверяем то, что заказчик увидит первым: две большие секции, «Берём»
 * с решением «берём / не берём», «Распределение» по «иду» и личные
 * «Взял» / «Мой рюкзак». Права на статус — из пропа `canEdit`, как и на
 * остальных вкладках: их считает сервер.
 *
 * «Список» проверяется здесь же: прогресс в `<summary>` свёрнутой секции,
 * «Рекомендация по личным вещам» отдельной секцией между общественной
 * и личной (05.11.2026, `docs/ph/gear-tab.md` §2), а сами чек-листы
 * и их ручки — в `TripGearChecklist.spec.ts`.
 */
const mocks = vi.hoisted(() => ({
  listTripGear: vi.fn(),
  listParticipants: vi.fn(),
  listGear: vi.fn(),
  proposeTripGear: vi.fn(),
  removeTripGear: vi.fn(),
  updateTripGear: vi.fn(),
  addManualTripGear: vi.fn(),
  createGearItem: vi.fn(),
  fetchGearTypes: vi.fn(),
  listTripChecklists: vi.fn(),
  createTripChecklist: vi.fn(),
  importChecklistItems: vi.fn(),
  setRecommendationMark: vi.fn(),
  addChecklistItem: vi.fn(),
  updateChecklistItem: vi.fn(),
  deleteChecklistItem: vi.fn(),
  listTemplates: vi.fn(),
}))

vi.mock('@/api/gear', () => ({
  listGear: mocks.listGear,
  listTripGear: mocks.listTripGear,
  proposeTripGear: mocks.proposeTripGear,
  removeTripGear: mocks.removeTripGear,
  updateTripGear: mocks.updateTripGear,
  addManualTripGear: mocks.addManualTripGear,
  createGearItem: mocks.createGearItem,
}))

vi.mock('@/api/tripChecklists', () => ({
  listTripChecklists: mocks.listTripChecklists,
  createTripChecklist: mocks.createTripChecklist,
  importChecklistItems: mocks.importChecklistItems,
  setRecommendationMark: mocks.setRecommendationMark,
}))

vi.mock('@/api/checklists', () => ({
  listTemplates: mocks.listTemplates,
  addChecklistItem: mocks.addChecklistItem,
  updateChecklistItem: mocks.updateChecklistItem,
  deleteChecklistItem: mocks.deleteChecklistItem,
}))

vi.mock('@/api/trips', () => ({ listParticipants: mocks.listParticipants }))
vi.mock('@/api/gearTypes', () => ({ fetchGearTypes: mocks.fetchGearTypes }))

const ME = 'demo-me'
const ANNA = 'demo-anna'
const PETYA = 'demo-petya'

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

function makeTrip(organizerUserId = ME): Trip {
  return {
    id: '1',
    organizerUserId,
    goalObjectId: '10',
    goalObject: { id: '10', name: 'Витязь', type: 'скальник', url: null },
    announcement: null,
    routeText: '',
    requirementsText: null,
    hasGuitar: false,
    visibility: 'public',
    isRecruitmentClosed: false,
    activityTypeIds: [],
    status: 'decided',
    startsAt: '2026-10-29T00:00:00.000Z',
    endsAt: '2026-10-31T00:00:00.000Z',
    dateVariants: [],
    actualStartedAt: null,
    actualFinishedAt: null,
    isCommercial: false,
    isOfficial: false,
    priceRub: null,
    priceNote: null,
    cancelledAt: null,
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
  }
}

function participant(
  userId: string,
  displayName: string,
  status: TripParticipant['status'] = 'going',
  isOrganizer = false,
): TripParticipant {
  return {
    userId,
    displayName,
    avatarUrl: null,
    status,
    roles: [],
    isOrganizer,
    isVirtual: false,
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
  }
}

function tripGearItem(
  overrides: Partial<TripGearItem> &
    Pick<TripGearItem, 'id' | 'typeCode' | 'typeName' | 'title' | 'ownerUserId'>,
): TripGearItem {
  return {
    gearItemId: overrides.id,
    typeId: 1,
    attributes: [],
    weightGrams: null,
    note: null,
    isTripOnly: false,
    status: 'approved',
    routeSection: null,
    assignedUserId: null,
    createdAt: '2026-10-29T10:00:00.000Z',
    ...overrides,
  }
}

function gearItem(
  overrides: Partial<GearItem> & Pick<GearItem, 'id' | 'typeCode' | 'typeName' | 'title'>,
): GearItem {
  return {
    typeId: 1,
    groupId: 4,
    groupCode: 'other',
    groupName: 'Прочее',
    sortOrder: 10,
    attributes: [],
    weightGrams: null,
    note: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  }
}

function tripGearList(items: TripGearItem[]): {
  items: TripGearItem[]
  totalWeightGrams: number
  itemsWithoutWeight: number
} {
  return { items, totalWeightGrams: 0, itemsWithoutWeight: 0 }
}

function checklistItem(
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
    createdByUserId: ME,
    gear: null,
    createdAt: '2026-11-05T10:00:00.000Z',
    ...overrides,
  }
}

function checklist(
  id: string,
  scope: Checklist['scope'],
  items: ChecklistItem[],
  title = '',
): Checklist {
  return {
    id,
    scope,
    title,
    tripId: '1',
    ownerUserId: scope === 'personal' ? ME : null,
    items,
    createdAt: '2026-11-05T10:00:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
  }
}

function emptyChecklists(): TripChecklists {
  return { shared: null, personal: null, recommendation: null }
}

/**
 * Набор похода: палатка моя (несу я), топор не распределён, котёл ждёт
 * решения, лодку уже отклонили, спальник едет Анне. Этого хватает на все
 * ветки: статусы, плитки, «Взял» и итог веса.
 */
function defaultItems(): TripGearItem[] {
  return [
    tripGearItem({
      id: 'g1',
      typeCode: 'tent',
      typeName: 'Палатка',
      title: 'Палатка',
      ownerUserId: ANNA,
      assignedUserId: ME,
      weightGrams: 2600,
      status: 'approved',
    }),
    tripGearItem({
      id: 'g2',
      typeCode: 'axe',
      typeName: 'Топор',
      title: 'Топор',
      ownerUserId: ME,
      assignedUserId: null,
      weightGrams: 900,
      status: 'approved',
    }),
    tripGearItem({
      id: 'g3',
      typeCode: 'kettle',
      typeName: 'Котёл',
      title: 'Котёл',
      ownerUserId: ANNA,
      assignedUserId: ANNA,
      weightGrams: 1200,
      status: 'proposed',
    }),
    tripGearItem({
      id: 'g4',
      typeCode: 'other',
      typeName: 'Прочее',
      title: 'Лодка',
      ownerUserId: ME,
      assignedUserId: null,
      weightGrams: null,
      status: 'declined',
    }),
    tripGearItem({
      id: 'g5',
      typeCode: 'sleeping_bag',
      typeName: 'Спальник',
      title: 'Спальник',
      ownerUserId: ANNA,
      assignedUserId: ANNA,
      weightGrams: 800,
      status: 'approved',
    }),
  ]
}

async function mounted(
  canEdit = false,
  organizerUserId = ME,
): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(TripGear, {
    props: { trip: makeTrip(organizerUserId), canEdit },
  })
  await flushPromises()

  return wrapper
}

function textOf(wrapper: ReturnType<typeof mount>, selector: string): string {
  return wrapper.get(selector).text()
}

describe('вкладка «Снаряжение» похода', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    useAuthStore().setAuth(makeUser(), 'token')

    mocks.listTripGear.mockResolvedValue(tripGearList(defaultItems()))
    mocks.listParticipants.mockResolvedValue([
      participant(ME, 'Олег', 'going', true),
      participant(ANNA, 'Анна'),
      participant(PETYA, 'Петя', 'maybe'),
    ])
    mocks.listGear.mockResolvedValue({ items: [], totalWeightGrams: 0, itemsWithoutWeight: 0 })
    mocks.listTripChecklists.mockResolvedValue(emptyChecklists())
    mocks.listTemplates.mockResolvedValue([])
    mocks.removeTripGear.mockResolvedValue(undefined)
    mocks.updateTripGear.mockImplementation(
      async (_tripId: string, gearId: string, body: Record<string, unknown>) => {
        const row = defaultItems().find((item) => item.id === gearId)

        return { ...(row as TripGearItem), ...body }
      },
    )
  })

  it('две большие секции и вложенные подписи на месте', async () => {
    const wrapper = await mounted()

    expect(textOf(wrapper, '[data-test="gear-public-section"] summary')).toContain(
      'Общественное снаряжение',
    )
    expect(textOf(wrapper, '[data-test="gear-personal-section"] summary')).toContain(
      'Личное снаряжение',
    )

    expect(wrapper.find('[data-test="gear-taking"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-distribution"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-taken"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-backpack"]').exists()).toBe(true)
  })

  it('в заголовках секций количеств нет, а у списков — прогресс в свёрнутой секции', async () => {
    mocks.listTripChecklists.mockResolvedValue({
      ...emptyChecklists(),
      shared: checklist('c1', 'trip', [
        checklistItem('i1', 'Котёл', { isDone: true }),
        checklistItem('i2', 'Топор'),
        checklistItem('i3', 'Пила'),
      ]),
      recommendation: checklist('r1', 'recommendation', [checklistItem('ri1', 'Рюкзак')]),
    })

    const wrapper = await mounted(true)

    // Заказчик: «убирай количества в заголовках секций… у „Личных вещей
    // участников“, „Берём“ — вообще не нужно количество».
    const sharedSummary = wrapper.get('[data-test="gear-shared-checklist"] > summary')
    expect(sharedSummary.text()).toContain('Список')
    expect(wrapper.get('[data-test="gear-personal-checklist"] > summary').text()).toContain(
      'Список',
    )
    expect(wrapper.get('[data-test="gear-recommendation-section"] > summary').text()).toBe(
      'Рекомендация по личным вещам',
    )
    expect(wrapper.get('[data-test="gear-taking"] > summary').text()).toBe('Берём')
    expect(wrapper.get('[data-test="gear-distribution"] > summary').text()).toBe('Распределение')
    expect(wrapper.get('[data-test="gear-declined"] > summary').text()).toBe('Не берём')
    expect(wrapper.get('[data-test="gear-unassigned"] p').text()).toBe('Не распределено')
    expect(wrapper.get('[data-test="gear-taken"] > summary').text()).toBe('Взял')
    expect(wrapper.get('[data-test="gear-backpack"] > summary').text()).toBe('Мой рюкзак')

    // Прогресс стоит в `<summary>`: в свёрнутой секции только он и виден.
    expect(
      sharedSummary.get('[data-test="gear-shared-progress"]').text(),
    ).toBe('1/3')
  })

  it('дробь личного списка складывается из рекомендации и своих пунктов', async () => {
    mocks.listTripChecklists.mockResolvedValue({
      ...emptyChecklists(),
      recommendation: checklist('r1', 'recommendation', [
        checklistItem('ri1', 'Рюкзак', { isDone: true }),
        checklistItem('ri2', 'Спальник'),
      ]),
      personal: checklist('p1', 'personal', [
        checklistItem('pi1', 'Коврик', { isDone: true }),
        checklistItem('pi2', 'Кружка'),
        checklistItem('pi3', 'Фонарь'),
      ]),
    })

    const wrapper = await mounted(false, ANNA)
    const personalSummary = wrapper.get('[data-test="gear-personal-checklist"] > summary')

    // Два закрытых из пяти: одна рекомендация и один свой пункт.
    expect(personalSummary.get('[data-test="gear-personal-progress"]').text()).toBe('2/5')
  })

  it('подписи списков — словами заказчика, а инструменты скрываются в обоих списках', async () => {
    mocks.listTripChecklists.mockResolvedValue({
      ...emptyChecklists(),
      shared: checklist('c1', 'trip', []),
      personal: checklist('p1', 'personal', [checklistItem('pi1', 'Спальник')]),
      recommendation: checklist('r1', 'recommendation', []),
    })

    const wrapper = await mounted(true)

    expect(wrapper.get('[data-test="gear-shared-checklist"]').text()).toContain(
      'Список общественного снаряжения. Редактируют только организаторы.',
    )
    expect(wrapper.get('[data-test="gear-recommendation-section"]').text()).toContain(
      'Рекомендация добавляется каждому участнику в личный список. Выполнение на его совести.',
    )

    // «Что берём в поход» над общим списком заказчик убрал: и так понятно.
    expect(wrapper.get('[data-test="gear-shared-checklist"]').text()).not.toContain(
      'Что берём в поход',
    )

    // Кнопка скрытия инструментов есть у обоих списков, которые можно править.
    expect(
      wrapper.find('[data-test="gear-personal-checklist"] [data-test="checklist-tools-toggle"]')
        .exists(),
    ).toBe(true)
    expect(
      wrapper.find('[data-test="gear-shared-checklist"] [data-test="checklist-tools-toggle"]')
        .exists(),
    ).toBe(true)

    // А у участника без прав инструментов нет — значит, и кнопки нет.
    const readOnly = await mounted(false, ANNA)
    expect(
      readOnly.find('[data-test="gear-shared-checklist"] [data-test="checklist-tools-toggle"]')
        .exists(),
    ).toBe(false)

    // Модалка импорта говорит, чем станет вещь в общественном списке.
    await wrapper
      .get('[data-test="gear-shared-checklist"] [data-test="checklist-import"]')
      .trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="template-picker"]').text()).toContain(
      'В список общественного снаряжения вещи из шаблона попадут названиями типов: «Топор», а не «мой любимый Fixars».',
    )
  })

  it('«Берём»: утверждённое и предложенное, без прав — подпись «ждёт решения»', async () => {
    const wrapper = await mounted()
    const pills = wrapper.findAll('[data-test^="gear-taking-item-"]')
    expect(pills.map((pill) => pill.text())).toHaveLength(4)
    expect(wrapper.find('[data-test="gear-taking-item-g1"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-taking-item-g3"]').exists()).toBe(true)

    expect(wrapper.find('[data-test="gear-taking-pending-g3"]').text()).toContain(
      'ждёт решения',
    )
    // Без права вкладки статус не поменять: списка выбора нет вовсе.
    expect(wrapper.find('[data-test="gear-taking-status-g3"]').exists()).toBe(false)
  })

  it('«Берём»: ведущий меняет статус, и вещь переезжает в утверждённые', async () => {
    const wrapper = await mounted(true)

    const status = wrapper.get('[data-test="gear-taking-status-g3"]')
    await status.setValue('approved')
    await flushPromises()

    expect(mocks.updateTripGear).toHaveBeenCalledWith('1', 'g3', { status: 'approved' })
    expect(wrapper.find('[data-test="gear-taking-pending-g3"]').exists()).toBe(false)
    expect(
      (wrapper.get('[data-test="gear-taking-status-g3"]').element as HTMLSelectElement).value,
    ).toBe('approved')
  })

  it('отклонённое уходит в «Не берём» и возвращается решением ведущего', async () => {
    const wrapper = await mounted(true)

    expect(wrapper.find('[data-test="gear-declined"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-declined-item-g4"]').text()).toContain('Лодка')

    await wrapper.get('[data-test="gear-declined-restore-g4"]').trigger('click')
    await flushPromises()

    expect(mocks.updateTripGear).toHaveBeenCalledWith('1', 'g4', { status: 'proposed' })
    expect(wrapper.find('[data-test="gear-declined"]').exists()).toBe(false)
  })

  it('«Распределение» строит плитки только по идущим и считает вес', async () => {
    const wrapper = await mounted()

    expect(wrapper.find(`[data-test="gear-bag-${ME}"]`).exists()).toBe(true)
    expect(wrapper.find(`[data-test="gear-bag-${ANNA}"]`).exists()).toBe(true)
    // «Пока не решил» ещё не несёт груз.
    expect(wrapper.find(`[data-test="gear-bag-${PETYA}"]`).exists()).toBe(false)

    expect(textOf(wrapper, `[data-test="gear-bag-${ME}"]`)).toContain('Всего: 2,6 кг')
    expect(textOf(wrapper, `[data-test="gear-bag-${ANNA}"]`)).toContain('Всего: 800 г')

    // Количества у зоны нет: заказчик просил убрать их из заголовков секций.
    expect(wrapper.get('[data-test="gear-unassigned"] p').text()).toBe('Не распределено')
    expect(wrapper.find('[data-test="gear-unassigned-item-g2"]').exists()).toBe(true)
  })

  it('вещь переносится между рюкзаками выпадающим списком', async () => {
    const wrapper = await mounted()

    await wrapper.get('[data-test="gear-assign-g5"]').setValue(ME)
    await flushPromises()

    expect(mocks.updateTripGear).toHaveBeenCalledWith('1', 'g5', { assignedUserId: ME })
    expect(wrapper.find(`[data-test="gear-bag-${ME}"]`).text()).toContain('Спальник')
  })

  it('вещь переносится перетаскиванием на плитку', async () => {
    const wrapper = await mounted()

    await wrapper.get('[data-test="gear-bag-item-g5"]').trigger('dragstart')
    await wrapper.get(`[data-test="gear-bag-${ME}"]`).trigger('drop')
    await flushPromises()

    expect(mocks.updateTripGear).toHaveBeenCalledWith('1', 'g5', { assignedUserId: ME })
  })

  it('«Взял» и «Мой рюкзак» — только мои вещи и их итог', async () => {
    const wrapper = await mounted()

    expect(wrapper.find('[data-test="gear-taken-item-g1"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-taken-item-g2"]').exists()).toBe(false)

    expect(wrapper.find('[data-test="gear-backpack-item-g1"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-backpack-item-g2"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="gear-backpack-total"]').text()).toBe('Всего: 2,6 кг')
  })

  it('«Добавить снаряжение» открывает общий каталог и предлагает вещь', async () => {
    const catalog = [
      gearItem({ id: 'cat-1', typeCode: 'other', typeName: 'Прочее', title: 'Грелка' }),
    ]
    mocks.listGear.mockResolvedValue({ items: catalog, totalWeightGrams: 0, itemsWithoutWeight: 0 })
    mocks.proposeTripGear.mockResolvedValue(
      tripGearItem({
        id: 'g6',
        gearItemId: 'cat-1',
        typeCode: 'other',
        typeName: 'Прочее',
        title: 'Грелка',
        ownerUserId: ME,
        assignedUserId: ME,
        weightGrams: 150,
        status: 'proposed',
      }),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="gear-add"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="route-extra-picker"]').exists()).toBe(true)

    await wrapper.get('[data-test="route-extra-search"]').setValue('Грелка')
    await flushPromises()
    await wrapper.get('[data-test="route-extra-item-cat-1"]').trigger('click')
    await flushPromises()

    expect(mocks.proposeTripGear).toHaveBeenCalledWith('1', 'cat-1')
    expect(wrapper.find('[data-test="route-extra-picker"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="gear-taking-item-g6"]').exists()).toBe(true)
  })

  it('«Добавить вручную» открывает общую форму поверх выбора', async () => {
    mocks.fetchGearTypes.mockResolvedValue([])

    const wrapper = await mounted()

    await wrapper.get('[data-test="gear-add"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="route-extra-manual"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="manual-gear-dialog"]').exists()).toBe(true)
  })

  it('своя вещь убирается из похода, чужая — только с правом вкладки', async () => {
    const wrapper = await mounted()

    // Топор мой — крестик есть и без права вкладки.
    expect(wrapper.find('[data-test="gear-taking-remove-g2"]').exists()).toBe(true)
    // Палатка Анны — без права вкладки крестика нет.
    expect(wrapper.find('[data-test="gear-taking-remove-g1"]').exists()).toBe(false)

    await wrapper.get('[data-test="gear-taking-remove-g2"]').trigger('click')
    await flushPromises()

    expect(mocks.removeTripGear).toHaveBeenCalledWith('1', 'g2')
    expect(wrapper.find('[data-test="gear-taking-item-g2"]').exists()).toBe(false)
  })

  it('ошибку правки показывает словами сервера', async () => {
    mocks.updateTripGear.mockRejectedValue(
      new ApiError(403, '«Берём / не берём» решает тот, кто ведёт снаряжение похода'),
    )

    const wrapper = await mounted(true)

    await wrapper.get('[data-test="gear-taking-status-g3"]').setValue('declined')
    await flushPromises()

    expect(wrapper.find('[data-test="gear-action-error"]').text()).toContain(
      'решает тот, кто ведёт снаряжение',
    )
  })

  it('пустое снаряжение приглашает добавить, а не показывает пустые списки', async () => {
    mocks.listTripGear.mockResolvedValue(tripGearList([]))

    const wrapper = await mounted()

    expect(wrapper.find('[data-test="gear-taking-empty"]').text()).toContain(
      'Пока ничего не собрано',
    )
    expect(wrapper.find('[data-test="gear-distribution-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-taken-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-backpack-empty"]').exists()).toBe(true)
  })

  // ───────────────────────── «Список»: чек-листы (05.11.2026) ─────────────────────────

  it('«Список»: общий чек-лист виден всем, галочки — только с доступом', async () => {
    const shared = checklist('c1', 'trip', [
      checklistItem('i1', 'Котёл'),
      checklistItem('i2', 'Топор', { isDone: true }),
    ])
    mocks.listTripChecklists.mockResolvedValue({ ...emptyChecklists(), shared })

    const readOnly = await mounted(false)
    const readBlock = readOnly.get('[data-test="gear-shared-checklist"]')

    expect(readBlock.text()).toContain('Котёл')
    expect(readBlock.text()).toContain('Топор')
    // Без доступа список только виден: ни галочек, ни поля добавления.
    expect(readBlock.find('[data-test="checklist-item-check-i1"]').exists()).toBe(false)
    expect(readBlock.find('[data-test="checklist-new-item"]').exists()).toBe(false)

    const editor = await mounted(true)
    const editBlock = editor.get('[data-test="gear-shared-checklist"]')

    expect(editBlock.find('[data-test="checklist-item-check-i1"]').exists()).toBe(true)
    expect(editBlock.find('[data-test="checklist-new-item"]').exists()).toBe(true)
  })

  it('«Список»: создаёт и заполняет список с нуля', async () => {
    mocks.createTripChecklist.mockResolvedValue(checklist('c1', 'trip', []))
    const wrapper = await mounted(true)

    expect(wrapper.get('[data-test="gear-shared-checklist"]').text()).toContain(
      'ещё не завели',
    )

    await wrapper
      .get('[data-test="gear-shared-checklist"] [data-test="checklist-create"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.createTripChecklist).toHaveBeenCalledWith('1', 'trip')
    expect(wrapper.get('[data-test="gear-shared-checklist"]').text()).toContain(
      'Пунктов пока нет',
    )

    mocks.addChecklistItem.mockResolvedValue(checklistItem('i1', 'Котёл'))
    await wrapper
      .get('[data-test="gear-shared-checklist"] [data-test="checklist-new-item"]')
      .setValue('Котёл')
    await wrapper.get('[data-test="gear-shared-checklist"] form').trigger('submit')
    await flushPromises()

    expect(mocks.addChecklistItem).toHaveBeenCalledWith('c1', { title: 'Котёл' })
    expect(wrapper.get('[data-test="gear-shared-checklist"]').text()).toContain('Котёл')
  })

  it('рекомендация организатора — отдельная секция между общественной и личной', async () => {
    const recommendation = checklist('r1', 'recommendation', [
      checklistItem('ri1', 'Рюкзак'),
      checklistItem('ri2', 'Спальник'),
    ])
    mocks.listTripChecklists.mockResolvedValue({
      ...emptyChecklists(),
      recommendation,
    })

    const organizer = await mounted(true)

    // Заказчик: «секция „Личные вещи участников“ некорректно смотрится
    // в Общественном снаряжении… Вынеси её отдельно между „Общественное
    // снаряжение“ и „Личное снаряжение“».
    const html = organizer.html()
    expect(html.indexOf('data-test="gear-public-section"')).toBeLessThan(
      html.indexOf('data-test="gear-recommendation-section"'),
    )
    expect(html.indexOf('data-test="gear-recommendation-section"')).toBeLessThan(
      html.indexOf('data-test="gear-personal-section"'),
    )
    expect(
      organizer
        .get('[data-test="gear-public-section"]')
        .find('[data-test="gear-recommendation-section"]')
        .exists(),
    ).toBe(false)

    // Название — словами заказчика; внутренние подпись и бейдж не дублируют его.
    const editor = organizer.get('[data-test="gear-recommendation-section"]')
    expect(editor.get('summary').text()).toBe('Рекомендация по личным вещам')
    expect(editor.text()).not.toContain('Что взять каждому')
    expect(editor.find('[data-test="checklist-recommended-badge"]').exists()).toBe(false)
    expect(editor.find('[data-test="checklist-heading"]').exists()).toBe(false)

    // В личной секции рекомендация — над своим списком, отдельным блоком.
    const personal = organizer.get('[data-test="gear-personal-checklist"]')
    expect(personal.text()).toContain('Рекомендовано организатором')
    expect(personal.text()).toContain('Рюкзак')
    expect(personal.text()).toContain('Спальник')
    // Удалить рекомендацию участник не может.
    expect(personal.find('[data-test="checklist-item-remove"]').exists()).toBe(false)
  })

  it('участник без прав не видит редактор рекомендации, но получает её в личном списке', async () => {
    mocks.listTripChecklists.mockResolvedValue({
      ...emptyChecklists(),
      recommendation: checklist('r1', 'recommendation', [checklistItem('ri1', 'Рюкзак')]),
    })

    const wrapper = await mounted(false, ANNA)

    expect(wrapper.find('[data-test="gear-recommendation-section"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="gear-personal-checklist"]').text()).toContain('Рюкзак')
  })

  it('отметка рекомендации уходит в отдельную ручку и остаётся личной', async () => {
    mocks.listTripChecklists.mockResolvedValue({
      ...emptyChecklists(),
      recommendation: checklist('r1', 'recommendation', [checklistItem('ri1', 'Рюкзак')]),
    })
    mocks.setRecommendationMark.mockResolvedValue({
      itemId: 'ri1',
      isDone: true,
      doneAt: '2026-11-05T12:00:00.000Z',
    })

    const wrapper = await mounted(false, ANNA)
    const checkbox = wrapper.get(
      '[data-test="gear-personal-checklist"] [data-test="checklist-item-check-ri1"]',
    )
    await checkbox.setValue(true)
    await flushPromises()

    expect(mocks.setRecommendationMark).toHaveBeenCalledWith('1', 'ri1', true)
    // Общий PATCH для отметки не зовётся: он записал бы «взял» за всех.
    expect(mocks.updateChecklistItem).not.toHaveBeenCalled()
  })

  it('личный список: пункт добавляется из поля', async () => {
    mocks.listTripChecklists.mockResolvedValue({
      ...emptyChecklists(),
      personal: checklist('p1', 'personal', [checklistItem('pi1', 'Спальник')]),
    })
    mocks.addChecklistItem.mockResolvedValue(checklistItem('pi2', 'Коврик'))

    const wrapper = await mounted(false)
    const block = wrapper.get('[data-test="gear-personal-checklist"]')

    expect(block.text()).toContain('Спальник')
    await block.get('[data-test="checklist-new-item"]').setValue('Коврик')
    await block.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.addChecklistItem).toHaveBeenCalledWith('p1', { title: 'Коврик' })
    expect(wrapper.get('[data-test="gear-personal-checklist"]').text()).toContain('Коврик')
  })

  it('«Из чек-листа» открывает выбор чек-листа личных шаблонов', async () => {
    mocks.listTripChecklists.mockResolvedValue({
      ...emptyChecklists(),
      shared: checklist('c1', 'trip', []),
    })

    const wrapper = await mounted(true)
    await wrapper
      .get('[data-test="gear-shared-checklist"] [data-test="checklist-import"]')
      .trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="template-picker"]').exists()).toBe(true)
    expect(mocks.listTemplates).toHaveBeenCalled()
  })
})
