import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/errors'
import type { Trip } from '@/types/trips'
import TripAlmanacView from '@/views/trips/TripAlmanac.vue'

/**
 * Вкладка «Альманах» (22.11.2026).
 *
 * Проверяем решения заказчика, а не вёрстку:
 *
 * 1. Собирает организатор (и соорганизатор) — кнопкой «Собрать альманах»;
 * 2. в альманах попадают только помеченные записи (сервер их уже отфильтровал);
 * 3. формат — хронология по дате с разделителями «День N · дата», записи
 *    с автором и markdown;
 * 4. записи не правятся: на экране нет ни «Править», ни «Удалить»;
 * 5. упоминания `[[user:ID]]` — ссылки на профиль.
 */
const mocks = vi.hoisted(() => ({
  getTripAlmanac: vi.fn(),
  push: vi.fn(),
}))

vi.mock('@/api/diary', () => ({
  getTripAlmanac: mocks.getTripAlmanac,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

function local(day: number, hours = 10): string {
  return new Date(2026, 10, day, hours).toISOString()
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
    startsAt: local(14),
    endsAt: local(18),
    dateVariants: [],
    isCommercial: false,
    isOfficial: false,
    openParticipation: true,
    priceRub: null,
    priceNote: null,
    cancelledAt: null,
    completedAt: local(18, 20),
    createdAt: local(1),
    updatedAt: local(1),
  }
}

function almanacEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e-1',
    body: 'Дошли до озера.',
    createdAt: local(16, 12),
    author: { userId: 'u-1', displayName: 'Анна', avatarUrl: null },
    ...overrides,
  }
}

async function mountAlmanac(canAssemble = false) {
  const wrapper = mount(TripAlmanacView, {
    props: { trip: makeTrip(), canAssemble },
    global: { plugins: [createPinia()] },
  })
  await flushPromises()

  return wrapper
}

describe('вкладка «Альманах»', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('участник видит альманах сразу, без кнопки сборки', async () => {
    mocks.getTripAlmanac.mockResolvedValue({
      tripId: '679',
      completedAt: local(18, 20),
      entries: [
        almanacEntry(),
        almanacEntry({
          id: 'e-2',
          body: 'Второй день: ветер.',
          createdAt: local(17, 9),
          author: { userId: 'u-2', displayName: 'Борис', avatarUrl: null },
        }),
      ],
    })

    const wrapper = await mountAlmanac(false)

    expect(mocks.getTripAlmanac).toHaveBeenCalledWith('679')
    expect(wrapper.find('[data-test="almanac-assemble"]').exists()).toBe(false)

    // Хронология по дате: 14 ноября — старт, значит 16-е и 17-е — дни 3 и 4.
    const days = wrapper.findAll('[data-test="almanac-day"]').map((day) => day.text())
    expect(days).toHaveLength(2)
    expect(days[0]).toContain('День 3 ·')
    expect(days[1]).toContain('День 4 ·')

    expect(wrapper.findAll('[data-test="almanac-entry"]')).toHaveLength(2)
    expect(wrapper.get('[data-test="almanac-author"]').text()).toBe('Анна')
    expect(wrapper.get('[data-test="almanac-entry-body"]').text()).toContain(
      'Дошли до озера.',
    )
  })

  it('организатор собирает альманах кнопкой', async () => {
    mocks.getTripAlmanac.mockResolvedValue({
      tripId: '679',
      completedAt: local(18, 20),
      entries: [almanacEntry()],
    })

    const wrapper = await mountAlmanac(true)

    // До нажатия — приглашение, а не пустой экран и не запрос.
    expect(mocks.getTripAlmanac).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="almanac-idle"]').exists()).toBe(true)

    const button = wrapper.get('[data-test="almanac-assemble"]')
    expect(button.text()).toBe('Собрать альманах')

    await button.trigger('click')
    await flushPromises()

    expect(mocks.getTripAlmanac).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('[data-test="almanac-entry"]')).toHaveLength(1)
    // Пересобрать можно: автор мог снять пометку уже после первого раза.
    expect(wrapper.get('[data-test="almanac-assemble"]').text()).toBe(
      'Собрать заново',
    )
  })

  it('до завершения похода показывает ответ сервера', async () => {
    mocks.getTripAlmanac.mockRejectedValue(
      new ApiError(409, 'Альманах собирается после завершения похода'),
    )

    const wrapper = await mountAlmanac(false)

    expect(wrapper.get('[data-test="almanac-error"]').text()).toContain(
      'после завершения похода',
    )
    expect(wrapper.find('[data-test="almanac-entry"]').exists()).toBe(false)
  })

  it('пустой альманах объясняет, почему записей нет', async () => {
    mocks.getTripAlmanac.mockResolvedValue({
      tripId: '679',
      completedAt: local(18, 20),
      entries: [],
    })

    const wrapper = await mountAlmanac(false)

    expect(wrapper.get('[data-test="almanac-empty"]').text()).toContain(
      'не пометили',
    )
  })

  it('записи не правятся: на экране нет кнопок правки и удаления', async () => {
    mocks.getTripAlmanac.mockResolvedValue({
      tripId: '679',
      completedAt: local(18, 20),
      entries: [almanacEntry()],
    })

    const wrapper = await mountAlmanac(false)

    expect(wrapper.text()).not.toContain('Править')
    expect(wrapper.text()).not.toContain('Удалить')
  })

  it('упоминание [[user:ID]] ведёт на профиль', async () => {
    mocks.getTripAlmanac.mockResolvedValue({
      tripId: '679',
      completedAt: local(18, 20),
      entries: [
        almanacEntry({
          body: 'Шли с [[user:u-2]] весь день.',
          author: { userId: 'u-1', displayName: 'Анна', avatarUrl: null },
        }),
        almanacEntry({
          id: 'e-2',
          body: 'Отвечаю.',
          createdAt: local(16, 13),
          author: { userId: 'u-2', displayName: 'Борис', avatarUrl: null },
        }),
      ],
    })

    const wrapper = await mountAlmanac(false)
    const link = wrapper.get('[data-test="almanac-entry-body"] a[data-user-id]')

    expect(link.text()).toBe('Борис')
    expect(link.attributes('href')).toBe('/people/u-2')

    await link.trigger('click')
    expect(mocks.push).toHaveBeenCalledWith({
      name: 'person',
      params: { id: 'u-2' },
    })
  })
})
