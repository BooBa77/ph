import { apiFetch } from '@/api/client'

/**
 * Календарь: производственный и личный.
 *
 * Типы продублированы здесь, а не тянутся из бэкенда: фронт и бэк
 * собираются отдельно, общего пакета типов у нас нет. Расхождение поймают
 * тесты бэкенда и 4xx на живом стенде.
 */

/** Тип дня. `short_workday` — рабочий день, просто короче на час. */
export type CalendarDayType = 'workday' | 'weekend' | 'short_workday'

/** Режим работы: те же значения, что в CHECK на `users.calendar_mode`. */
export type CalendarMode = 'cycle' | 'free' | 'study' | 'parental' | 'retired'

/** День личного календаря. */
export interface CalendarDay {
  date: string
  dayType: CalendarDayType
  label: string | null
  /** Заметки необязательны в типе: старые ответы и тесты их не несут. */
  notePublic?: string | null
  notePersonal?: string | null
}

/** Тип активности из справочника. */
export interface ActivityType {
  id: number
  code: string
  label: string
  icon: string
  groupId: number
}

/** Группа активностей: закладка в модалке дня и цвет иконок. */
export interface ActivityGroup {
  id: number
  code: string
  label: string
  color: string
  types: ActivityType[]
}

/** Запрос пользователя на новую активность. */
export interface ActivityRequest {
  id: string
  label: string
  status: 'pending' | 'approved' | 'rejected' | 'revision'
  adminComment: string | null
  /** Кто попросил: приходит только админу. */
  userName?: string | null
}

/**
 * Справочник активностей: запрашивается один раз при открытии календаря.
 *
 * `favorites` — идентификаторы типов по убыванию частоты: закладка
 * «Избранное». Пустой список — пользователь ещё ничего не отмечал.
 */
export interface ActivityDictionary {
  groups: ActivityGroup[]
  favorites: number[]
  requests: ActivityRequest[]
  /** Админ ли запросивший: по этому флагу показываем ссылку на модерацию. */
  isAdmin: boolean
}

/** Вариант иконки в модерации. */
export interface ModerationItem {
  id: number
  label: string
  icon: string
  groupCode: string
  groupLabel: string
  isActive: boolean
  requestedBy: string | null
}

/** Что видит админ: варианты иконок и заявки. */
export interface ModerationData {
  types: ModerationItem[]
  requests: ActivityRequest[]
}

/** GET /api/calendar/admin/moderation */
export async function fetchModeration(): Promise<ModerationData> {
  return apiFetch<ModerationData>('/calendar/admin/moderation')
}

/** PATCH /api/calendar/admin/requests/:id — решение по заявке. */
export async function decideActivityRequest(
  id: string,
  status: 'approved' | 'rejected' | 'revision',
  comment?: string | null,
): Promise<ActivityRequest> {
  return apiFetch<ActivityRequest>(`/calendar/admin/requests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, comment: comment ?? null }),
  })
}

/** PATCH /api/calendar/admin/types/:id — показать вариант или вернуть на рассмотрение. */
export async function setActivityTypeActive(id: number, isActive: boolean): Promise<unknown> {
  return apiFetch(`/calendar/admin/types/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive }),
  })
}

/** Ответ на запрос дней: дни плюс отметки по датам. */
export interface DaysResponse {
  days: CalendarDay[]
  activities: Record<string, number[]>
}

/** Состояние года: создан ли календарь, режим, есть ли шаблон. */
export interface YearState {
  year: number
  filled: boolean
  mode: CalendarMode | null
  filledDays: number
  stateAvailable: boolean
  educationAvailable: boolean
}

/** Правка одного дня: можно поменять статус, метку или и то и другое. */
export interface DayPatch {
  date: string
  dayType?: CalendarDayType
  label?: string | null
}

/** День для пачки: статус обязателен, метка — нет. */
export interface DayUpdate {
  date: string
  dayType: CalendarDayType
  label?: string | null
}

/**
 * GET /api/calendar/years/:year
 *
 * По этому ответу решаем, спрашивать ли «работаешь?» (`filled`), показывать
 * ли кнопку производственного календаря (`mode`) и предупреждать ли, что
 * государственный календарь на год ещё не утверждён (`stateAvailable`).
 */
export async function fetchYearState(year: number): Promise<YearState> {
  return apiFetch<YearState>(`/calendar/years/${year}`)
}

/**
 * POST /api/calendar/years/:year/init
 *
 * Создать календарь на год. Повторный вызов вернёт 409 — год не
 * перезаписывается, чтобы не потерять правки пользователя.
 */
export async function createYear(year: number, mode: CalendarMode): Promise<YearState> {
  return apiFetch<YearState>(`/calendar/years/${year}/init`, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  })
}

/**
 * GET /api/calendar/days?from&to
 *
 * Дни диапазона. Фронт просит месяц вместе с хвостами соседних месяцев
 * (42 дня) — одним запросом на экран.
 */
export async function fetchDays(from: string, to: string): Promise<DaysResponse> {
  return apiFetch<DaysResponse>(`/calendar/days?from=${from}&to=${to}`)
}

/** GET /api/calendar/activities — справочник групп, избранное и запросы. */
export async function fetchActivityDictionary(): Promise<ActivityDictionary> {
  return apiFetch<ActivityDictionary>('/calendar/activities')
}

/** POST /api/calendar/activities — отметить активность на дне. */
export async function addActivity(
  date: string,
  activityTypeId: number,
): Promise<{ active: boolean }> {
  return apiFetch<{ active: boolean }>('/calendar/activities', {
    method: 'POST',
    body: JSON.stringify({ date, activityTypeId }),
  })
}

/**
 * DELETE /api/calendar/activities — снять отметку.
 *
 * Дата и тип едут в строке запроса: тело у DELETE поддерживается
 * неповсеместно, а параметры работают везде.
 */
export async function removeActivity(
  date: string,
  activityTypeId: number,
): Promise<{ active: boolean }> {
  return apiFetch<{ active: boolean }>(
    `/calendar/activities?date=${date}&activityTypeId=${activityTypeId}`,
    { method: 'DELETE' },
  )
}

/** PATCH /api/calendar/days/notes — обе заметки дня одним сохранением. */
export async function saveNotes(
  date: string,
  notes: { notePublic?: string | null; notePersonal?: string | null },
): Promise<CalendarDay> {
  return apiFetch<CalendarDay>('/calendar/days/notes', {
    method: 'PATCH',
    body: JSON.stringify({ date, ...notes }),
  })
}

/** POST /api/calendar/activity-requests — попросить новую активность. */
export async function createActivityRequest(label: string): Promise<ActivityRequest> {
  return apiFetch<ActivityRequest>('/calendar/activity-requests', {
    method: 'POST',
    body: JSON.stringify({ label }),
  })
}

/** PATCH /api/calendar/days — правка одного дня. Возвращает день как он есть. */
export async function patchDay(patch: DayPatch): Promise<CalendarDay> {
  return apiFetch<CalendarDay>('/calendar/days', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/**
 * PUT /api/calendar/days — пачка правок, «Сохранить» в модалке
 * производственного календаря. Если одна дата встречается дважды,
 * применяется последняя запись.
 */
export async function updateDays(days: DayUpdate[]): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>('/calendar/days', {
    method: 'PUT',
    body: JSON.stringify({ days }),
  })
}
