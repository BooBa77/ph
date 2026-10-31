import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/api/types'
import type { GearItem, GearItemAttribute, TripGearItem } from '@/types/gear'
import type {
  ParticipantStatus,
  RouteLodger,
  RouteTraveler,
  Trip,
  TripParticipant,
  TripRoute,
} from '@/types/trips'
import TripRouteTents from '@/views/trips/TripRouteTents.vue'

/**
 * Секция «Палатки» (29.10.2026) — распределение участников по палаткам.
 *
 * **С 31.10.2026 «кто где живёт» — на сервере.** Раньше `TentMember` жил
 * в памяти компонента; теперь источник — ответ вкладки (`lodgers`), а посадка,
 * принятие заявки и освобождение места — ручки
 * `PUT/POST/DELETE /route/lodgers/:userId`.
 *
 * Поэтому спека держит **маленький фейк сервера**: он применяет те же правила
 * (себя в свою палатку или тому, кто ведёт вкладку, — сразу живёт; в чужую —
 * заявкой; убрать может каждый своё) и отвечает вкладкой целиком. Тесты
 * читают экран после ответа, как читал бы его человек.
 *
 * Что именно проверяется:
 *
 * - **вместимость не блокирует**: палатка на троих спокойно принимает
 *   четвёртого — «производитель рекомендует, а живут +1»;
 * - **заголовок плашки** — «{хозяин} {seats}-х местная {вес}гр.», и число
 *   мест берётся **из значения характеристики `seats`** (30.10.2026);
 * - **тип вместо слова в названии**: палатки — вещи типа `tent`, тенты —
 *   `shelter`; «Добавить тент» уходит на сервер, как и палатка;
 * - **распределяем только «идёт»**: «пока не решил», «приглашён» и «не идёт»
 *   места в палатке не занимают;
 * - **взял свою палатку — сразу живёшь в ней**: это одно действие с сервером,
 *   а не два разных («палатка в походе» и «место в ней»).
 *
 * Снаряжение похода секции отдаёт родитель (`TripRouteNights.vue`) — здесь
 * это пропс: второй такой же запрос из секции был бы лишним.
 */
const mocks = vi.hoisted(() => ({
  listParticipants: vi.fn(),
  lodgeRoute: vi.fn(),
  acceptRouteLodger: vi.fn(),
  releaseRouteLodger: vi.fn(),
  listGear: vi.fn(),
  proposeTripGear: vi.fn(),
  removeTripGear: vi.fn(),
  addManualTripGear: vi.fn(),
  fetchGearTypes: vi.fn(),
}))

vi.mock('@/api/trips', () => ({
  listParticipants: mocks.listParticipants,
  lodgeRoute: mocks.lodgeRoute,
  acceptRouteLodger: mocks.acceptRouteLodger,
  releaseRouteLodger: mocks.releaseRouteLodger,
}))

vi.mock('@/api/gear', () => ({
  listGear: mocks.listGear,
  proposeTripGear: mocks.proposeTripGear,
  removeTripGear: mocks.removeTripGear,
  addManualTripGear: mocks.addManualTripGear,
}))

vi.mock('@/api/gearTypes', () => ({ fetchGearTypes: mocks.fetchGearTypes }))

const ME = 'demo-me'
const ANNA = 'demo-anna'
const PETR = 'demo-petr'
const IVAN = 'demo-ivan'
const OLGA = 'demo-olga'

const ME_NAME = 'Олег'
const ANNA_NAME = 'Анна'

/**
 * Фейк сервера: снаряжение похода, распределение и права.
 *
 * Мутируется ручками ниже так же, как настоящий: `PUT` перезаписывает строку
 * человеку (у него одно место на поход), `POST .../accept` меняет статус,
 * `DELETE` убирает строку.
 */
const server = {
  gear: [] as TripGearItem[],
  lodgers: [] as RouteLodger[],
  travelers: [] as RouteTraveler[],
  canEdit: true,
}

/** Ответ «вкладки целиком» — ровно те поля, которые читает «Палатки». */
function payload(): TripRoute {
  return {
    canEdit: server.canEdit,
    nights: [],
    lodgers: server.lodgers.map((lodger) => ({ ...lodger })),
    travelers: server.travelers.map((traveler) => ({ ...traveler })),
  }
}

function travelerName(userId: string): string {
  return (
    server.travelers.find((traveler) => traveler.userId === userId)?.displayName ?? 'Участник'
  )
}

/**
 * Посадить человека — по правилу бэкенда: в свою палатку сразу живёт,
 * в чужую — заявкой (если не ведёт вкладку).
 */
function lodge(userId: string, tentGearId: string): void {
  const tent = server.gear.find((item) => item.id === tentGearId)
  const accepted = server.canEdit || tent?.ownerUserId === userId
  const row: RouteLodger = {
    userId,
    displayName: travelerName(userId),
    tentGearId,
    status: accepted ? 'accepted' : 'requested',
  }

  server.lodgers = [...server.lodgers.filter((lodger) => lodger.userId !== userId), row]
}

function makeUser(): User {
  return {
    id: ME,
    displayName: ME_NAME,
    location: null,
    avatarUrl: null,
    gender: 'm',
    isVegetarian: false,
    allergies: null,
    sportExperience: null,
    isAdmin: false,
  }
}

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: '1',
    organizerUserId: ME,
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
    ...overrides,
  }
}

function participant(
  userId: string,
  displayName: string,
  status: ParticipantStatus = 'going',
): TripParticipant {
  return {
    userId,
    displayName,
    avatarUrl: null,
    status,
    roles: [],
    isOrganizer: false,
    isVirtual: false,
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
  }
}

/** Состав: двое идут, остальные — по одному в каждом «не идущем» статусе. */
function makePeople(): TripParticipant[] {
  return [
    participant(ME, ME_NAME, 'going'),
    participant(ANNA, ANNA_NAME, 'going'),
    participant(PETR, 'Пётр', 'maybe'),
    participant(IVAN, 'Иван', 'declined'),
    participant(OLGA, 'Ольга', 'invited'),
  ]
}

/** Значение характеристики, как его отдаёт API: `seats` — число. */
function attribute(code: string, name: string, value: number | string): GearItemAttribute {
  return {
    attributeId: code === 'seats' ? 1 : 2,
    code,
    name,
    valueKind: typeof value === 'number' ? 'number' : 'text',
    unit: null,
    value,
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
    assignedUserId: null,
    createdAt: '2026-10-29T10:00:00.000Z',
    ...overrides,
  }
}

/** Палатка Анны — единственная, что «берём»: с неё начинается каждый тест. */
function annaTent(): TripGearItem {
  return tripGearItem({
    id: 'g1',
    gearItemId: '10',
    typeCode: 'tent',
    typeName: 'Палатка',
    title: 'Палатка на четверых',
    ownerUserId: ANNA,
    weightGrams: 2400,
    attributes: [attribute('seats', 'Вместимость', 3)],
  })
}

/** Анна уже живёт в своей палатке — так распределение выглядит на экране. */
function annaLodger(): RouteLodger {
  return { userId: ANNA, displayName: ANNA_NAME, tentGearId: 'g1', status: 'accepted' }
}

function gearList(items: GearItem[]): {
  items: GearItem[]
  totalWeightGrams: number
  itemsWithoutWeight: number
} {
  return { items, totalWeightGrams: 0, itemsWithoutWeight: 0 }
}

/** Вещь личного каталога: тип задаётся кодом, вместимость — значением `seats`. */
function personalGear(
  id: string,
  title: string,
  typeCode: 'tent' | 'shelter' | 'other' = 'tent',
  seats: number | null = null,
): GearItem {
  return {
    id,
    typeId: 1,
    typeCode,
    typeName: typeCode === 'shelter' ? 'Тент' : typeCode === 'tent' ? 'Палатка' : 'Прочее',
    groupId: 1,
    groupCode: 'roof',
    groupName: 'Кров',
    sortOrder: 10,
    attributes: seats === null ? [] : [attribute('seats', 'Вместимость', seats)],
    title,
    weightGrams: null,
    note: null,
    createdAt: '2026-10-20T10:00:00.000Z',
  }
}

interface MountOptions {
  trip?: Trip
  /** Снаряжение похода: то, что родитель уже загрузил. */
  gear?: TripGearItem[]
  /** Ошибка загрузки снаряжения: секция объясняет пустоту, а не молчит. */
  gearError?: string | null
  lodgers?: RouteLodger[]
  /** Право на вкладку: чужие места правят только ведущие вкладку. */
  canEdit?: boolean
}

/**
 * Смонтировать секцию так, как её монтирует родитель.
 *
 * Обёртка держит `gear` и `lodgers` в своём состоянии и обновляет их
 * по событиям `gear` и `route`: без этого ответ сервера не доехал бы
 * до пропсов, и экран показывал бы прежнее распределение.
 */
async function mounted(options: MountOptions = {}): Promise<ReturnType<typeof mount>> {
  const trip = options.trip ?? makeTrip()

  server.gear = options.gear ?? [annaTent()]
  server.lodgers = options.lodgers ?? [annaLodger()]
  server.canEdit = options.canEdit ?? true

  const gear = ref<TripGearItem[]>(server.gear)
  const lodgers = ref<RouteLodger[]>(server.lodgers)

  const Parent = defineComponent({
    setup() {
      return () =>
        h(TripRouteTents, {
          trip,
          gear: gear.value,
          gearError: options.gearError ?? null,
          lodgers: lodgers.value,
          travelers: server.travelers,
          canEdit: server.canEdit,
          onGear: (items: TripGearItem[]) => {
            gear.value = items
            server.gear = items
          },
          onRoute: (route: TripRoute) => {
            lodgers.value = route.lodgers
          },
        })
    },
  })

  const wrapper = mount(Parent)
  await flushPromises()

  return wrapper
}

/** Состав похода — он же «кого можно посадить»: только идущие. */
function setPeople(people: TripParticipant[] = makePeople()): void {
  mocks.listParticipants.mockResolvedValue(people)
  server.travelers = people
    .filter((person) => person.status === 'going')
    .map((person) => ({ userId: person.userId, displayName: person.displayName }))
}

/** Подписи всех плашек по порядку: удобно и читаемо в проверках. */
function tentTitles(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('[data-test="route-tent-title"]').map((node) => node.text())
}

/** Подписи «кто живёт» всех плашек по порядку. */
function tentSummaries(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('[data-test="route-tent-summary"]').map((node) => node.text())
}

describe('секция «Палатки»', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    useAuthStore().setAuth(makeUser(), 'token')

    setPeople()
    mocks.listGear.mockResolvedValue(gearList([]))
    mocks.removeTripGear.mockResolvedValue(undefined)
    // Типы контекста «Палаток»: палатка (с обязательной вместимостью) и тент.
    mocks.fetchGearTypes.mockResolvedValue([
      {
        id: 1,
        code: 'tent',
        name: 'Палатка',
        sortOrder: 1,
        attributes: [
          {
            id: 11,
            code: 'seats',
            name: 'Вместимость',
            valueKind: 'number',
            unit: 'мест',
            allowCustomValue: false,
            isRequired: true,
            sortOrder: 0,
            options: [],
          },
        ],
      },
      { id: 2, code: 'shelter', name: 'Тент', sortOrder: 2, attributes: [] },
    ])

    // Фейк сервера: каждая ручка меняет распределение и отвечает вкладкой.
    mocks.lodgeRoute.mockImplementation(
      async (_tripId: string, userId: string, tentGearId: string) => {
        lodge(userId, tentGearId)

        return payload()
      },
    )
    mocks.acceptRouteLodger.mockImplementation(async (_tripId: string, userId: string) => {
      server.lodgers = server.lodgers.map((lodger) =>
        lodger.userId === userId ? { ...lodger, status: 'accepted' } : lodger,
      )

      return payload()
    })
    mocks.releaseRouteLodger.mockImplementation(async (_tripId: string, userId: string) => {
      server.lodgers = server.lodgers.filter((lodger) => lodger.userId !== userId)

      return payload()
    })
  })

  it('палатка — только тип «палатка» и только «берём»', async () => {
    const wrapper = await mounted({
      gear: [
        annaTent(),
        tripGearItem({
          id: 'g2',
          gearItemId: '11',
          typeCode: 'tent',
          typeName: 'Палатка',
          title: 'Палатка, которую не берём',
          ownerUserId: PETR,
          status: 'declined',
        }),
        tripGearItem({
          id: 'g3',
          gearItemId: '12',
          typeCode: 'sleeping_bag',
          typeName: 'Спальник',
          title: 'Спальник',
          ownerUserId: ME,
        }),
      ],
    })

    expect(tentTitles(wrapper)).toEqual(['Анна 3-х местная 2400 гр.'])
  })

  it('без веса в заголовке нет «гр.»: «Анна 3-х местная»', async () => {
    const wrapper = await mounted({ gear: [{ ...annaTent(), weightGrams: null }] })

    expect(wrapper.get('[data-test="route-tent-title"]').text()).toBe('Анна 3-х местная')
  })

  it('заголовок плашки — «{хозяин} {seats}-х местная {вес}гр.»', async () => {
    const wrapper = await mounted()

    expect(wrapper.get('[data-test="route-tent-title"]').text()).toBe(
      'Анна 3-х местная 2400 гр.',
    )
  })

  it('кто живёт — из ответа сервера, а заявки отдельно от жильцов', async () => {
    const wrapper = await mounted({
      lodgers: [
        annaLodger(),
        { userId: ME, displayName: ME_NAME, tentGearId: 'g1', status: 'requested' },
      ],
    })

    // Заявка места не занимает: в пилюлях только те, кто живёт.
    expect(wrapper.get('[data-test="route-tent-summary"]').text()).toBe('живёт 1 (Анна)')
    expect(wrapper.get('[data-test="route-tent-requests"]').text()).toContain('Олег')
  })

  it('вместимость не заполнена — не выдумываем: «Анна 2400 гр.» и никакой пометки', async () => {
    setPeople([
      ...makePeople(),
      participant('demo-vasya', 'Вася'),
      participant('demo-katya', 'Катя'),
    ])

    const wrapper = await mounted({ gear: [{ ...annaTent(), attributes: [] }] })

    expect(wrapper.get('[data-test="route-tent-title"]').text()).toBe('Анна 2400 гр.')

    // Вместимости нет — «сверх вместимости» сказать нечего, и не говорим.
    await wrapper.get('[data-test="route-tent-add-member"]').setValue('demo-vasya')
    await flushPromises()
    await wrapper.get('[data-test="route-tent-add-member"]').setValue('demo-katya')
    await flushPromises()

    expect(wrapper.find('[data-test="route-tent-over"]').exists()).toBe(false)
  })

  it('«Добавить тент» берёт вещь типа «Тент» и уводит её в поход', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([
        personalGear('60', 'Тент 3×4', 'shelter'),
        personalGear('61', 'Аптечка', 'other'),
      ]),
    )
    mocks.proposeTripGear.mockResolvedValue(
      tripGearItem({
        id: 'g60',
        gearItemId: '60',
        typeCode: 'shelter',
        typeName: 'Тент',
        title: 'Тент 3×4',
        ownerUserId: ME,
        weightGrams: 3000,
      }),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-awning"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="route-awning-dialog"]').exists()).toBe(true)
    // В списке только тенты: тип решает, а не слово в названии.
    expect(
      wrapper
        .get('[data-test="route-awning-gear"]')
        .findAll('option')
        .map((node) => node.text()),
    ).toEqual(['выберите…', 'Тент 3×4'])

    await wrapper.get('[data-test="route-awning-gear"]').setValue('60')
    await wrapper.get('[data-test="route-awning-save"]').trigger('click')
    await flushPromises()

    expect(mocks.proposeTripGear).toHaveBeenCalledWith('1', '60')
    expect(wrapper.find('[data-test="route-awning-dialog"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="route-awning"] span').text()).toBe('Тент - 3000 гр. (Олег)')
    // Тент — вещь похода, а не строка на экране: плашек палаток он не создаёт.
    expect(wrapper.findAll('[data-test="route-tent"]')).toHaveLength(1)
  })

  it('тент приходит и при загрузке: вещь типа shelter из снаряжения похода', async () => {
    const wrapper = await mounted({
      gear: [
        annaTent(),
        tripGearItem({
          id: 'g60',
          gearItemId: '60',
          typeCode: 'shelter',
          typeName: 'Тент',
          title: 'Тент 3×4',
          ownerUserId: ME,
          weightGrams: 3000,
        }),
      ],
    })

    expect(wrapper.get('[data-test="route-awning"] span').text()).toBe('Тент - 3000 гр. (Олег)')
    expect(wrapper.findAll('[data-test="route-tent"]')).toHaveLength(1)
  })

  it('кнопки цветут по состоянию: палатка — пока не распределён, тент — пока его нет', async () => {
    mocks.listGear.mockResolvedValue(gearList([personalGear('60', 'Тент', 'shelter')]))
    mocks.proposeTripGear.mockResolvedValue(
      tripGearItem({
        id: 'g60',
        gearItemId: '60',
        typeCode: 'shelter',
        typeName: 'Тент',
        title: 'Тент',
        ownerUserId: ME,
      }),
    )

    const wrapper = await mounted()

    // Олег нигде не живёт, тента в секции нет — обе кнопки цветные.
    expect(wrapper.get('[data-test="route-tent-add"]').classes()).toContain('bg-emerald-600')
    expect(wrapper.get('[data-test="route-tent-awning"]').classes()).toContain('bg-emerald-600')

    // Взял тент — его кнопка стала белой.
    await wrapper.get('[data-test="route-tent-awning"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="route-awning-gear"]').setValue('60')
    await wrapper.get('[data-test="route-awning-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="route-tent-awning"]').classes()).toContain('bg-field')

    // Занял место в палатке Анны — место есть, кнопка белая.
    await wrapper.get('[data-test="route-tent-add-member"]').setValue(ME)
    await flushPromises()

    expect(wrapper.get('[data-test="route-tent-add"]').classes()).toContain('bg-field')
  })

  it('«Попроситься» — белая и зовёт ручку посадки', async () => {
    const wrapper = await mounted({ canEdit: false })

    const join = wrapper.get('[data-test="route-tent-join"]')
    expect(join.text()).toBe('Попроситься')
    expect(join.classes()).toContain('bg-field')
    expect(join.classes()).not.toContain('bg-primary')

    await join.trigger('click')
    await flushPromises()

    expect(mocks.lodgeRoute).toHaveBeenCalledWith('1', ME, 'g1')
  })

  it('владелец убирает свою палатку крестиком: настоящий DELETE', async () => {
    const wrapper = await mounted({
      trip: makeTrip({ organizerUserId: ANNA }),
      gear: [
        tripGearItem({
          id: 'g9',
          gearItemId: '19',
          typeCode: 'tent',
          typeName: 'Палатка',
          title: 'Палатка Олега',
          ownerUserId: ME,
        }),
      ],
      lodgers: [],
    })

    await wrapper.get('[data-test="route-tent-remove-g9"]').trigger('click')
    await flushPromises()

    expect(mocks.removeTripGear).toHaveBeenCalledWith('1', 'g9')
    expect(wrapper.findAll('[data-test="route-tent"]')).toHaveLength(0)
    expect(wrapper.find('[data-test="route-tents-empty"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="route-tents-unassigned"]').text()).toContain('Олег')
  })

  it('организатор убирает чужую палатку тем же DELETE', async () => {
    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-remove-g1"]').trigger('click')
    await flushPromises()

    expect(mocks.removeTripGear).toHaveBeenCalledWith('1', 'g1')
    expect(wrapper.findAll('[data-test="route-tent"]')).toHaveLength(0)
  })

  it('сервер отказал в удалении — текст ошибки, палатка на месте', async () => {
    mocks.removeTripGear.mockRejectedValue(
      new ApiError(403, 'Чужую вещь убирает владелец или тот, кто ведёт снаряжение похода'),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-remove-g1"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="route-tents-remove-error"]').text()).toContain(
      'тот, кто ведёт снаряжение',
    )
    expect(wrapper.findAll('[data-test="route-tent"]')).toHaveLength(1)
  })

  it('постороннему участнику крестика палатки нет', async () => {
    const wrapper = await mounted({ canEdit: false })

    expect(wrapper.find('[data-test="route-tent-remove-g1"]').exists()).toBe(false)
  })

  it('«не распределены» — только идущие: «пока не решил» и остальные не в счёте', async () => {
    const wrapper = await mounted()
    const unassigned = wrapper.get('[data-test="route-tents-unassigned"]')

    expect(unassigned.text()).toContain('Олег')
    expect(unassigned.text()).not.toContain('Пётр')
    expect(unassigned.text()).not.toContain('Ольга')
    expect(unassigned.text()).not.toContain('Иван')
  })

  it('«взять в палатку» предлагает только идущих', async () => {
    const wrapper = await mounted()

    const options = wrapper
      .get('[data-test="route-tent-add-member"]')
      .findAll('option')
      .map((option) => option.text())

    expect(options).toEqual(['взять в палатку…', 'Олег'])
  })

  it('владелец зовёт человека, и селект возвращается в пустое состояние', async () => {
    // Ещё один идущий: с одним селект после добавления исчез бы, и «сброс»
    // было бы не на чем проверить.
    setPeople([...makePeople(), participant('demo-vasya', 'Вася')])

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-add-member"]').setValue(ME)
    await flushPromises()

    expect(mocks.lodgeRoute).toHaveBeenCalledWith('1', ME, 'g1')
    expect(wrapper.get('[data-test="route-tent-summary"]').text()).toBe('живут 2 (Анна, Олег)')
    expect(wrapper.get('[data-test="route-tents-unassigned"]').text()).toContain('Вася')

    const select = wrapper.get('[data-test="route-tent-add-member"]')
    expect((select.element as HTMLSelectElement).value).toBe('')
    // Только что добавленного в списке больше нет.
    expect(select.findAll('option').map((option) => option.text())).toEqual([
      'взять в палатку…',
      'Вася',
    ])
  })

  it('владельца из палатки не убрать, остальных — можно', async () => {
    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-add-member"]').setValue(ME)
    await flushPromises()

    // У Анны крестика нет: палатка уходит из похода вместе с ней.
    expect(wrapper.find(`[data-test="route-tent-leave-${ANNA}"]`).exists()).toBe(false)

    await wrapper.get(`[data-test="route-tent-leave-${ME}"]`).trigger('click')
    await flushPromises()

    expect(mocks.releaseRouteLodger).toHaveBeenCalledWith('1', ME)
    expect(wrapper.get('[data-test="route-tent-summary"]').text()).toBe('живёт 1 (Анна)')
    expect(wrapper.get('[data-test="route-tents-unassigned"]').text()).toContain('Олег')
  })

  it('в чужую палатку просятся, а не входят сразу; заявку можно отменить', async () => {
    // Олег не ведёт вкладку и палатка не его: место только заявкой.
    const wrapper = await mounted({ canEdit: false })

    expect(wrapper.get('[data-test="route-tent-join"]').text()).toBe('Попроситься')

    await wrapper.get('[data-test="route-tent-join"]').trigger('click')
    await flushPromises()

    const requests = wrapper.get('[data-test="route-tent-requests"]')
    expect(requests.text()).toContain('Олег')
    // Место в палатке заявка не занимает: в пилюлях спящих Олега нет.
    expect(wrapper.get('[data-test="route-tent-summary"]').text()).toBe('живёт 1 (Анна)')
    expect(wrapper.findAll('[data-test^="route-tent-accept-"]')).toHaveLength(0)
    expect(wrapper.find('[data-test="route-tent-add-member"]').exists()).toBe(false)

    await wrapper.get(`[data-test="route-tent-leave-${ME}"]`).trigger('click')
    await flushPromises()

    expect(mocks.releaseRouteLodger).toHaveBeenCalledWith('1', ME)
    expect(wrapper.find('[data-test="route-tent-requests"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="route-tent-join"]').exists()).toBe(true)
  })

  it('заявку принимают те, кто правит палатку', async () => {
    const wrapper = await mounted({
      lodgers: [
        annaLodger(),
        { userId: ME, displayName: ME_NAME, tentGearId: 'g1', status: 'requested' },
      ],
    })

    await wrapper.get(`[data-test="route-tent-accept-${ME}"]`).trigger('click')
    await flushPromises()

    expect(mocks.acceptRouteLodger).toHaveBeenCalledWith('1', ME)
    expect(wrapper.get('[data-test="route-tent-summary"]').text()).toBe('живут 2 (Анна, Олег)')
    expect(wrapper.find('[data-test="route-tent-requests"]').exists()).toBe(false)
    expect(wrapper.find(`[data-test="route-tent-leave-${ME}"]`).exists()).toBe(true)
  })

  it('заявку можно отклонить — человек возвращается в «не распределены»', async () => {
    const wrapper = await mounted({
      lodgers: [
        annaLodger(),
        { userId: ME, displayName: ME_NAME, tentGearId: 'g1', status: 'requested' },
      ],
    })

    await wrapper.get(`[data-test="route-tent-reject-${ME}"]`).trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="route-tent-requests"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="route-tents-unassigned"]').text()).toContain('Олег')
  })

  it('вместимость не блокирует: 3-х местная принимает четвёртого', async () => {
    setPeople([
      ...makePeople(),
      participant('demo-vasya', 'Вася'),
      participant('demo-katya', 'Катя'),
      participant('demo-lena', 'Лена'),
    ])

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-add-member"]').setValue('demo-vasya')
    await flushPromises()
    await wrapper.get('[data-test="route-tent-add-member"]').setValue('demo-katya')
    await flushPromises()
    await wrapper.get('[data-test="route-tent-add-member"]').setValue('demo-lena')
    await flushPromises()

    expect(wrapper.get('[data-test="route-tent-summary"]').text()).toBe(
      'живут 4 (Анна, Вася, Катя, Лена)',
    )
    expect(wrapper.get('[data-test="route-tent-over"]').text()).toBe('сверх вместимости')
    expect(wrapper.text()).not.toContain('мест нет')
  })

  it('пусто: палаток нет — подсказка и кнопка «Добавить свою палатку»', async () => {
    const wrapper = await mounted({ gear: [], lodgers: [] })

    expect(wrapper.get('[data-test="route-tents-empty"]').text()).toContain(
      'Пока никто не взял палатку',
    )
    expect(wrapper.find('[data-test="route-tent-add"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="route-tents-unassigned"]').text()).toContain('Олег')
  })

  it('своя палатка: вместимость — значение seats, и человек сразу живёт в ней', async () => {
    mocks.listGear.mockResolvedValue(
      gearList([
        personalGear('20', 'Палатка на пятерых', 'tent', 5),
        personalGear('21', 'Односкатка', 'tent', 1),
      ]),
    )
    mocks.proposeTripGear
      .mockResolvedValueOnce(
        tripGearItem({
          id: 'g20',
          gearItemId: '20',
          typeCode: 'tent',
          typeName: 'Палатка',
          title: 'Палатка на пятерых',
          ownerUserId: ME,
          weightGrams: 1000,
          attributes: [attribute('seats', 'Вместимость', 5)],
        }),
      )
      .mockResolvedValueOnce(
        tripGearItem({
          id: 'g21',
          gearItemId: '21',
          typeCode: 'tent',
          typeName: 'Палатка',
          title: 'Односкатка',
          ownerUserId: ME,
          attributes: [attribute('seats', 'Вместимость', 1)],
        }),
      )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-add"]').trigger('click')
    await flushPromises()

    // Поля вместимости в диалоге нет: это характеристика вещи.
    expect(wrapper.find('[data-test="route-tent-capacity"]').exists()).toBe(false)

    await wrapper.get('[data-test="route-tent-gear"]').setValue('20')
    await wrapper.get('[data-test="route-tent-save"]').trigger('click')
    await flushPromises()

    expect(mocks.proposeTripGear).toHaveBeenCalledWith('1', '20')
    expect(wrapper.find('[data-test="route-tent-dialog"]').exists()).toBe(false)
    expect(tentTitles(wrapper)).toContain('Олег 5-местная 1000 гр.')

    // Палатку берут, чтобы в ней спать: место занимает та же цепочка действий.
    expect(mocks.lodgeRoute).toHaveBeenCalledWith('1', ME, 'g20')
    expect(tentSummaries(wrapper)).toContain('живёт 1 (Олег)')

    // Вторая палатка — на одного и без веса: «одноместная», а не «1-х
    // местная», и без «гр.», которого не из чего взять.
    await wrapper.get('[data-test="route-tent-add"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-test="route-tent-gear"]').setValue('21')
    await wrapper.get('[data-test="route-tent-save"]').trigger('click')
    await flushPromises()

    expect(tentTitles(wrapper)).toContain('Олег одноместная')
  })

  it('своя палатка без вместимости: подсказка в диалоге, заголовок без числа', async () => {
    mocks.listGear.mockResolvedValue(gearList([personalGear('20', 'Старая палатка', 'tent')]))
    mocks.proposeTripGear.mockResolvedValue(
      tripGearItem({
        id: 'g20',
        gearItemId: '20',
        typeCode: 'tent',
        typeName: 'Палатка',
        title: 'Старая палатка',
        ownerUserId: ME,
        weightGrams: 1800,
      }),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-add"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-test="route-tent-gear"]').setValue('20')

    expect(wrapper.get('[data-test="route-tent-no-capacity"]').text()).toContain(
      'не заполнена вместимость',
    )

    await wrapper.get('[data-test="route-tent-save"]').trigger('click')
    await flushPromises()

    expect(tentTitles(wrapper)).toEqual(['Анна 3-х местная 2400 гр.', 'Олег 1800 гр.'])
  })

  it('в списке нет палаток, которые уже взяли в поход', async () => {
    // Предмет каталога 10 уже едет в походе (палатка Анны) — своей она быть
    // не может, но принцип тот же: занятые в списке не предлагаются.
    mocks.listGear.mockResolvedValue(
      gearList([
        personalGear('10', 'Моя палатка', 'tent', 3),
        personalGear('30', 'Спальник', 'other'),
      ]),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-add"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="route-tent-no-gear"]').text()).toContain('Свободной палатки')
  })

  it('ошибка добавления видна в модалке, а не под затемнением', async () => {
    mocks.listGear.mockResolvedValue(gearList([personalGear('20', 'Палатка', 'tent', 3)]))
    mocks.proposeTripGear.mockRejectedValue(new ApiError(400, 'Эта палатка уже в походе'))

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-add"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-test="route-tent-gear"]').setValue('20')
    await wrapper.get('[data-test="route-tent-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="route-tent-dialog"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="route-tent-error"]').text()).toBe('Эта палатка уже в походе')
  })

  it('снаряжение не загрузилось — сообщение, а не пустая зелёная секция', async () => {
    const wrapper = await mounted({ gear: [], gearError: 'Снаряжение недоступно' })

    expect(wrapper.get('[data-test="route-tents-error"]').text()).toBe('Снаряжение недоступно')
    expect(wrapper.find('[data-test="route-tent-add"]').exists()).toBe(false)
  })

  /**
   * «Указать вручную» (31.10.2026): палатки в каталоге нет, а в поход
   * она нужна. Модалка спрашивает характеристики, вещь уходит в снаряжение
   * похода, и плашка собирается из общего списка — как у любой другой вещи.
   */
  it('«Указать вручную» добавляет палатку в распределение', async () => {
    mocks.addManualTripGear.mockResolvedValue(
      tripGearItem({
        id: 'g-manual',
        gearItemId: 'gi-manual',
        typeCode: 'tent',
        typeName: 'Палатка',
        title: 'Палатка',
        ownerUserId: ME,
        weightGrams: 2400,
        isTripOnly: true,
        attributes: [attribute('seats', 'Вместимость', 2)],
      }),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-add"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="route-tent-manual"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-test="manual-seats"]').setValue('2')
    await wrapper.get('[data-test="manual-save"]').trigger('click')
    await flushPromises()

    expect(mocks.addManualTripGear).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ typeId: 1, addToCatalog: false }),
    )
    expect(tentTitles(wrapper)).toContain('Олег 2-х местная 2400 гр.')
  })

  /**
   * Тент — второй тип контекста «Палаток»: кнопка в диалоге тента открывает
   * ту же модалку с типом `shelter`, и пилюля собирается из ответа сервера.
   */
  it('«Указать вручную» из диалога тента добавляет тент пилюлей', async () => {
    mocks.addManualTripGear.mockResolvedValue(
      tripGearItem({
        id: 'g-awning',
        gearItemId: 'gi-awning',
        typeCode: 'shelter',
        typeName: 'Тент',
        title: 'Тент',
        ownerUserId: ME,
        isTripOnly: true,
      }),
    )

    const wrapper = await mounted()

    await wrapper.get('[data-test="route-tent-awning"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="route-awning-manual"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-test="manual-save"]').trigger('click')
    await flushPromises()

    expect(mocks.addManualTripGear).toHaveBeenCalledWith('1', expect.objectContaining({ typeId: 2 }))
    // В тексте пилюли есть и крестик — проверяем подпись, а не весь узел.
    const awningTexts = wrapper.findAll('[data-test="route-awning"]').map((node) => node.text())

    expect(awningTexts.some((text) => text.startsWith('Тент (Олег)'))).toBe(true)
  })
})
