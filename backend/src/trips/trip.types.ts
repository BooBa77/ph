/**
 * Справочные списки и типы предметной области походов.
 *
 * Отдельный файл по той же причине, что и `sport-experience.types.ts`:
 * один и тот же список нужен сразу в трёх местах — DTO (валидация `@IsIn`),
 * entity (CHECK-и) и Swagger (`enum`).
 *
 * **Словари спорта не дублируются, а берутся из опыта пользователя.**
 * `TOURISM_KINDS`, `TOURISM_CATEGORIES` и `MOUNTAIN_CATEGORIES` уже описаны
 * в `users/sport-experience.types.ts`. Поход и профиль обязаны говорить
 * одними словами: иначе фильтр «покажи походы под мой опыт» не сойдётся —
 * человек заполнил «пешеходный, 2 к.с.», а база предложит ему «hiking, 2».
 * Поэтому здесь только импорт.
 */

import {
  MOUNTAIN_CATEGORIES,
  TOURISM_CATEGORIES,
  TOURISM_KINDS,
} from '../users/sport-experience.types';

/**
 * Видимость похода.
 *
 * `public` — виден всем зарегистрированным, `private` — только участникам.
 * Отдельного «по ссылке» нет: зарегистрированных немного, а третье
 * состояние пришлось бы объяснять в каждом запросе доступа.
 */
export const TRIP_VISIBILITIES = ['public', 'private'] as const;

export type TripVisibility = (typeof TRIP_VISIBILITIES)[number];

/**
 * Статус подготовки. Это три состояния «как далеко зашла подготовка»,
 * и ничего больше.
 *
 * `ongoing` и `finished` здесь намеренно отсутствуют: они не решение
 * человека, а следствие дат, и вычисляются из `starts_at`/`ends_at`.
 * Хранить их значило бы заводить поле, которое обязано меняться само, —
 * то есть врать, как только поход перенесли.
 */
export const TRIP_STATUSES = ['idea', 'planning', 'decided'] as const;

export type TripStatus = (typeof TRIP_STATUSES)[number];

/**
 * Статус участника.
 *
 * `invited` — пригласили, человек ещё не ответил; `going` — идёт;
 * `maybe` — 50/50; `declined` — не идёт по любой причине, включая
 * «организую, но сам не пойду». Отдельной роли «помощник» нет:
 * роли — про задачи, а не про участие.
 */
export const PARTICIPANT_STATUSES = [
  'invited',
  'going',
  'maybe',
  'declined',
] as const;

export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

/**
 * Направление тикета: приглашение (организатор → человек) или заявка
 * (человек → организатор). Обе живут в одной таблице — поля те же,
 * разница только в том, кто начал.
 */
export const REQUEST_DIRECTIONS = ['invite', 'apply'] as const;

export type RequestDirection = (typeof REQUEST_DIRECTIONS)[number];

/**
 * Виды чатов похода.
 *
 * Создаются оба сразу при создании похода, даже если поход приватный:
 * чат существует всегда, а кто в него впущен — вопрос доступа, а не
 * наличия строки.
 */
export const CHAT_KINDS = ['trip_guest', 'trip_members'] as const;

export type ChatKind = (typeof CHAT_KINDS)[number];

/**
 * Вид спорта у официального похода.
 *
 * Шкалы у них разные, и это не деталь: у спортивного туризма категория —
 * цифра плюс вид туризма, у альпинизма — категория маршрута с буквой
 * (1Б–6Б), а у скайраннинга категории маршрута нет вовсе (там разряды
 * за дистанции). Поэтому «категория» проверяется в связке с видом.
 */
export const SPORT_KINDS = ['tourism', 'alpinism', 'skyrunning'] as const;

export type TripSportKind = (typeof SPORT_KINDS)[number];

/**
 * Вид спортивного туризма — тот же словарь, что в профиле.
 *
 * Осмыслен только при `sport_kind = 'tourism'`: у альпинизма и
 * скайраннинга вида туризма нет.
 */
export const SPORT_TYPES = TOURISM_KINDS;

export type TripSportType = (typeof SPORT_TYPES)[number];

/**
 * Категории сложности по видам спорта.
 *
 * Ключи — значения `SPORT_KINDS`, у которых категория вообще есть:
 * скайраннинга здесь нет, и это осознанно. Именно из этого объекта
 * собирается CHECK в entity, поэтому добавить вид спорта с новой шкалой —
 * значит дописать сюда строку, а не искать CHECK по файлам.
 */
export const SPORT_CATEGORIES_BY_KIND = {
  tourism: TOURISM_CATEGORIES,
  alpinism: MOUNTAIN_CATEGORIES,
} as const;
