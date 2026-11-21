import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OfflineError } from '@/api/errors'
import type { TripDiaryEntry } from '@/types/diary'
import type { Trip, TripParticipant } from '@/types/trips'
import { tripDayNumber } from '@/utils/tripDay'
import TripDiaryView from '@/views/trips/TripDiary.vue'

/**
 * Вкладка «Дневник» (16.11.2026).
 *
 * Проверяем то, что заказчик назвал словами: личные записи, «большой чат»,
 * кнопки вставки времени, даты и дня похода, упоминание участника и работа
 * без связи с отправкой при её возврате.
 *
 * Очередь настоящая (`offline/diaryOutbox`), подменены её границы:
 * IndexedDB — картой в памяти, API — шпионами. Так проверяется именно
 * сценарий «написал без связи → уехало, когда связь появилась».
 */
const mocks = vi.hoisted(() => ({
  getTripDiary: vi.fn(),
  syncTripDiary: vi.fn(),
  listParticipants: vi.fn(),
  push: vi.fn(),
  subscribe: vi.fn(),
  offline: { isOnline: true },
  state: new Map<string, unknown>(),
}))

vi.mock('@/api/diary', () => ({
  getTripDiary: mocks.getTripDiary,
  syncTripDiary: mocks.syncTripDiary,
}))

vi.mock('@/api/trips', () => ({
  listParticipants: mocks.listParticipants,
}))

vi.mock('@/api/events', () => ({
  subscribeTripEvents: mocks.subscribe,
}))

vi.mock('@/stores/offline', () => ({
  useOfflineStore: () => mocks.offline,
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: { id: 'me' } }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('@/offline/indexedDb', () => ({
  RESPONSES_STORE: 'responses',
  STATE_STORE: 'state',
  getRecord: async (store: string, key: string) => {
    const source = mocks.state as Map<string, unknown>
    const fullKey = `${store}:${key}`
    return source.get(fullKey) ?? null
  },
  putRecord: async (store: string, value: Record<string, unknown>) => {
    const key = store === 'responses' ? String(value.path) : String(value.key)
    mocks.state.set(`${store}:${key}`, value)
    return true
  },
  deleteRecord: async (store: string, key: string) => {
    mocks.state.delete(`${store}:${key}`)
  },
  getAllRecords: async () => [...mocks.state.values()],
  deleteByIndex: async () => undefined,
  clearStore: async () => undefined,
}))

/** Редактор подменяем: у настоящего contenteditable-механика на Range. */
const MarkdownEditorStub = defineComponent({
  name: 'MarkdownEditor',
  props: {
    modelValue: { type: String, default: '' },
    participants: { type: Array, default: () => [] },
  },
  emits: ['update:modelValue'],
  setup(props, { emit, expose }) {
    expose({
      insertText: (text: string) => {
        emit('update:modelValue', `${props.modelValue}${text}`)
      },
    })
    return () => h('div', { 'data-test': 'md-editor' })
  },
})

const ME = 'me'

function local(month: number, day: number, hours = 10): string {
  return new Date(2026, month - 1, day, hours).toISOString()
}

function makeTrip(): Trip {
  return {
    id: '679',
    organizerUserId: 'org-1',
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
    startsAt: local(11, 14),
    endsAt: local(11, 18),
    dateVariants: [],
    isCommercial: false,
    isOfficial: false,
    openParticipation: true,
    priceRub: null,
    priceNote: null,
    cancelledAt: null,
    createdAt: local(11, 1),
    updatedAt: local(11, 1),
  }
}

function entry(overrides: Partial<TripDiaryEntry> = {}): TripDiaryEntry {
  return {
    id: '4c1f3a84-1111-4111-8111-111111111111',
    body: 'Дошли до озера.',
    createdAt: local(11, 16, 12),
    updatedAt: local(11, 16, 12),
    ...overrides,
  }
}

function person(overrides: Partial<TripParticipant> = {}): TripParticipant {
  return {
    userId: 'u-1',
    displayName: 'Анна',
    avatarUrl: null,
    status: 'going',
    roles: [],
    isOrganizer: false,
    isVirtual: false,
    createdAt: local(11, 1),
    updatedAt: local(11, 1),
    ...overrides,
  }
}

async function mountDiary() {
  const wrapper = mount(TripDiaryView, {
    props: { trip: makeTrip() },
    global: {
      stubs: { MarkdownEditor: MarkdownEditorStub },
      plugins: [createPinia()],
    },
  })
  await flushPromises()

  return wrapper
}

describe('вкладка «Дневник»', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    mocks.state.clear()
    mocks.offline.isOnline = true
    mocks.subscribe.mockReturnValue(() => undefined)
    mocks.listParticipants.mockResolvedValue([person()])
    mocks.getTripDiary.mockResolvedValue({ entries: [] })
    mocks.syncTripDiary.mockImplementation(
      async (_tripId: string, entries: Array<Record<string, unknown>>) => ({
        // Сервер не отдаёт удалённые записи — как и настоящий.
        entries: entries
          .filter((row) => !row.deletedAt)
          .map((row) => ({
            id: row.id,
            body: row.body,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          })),
      }),
    )
  })

  it('показывает записи по дням с номером дня похода', async () => {
    mocks.getTripDiary.mockResolvedValue({
      entries: [
        entry({ body: 'Первый день.' }),
        entry({
          id: '4c1f3a84-2222-4222-8222-222222222222',
          body: 'Второй день.',
          createdAt: local(11, 17, 9),
          updatedAt: local(11, 17, 9),
        }),
      ],
    })

    const wrapper = await mountDiary()

    expect(mocks.getTripDiary).toHaveBeenCalledWith('679')
    const body = wrapper.get('[data-test="diary-entries"]').text()
    expect(body).toContain('Первый день.')
    expect(body).toContain('Второй день.')
    // 14 ноября — старт, 16-е — третий день похода, 17-е — четвёртый.
    expect(body).toContain('День 3')
    expect(body).toContain('День 4')
    expect(wrapper.findAll('[data-test="diary-day"]')).toHaveLength(2)
  })

  it('пустой дневник приглашает написать первую запись', async () => {
    const wrapper = await mountDiary()

    expect(wrapper.get('[data-test="diary-empty"]').text()).toContain(
      'Первая запись',
    )
  })

  it('без связи запись остаётся на устройстве и отправляется позже', async () => {
    mocks.offline.isOnline = false
    mocks.getTripDiary.mockRejectedValue(new OfflineError())

    const wrapper = await mountDiary()
    const editor = wrapper.findComponent(MarkdownEditorStub)

    editor.vm.$emit('update:modelValue', 'Пишу без связи.')
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-test="diary-entries"]').text()).toContain(
      'Пишу без связи.',
    )
    expect(wrapper.get('[data-test="diary-sync-status"]').text()).toContain(
      'Не отправлено: 1',
    )
    expect(mocks.syncTripDiary).not.toHaveBeenCalled()

    // Связь вернулась: та же запись уходит на сервер.
    mocks.offline.isOnline = true
    mocks.getTripDiary.mockResolvedValue({
      entries: [entry({ body: 'Пишу без связи.' })],
    })

    const remounted = await mountDiary()
    expect(mocks.syncTripDiary).toHaveBeenCalledWith('679', [
      expect.objectContaining({ body: 'Пишу без связи.' }),
    ])
    expect(remounted.get('[data-test="diary-sync-status"]').text()).toContain(
      'Все записи сохранены',
    )
  })

  it('кнопка «День N» вставляет номер дня похода', async () => {
    const wrapper = await mountDiary()

    /**
     * Номер считаем тем же правилом, что и компонент: тест не должен
     * ломаться оттого, что сегодня другой день. Сама арифметика покрыта
     * в `utils/tripDay.spec.ts`, здесь проверяется, что кнопка её
     * показывает и вставляет в текст.
     */
    const day = tripDayNumber(makeTrip())
    expect(day).not.toBeNull()

    expect(wrapper.get('[data-test="diary-insert-day"]').text()).toContain(`День ${day}`)

    await wrapper.get('[data-test="diary-insert-day"]').trigger('click')
    await flushPromises()

    expect(
      wrapper.findComponent(MarkdownEditorStub).props('modelValue'),
    ).toContain(`День ${day}`)
  })

  it('время и дата вставляются в текст записи', async () => {
    const wrapper = await mountDiary()

    await wrapper.get('[data-test="diary-insert-time"]').trigger('click')
    await flushPromises()
    expect(
      wrapper.findComponent(MarkdownEditorStub).props('modelValue'),
    ).toMatch(/\d{2}:\d{2}/)

    await wrapper.get('[data-test="diary-insert-date"]').trigger('click')
    await flushPromises()
    expect(
      wrapper.findComponent(MarkdownEditorStub).props('modelValue'),
    ).toMatch(/\d{2}\.\d{2}\.\d{4}/)
  })

  it('до старта кнопка дня вставляет обратный отсчёт', async () => {
    const wrapper = mount(TripDiaryView, {
      props: {
        trip: { ...makeTrip(), startsAt: local(12, 20) },
      },
      global: {
        stubs: { MarkdownEditor: MarkdownEditorStub },
        plugins: [createPinia()],
      },
    })
    await flushPromises()

    const button = wrapper.get('[data-test="diary-insert-day"]')
    const label = button.text()

    /**
     * Точное число дней зависит от дня прогона, поэтому здесь проверяется
     * форма подписи и то, что она попадает в текст. Само правило и
     * согласование слова «день» — в `utils/tripDay.spec.ts`.
     */
    expect(label).toMatch(/^До старта \d+ (день|дня|дней)$/)
    expect((button.element as HTMLButtonElement).disabled).toBe(false)
    expect(button.attributes('title')).toBe(`Вставить «${label}»`)

    await button.trigger('click')
    await flushPromises()

    expect(
      wrapper.findComponent(MarkdownEditorStub).props('modelValue'),
    ).toContain(label)
  })

  it('у отменённого похода кнопка дня выключена', async () => {
    const wrapper = mount(TripDiaryView, {
      props: {
        trip: { ...makeTrip(), cancelledAt: local(11, 20) },
      },
      global: {
        stubs: { MarkdownEditor: MarkdownEditorStub },
        plugins: [createPinia()],
      },
    })
    await flushPromises()

    const button = wrapper.get('[data-test="diary-insert-day"]')

    expect((button.element as HTMLButtonElement).disabled).toBe(true)
    expect(button.attributes('title')).toBe('Поход отменён — дня похода нет')
  })

  it('упоминание участника показывается именем и ведёт в профиль', async () => {
    mocks.getTripDiary.mockResolvedValue({
      entries: [entry({ body: 'Идём с [[user:u-1]].' })],
    })

    const wrapper = await mountDiary()
    const link = wrapper.get('[data-test="diary-entry-body"] a[data-user-id]')

    expect(link.text()).toBe('Анна')
    expect(link.attributes('href')).toBe('/people/u-1')

    await link.trigger('click')
    expect(mocks.push).toHaveBeenCalledWith({
      name: 'person',
      params: { id: 'u-1' },
    })
  })

  it('запись правится и правка уходит на сервер', async () => {
    mocks.getTripDiary.mockResolvedValue({ entries: [entry()] })

    const wrapper = await mountDiary()
    await wrapper.get('[data-test="diary-edit"]').trigger('click')

    const editor = wrapper
      .get('[data-test="diary-editor"]')
      .findComponent(MarkdownEditorStub)
    editor.vm.$emit('update:modelValue', 'Поправленный текст.')
    await flushPromises()

    await wrapper.get('[data-test="diary-edit-save"]').trigger('click')
    await flushPromises()

    expect(mocks.syncTripDiary).toHaveBeenCalledWith(
      '679',
      [expect.objectContaining({ body: 'Поправленный текст.' })],
    )
    expect(wrapper.get('[data-test="diary-entries"]').text()).toContain(
      'Поправленный текст.',
    )
  })

  it('удаление спрашивает и удаляет со второго нажатия', async () => {
    mocks.getTripDiary.mockResolvedValue({ entries: [entry()] })

    const wrapper = await mountDiary()
    await wrapper.get('[data-test="diary-delete"]').trigger('click')

    expect(wrapper.get('[data-test="diary-delete"]').text()).toContain('Удалить?')

    await wrapper.get('[data-test="diary-delete"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="diary-entries"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="diary-empty"]').exists()).toBe(true)
    expect(mocks.syncTripDiary).toHaveBeenCalledWith(
      '679',
      [expect.objectContaining({ deletedAt: expect.any(String) })],
    )
  })

  it('своё событие дневника с другого устройства перечитывает записи', async () => {
    mocks.getTripDiary.mockResolvedValue({ entries: [entry()] })

    const wrapper = await mountDiary()
    const listener = mocks.subscribe.mock.calls[0]![1] as (event: {
      scope: string
      actorId: string
      at: string
    }) => void

    expect(mocks.subscribe).toHaveBeenCalledWith('679', expect.any(Function), 'diary')

    mocks.getTripDiary.mockResolvedValue({
      entries: [entry(), entry({ id: '4c1f3a84-3333-4333-8333-333333333333' })],
    })
    listener({ scope: 'diary', actorId: ME, at: new Date().toISOString() })
    await flushPromises()

    expect(mocks.getTripDiary).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('[data-test="diary-entry"]')).toHaveLength(2)
  })

  it('чужое событие дневника мой экран не трогает', async () => {
    mocks.getTripDiary.mockResolvedValue({ entries: [entry()] })

    await mountDiary()
    const listener = mocks.subscribe.mock.calls[0]![1] as (event: {
      scope: string
      actorId: string
      at: string
    }) => void

    mocks.getTripDiary.mockClear()
    listener({ scope: 'diary', actorId: 'someone-else', at: new Date().toISOString() })
    await flushPromises()

    expect(mocks.getTripDiary).not.toHaveBeenCalled()
  })
})
