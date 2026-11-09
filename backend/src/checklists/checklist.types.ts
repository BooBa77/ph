/**
 * Справочные значения домена чек-листов.
 *
 * Отдельный файл по той же причине, что `trip.types.ts`: один список нужен
 * entity (CHECK), DTO (`@IsIn`) и Swagger (`enum`). Держать его в трёх
 * местах — верный способ однажды разойтись.
 */

/**
 * Где живёт чек-лист. Четыре области — это и есть всё отличие списков
 * друг от друга: поля одинаковые, правила доступа разные.
 *
 * - `template` — шаблон пользователя, вне похода;
 * - `trip` — общий список похода, принадлежит походу;
 * - `personal` — личный список участника в походе;
 * - `recommendation` — список личных вещей, который организатор
 *   рекомендует всем участникам (05.11.2026). Принадлежит походу,
 *   как и `trip`: участники его видят, но не правят. Отметки выполнения
 *   у каждого участника свои и в этот список не возвращаются
 *   (`checklist_recommendation_marks`).
 */
export const CHECKLIST_SCOPES = [
  'template',
  'trip',
  'personal',
  'recommendation',
] as const;

export type ChecklistScope = (typeof CHECKLIST_SCOPES)[number];

/**
 * Области, которые создаются запросом из похода.
 *
 * `template` сюда не входит: шаблон заводят в профиле, а не в походе,
 * и «создать шаблон через поход» означало бы два входа в одну операцию.
 */
export const TRIP_CHECKLIST_SCOPES = [
  'trip',
  'personal',
  'recommendation',
] as const;

export type TripChecklistScope = (typeof TRIP_CHECKLIST_SCOPES)[number];

/**
 * Вкладка похода, которой принадлежит чек-лист (09.11.2026).
 *
 * До «Аптечки» область была одна — «Снаряжение». Теперь у списков похода
 * появился второй владелец: общественная и личная аптечка. Отдельная
 * колонка `area`, а не новый `scope`: область отвечает на вопрос «чья это
 * вкладка», а не «кто правит список». Права обеих осей считаются вместе
 * (`checklists.service.ts`).
 *
 * `recommendation` и шаблоны живут только в `gear`: рекомендация личных
 * вещей — часть «Снаряжения», а шаблоны профиля общие для всех вкладок.
 */
export const CHECKLIST_AREAS = ['gear', 'first_aid'] as const;

export type ChecklistArea = (typeof CHECKLIST_AREAS)[number];

/** Область по умолчанию: всё, что не аптечка, — снаряжение. */
export const DEFAULT_CHECKLIST_AREA: ChecklistArea = 'gear';

/**
 * Код вкладки, которой принадлежит область.
 *
 * Коды вкладок — контракт (`trip-tabs.ts`), и русские подписи здесь
 * не нужны: сервис проверяет права, а не рисует меню.
 */
export const CHECKLIST_AREA_TABS: Record<ChecklistArea, 'gear' | 'firstAid'> = {
  gear: 'gear',
  first_aid: 'firstAid',
};
