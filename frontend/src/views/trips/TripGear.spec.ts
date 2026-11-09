import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import TripGear from '@/views/trips/TripGear.vue'
import type { Checklist, ChecklistItem, TripChecklists } from '@/types/checklists'
import type {
  GearItem,
  TripGearItem,
  TripGearLoad,
  TripGearLoadBackpack,
  TripGearSection,
  TripGearSleeping,
} from '@/types/gear'
import type { Trip, TripParticipant } from '@/types/trips'
import type { TripEvent } from '@/api/events'
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
  createTripGearSection: vi.fn(),
  updateTripGearSection: vi.fn(),
  removeTripGearSection: vi.fn(),
  subscribeTripEvents: vi.fn(),
  autoDistributeTripGear: vi.fn(),
  getTripGearLoad: vi.fn(),
  addPersonalTripGear: vi.fn(),
  updatePersonalTripGear: vi.fn(),
  removePersonalTripGear: vi.fn(),
  assignTripGearPackage: vi.fn(),
  removeRouteSleeping: vi.fn(),
}))

vi.mock('@/api/gear', () => ({
  listGear: mocks.listGear,
  listTripGear: mocks.listTripGear,
  proposeTripGear: mocks.proposeTripGear,
  removeTripGear: mocks.removeTripGear,
  updateTripGear: mocks.updateTripGear,
  addManualTripGear: mocks.addManualTripGear,
  createGearItem: mocks.createGearItem,
  createTripGearSection: mocks.createTripGearSection,
  updateTripGearSection: mocks.updateTripGearSection,
  removeTripGearSection: mocks.removeTripGearSection,
  autoDistributeTripGear: mocks.autoDistributeTripGear,
  getTripGearLoad: mocks.getTripGearLoad,
  addPersonalTripGear: mocks.addPersonalTripGear,
  updatePersonalTripGear: mocks.updatePersonalTripGear,
  removePersonalTripGear: mocks.removePersonalTripGear,
  assignTripGearPackage: mocks.assignTripGearPackage,
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

vi.mock('@/api/trips', () => ({
  listParticipants: mocks.listParticipants,
  removeRouteSleeping: mocks.removeRouteSleeping,
}))
vi.mock('@/api/gearTypes', () => ({ fetchGearTypes: mocks.fetchGearTypes }))

/**
 * Поток живых изменений подменяем целиком: настоящий `fetch`-стрим —
 * забота `api/events.spec.ts`, а здесь важно, что вкладка на событие делает.
 */
vi.mock('@/api/events', () => ({ subscribeTripEvents: mocks.subscribeTripEvents }))

/** Чат проверяется своим файлом; здесь он только должен стоять внизу. */
vi.mock('@/views/trips/TripChat.vue', () => ({
  default: {
    name: 'TripChat',
    props: ['tripId', 'kind'],
    template: '<section data-test="trip-chat" />',
  },
}))

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
    sharedSectionId: null,
    personalSectionId: null,
    assignedUserId: null,
    createdAt: '2026-10-29T10:00:00.000Z',
    ...overrides,
  }
}

/** Личная вещь из «Ночёвок»: раздел «в палатку» показывает её как есть. */
function sleepingRow(
  id: string,
  title: string,
  weightGrams: number | null,
  typeName = 'Спальник',
): TripGearSleeping {
  return {
    id,
    gearItemId: `cat-${id}`,
    typeCode: 'sleeping_bag',
    typeName,
    title,
    weightGrams,
  }
}

function tripGearSection(
  overrides: Partial<TripGearSection> & Pick<TripGearSection, 'id' | 'title'>,
): TripGearSection {
  return {
    scope: 'shared',
    ownerUserId: null,
    parentId: null,
    templateCode: null,
    sortOrder: 10,
    ...overrides,
  }
}

function gearItem(
  overrides: Partial<GearItem> & Pick<GearItem, 'id' | 'typeCode' | 'typeName' | 'title'>,
): GearItem {  return {
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

function tripGearList(
  items: TripGearItem[],
  sections: TripGearSection[] = [],
  sleeping: TripGearSleeping[] = [],
  personalItems: TripGearItem[] = [],
): {
  items: TripGearItem[]
  sections: TripGearSection[]
  totalWeightGrams: number
  itemsWithoutWeight: number
  sleeping: TripGearSleeping[]
  personalItems: TripGearItem[]
} {
  return {
    items,
    sections,
    totalWeightGrams: 0,
    itemsWithoutWeight: 0,
    sleeping,
    personalItems,
  }
}

/** Рюкзак в раскладке: по умолчанию всё пусто, тесты наливают нужное. */
function loadBackpack(
  userId: string,
  overrides: Partial<TripGearLoadBackpack> = {},
): TripGearLoadBackpack {
  return {
    userId,
    gender: 'm',
    targetWeightGrams: 0,
    gearWeightGrams: 0,
    packagesWeightGrams: 0,
    totalWeightGrams: 0,
    deviationGrams: 0,
    gear: [],
    packages: [],
    ...overrides,
  }
}

/** Ответ `GET /gear/load`: по умолчанию без груза, без пакетов и без личного. */
function tripLoad(overrides: Partial<TripGearLoad> = {}): TripGearLoad {
  return {
    totalWeightGrams: 0,
    backpacks: [] as TripGearLoadBackpack[],
    unassigned: [],
    itemsWithoutWeight: 0,
    packagesWithoutWeight: 0,
    doctorUserId: null,
    doctorMissing: false,
    personal: {
      gearWeightGrams: 0,
      packagesWeightGrams: 0,
      totalWeightGrams: 0,
      gear: [],
      packages: [],
    },
    ...overrides,
  }
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
    window.localStorage.clear()
    setActivePinia(createPinia())
    useAuthStore().setAuth(makeUser(), 'token')

    // Поток событий по умолчанию молчит: большинство тестов живут без него.
    mocks.subscribeTripEvents.mockReset()
    mocks.subscribeTripEvents.mockReturnValue(() => {})

    // Раскладка по умолчанию не пришла: старые тесты проверяют вид
    // по вещам похода, а пакеты и доли — в отдельных тестах ниже.
    mocks.getTripGearLoad.mockResolvedValue(null)

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
    mocks.createTripGearSection.mockImplementation(
      async (
        _tripId: string,
        body: { scope: TripGearSection['scope']; title: string; parentId?: string | null },
      ) =>
        tripGearSection({
          id: `new-${body.title}`,
          title: body.title,
          scope: body.scope,
          ownerUserId: body.scope === 'personal' ? ME : null,
          parentId: body.parentId ?? null,
        }),
    )
    mocks.updateTripGearSection.mockImplementation(
      async (
        _tripId: string,
        sectionId: string,
        patch: { title?: string; sortOrder?: number; parentId?: string | null },
      ) => ({
        ...tripGearSection({ id: sectionId, title: 'Раздел' }),
        ...patch,
      }),
    )
    mocks.removeTripGearSection.mockResolvedValue(undefined)
    mocks.removeRouteSleeping.mockResolvedValue({})
    mocks.addPersonalTripGear.mockImplementation(
      async (_tripId: string, body: { gearItemId: string; sectionId?: string | null }) =>
        tripGearItem({
          id: `personal-${body.gearItemId}`,
          gearItemId: body.gearItemId,
          typeCode: 'clothes',
          typeName: 'Одежда',
          title: 'Куртка',
          ownerUserId: ME,
          assignedUserId: ME,
          weightGrams: 800,
          personalSectionId: body.sectionId ?? null,
        }),
    )
    mocks.updatePersonalTripGear.mockImplementation(
      async (_tripId: string, personalId: string, body: { sectionId: string | null }) =>
        tripGearItem({
          id: personalId,
          gearItemId: `cat-${personalId}`,
          typeCode: 'clothes',
          typeName: 'Одежда',
          title: 'Куртка',
          ownerUserId: ME,
          assignedUserId: ME,
          weightGrams: 800,
          personalSectionId: body.sectionId,
        }),
    )
    mocks.removePersonalTripGear.mockResolvedValue(undefined)
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
      'Рекомендации участникам по личным вещам',
    )
    expect(wrapper.get('[data-test="gear-taking"] > summary').text()).toBe('Берём')
    expect(wrapper.get('[data-test="gear-distribution"] > summary').text()).toBe('Распределение')
    expect(wrapper.get('[data-test="gear-unassigned"] p').text()).toBe('Не распределено')
    expect(wrapper.get('[data-test="gear-taken"] > summary').text()).toBe('Взял')

    // В заголовке «Моего рюкзака» теперь вес, а не количество (09.11.2026):
    // заказчик просил суммарный вес, видимый и в свёрнутой секции.
    expect(wrapper.get('[data-test="gear-backpack"] > summary').text()).toContain(
      'Мой рюкзак',
    )
    expect(wrapper.get('[data-test="gear-backpack-total"]').text()).toBe(
      'Всего: 2,6 кг',
    )

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
      'Редактируют только организаторы.',
    )
    expect(wrapper.get('[data-test="gear-shared-checklist"]').text()).not.toContain(
      'Список общественного снаряжения.',
    )
    expect(wrapper.get('[data-test="gear-recommendation-section"]').text()).toContain(
      'Рекомендация добавляется каждому участнику в личный список. Выполнение на его совести.',
    )

    // «Что берём в поход» над общим списком заказчик убрал: и так понятно.
    expect(wrapper.get('[data-test="gear-shared-checklist"]').text()).not.toContain(
      'Что берём в поход',
    )

    // «⋯» в заголовке есть у обоих списков, которые можно править.
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

  it('«⋯» в заголовке списка скрывает инструменты, оставляя галочки', async () => {
    mocks.listTripChecklists.mockResolvedValue({
      ...emptyChecklists(),
      shared: checklist('c1', 'trip', [checklistItem('i1', 'Котёл')]),
    })

    const wrapper = await mounted(true)
    const block = wrapper.get('[data-test="gear-shared-checklist"]')
    const toggle = block.get('[data-test="checklist-tools-toggle"]')

    // Заказчик: «у разделов кнопка скрытия в виде хлебных крошек… Установи
    // спискам крошки». Текстовой ссылки «Скрыть инструменты» больше нет:
    // те же слова живут в `aria-label` и подсказке, а на экране — «⋯».
    expect(toggle.text()).toBe('⋯')
    expect(toggle.text()).not.toContain('инструменты')
    expect(toggle.attributes('title')).toBe('Скрыть инструменты')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(block.find('[data-test="checklist-new-item"]').exists()).toBe(true)

    // Кнопка в `<summary>` не сворачивает сам список: сначала разворачиваем
    // секцию (по умолчанию вкладка открывается свёрнутой), потом жмём «⋯».
    const details = block.element as HTMLDetailsElement
    details.open = true
    await block.trigger('toggle')

    await toggle.trigger('click')

    expect(block.find('[data-test="checklist-new-item"]').exists()).toBe(false)
    expect(block.find('[data-test="checklist-import"]').exists()).toBe(false)
    expect(block.find('[data-test="checklist-item-check-i1"]').exists()).toBe(true)
    expect(toggle.attributes('title')).toBe('Показать инструменты')
    expect(toggle.attributes('aria-expanded')).toBe('false')

    // Кнопка в `<summary>` не сворачивает сам список.
    expect(details.hasAttribute('open')).toBe(true)
  })

  it('у всех трёх списков один плейсхолдер и одно название импорта', async () => {
    mocks.listTripChecklists.mockResolvedValue({
      shared: checklist('c1', 'trip', []),
      personal: checklist('p1', 'personal', []),
      recommendation: checklist('r1', 'recommendation', []),
    })

    const wrapper = await mounted(true)

    // Заказчик: «измени все три плейсхолдера списков на „Добавить в список“,
    // у всех одинаково».
    const placeholders = wrapper
      .findAll('[data-test="checklist-new-item"]')
      .map((input) => input.attributes('placeholder'))

    expect(placeholders).toHaveLength(3)
    expect(new Set(placeholders)).toEqual(new Set(['Добавить в список']))

    const imports = wrapper
      .findAll('[data-test="checklist-import"]')
      .map((button) => button.text())

    expect(imports).toHaveLength(3)
    expect(new Set(imports)).toEqual(new Set(['Взять из личного чек-листа']))
  })

  it('«Берём»: утверждённое, предложенное и отклонённое — в одном списке', async () => {
    const wrapper = await mounted()
    const pills = wrapper.findAll('[data-test^="gear-taking-item-"]')
    expect(pills.map((pill) => pill.text())).toHaveLength(5)
    expect(wrapper.find('[data-test="gear-taking-item-g1"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-taking-item-g3"]').exists()).toBe(true)

    // Статус — оформлением, а не полем: сплошная «берём», пунктир «предложено».
    expect(wrapper.get('[data-test="gear-taking-item-g1"]').attributes('data-status')).toBe(
      'approved',
    )
    expect(wrapper.get('[data-test="gear-taking-item-g3"]').attributes('data-status')).toBe(
      'proposed',
    )
    expect(wrapper.get('[data-test="gear-taking-item-g1"]').classes()).toContain('bg-orange-100')
    expect(wrapper.get('[data-test="gear-taking-item-g3"]').classes()).toContain('border-dashed')
    expect(wrapper.get('[data-test="gear-taking-item-g3"]').attributes('title')).toBe('Предложено')

    // Заказчик: «не удалять из секции, а помечать как отвергнутое,
    // перечеркнуть». Отклонённое осталось На месте, но зачёркнуто.
    expect(wrapper.get('[data-test="gear-taking-item-g4"]').classes()).toContain('line-through')
    expect(wrapper.get('[data-test="gear-taking-item-g4"]').attributes('data-status')).toBe(
      'declined',
    )
    expect(wrapper.get('[data-test="gear-taking-item-g4"]').attributes('title')).toBe('Не берём')

    // Полей в пилюле нет вовсе: решения переехали в карточку вещи.
    expect(wrapper.find('[data-test="gear-taking-status-g3"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="gear-taking-section-g3"]').exists()).toBe(false)
  })

  it('«Берём»: ведущий меняет статус в карточке, и вещь переезжает в утверждённые', async () => {
    const wrapper = await mounted(true)

    await wrapper.get('[data-test="gear-taking-item-g3"]').trigger('click')
    expect(wrapper.find('[data-test="gear-item-dialog"]').exists()).toBe(true)

    await wrapper.get('[data-test="gear-item-status-approved"]').trigger('click')
    await flushPromises()

    expect(mocks.updateTripGear).toHaveBeenCalledWith('1', 'g3', { status: 'approved' })
    expect(wrapper.get('[data-test="gear-taking-item-g3"]').attributes('data-status')).toBe(
      'approved',
    )
  })

  it('отклонённое не удаляется из секции: статус меняется в карточке', async () => {
    const wrapper = await mounted(true)

    // Отдельного «Не берём» больше нет: вещь осталась в «Берём».
    expect(wrapper.find('[data-test="gear-declined"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="gear-taking-item-g4"]').exists()).toBe(true)

    await wrapper.get('[data-test="gear-taking-item-g4"]').trigger('click')
    await wrapper.get('[data-test="gear-item-status-proposed"]').trigger('click')
    await flushPromises()

    expect(mocks.updateTripGear).toHaveBeenCalledWith('1', 'g4', { status: 'proposed' })
    expect(wrapper.get('[data-test="gear-taking-item-g4"]').attributes('data-status')).toBe(
      'proposed',
    )
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

  it('«Распределить груз» зовёт автораскладку и перечитывает снаряжение', async () => {
    mocks.autoDistributeTripGear.mockResolvedValue({
      totalWeightGrams: 0,
      backpacks: [],
      unassigned: [],
      itemsWithoutWeight: 0,
      packagesWithoutWeight: 0,
      doctorUserId: null,
      doctorMissing: false,
    })

    const wrapper = await mounted(true)
    await wrapper.get('[data-test="gear-distribute"]').trigger('click')
    await flushPromises()

    expect(mocks.autoDistributeTripGear).toHaveBeenCalledWith('1')
    // Полная загрузка плюс тихое перечитывание после кнопки: назначения
    // записал сервер, и пилюли берут их из свежего ответа.
    expect(mocks.listTripGear).toHaveBeenCalledTimes(2)
  })

  it('кнопки автораспределения нет без права вкладки', async () => {
    const wrapper = await mounted(false)

    expect(wrapper.find('[data-test="gear-distribute"]').exists()).toBe(false)
  })

  it('в «Распределении» пилюля открывает карточку, а несущий — поле в ней', async () => {
    const wrapper = await mounted()

    // Поля прямо в плитке больше нет: пилюля — строка, а не форма.
    expect(wrapper.find('[data-test="gear-assign-g5"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="gear-unassigned-assign-g2"]').exists()).toBe(false)

    await wrapper.get('[data-test="gear-bag-item-g5"]').trigger('click')
    expect(wrapper.find('[data-test="gear-item-dialog"]').exists()).toBe(true)

    await wrapper.get('[data-test="gear-item-assignee"]').setValue(ME)
    await flushPromises()

    expect(mocks.updateTripGear).toHaveBeenCalledWith('1', 'g5', { assignedUserId: ME })
    expect(wrapper.find(`[data-test="gear-bag-${ME}"]`).text()).toContain('Спальник')
  })

  it('несущего в «Берём» выбирают полем карточки, а не подписью', async () => {
    const wrapper = await mounted()

    await wrapper.get('[data-test="gear-taking-item-g2"]').trigger('click')

    // В карточке — выпадающий список идущих, а не строка «Несёт».
    const assignee = wrapper.get('[data-test="gear-item-assignee"]')
    expect(assignee.element.tagName).toBe('SELECT')
    expect(
      Array.from((assignee.element as HTMLSelectElement).options).map(
        (option) => option.textContent?.trim(),
      ),
    ).toEqual(['Не распределено', 'Олег (я)', 'Анна'])

    await assignee.setValue(ANNA)
    await flushPromises()

    expect(mocks.updateTripGear).toHaveBeenCalledWith('1', 'g2', { assignedUserId: ANNA })
    expect(
      (wrapper.get('[data-test="gear-item-assignee"]').element as HTMLSelectElement).value,
    ).toBe(ANNA)
  })

  it('вещь переносится перетаскиванием на плитку', async () => {
    const wrapper = await mounted()

    await wrapper.get('[data-test="gear-bag-item-g5"]').trigger('dragstart')
    await wrapper.get(`[data-test="gear-bag-${ME}"]`).trigger('drop')
    await flushPromises()

    expect(mocks.updateTripGear).toHaveBeenCalledWith('1', 'g5', { assignedUserId: ME })
  })

  it('«Взял» — только личное, «Мой рюкзак» — общественное и личное', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList(
        defaultItems(),
        [
          tripGearSection({
            id: 'p1',
            title: 'в палатку',
            scope: 'personal',
            ownerUserId: ME,
            templateCode: 'tent_inside',
          }),
        ],
        [sleepingRow('s1', 'Спальник зимний', 1200)],
      ),
    )
    const wrapper = await mounted()

    expect(wrapper.find('[data-test="gear-taken-item-g1"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="gear-taken-sleeping-s1"]').exists()).toBe(true)

    // «Мой рюкзак» разделён на «Общественное» и «Личное» (06.11.2026).
    expect(wrapper.find('[data-test="gear-backpack-item-g1"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-backpack-item-g2"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="gear-backpack-sleeping-s1"]').exists()).toBe(true)

    expect(
      wrapper.get('[data-test="gear-backpack-public"] summary').text(),
    ).toContain('Всего: 2,6 кг')
    expect(
      wrapper.get('[data-test="gear-backpack-personal"] summary').text(),
    ).toContain('Всего: 1,2 кг')

    // Итог рюкзака виден в свёрнутой строке: 2,6 кг общественного
    // плюс 1,2 кг личного (09.11.2026).
    expect(wrapper.get('[data-test="gear-backpack-total"]').text()).toBe(
      'Всего: 3,8 кг',
    )
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

  it('«Убрать из похода» в карточке — только владельцу вещи', async () => {
    const wrapper = await mounted()

    // Топор мой — «Убрать из похода» есть и без права вкладки.
    await wrapper.get('[data-test="gear-taking-item-g2"]').trigger('click')
    expect(wrapper.find('[data-test="gear-item-remove"]').exists()).toBe(true)

    // Палатка Анны — без права вкладки убрать нечем: кнопки нет.
    await wrapper.get('[data-test="gear-item-done"]').trigger('click')
    await wrapper.get('[data-test="gear-taking-item-g1"]').trigger('click')
    expect(wrapper.find('[data-test="gear-item-remove"]').exists()).toBe(false)

    await wrapper.get('[data-test="gear-item-done"]').trigger('click')
    await wrapper.get('[data-test="gear-taking-item-g2"]').trigger('click')
    await wrapper.get('[data-test="gear-item-remove"]').trigger('click')
    await flushPromises()

    expect(mocks.removeTripGear).toHaveBeenCalledWith('1', 'g2')
    expect(wrapper.find('[data-test="gear-taking-item-g2"]').exists()).toBe(false)
    // Карточка убранной вещи закрылась вместе с ней.
    expect(wrapper.find('[data-test="gear-item-dialog"]').exists()).toBe(false)
  })

  it('организатор не удаляет чужую вещь: его крестик ставит «не берём»', async () => {
    const wrapper = await mounted(true)

    // Палатка Анны: в карточке удаления нет даже у ведущего вкладку —
    // заказчик: «удалить вещь из похода может только владелец».
    await wrapper.get('[data-test="gear-taking-item-g1"]').trigger('click')
    expect(wrapper.find('[data-test="gear-item-remove"]').exists()).toBe(false)
    await wrapper.get('[data-test="gear-item-done"]').trigger('click')

    await wrapper.get('[data-test="gear-taking-remove-g1"]').trigger('click')
    await flushPromises()

    expect(mocks.removeTripGear).not.toHaveBeenCalled()
    expect(mocks.updateTripGear).toHaveBeenCalledWith('1', 'g1', { status: 'declined' })
    // Крестик не открыл карточку.
    expect(wrapper.find('[data-test="gear-item-dialog"]').exists()).toBe(false)
  })

  it('отклонённую чужую вещь организатор крестиком не помечает', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList(
        defaultItems().map((item) =>
          item.id === 'g1' ? { ...item, status: 'declined' as const } : item,
        ),
      ),
    )

    const wrapper = await mounted(true)

    // Отметка уже стоит — повторять нечего, а удалять организатор не вправе.
    expect(wrapper.find('[data-test="gear-taking-remove-g1"]').exists()).toBe(false)
    // Свою отклонённую лодку владелец по-прежнему убирает крестиком.
    expect(wrapper.find('[data-test="gear-taking-remove-g4"]').exists()).toBe(true)
  })

  it('отклонённую вещь владелец убирает крестиком прямо в разделе', async () => {
    const wrapper = await mounted()

    // Лодка моя и отклонена — крестик есть, чужой палатки — нет.
    expect(wrapper.find('[data-test="gear-taking-remove-g4"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-taking-remove-g1"]').exists()).toBe(false)

    await wrapper.get('[data-test="gear-taking-remove-g4"]').trigger('click')
    await flushPromises()

    expect(mocks.removeTripGear).toHaveBeenCalledWith('1', 'g4')
    expect(wrapper.find('[data-test="gear-taking-item-g4"]').exists()).toBe(false)
    // Крестик не открыл карточку: удаление — не редактирование.
    expect(wrapper.find('[data-test="gear-item-dialog"]').exists()).toBe(false)
  })

  it('карточка вещи показывает характеристики, владельца и «кому едет»', async () => {
    const items = defaultItems().map((item) =>
      item.id === 'g1'
        ? {
            ...item,
            note: 'Тент отдельно',
            attributes: [
              {
                attributeId: 1,
                code: 'seats',
                name: 'Вместимость',
                valueKind: 'number' as const,
                unit: 'мест',
                value: 3,
              },
            ],
          }
        : item,
    )
    mocks.listTripGear.mockResolvedValue(tripGearList(items))

    const wrapper = await mounted()

    await wrapper.get('[data-test="gear-taking-item-g1"]').trigger('click')

    const card = wrapper.get('[data-test="gear-item-dialog"]')
    expect(card.get('[data-test="gear-item-title"]').text()).toBe('Палатка')
    expect(card.text()).toContain('2,6 кг')
    expect(card.text()).toContain('Вместимость')
    expect(card.text()).toContain('3 мест')
    expect(card.text()).toContain('Тент отдельно')
    expect(card.get('[data-test="gear-item-owner"]').text()).toBe('Анна')
    expect(
      (card.get('[data-test="gear-item-assignee"]').element as HTMLSelectElement).value,
    ).toBe(ME)

    // Заказчик: «визуально характеристики на мобиле помещаются в одну
    // строку. Нет?» — подпись и значение стоят рядом на любой ширине.
    expect(card.get('[data-test="gear-item-characteristics"] dl').classes()).toContain(
      'grid-cols-[auto_1fr]',
    )
  })

  it('ошибку правки показывает словами сервера', async () => {
    mocks.updateTripGear.mockRejectedValue(
      new ApiError(403, '«Берём / не берём» решает тот, кто ведёт снаряжение похода'),
    )

    const wrapper = await mounted(true)

    await wrapper.get('[data-test="gear-taking-item-g3"]').trigger('click')
    await wrapper.get('[data-test="gear-item-status-declined"]').trigger('click')
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
    expect(wrapper.find('[data-test="gear-backpack-public-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-backpack-personal-empty"]').exists()).toBe(true)
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
    expect(editor.get('summary').text()).toBe('Рекомендации участникам по личным вещам')
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

  it('пустая рекомендация не занимает строку в личном списке', async () => {
    mocks.listTripChecklists.mockResolvedValue({
      ...emptyChecklists(),
      recommendation: checklist('r1', 'recommendation', []),
      personal: checklist('p1', 'personal', [checklistItem('pi1', 'Спальник')]),
    })

    const wrapper = await mounted(true)
    const personal = wrapper.get('[data-test="gear-personal-checklist"]')

    // Заказчик: «Если их нет, то в Личном списке секцию рекомендаций
    // от организатора тоже не отображать».
    expect(personal.text()).not.toContain('Рекомендовано организатором')
    expect(personal.text()).toContain('Спальник')
    // А редактор рекомендации у организатора на месте: туда и добавляют.
    expect(wrapper.find('[data-test="gear-recommendation-section"]').exists()).toBe(true)
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

  // ───────────────────────── разделы «Берём» и «Взял» (05.11.2026) ─────────────────────────

  it('разделы из ответа показываются деревом, а вещи без раздела — в корне', async () => {
    const items = defaultItems().map((item) =>
      item.id === 'g2' ? { ...item, sharedSectionId: 's1' } : item,
    )
    mocks.listTripGear.mockResolvedValue(
      tripGearList(items, [
        tripGearSection({ id: 's1', title: 'Табор' }),
        tripGearSection({ id: 's2', title: 'Альпинизм', sortOrder: 20 }),
      ]),
    )

    const wrapper = await mounted(true)

    const tabor = wrapper.get('[data-test="gear-section-s1"]')
    expect(tabor.text()).toContain('Табор')
    expect(tabor.find('[data-test="gear-taking-item-g2"]').exists()).toBe(true)
    // Вещь без раздела осталась в корне, а не пропала.
    expect(wrapper.find('[data-test="gear-taking-item-g1"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gear-section-s2"]').text()).toContain('Альпинизм')
  })

  it('в разделе кнопка добавления говорит, куда именно добавит', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList(defaultItems(), [tripGearSection({ id: 's1', title: 'Табор' })]),
    )

    const wrapper = await mounted(true)

    // Заказчик: «измени текст кнопок в разделах с „Добавить снаряжение“
    // на „Добавить снаряжение в этот раздел“».
    expect(wrapper.get('[data-test="gear-section-add-item-s1"]').text()).toBe(
      'Добавить снаряжение в этот раздел',
    )
  })

  it('общественный раздел создаётся с корня и с подразделом', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList(defaultItems(), [tripGearSection({ id: 's1', title: 'Пешка' })]),
    )

    const wrapper = await mounted(true)

    await wrapper
      .get('[data-test="gear-taking-sections"] [data-test="gear-section-add-root"]')
      .trigger('click')
    await wrapper.get('[data-test="gear-section-create-title"]').setValue('Альпинизм')
    await wrapper.get('[data-test="gear-section-create-form"]').trigger('submit')
    await flushPromises()

    expect(mocks.createTripGearSection).toHaveBeenCalledWith('1', {
      scope: 'shared',
      title: 'Альпинизм',
      parentId: null,
    })
    expect(wrapper.text()).toContain('Альпинизм')

    // Подраздел: «+ Подраздел» живёт в инструментах раздела, за кнопкой «⋯».
    await wrapper.get('[data-test="gear-section-tools-s1"]').trigger('click')
    await wrapper.get('[data-test="gear-section-add-child-s1"]').trigger('click')
    await wrapper.get('[data-test="gear-section-create-child-title-s1"]').setValue('Верёвки')
    await wrapper
      .get('[data-test="gear-section-create-child-form-s1"]')
      .trigger('submit')
    await flushPromises()

    expect(mocks.createTripGearSection).toHaveBeenLastCalledWith('1', {
      scope: 'shared',
      title: 'Верёвки',
      parentId: 's1',
    })
  })

  it('личный раздел создаётся только в «Взял» и с личным видом', async () => {
    const wrapper = await mounted()

    await wrapper
      .get('[data-test="gear-taken-sections"] [data-test="gear-section-add-root"]')
      .trigger('click')
    await wrapper.get('[data-test="gear-section-create-title"]').setValue('Обувь')
    await wrapper.get('[data-test="gear-section-create-form"]').trigger('submit')
    await flushPromises()

    expect(mocks.createTripGearSection).toHaveBeenCalledWith('1', {
      scope: 'personal',
      title: 'Обувь',
      parentId: null,
    })
  })

  it('инструменты раздела прячутся за кнопкой в заголовке', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList(defaultItems(), [tripGearSection({ id: 's1', title: 'Пешка' })]),
    )

    const wrapper = await mounted(true)
    const section = wrapper.get('[data-test="gear-section-s1"]')

    expect(section.find('[data-test="gear-section-add-child-s1"]').exists()).toBe(false)
    expect(section.find('[data-test="gear-section-rename-open-s1"]').exists()).toBe(false)
    expect(section.find('[data-test="gear-section-remove-s1"]').exists()).toBe(false)

    const tools = section.get('[data-test="gear-section-tools-s1"]')
    expect(tools.attributes('aria-expanded')).toBe('false')

    await tools.trigger('click')

    expect(tools.attributes('aria-expanded')).toBe('true')
    expect(section.find('[data-test="gear-section-add-child-s1"]').exists()).toBe(true)
    expect(section.find('[data-test="gear-section-rename-open-s1"]').exists()).toBe(true)
    expect(section.find('[data-test="gear-section-remove-s1"]').exists()).toBe(true)

    await tools.trigger('click')

    expect(section.find('[data-test="gear-section-tools-panel-s1"]').exists()).toBe(false)
  })

  it('раздел переименовывается и удаляется с экрана', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList(defaultItems(), [tripGearSection({ id: 's1', title: 'Пешка' })]),
    )

    const wrapper = await mounted(true)
    await wrapper.get('[data-test="gear-section-tools-s1"]').trigger('click')
    await wrapper.get('[data-test="gear-section-rename-open-s1"]').trigger('click')
    await wrapper.get('[data-test="gear-section-rename-title-s1"]').setValue('Пешая часть')
    await wrapper.get('[data-test="gear-section-rename-s1"]').trigger('submit')
    await flushPromises()

    expect(mocks.updateTripGearSection).toHaveBeenCalledWith('1', 's1', {
      title: 'Пешая часть',
    })

    await wrapper.get('[data-test="gear-section-tools-s1"]').trigger('click')
    await wrapper.get('[data-test="gear-section-remove-s1"]').trigger('click')
    await flushPromises()

    expect(mocks.removeTripGearSection).toHaveBeenCalledWith('1', 's1')
    expect(wrapper.find('[data-test="gear-section-s1"]').exists()).toBe(false)
  })

  it('вещь переносится в раздел из карточки — путь для телефона', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList(defaultItems(), [tripGearSection({ id: 's1', title: 'Табор' })]),
    )

    const wrapper = await mounted(true)
    await wrapper.get('[data-test="gear-taking-item-g1"]').trigger('click')

    // Заказчик: «надпись „Раздел в «Берём»“ с толку сбивала кнопка „Берём“
    // над ней: упрости до „Раздел“».
    const label = wrapper.get('[data-test="gear-item-section"]').element.closest('label')
    expect(label?.textContent).toContain('Раздел')
    expect(label?.textContent).not.toContain('«Берём»')

    await wrapper.get('[data-test="gear-item-section"]').setValue('s1')
    await flushPromises()

    expect(mocks.updateTripGear).toHaveBeenCalledWith('1', 'g1', { sharedSectionId: 's1' })
  })

  it('спальник из «Ночёвок» стоит в разделе «в палатку»', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList(
        defaultItems(),
        [
          tripGearSection({
            id: 'p1',
            title: 'в палатку',
            scope: 'personal',
            ownerUserId: ME,
            templateCode: 'tent_inside',
          }),
        ],
        [sleepingRow('s1', 'Спальник зимний', 1200)],
      ),
    )

    const wrapper = await mounted()
    const block = wrapper.get('[data-test="gear-taken-sleeping"]')

    expect(block.text()).toContain('Спальник зимний')
    expect(block.text()).toContain('1,2 кг')
  })

  it('без прав на вкладку разделы «Берём» только читаются', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList(defaultItems(), [tripGearSection({ id: 's1', title: 'Табор' })]),
    )

    const wrapper = await mounted(false)
    const taking = wrapper.get('[data-test="gear-taking-sections"]')

    expect(taking.find('[data-test="gear-section-s1"]').exists()).toBe(true)
    expect(taking.find('[data-test="gear-section-tools-s1"]').exists()).toBe(false)
    expect(taking.find('[data-test="gear-section-add-root"]').exists()).toBe(false)

    // И в карточке нет ни раздела, ни статуса: раскладка и решение — право вкладки.
    await wrapper.get('[data-test="gear-taking-item-g1"]').trigger('click')
    expect(wrapper.find('[data-test="gear-item-section"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="gear-item-status-field"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="gear-item-status-words"]').text()).toContain('Берём')
  })

  // ───────────────────── чат и живые обновления (06.11.2026) ─────────────────────

  /** Обработчик, который вкладка отдала потоку событий, — после монтирования. */
  function liveHandler(): (event: TripEvent) => void {
    const call = mocks.subscribeTripEvents.mock.calls[0]
    if (!call) throw new Error('вкладка не подписалась на поток событий')

    return call[1] as (event: TripEvent) => void
  }

  /** Ждём склейку событий (300 мс) и доехавший ответ «тихого» запроса. */
  async function settleLive(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 350))
    await flushPromises()
  }

  it('чат снаряжения стоит на вкладке внизу и открывает свой вид чата', async () => {
    const wrapper = await mounted()

    // Чат — тема вкладки, как у «Питания» и «Ночёвок»: отдельной закладки
    // «Чаты» в проекте нет.
    const chat = wrapper.getComponent({ name: 'TripChat' })
    expect(chat.props('tripId')).toBe('1')
    expect(chat.props('kind')).toBe('trip_gear')

    // Внизу страницы: после «Личного снаряжения», а не перед работой.
    const children = Array.from(wrapper.get('[data-test="trip-gear"]').element.children)
    const personal = wrapper.get('[data-test="gear-personal-section"]').element
    const chatElement = wrapper.get('[data-test="trip-chat"]').element

    expect(children.indexOf(personal)).toBeLessThan(children.indexOf(chatElement))
  })

  it('чужое изменение перечитывает снаряжение само, без перезагрузки', async () => {
    const wrapper = await mounted()

    // Второй ответ сервера уже с перетащенным топором.
    mocks.listTripGear.mockResolvedValue(
      tripGearList(
        defaultItems().map((item) =>
          item.id === 'g2' ? { ...item, assignedUserId: ANNA } : item,
        ),
      ),
    )

    liveHandler()({ scope: 'gear', actorId: ANNA, at: new Date().toISOString() })
    await settleLive()

    expect(mocks.listTripGear).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-test="gear-bag-item-g2"]').exists()).toBe(true)
    // Экран не мигал «Загружаем снаряжение…»: тихое обновление не поднимает
    // общий флаг загрузки.
    expect(wrapper.find('[data-test="gear-loading"]').exists()).toBe(false)
  })

  it('чужое изменение чек-листа тоже доезжает', async () => {
    const wrapper = await mounted()

    mocks.listTripChecklists.mockResolvedValue({
      ...emptyChecklists(),
      shared: checklist('c9', 'trip', [checklistItem('n1', 'Пила')]),
    })

    liveHandler()({ scope: 'checklist', actorId: ANNA, at: new Date().toISOString() })
    await settleLive()

    expect(mocks.listTripChecklists).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Пила')
  })

  it('своё действие не перечитывает вкладку — ответ PATCH уже применён', async () => {
    await mounted()

    liveHandler()({ scope: 'gear', actorId: ME, at: new Date().toISOString() })
    await settleLive()

    expect(mocks.listTripGear).toHaveBeenCalledTimes(1)
  })

  // ───────────────── «Взял», рюкзаки и память секций (06.11.2026) ─────────────────

  it('впервые вкладка открывается со свёрнутыми секциями, а развёрнутость запоминается', async () => {
    const wrapper = await mounted()
    const section = wrapper.get('[data-test="gear-public-section"]')
    const details = section.element as HTMLDetailsElement

    expect(details.open).toBe(false)

    // Развернули «Общественное снаряжение» — состояние ушло в хранилище.
    details.open = true
    await section.trigger('toggle')
    await flushPromises()

    const stored = JSON.parse(
      window.localStorage.getItem('ph.tripGear.open.1') ?? '{}',
    ) as Record<string, boolean>
    expect(stored.shared).toBe(true)

    // Переключились на другую закладку и вернулись: состояние то же.
    wrapper.unmount()
    const again = await mounted()
    expect(
      (again.get('[data-test="gear-public-section"]').element as HTMLDetailsElement).open,
    ).toBe(true)
  })

  it('кнопка автораскладки называется «Распределить груз автоматически»', async () => {
    const wrapper = await mounted(true)

    expect(wrapper.get('[data-test="gear-distribute"]').text()).toBe(
      'Распределить груз автоматически',
    )
  })

  it('у личных вещей «Взял» есть крестик, и он убирает вещь из похода', async () => {
    const personal = tripGearItem({
      id: 'p1',
      gearItemId: 'cat-1',
      typeCode: 'clothes',
      typeName: 'Одежда',
      title: 'Куртка мембранная',
      ownerUserId: ME,
      assignedUserId: ME,
      weightGrams: 800,
      personalSectionId: 'sec-clothes',
    })

    mocks.listTripGear.mockResolvedValue(
      tripGearList(
        [],
        [
          tripGearSection({
            id: 'sec-clothes',
            title: 'Одежда',
            scope: 'personal',
            ownerUserId: ME,
            templateCode: 'clothes',
          }),
        ],
        [],
        [personal],
      ),
    )

    const wrapper = await mounted()

    expect(wrapper.find('[data-test="gear-taken-personal-p1"]').exists()).toBe(true)

    await wrapper.get('[data-test="gear-taken-remove-p1"]').trigger('click')
    await flushPromises()

    expect(mocks.removePersonalTripGear).toHaveBeenCalledWith('1', 'p1')
    expect(wrapper.find('[data-test="gear-taken-personal-p1"]').exists()).toBe(false)
  })

  it('«Добавить снаряжение в этот раздел» кладёт вещь в личный раздел', async () => {
    mocks.listTripGear.mockResolvedValue(
      tripGearList([], [
        tripGearSection({
          id: 'sec-clothes',
          title: 'Одежда',
          scope: 'personal',
          ownerUserId: ME,
          templateCode: 'clothes',
        }),
      ]),
    )
    mocks.listGear.mockResolvedValue({
      items: [
        gearItem({ id: 'cat-1', typeCode: 'clothes', typeName: 'Одежда', title: 'Куртка' }),
      ],
      totalWeightGrams: 0,
      itemsWithoutWeight: 0,
    })

    const wrapper = await mounted()

    await wrapper.get('[data-test="gear-section-add-item-sec-clothes"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="route-extra-picker"]').exists()).toBe(true)

    // Группы каталога в модалке свёрнуты: сначала раскрываем «Прочее».
    await wrapper.get('[data-test="route-extra-toggle-other"]').trigger('click')
    await wrapper.get('[data-test="route-extra-item-cat-1"]').trigger('click')
    await flushPromises()

    expect(mocks.addPersonalTripGear).toHaveBeenCalledWith('1', {
      gearItemId: 'cat-1',
      sectionId: 'sec-clothes',
    })
    expect(wrapper.find('[data-test="gear-taken-personal-personal-cat-1"]').exists()).toBe(true)
  })

  it('пакеты еды стоят в рюкзаках фиолетовыми пилюлями и считаются в весе', async () => {
    mocks.getTripGearLoad.mockResolvedValue(
      tripLoad({
        totalWeightGrams: 3800,
        backpacks: [
          loadBackpack(ME, {
            gear: [
              {
                kind: 'gear',
                id: 'g1',
                title: 'Палатка',
                weightGrams: 2600,
                assignedUserId: ME,
              },
            ],
            packages: [
              {
                kind: 'package',
                id: 'p9',
                title: 'Пакет 1',
                weightGrams: 1200,
                assignedUserId: ME,
              },
            ],
            gearWeightGrams: 2600,
            packagesWeightGrams: 1200,
            totalWeightGrams: 3800,
          }),
        ],
      }),
    )

    const wrapper = await mounted(true)
    const pill = wrapper.get('[data-test="gear-bag-package-p9"]')

    expect(pill.text()).toContain('Пакет 1')
    expect(pill.classes().join(' ')).toContain('violet')
    expect(wrapper.get(`[data-test="gear-bag-${ME}"]`).text()).toContain('Всего: 3,8 кг')
  })

  it('пакет перетаскивается в рюкзак своей ручкой, а не как вещь', async () => {
    mocks.getTripGearLoad.mockResolvedValue(
      tripLoad({
        totalWeightGrams: 1200,
        backpacks: [loadBackpack(ME), loadBackpack(ANNA)],
        unassigned: [
          {
            kind: 'package',
            id: 'p9',
            title: 'Пакет 1',
            weightGrams: 1200,
            assignedUserId: null,
          },
        ],
      }),
    )
    mocks.assignTripGearPackage.mockResolvedValue(tripLoad())

    const wrapper = await mounted()

    await wrapper.get('[data-test="gear-unassigned-package-p9"]').trigger('dragstart')
    await wrapper.get(`[data-test="gear-bag-${ANNA}"]`).trigger('drop')
    await flushPromises()

    expect(mocks.assignTripGearPackage).toHaveBeenCalledWith('1', 'p9', ANNA)
  })

  it('личная еда в «Моём рюкзаке» стоит в «Личном» с расчётным или фактическим весом', async () => {
    mocks.getTripGearLoad.mockResolvedValue(
      tripLoad({
        personal: {
          gearWeightGrams: 800,
          packagesWeightGrams: 1200,
          totalWeightGrams: 2000,
          gear: [
            { kind: 'personal', id: 'p1', title: 'Куртка мембранная', weightGrams: 800 },
          ],
          packages: [
            { id: 'pp1', name: 'Мой пакет', weightGrams: 1200, isActual: false },
          ],
        },
      }),
    )

    const wrapper = await mounted()
    const pack = wrapper.get('[data-test="gear-backpack-personal-package-pp1"]')

    expect(pack.text()).toContain('Мой пакет')
    expect(pack.text()).toContain('расчёт')
    expect(pack.text()).toContain('1,2 кг')
    expect(
      wrapper.get('[data-test="gear-backpack-personal"] summary').text(),
    ).toContain('Всего: 2 кг')
  })

  it('«Мои продукты» видны в «Личном», а фактический вес подменяет расчёт (09.11.2026)', async () => {
    // Заказчик: «в Личном рюкзаке не отображается пакет „Мои продукты“».
    // Вес «факт» вписывают в «Питании», он живёт в браузере — рюкзак
    // обязан прочитать ту же отметку, а не показывать расчёт.
    window.localStorage.setItem(`ph.myFoodWeight.1.${ME}`, '350')

    mocks.getTripGearLoad.mockResolvedValue(
      tripLoad({
        backpacks: [
          loadBackpack(ME, {
            gearWeightGrams: 2600,
            totalWeightGrams: 2600,
            gear: [
              {
                kind: 'gear',
                id: 'g1',
                title: 'Палатка',
                weightGrams: 2600,
                assignedUserId: ME,
              },
            ],
          }),
        ],
        personal: {
          gearWeightGrams: 0,
          packagesWeightGrams: 70,
          totalWeightGrams: 70,
          gear: [],
          packages: [
            { id: 'my-food', name: 'Мои продукты', weightGrams: 70, isActual: false },
          ],
        },
      }),
    )

    const wrapper = await mounted()
    const pack = wrapper.get('[data-test="gear-backpack-personal-package-my-food"]')

    expect(pack.text()).toContain('Мои продукты')
    expect(pack.text()).toContain('факт')
    expect(pack.text()).toContain('350 г')
    expect(
      wrapper.get('[data-test="gear-backpack-personal"] summary').text(),
    ).toContain('Всего: 350 г')
    // Главный итог — общественное плюс личное: 2600 + 350.
    expect(wrapper.get('[data-test="gear-backpack-total"]').text()).toBe(
      'Всего: 2,95 кг',
    )
  })

  it('«Мои продукты» без отметки показываются расчётным весом', async () => {
    mocks.getTripGearLoad.mockResolvedValue(
      tripLoad({
        personal: {
          gearWeightGrams: 0,
          packagesWeightGrams: 70,
          totalWeightGrams: 70,
          gear: [],
          packages: [
            { id: 'my-food', name: 'Мои продукты', weightGrams: 70, isActual: false },
          ],
        },
      }),
    )

    const wrapper = await mounted()
    const pack = wrapper.get('[data-test="gear-backpack-personal-package-my-food"]')

    expect(pack.text()).toContain('расчёт')
    expect(pack.text()).toContain('70 г')
    expect(wrapper.get('[data-test="gear-backpack-total"]').text()).toBe(
      'Всего: 70 г',
    )
  })
})
