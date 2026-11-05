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
