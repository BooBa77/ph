import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { sqlValues } from '../../users/sport-experience.types';
import { User } from '../../users/entities/user.entity';
import {
  SPORT_CATEGORIES_BY_KIND,
  SPORT_KINDS,
  SPORT_TYPES,
  TRIP_STATUSES,
  TRIP_VISIBILITIES,
  type TripSportKind,
  type TripSportType,
  type TripStatus,
  type TripVisibility,
} from '../trip.types';
import { GeoObject } from './geo-object.entity';

/**
 * Категория сложности проверяется в связке с видом спорта: шкалы разные.
 * Скайраннинга в объекте категорий нет и быть не должно — там разряды
 * за дистанции, а не категории маршрута, поэтому `sport_category` у него
 * остаётся пустым.
 */
const SPORT_CATEGORY_CHECK = Object.entries(SPORT_CATEGORIES_BY_KIND)
  .map(
    ([kind, categories]) =>
      `("sport_kind" = '${kind}' AND "sport_category" IN (${sqlValues(categories)}))`,
  )
  .join(' OR ');
/**
 * Поход — центральная сущность проекта.
 *
 * ## Цель и заголовок
 *
 * `goal_object_id` обязателен и берётся из справочника: поход без цели —
 * это не поход. Он же служит заголовком, если `title` пуст, — но `title`
 * всё равно нужен: два похода на «Олхинское плато» в ленте неразличимы,
 * а коммерческому туру имя нужно по определению.
 *
 * ## Даты: три слоя, а не один
 *
 * Это самое неочевидное место в сущности, и путать слои нельзя.
 *
 * 1. **Прогноз** — `trip_date_variants`. Несколько строк, любая степень
 *    неопределённости («эти или следующие выходные», «летом на неделю»).
 * 2. **Решение** — `starts_at` и `ends_at` здесь. Момент, когда поход
 *    «решён»: одна дата вместо вариантов. По ним считается `ongoing`
 *    и `finished` и строится лента «кто идёт сейчас». Поэтому
 *    `status = 'decided'` без обеих дат запрещён CHECK-ом.
 * 3. **Факт** — `actual_started_at` и `actual_finished_at`. Заполняет
 *    организатор после похода; `NULL` значит «не отметили», а не «длился
 *    ноль дней». План при этом не затирается: «планировали 5–9, вышли
 *    6-го, вернулись 10-го» — это две разные правды, и обе нужны.
 *
 * Часы, а не дата: `timestamptz`. Выбор осознанный, и у него есть цена —
 * на многодневке, пересекающей часовые пояса, «когда вышли» зависит от
 * того, где считать. Приложение отправляет местное время, база хранит
 * момент, браузер показывает в своём поясе. Регион у проекта один
 * (Прибайкалье), так что расхождение — редкость, а не норма.
 *
 * ## Спорт: официальный поход и категория — разные оси
 *
 * `sport_category` (к.с. 1–6 у туризма, 1Б–6Б у альпинизма) описывает
 * **маршрут** и осмысленна у любого похода: «идём двойку» говорят и без
 * всякой книжки. `is_official` описывает **оформление**: выпуск МКК
 * или федерации, зачёт участникам и руководителю. Поэтому это два поля,
 * а не одно, и CHECK требует категорию только от официального похода.
 *
 * Руководитель официального похода — не организатор: это отдельная роль
 * в `roles` (`leader`), и назначается она участнику.
 *
 * ## Коммерция
 *
 * `is_commercial` — про то, что организатор зарабатывает. `price_rub` —
 * сколько стоит участие, и он не выводится из флага: у любительского
 * похода тоже бывает взнос «по три тысячи на заброску». Обратное
 * неверно — коммерческий поход без цены не бывает, это CHECK.
 *
 * Цена — **целые рубли**. Копейки в стоимости похода — шум, а `numeric`
 * в Node приезжает строкой («12500.00») и утёк бы в JSON как строка.
 * Оплаты внутри системы нет: поле информационное, эквайринга в проекте
 * не будет.
 */
@Entity('trips')
@Check(
  'chk_trips_visibility',
  `"visibility" IN (${sqlValues(TRIP_VISIBILITIES)})`,
)
@Check('chk_trips_status', `"status" IN (${sqlValues(TRIP_STATUSES)})`)
@Check(
  'chk_trips_decided_dates',
  `"status" <> 'decided' OR ("starts_at" IS NOT NULL AND "ends_at" IS NOT NULL)`,
)
@Check(
  'chk_trips_dates_order',
  `"starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" >= "starts_at"`,
)
@Check(
  'chk_trips_actual_dates_order',
  `"actual_started_at" IS NULL OR "actual_finished_at" IS NULL OR "actual_finished_at" >= "actual_started_at"`,
)
@Check(
  'chk_trips_actual_finish_needs_start',
  `"actual_finished_at" IS NULL OR "actual_started_at" IS NOT NULL`,
)
@Check(
  'chk_trips_idea_not_cancelled',
  `"status" <> 'idea' OR "cancelled_at" IS NULL`,
)
@Check(
  'chk_trips_sport_kind',
  `"sport_kind" IS NULL OR "sport_kind" IN (${sqlValues(SPORT_KINDS)})`,
)
@Check(
  'chk_trips_sport_type',
  `"sport_type" IS NULL OR "sport_type" IN (${sqlValues(SPORT_TYPES)})`,
)
/**
 * Обе проверки ниже намеренно начинаются с `"sport_kind" IS NOT NULL`,
 * и это не многословие. В SQL `NULL = 'tourism'` даёт не `false`, а `NULL`;
 * выражение `"sport_type" IS NULL OR "sport_kind" = 'tourism'` при пустом
 * `sport_kind` становится `NULL`, **а CHECK считает `NULL` выполненным**.
 * То есть вид туризма или категория без указанного вида спорта прошли бы
 * проверку. Поймано тестом `trips-schema-check`, а не глазами.
 */
@Check(
  'chk_trips_sport_type_is_tourism',
  `"sport_type" IS NULL OR ("sport_kind" IS NOT NULL AND "sport_kind" = 'tourism')`,
)
@Check(
  'chk_trips_sport_category',
  `"sport_category" IS NULL OR ("sport_kind" IS NOT NULL AND (${SPORT_CATEGORY_CHECK}))`,
)
@Check(
  'chk_trips_official_needs_sport',
  `"is_official" = false OR (
        "sport_kind" IS NOT NULL
        AND ("sport_kind" <> 'tourism' OR "sport_type" IS NOT NULL)
        AND ("sport_kind" = 'skyrunning' OR "sport_category" IS NOT NULL)
      )`,
)
@Check(
  'chk_trips_commercial_needs_price',
  `"is_commercial" = false OR "price_rub" IS NOT NULL`,
)
@Check('chk_trips_price_positive', `"price_rub" IS NULL OR "price_rub" > 0`)
export class Trip {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /**
   * Организатор — автор похода. Не меняется никогда, даже если человек
   * физически не идёт («организую, но в горы не поднимусь»). Нужен другой
   * организатор — создаётся другой поход.
   *
   * Не `trip_participant`: поход создаётся раньше участников, и ссылаться
   * было бы не на что. Обратная сторона — организатор обязан появиться
   * в `trip_participants` в той же транзакции, и это забота сервиса.
   */
  @Index('IDX_trips_organizer_user_id')
  @Column({ name: 'organizer_user_id', type: 'uuid' })
  organizerUserId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organizer_user_id' })
  organizer: User;

  /** Цель похода — заглавие, если `title` пуст. */
  @Index('IDX_trips_goal_object_id')
  @Column({ name: 'goal_object_id', type: 'bigint' })
  goalObjectId: string;

  @ManyToOne(() => GeoObject, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'goal_object_id' })
  goalObject: GeoObject;

  /**
   * Короткое имя похода. Пусто — в интерфейсе показывается имя цели.
   * Не NOT NULL именно поэтому: заставлять придумывать имя каждому ПВД
   * значит получать «Поход» и «Поход 2» в ленте.
   */
  @Column({ type: 'varchar', length: 120, nullable: true })
  title: string | null;

  /**
   * Маршрут: markdown (GFM) со ссылками `[[object:42]]`. Ссылки вставляются
   * кнопкой выбора объекта, руками не набираются, а имена подставляются
   * при рендере из справочника — поэтому в тексте лежат только id.
   *
   * Производная от этого текста — `trip_route_elements`: она нужна для
   * поиска «где упомянут Грандиозный», а сам текст остаётся источником
   * правды. Пересобирается целиком при сохранении похода.
   */
  @Column({ name: 'route_text', type: 'text', default: '' })
  routeText: string;

  /**
   * Требования к участникам: опыт, снаряжение, «нужны свои кошки».
   * Отдельное поле, а не абзац в маршруте: это то, по чему человек решает,
   * идти ли с вами, и оно не должно теряться в описании.
   */
  @Column({ name: 'requirements_text', type: 'text', nullable: true })
  requirementsText: string | null;

  @Column({ type: 'varchar', length: 20, default: 'public' })
  visibility: TripVisibility;

  /**
   * Ручной флаг «набор закрыт»: заявки не принимаются, кнопка «Хочу
   * с вами» пропадает, но поход остаётся видимым и приглашать можно.
   * У приватного похода смысла не имеет, но и не мешает.
   */
  @Column({ name: 'is_recruitment_closed', type: 'boolean', default: false })
  isRecruitmentClosed: boolean;

  /**
   * Активности из `calendar_activity_types` — массивом, а не связующей
   * таблицей: на практике их одна-две, а 99% походов — ровно одна.
   *
   * Цена решения: внешнего ключа у массива нет, существование id проверяет
   * триггер (`trg_trips_validate_activity_types`, см. миграцию). На
   * `is_active` он не смотрит намеренно: старый поход вправе ссылаться на
   * архивный тип, просто в выборе такой тип больше не предлагается.
   */
  @Column({
    name: 'activity_type_ids',
    type: 'int',
    array: true,
    default: () => "'{}'",
  })
  activityTypeIds: number[];

  /**
   * Стадия подготовки. `decided` — единственная, которая требует дат.
   * Отмена (`cancelled_at`) — отдельная ось: она не затирает статус,
   * потому что «отменили на этапе планирования» и «отменили решённый
   * поход» — разное, а истории подготовки похода мы не теряем.
   */
  @Column({ type: 'varchar', length: 20, default: 'idea' })
  status: TripStatus;

  /** Решение по датам. См. `chk_trips_decided_dates`. */
  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt: Date | null;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  /** Факт: когда вышли на маршрут и когда с него вернулись. */
  @Column({ name: 'actual_started_at', type: 'timestamptz', nullable: true })
  actualStartedAt: Date | null;

  @Column({ name: 'actual_finished_at', type: 'timestamptz', nullable: true })
  actualFinishedAt: Date | null;

  /** Официальный спортивный поход: выпуск МКК или федерации, зачёт. */
  @Column({ name: 'is_official', type: 'boolean', default: false })
  isOfficial: boolean;

  @Column({
    name: 'sport_kind',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  sportKind: TripSportKind | null;

  @Column({
    name: 'sport_type',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  sportType: TripSportType | null;

  @Column({
    name: 'sport_category',
    type: 'varchar',
    length: 4,
    nullable: true,
  })
  sportCategory: string | null;

  @Column({ name: 'is_commercial', type: 'boolean', default: false })
  isCommercial: boolean;

  @Column({ name: 'price_rub', type: 'int', nullable: true })
  priceRub: number | null;

  /** Что входит в стоимость: markdown. Без него это уезжает в маршрут. */
  @Column({ name: 'price_note', type: 'text', nullable: true })
  priceNote: string | null;

  /**
   * Отменённый поход остаётся в базе: история подготовки нужна для
   * повторного захода, а следящие должны увидеть, что поход не состоялся.
   */
  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /**
   * Не «когда редактировали» ради истории правок, а рабочий признак:
   * по нему строится лента «что нового» и дешёвая ревалидация карточки.
   *
   * Правит его только TypeORM. Сырой SQL (сид, админский скрипт) поле
   * не тронет: `DEFAULT now()` работает лишь при вставке. Появится правка
   * походов скриптом — понадобится триггер `BEFORE UPDATE`.
   */
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
