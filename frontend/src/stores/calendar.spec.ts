import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CalendarDay, YearState } from '@/api/calendar'
import { ApiError } from '@/api/errors'
import { useCalendarStore } from '@/stores/calendar'

/**
 * Тесты стора календаря.
 *
 * Стор держит два кэша и решает, когда идти в сеть: диапазон запрашивается
 * один раз, хвосты соседних месяцев складываются в тот же кэш, а правки
 * попадают в него из ответа сервера. Именно это здесь и проверяется —
 * сам рендер сетки проверяют тесты страницы.
 */
vi.mock('@/api/calendar', () => ({
  fetchYearState: vi.fn(),
  fetchDays: vi.fn(),
  createYear: vi.fn(),
  patchDay: vi.fn(),
  updateDays: vi.fn(),
  fetchActivityDictionary: vi.fn(),
  addActivity: vi.fn(),
  removeActivity: vi.fn(),
  saveNotes: vi.fn(),
  createActivityRequest: vi.fn(),
}))

import * as api from '@/api/calendar'

const mocked = vi.mocked(api)

function day(date: string, dayType: CalendarDay['dayType'] = 'workday'): CalendarDay {
  return { date, dayType, label: null }
}

function yearState(overrides: Partial<YearState> = {}): YearState {
  return {
    year: 2026,
    filled: true,
    mode: 'cycle',
    filledDays: 365,
    stateAvailable: true,
    educationAvailable: true,
    ...overrides,
  }
}

describe('стор календаря', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('загружает диапазон один раз', async () => {
    mocked.fetchDays.mockResolvedValue({ days: [day('2026-10-01'), day('2026-10-02')], activities: {} })
    const store = useCalendarStore()

    await store.ensureRange('2026-10-01', '2026-10-02')
    await store.ensureRange('2026-10-01', '2026-10-02')

    expect(mocked.fetchDays).toHaveBeenCalledTimes(1)
    expect(store.day('2026-10-01')).toMatchObject({ date: '2026-10-01' })
  })

  it('просит сетку заново, если она выходит за загруженное', async () => {
    mocked.fetchDays.mockResolvedValue({ days: [day('2026-10-01')], activities: {} })
    const store = useCalendarStore()

    await store.ensureRange('2026-10-01', '2026-10-01')
    await store.ensureRange('2026-09-28', '2026-11-01')

    expect(mocked.fetchDays).toHaveBeenCalledTimes(2)
    expect(mocked.fetchDays).toHaveBeenLastCalledWith('2026-09-28', '2026-11-01')
  })

  it('хвосты соседних месяцев попадают в тот же кэш', async () => {
    mocked.fetchDays.mockResolvedValue({
      days: [
      day('2026-09-28'),
      day('2026-10-01'),
      day('2026-11-01', 'weekend'),
      ],
      activities: {},
    })
    const store = useCalendarStore()

    await store.ensureRange('2026-09-28', '2026-11-01')

    expect(store.day('2026-09-28')?.date).toBe('2026-09-28')
    expect(store.day('2026-11-01')?.dayType).toBe('weekend')
  })

  it('состояние года спрашивает один раз', async () => {
    mocked.fetchYearState.mockResolvedValue(yearState())
    const store = useCalendarStore()

    await store.ensureYear(2026)
    await store.ensureYear(2026)

    expect(mocked.fetchYearState).toHaveBeenCalledTimes(1)
    expect(store.years[2026]?.filled).toBe(true)
  })

  it('создание года обновляет состояние и перечитывает загруженное', async () => {
    mocked.fetchDays.mockResolvedValue({ days: [day('2025-12-29'), day('2026-01-01')], activities: {} })
    mocked.fetchYearState.mockResolvedValue(yearState({ filled: false, mode: null }))
    mocked.createYear.mockResolvedValue(yearState({ mode: 'cycle' }))

    const store = useCalendarStore()
    await store.ensureYear(2026)
    await store.ensureRange('2025-12-29', '2026-01-01')
    expect(mocked.fetchDays).toHaveBeenCalledTimes(1)

    await store.createYear(2026, 'cycle')

    expect(store.years[2026]?.mode).toBe('cycle')
    // Старый кэш недействителен (статусы дней изменились), но и оставлять
    // сетку пустой нельзя: показанный диапазон запрашивается заново.
    expect(mocked.fetchDays).toHaveBeenCalledTimes(2)
    expect(mocked.fetchDays).toHaveBeenLastCalledWith('2025-12-29', '2026-01-01')
    expect(store.day('2026-01-01')).not.toBeNull()
  })

  it('правка дня кладёт в кэш ответ сервера', async () => {
    mocked.fetchDays.mockResolvedValue({ days: [day('2026-10-07')], activities: {} })
    mocked.patchDay.mockResolvedValue({
      date: '2026-10-07',
      dayType: 'weekend',
      label: 'ДР Любы',
    })

    const store = useCalendarStore()
    await store.ensureRange('2026-10-07', '2026-10-07')

    await store.patchDay({ date: '2026-10-07', label: 'ДР Любы' })

    expect(store.day('2026-10-07')).toMatchObject({
      dayType: 'weekend',
      label: 'ДР Любы',
    })
  })

  it('пачка правок раскладывается по кэшу, последняя запись выигрывает', async () => {
    mocked.fetchDays.mockResolvedValue({ days: [day('2026-06-03'), day('2026-06-04')], activities: {} })
    mocked.updateDays.mockResolvedValue({ updated: 2 })

    const store = useCalendarStore()
    await store.ensureRange('2026-06-03', '2026-06-04')

    const updated = await store.applyDays([
      { date: '2026-06-03', dayType: 'weekend', label: 'Отпуск' },
      { date: '2026-06-04', dayType: 'weekend', label: 'Отпуск' },
      { date: '2026-06-04', dayType: 'workday', label: 'Передумал' },
    ])

    expect(updated).toBe(2)
    expect(store.day('2026-06-03')?.label).toBe('Отпуск')
    expect(store.day('2026-06-04')).toMatchObject({
      dayType: 'workday',
      label: 'Передумал',
    })
  })

  it('ошибку показывает текстом и пробрасывает дальше', async () => {
    mocked.fetchYearState.mockRejectedValue(new ApiError(500, 'Сервер прилёг', null))
    const store = useCalendarStore()

    await expect(store.ensureYear(2026)).rejects.toBeInstanceOf(ApiError)
    expect(store.error).toBe('Сервер прилёг')
    expect(store.pending).toBe(0)
  })
})
