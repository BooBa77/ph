import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  addActivity as addActivityRequest,
  createActivityRequest,
  fetchActivityDictionary,
  fetchDays,
  fetchYearState,
  patchDay as patchDayRequest,
  removeActivity as removeActivityRequest,
  saveNotes as saveNotesRequest,
  updateDays as updateDaysRequest,
  createYear as createYearRequest,
  type ActivityDictionary,
  type CalendarDay,
  type CalendarMode,
  type DayPatch,
  type DayUpdate,
  type YearState,
} from '@/api/calendar'
import { ApiError } from '@/api/errors'

/**
 * Календарь в Pinia.
 *
 * Два кэша и один принцип: сетка месяца вместе с хвостами соседних месяцев
 * запрашивается диапазоном и складывается в `daysByDate` по дате. Хвосты
 * попадают в тот же кэш естественно — 28 сентября, показанное в сетке
 * октября, не тянет за собой запрос за сентябрём.
 *
 * `loadedRanges` помнит, что уже загружено: перелистывание месяцев
 * в пределах загруженного не ходит в сеть. Диапазоны могут пересекаться —
 * нам важно только то, что нужный отрезок уже покрыт.
 *
 * Истина по-прежнему на бэкенде: стор ничего не «достраивает» сам, а кладёт
 * в кэш ответы сервера и то, что только что отправил.
 */
export const useCalendarStore = defineStore('calendar', () => {
  /** Дни по дате вида `2026-10-07`. */
  const daysByDate = ref<Record<string, CalendarDay>>({})

  /**
   * Отметки активностей по дате: `{ '2026-10-07': [1, 4] }`.
   *
   * Держим отдельно от дней: у дня идентификаторы типов, а названия, иконки
   * и цвет берутся из справочника. Так отметка занимает в кэше пару байт,
   * а иконка рисуется по ключу.
   */
  const activitiesByDate = ref<Record<string, number[]>>({})

  /** Справочник активностей: грузится один раз на сессию. */
  const dictionary = ref<ActivityDictionary | null>(null)

  /** Что уже загружено — чтобы не просить одно и то же дважды. */
  const loadedRanges = ref<{ from: string; to: string }[]>([])

  /** Состояние годов по номеру года. */
  const years = ref<Record<number, YearState>>({})

  /** Счётчик активных запросов: по нему показываем «загружаем». */
  const pending = ref(0)

  /** Последняя ошибка — для сообщения в интерфейсе. */
  const error = ref<string | null>(null)

  function messageOf(cause: unknown): string {
    if (cause instanceof ApiError) return cause.message
    return 'Не удалось загрузить календарь. Попробуйте ещё раз.'
  }

  function isCovered(from: string, to: string): boolean {
    return loadedRanges.value.some(
      (range) => range.from <= from && range.to >= to,
    )
  }

  /** Загрузить дни диапазона, если их ещё нет в кэше. */
  async function ensureRange(from: string, to: string): Promise<void> {
    if (isCovered(from, to)) return

    pending.value += 1
    try {
      const response = await fetchDays(from, to)
      const next = { ...daysByDate.value }
      for (const day of response.days) next[day.date] = day
      daysByDate.value = next

      // Отметки приезжают вместе с днями: отдельный запрос за иконками
      // на каждый месяц — лишний круг по сети.
      activitiesByDate.value = { ...activitiesByDate.value, ...response.activities }

      loadedRanges.value = [...loadedRanges.value, { from, to }]
      error.value = null
    } catch (cause) {
      error.value = messageOf(cause)
      throw cause
    } finally {
      pending.value -= 1
    }
  }

  /** Состояние года: спрашиваем один раз на год. */
  async function ensureYear(year: number): Promise<YearState> {
    const cached = years.value[year]
    if (cached) return cached

    pending.value += 1
    try {
      const state = await fetchYearState(year)
      years.value = { ...years.value, [year]: state }
      error.value = null
      return state
    } catch (cause) {
      error.value = messageOf(cause)
      throw cause
    } finally {
      pending.value -= 1
    }
  }

  /**
   * Создать календарь на год.
   *
   * Кэш дней чистим целиком: год заполняется разом, и всё, что мы успели
   * загрузить до этого, — не более чем хвосты соседних месяцев. Но потом
   * **сразу перечитываем** то, что было загружено: без этого сетка осталась
   * бы пустой до следующего переключения месяца — статусы дней изменились,
   * а запрос за ними никто не отправил.
   */
  async function createYear(year: number, mode: CalendarMode): Promise<YearState> {
    pending.value += 1
    try {
      const state = await createYearRequest(year, mode)
      years.value = { ...years.value, [year]: state }

      const ranges = [...loadedRanges.value]
      daysByDate.value = {}
      loadedRanges.value = []
      error.value = null

      // Ошибку перезагрузки глотаем: год уже создан, и показывать из-за неё
      // «не удалось создать календарь» — врать. Сетка просто отрисуется
      // по дням недели, пока не подгрузятся настоящие дни.
      for (const range of ranges) {
        await ensureRange(range.from, range.to).catch(() => undefined)
      }

      return state
    } catch (cause) {
      error.value = messageOf(cause)
      throw cause
    } finally {
      pending.value -= 1
    }
  }

  /** Правка одного дня: в кэш кладём ответ сервера, а не то, что просили. */
  async function patchDay(patch: DayPatch): Promise<CalendarDay> {
    pending.value += 1
    try {
      const updated = await patchDayRequest(patch)
      daysByDate.value = { ...daysByDate.value, [updated.date]: updated }
      error.value = null
      return updated
    } catch (cause) {
      error.value = messageOf(cause)
      throw cause
    } finally {
      pending.value -= 1
    }
  }

  /**
   * Пачка правок.
   *
   * В кэш раскладываем то, что отправили: сервер отвечает только числом
   * изменённых дней, а список у нас уже есть. Идём по нему в том же порядке,
   * что и сервер, — «последняя запись по дате выигрывает».
   */
  async function applyDays(days: DayUpdate[]): Promise<number> {
    pending.value += 1
    try {
      const result = await updateDaysRequest(days)
      const next = { ...daysByDate.value }
      for (const day of days) {
        const existing = next[day.date]
        if (!existing) continue
        next[day.date] = {
          date: day.date,
          dayType: day.dayType,
          label: day.label ?? null,
        }
      }
      daysByDate.value = next
      error.value = null
      return result.updated
    } catch (cause) {
      error.value = messageOf(cause)
      throw cause
    } finally {
      pending.value -= 1
    }
  }

  /** День из кэша или null, если он ещё не загружен. */
  function day(date: string): CalendarDay | null {
    return daysByDate.value[date] ?? null
  }

  /** Отметки дня: идентификаторы типов. */
  function activities(date: string): number[] {
    return activitiesByDate.value[date] ?? []
  }

  /** Тип активности по идентификатору — для иконки, названия и цвета. */
  function typeById(id: number): { icon: string; label: string; color: string } | null {
    const groups = dictionary.value?.groups ?? []
    for (const group of groups) {
      const type = group.types.find((item) => item.id === id)
      if (type) return { icon: type.icon, label: type.label, color: group.color }
    }
    return null
  }

  /** Справочник: спрашиваем один раз за сессию. */
  async function ensureDictionary(force = false): Promise<ActivityDictionary> {
    if (dictionary.value && !force) return dictionary.value

    const loaded = await fetchActivityDictionary()
    dictionary.value = loaded
    return loaded
  }

  /**
   * Поставить или снять отметку.
   *
   * Оптимистично правим кэш, а при ошибке возвращаем как было: клик по
   * иконке должен отзываться мгновенно, а не после ответа сервера.
   */
  async function toggleActivity(
    date: string,
    activityTypeId: number,
    active: boolean,
  ): Promise<void> {
    const before = activitiesByDate.value[date] ?? []
    const after = active
      ? [...before, activityTypeId]
      : before.filter((id) => id !== activityTypeId)
    activitiesByDate.value = { ...activitiesByDate.value, [date]: after }

    try {
      if (active) {
        await addActivityRequest(date, activityTypeId)
      } else {
        await removeActivityRequest(date, activityTypeId)
      }
      // Счёт избранного изменился — перечитываем справочник, чтобы закладка
      // «Избранное» показывала актуальный порядок.
      await ensureDictionary(true)
    } catch (cause) {
      activitiesByDate.value = { ...activitiesByDate.value, [date]: before }
      error.value = messageOf(cause)
      throw cause
    }
  }

  /** Сохранить заметки дня. */
  async function saveNotes(
    date: string,
    notes: { notePublic?: string | null; notePersonal?: string | null },
  ): Promise<CalendarDay> {
    const updated = await saveNotesRequest(date, notes)
    daysByDate.value = { ...daysByDate.value, [updated.date]: updated }
    return updated
  }

  /** Попросить новую активность: строка в очереди на модерацию. */
  async function requestActivity(label: string): Promise<void> {
    await createActivityRequest(label)
    await ensureDictionary(true)
  }

  return {
    daysByDate,
    activitiesByDate,
    dictionary,
    loadedRanges,
    years,
    pending,
    error,
    ensureRange,
    ensureYear,
    ensureDictionary,
    createYear,
    patchDay,
    applyDays,
    day,
    activities,
    typeById,
    toggleActivity,
    saveNotes,
    requestActivity,
  }
})
