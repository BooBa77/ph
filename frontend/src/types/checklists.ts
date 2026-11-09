/**
 * Чек-листы на фронте.
 *
 * Значения `scope` — ровно те строки, что принимает и отдаёт бэкенд
 * (`backend/src/checklists/checklist.types.ts`). Русские подписи живут
 * только здесь: бэкенд отдаёт значения, а как их назвать — дело интерфейса.
 */

export const CHECKLIST_SCOPES = [
  'template',
  'trip',
  'personal',
  'recommendation',
] as const
export type ChecklistScope = (typeof CHECKLIST_SCOPES)[number]

/**
 * Вкладка похода, которой принадлежит список (09.11.2026).
 *
 * `gear` — «Снаряжение» и шаблоны профиля, `first_aid` — «Аптечка».
 * Уникальность списков считается парой «область + поход», поэтому общий
 * список снаряжения и общественная аптечка живут рядом, не мешая друг другу.
 */
export const CHECKLIST_AREAS = ['gear', 'first_aid'] as const

export type ChecklistArea = (typeof CHECKLIST_AREAS)[number]

/** Пункт списка: текст, отметка и её автор. */
export interface ChecklistItem {
  id: string
  title: string
  isDone: boolean
  /** Кто отметил. `null` — пункт не отмечен. */
  doneByUserId: string | null
  /** Когда отметили. Всегда пара с `doneByUserId`. */
  doneAt: string | null
  createdByUserId: string | null
  /**
   * Конкретная вещь снаряжения, на которую указывает пункт (31.10.2026).
   *
   * `null` — обычный текстовый пункт, и тогда `title` и есть весь текст.
   * Вещь удалили в каталоге — сервер присылает `null`, а `title` становится
   * именем типа («Палатка»): пункт не исчезает, а превращается в текст.
   */
  gear: ChecklistItemGear | null
  createdAt: string
}

/**
 * Вещь, на которую ссылается пункт: подпись без каталоговых подробностей.
 *
 * `title` живой: переименовали вещь — пункт показывает новое имя. Снимок
 * названия лежит в `ChecklistItem.title` и нужен только после удаления вещи.
 */
export interface ChecklistItemGear {
  id: string
  title: string
  /** Код типа: `tent`, `axe`. Контракт, на нём фильтруют экраны похода. */
  typeCode: string
  /** Название типа для человека: «Палатка», «Топор». */
  typeName: string
  /** Вес в граммах. `null` — не указан. */
  weightGrams: number | null
}

/**
 * Список целиком, с пунктами.
 *
 * Пункты приходят вместе со списком: вкладке нужен список сразу,
 * а отдельных запросов за пунктами нет намеренно — это второй круг
 * до базы на каждое открытие.
 */
export interface Checklist {
  id: string
  scope: ChecklistScope
  /** Вкладка похода: `gear` или `first_aid` (09.11.2026). */
  area?: ChecklistArea
  /** Заголовок. У списков похода обычно пустой. */
  title: string
  /**
   * Вес готовой аптечки в граммах. `null` — не взвешена.
   *
   * Поле имеет смысл только у области `first_aid`: в «Снаряжении» вес
   * считают вещи. Ноль в нём не встречается — «неизвестно» это `null`.
   * Необязательное — старые сохранённые ответы и моки без поля.
   */
  weightGrams?: number | null
  tripId: string | null
  ownerUserId: string | null
  items: ChecklistItem[]
  createdAt: string
  updatedAt: string
}

/**
 * Чек-листы похода глазами смотрящего (05.11.2026).
 *
 * - `shared` — список общественного снаряжения, его ведёт вкладка;
 * - `personal` — личный список участника, его видит только владелец;
 * - `recommendation` — совет организатора всем участникам. Пункты общие,
 *   а `isDone` — **свой у каждого**: сервер подмешивает отметки смотрящего.
 */
export interface TripChecklists {
  shared: Checklist | null
  personal: Checklist | null
  recommendation: Checklist | null
}

/** Отметка участника на пункте рекомендации. */
export interface RecommendationMark {
  itemId: string
  isDone: boolean
  doneAt: string | null
}
