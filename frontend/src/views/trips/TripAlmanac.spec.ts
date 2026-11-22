import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import TripAlmanacView from '@/views/trips/TripAlmanac.vue'

/**
 * Секция «Альманах» в «Гостевой» (22.11.2026).
 *
 * Проверяем решения заказчика, а не вёрстку:
 *
 * 1. это секция «Гостевой», свёрнутая и помнящая состояние;
 * 2. группа «До похода» — после допоходных дневников, «День N» — после
 *    дневников этого дня, «После похода» — в самом конце;
 * 3. воспоминание идёт после дневников дня и без времени;
 * 4. инструменты скрываются кнопкой «⋯»;
 * 5. удалять строки может только организатор (`canDelete` с сервера);
 * 6. на день — одна своя запись, кнопка открывает её на дописывание.
 */
const mocks = vi.hoisted(() => ({
  getTripAlmanac: vi.fn(),
  createAlmanacEntry: vi.fn(),
  updateAlmanacEntry: vi.fn(),
  deleteAlmanacEntry: vi.fn(),
  push: vi.fn(),
}))

vi.mock('@/api/diary', () => ({
  getTripAlmanac: mocks.getTripAlmanac,
  createAlmanacEntry: mocks.createAlmanacEntry,
  updateAlmanacEntry: mocks.updateAlmanacEntry,
  deleteAlmanacEntry: mocks.deleteAlmanacEntry,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

/** Редактор подменяем: у настоящего contenteditable-механика на Range. */
const MarkdownEditorStub = defineComponent({
  name: 'MarkdownEditor',
  props: {
    modelValue: { type: String, default: '' },
  },
  emits: ['update:modelValue'],
  setup() {
    return () => h('div', { 'data-test': 'md-editor' })
  },
})

const mountOptions = { global: { stubs: { MarkdownEditor: MarkdownEditorStub } } }

/** Набрать текст в инструменте-чате. */
async function typeInModal(
  wrapper: ReturnType<typeof mount>,
  text: string,
): Promise<void> {
  wrapper.findComponent(MarkdownEditorStub).vm.$emit('update:modelValue', text)
  await flushPromises()
}

function local(day: number, hours = 10): string {
  return new Date(2026, 10, day, hours).toISOString()
}

function makeTrip() {
  return {
    id: '679',
    startsAt: local(14),
    endsAt: local(18),
    cancelledAt: null,
  }
}

function diaryEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd-1',
    kind: 'diary',
    body: 'Дошли до озера.',
    createdAt: local(16, 12),
    updatedAt: null,
    placement: null,
    dayIndex: null,
    author: { userId: 'u-1', displayName: 'Анна', avatarUrl: null },
    canEdit: false,
    canDelete: false,
    ...overrides,
  }
}

function memoryEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    kind: 'memory',
    body: 'Вечером был самый красивый закат.',
    createdAt: local(16, 20),
    updatedAt: local(16, 20),
    placement: 'day',
    dayIndex: 2,
    author: { userId: 'u-2', displayName: 'Борис', avatarUrl: null },
    canEdit: false,
    canDelete: false,
    ...overrides,
  }
}

function makeAlmanac(overrides: Record<string, unknown> = {}) {
  return {
    tripId: '679',
    completedAt: local(18, 20),
    canWrite: true,
    canManage: false,
    entries: [],
    ...overrides,
  }
}

async function mountAlmanac(almanac = makeAlmanac()) {
  mocks.getTripAlmanac.mockResolvedValue(almanac)

  const wrapper = mount(TripAlmanacView, {
    props: { trip: makeTrip() },
    ...mountOptions,
  })
  await flushPromises()

  return wrapper
}

/** `<details>` в jsdom не переключается кликом — ставим open сами. */
async function toggle(wrapper: ReturnType<typeof mount>): Promise<void> {
  const section = wrapper.get('[data-test="trip-almanac"]')
  ;(section.element as HTMLDetailsElement).open = true
  await section.trigger('toggle')
  await flushPromises()
}

enableAutoUnmount(afterEach)

describe('секция «Альманах»', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
  })

  it('свёрнутая секция «Гостевой» помнит состояние на поход', async () => {
    const wrapper = await mountAlmanac()

    expect(wrapper.get('[data-test="trip-almanac"]').element.hasAttribute('open')).toBe(false)

    await toggle(wrapper)

    expect(
      JSON.parse(window.localStorage.getItem('ph.tripGuestView.open.679') ?? '{}'),
    ).toMatchObject({ almanac: true })

    const again = mount(TripAlmanacView, { props: { trip: makeTrip() }, ...mountOptions })
    await flushPromises()

    expect(again.get('[data-test="trip-almanac"]').element.hasAttribute('open')).toBe(true)
  })

  it('группы: «До похода», дни похода и «После похода»', async () => {
    const wrapper = await mountAlmanac(
      makeAlmanac({
        entries: [
          diaryEntry({ id: 'd-before', body: 'Закупили крупу.', createdAt: local(10, 12) }),
          diaryEntry({ id: 'd-day2', body: 'День на озере.', createdAt: local(15, 12) }),
          memoryEntry({ id: 'm-after', placement: 'after', dayIndex: null, body: 'Спасибо всем!' }),
        ],
      }),
    )

    await toggle(wrapper)
    const days = wrapper.findAll('[data-test="almanac-day"]').map((day) => day.text())

    expect(days[0]).toContain('До похода')
    expect(days[1]).toContain('День 2')
    expect(days[days.length - 1]).toContain('После похода')
  })

  it('воспоминание — после дневника дня и без времени', async () => {
    const wrapper = await mountAlmanac(
      makeAlmanac({
        entries: [
          memoryEntry({ id: 'm-day2', body: 'Моё воспоминание.' }),
          diaryEntry({ id: 'd-day2', body: 'Дневниковая запись.', createdAt: local(15, 9) }),
        ],
      }),
    )

    await toggle(wrapper)
    const bodies = wrapper.findAll('[data-test="almanac-entry-body"]').map((row) => row.text())

    expect(bodies[0]).toContain('Дневниковая запись')
    expect(bodies[1]).toContain('Моё воспоминание')
    // Время есть только у дневниковой строки.
    expect(wrapper.findAll('[data-test="almanac-entry-time"]')).toHaveLength(1)
  })

  it('инструменты скрываются кнопкой «⋯»: читать можно без кнопок', async () => {
    const wrapper = await mountAlmanac(
      makeAlmanac({
        entries: [memoryEntry({ canDelete: true })],
      }),
    )

    await toggle(wrapper)
    expect(wrapper.find('[data-test="almanac-compose"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="almanac-delete"]').exists()).toBe(true)

    await wrapper.get('[data-test="almanac-tools-toggle"]').trigger('click')

    expect(wrapper.find('[data-test="almanac-compose"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="almanac-delete"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="almanac-entry-body"]').exists()).toBe(true)
  })

  it('гостю инструментов нет: только чтение', async () => {
    const wrapper = await mountAlmanac(
      makeAlmanac({
        canWrite: false,
        canManage: false,
        entries: [memoryEntry({ canDelete: false })],
      }),
    )

    await toggle(wrapper)

    expect(wrapper.find('[data-test="almanac-tools-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="almanac-compose"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="almanac-delete"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="almanac-entry-body"]').exists()).toBe(true)
  })

  it('организатор удаляет строку в два нажатия', async () => {
    const removed = makeAlmanac({ canManage: true, entries: [] })
    mocks.deleteAlmanacEntry.mockResolvedValue(removed)

    const wrapper = await mountAlmanac(
      makeAlmanac({ canManage: true, entries: [memoryEntry({ canDelete: true })] }),
    )

    await toggle(wrapper)
    const button = wrapper.get('[data-test="almanac-delete"]')

    expect(button.text()).toBe('Удалить')
    await button.trigger('click')
    expect(button.text()).toBe('Точно?')
    expect(mocks.deleteAlmanacEntry).not.toHaveBeenCalled()

    await wrapper.get('[data-test="almanac-delete"]').trigger('click')
    await flushPromises()

    expect(mocks.deleteAlmanacEntry).toHaveBeenCalledWith('679', 'm-1')
  })

  it('на день одна своя запись: кнопка «Дописать», а не вторая запись', async () => {
    const wrapper = await mountAlmanac(
      makeAlmanac({
        entries: [memoryEntry({ id: 'm-mine', canEdit: true, author: { userId: 'me', displayName: 'Я', avatarUrl: null } })],
      }),
    )

    await toggle(wrapper)
    await wrapper.get('[data-test="almanac-place"]').setValue('day:2')

    expect(wrapper.get('[data-test="almanac-write"]').text()).toBe('Дописать')
  })

  it('создание: место выбрано снаружи, в инструменте-чате дня нет', async () => {
    mocks.createAlmanacEntry.mockResolvedValue(
      makeAlmanac({ entries: [memoryEntry({ canEdit: true })] }),
    )

    const wrapper = await mountAlmanac()
    await toggle(wrapper)

    await wrapper.get('[data-test="almanac-place"]').setValue('day:3')
    await wrapper.get('[data-test="almanac-write"]').trigger('click')

    const modal = wrapper.get('[data-test="almanac-memory-modal"]')
    expect(modal.text()).not.toContain('День 3')
    expect(modal.text()).toContain('Воспоминание')

    await typeInModal(wrapper, 'Было холодно, но красиво.')
    await modal.get('[data-test="almanac-memory-save"]').trigger('click')
    await flushPromises()

    expect(mocks.createAlmanacEntry).toHaveBeenCalledWith(
      '679',
      { placement: 'day', dayIndex: 3 },
      'Было холодно, но красиво.',
    )
  })

  it('правка своего воспоминания — через «Дописать», место не меняется', async () => {
    mocks.updateAlmanacEntry.mockResolvedValue(makeAlmanac())

    const wrapper = await mountAlmanac(
      makeAlmanac({ entries: [memoryEntry({ id: 'm-mine', canEdit: true })] }),
    )

    await toggle(wrapper)
    await wrapper.get('[data-test="almanac-place"]').setValue('day:2')
    await wrapper.get('[data-test="almanac-write"]').trigger('click')
    await typeInModal(wrapper, 'Дописал.')
    await wrapper.get('[data-test="almanac-memory-save"]').trigger('click')
    await flushPromises()

    expect(mocks.updateAlmanacEntry).toHaveBeenCalledWith('679', 'm-mine', 'Дописал.')
  })

  it('из ленты ничего не правится: чужое админ только удаляет', async () => {
    const wrapper = await mountAlmanac(
      makeAlmanac({
        canManage: true,
        entries: [
          memoryEntry({ id: 'm-other', canEdit: false, canDelete: true }),
          diaryEntry({ id: 'd-other', canDelete: true }),
        ],
      }),
    )

    await toggle(wrapper)

    // Ни «Править», ни карандаша: в ленте только чтение и «Удалить».
    expect(wrapper.find('[data-test="almanac-edit"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Править')
    expect(wrapper.findAll('[data-test="almanac-delete"]')).toHaveLength(2)
  })

  it('в заголовке секции нет счётчика записей и авторов', async () => {
    const wrapper = await mountAlmanac(
      makeAlmanac({ entries: [diaryEntry(), memoryEntry()] }),
    )

    const title = wrapper.get('summary').text()

    expect(title).toContain('Альманах')
    expect(title).not.toContain('записи')
    expect(title).not.toContain('автор')
    expect(wrapper.find('[data-test="almanac-count"]').exists()).toBe(false)
  })

  it('ошибка загрузки объясняется словами', async () => {
    mocks.getTripAlmanac.mockRejectedValue(new ApiError(409, 'Альманах собирается после завершения похода'))

    const wrapper = mount(TripAlmanacView, { props: { trip: makeTrip() }, ...mountOptions })
    await flushPromises()

    await toggle(wrapper)
    expect(wrapper.get('[data-test="almanac-error"]').text()).toContain('после завершения')
  })
})
