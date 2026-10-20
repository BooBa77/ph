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
  TRIP_STATUSES,
  TRIP_VISIBILITIES,
  type TripStatus,
  type TripVisibility,
} from '../trip.types';
import { GeoObject } from './geo-object.entity';

/**
 * Поход — центральная сущность проекта.
 *
 * ## Цель и заголовок
 *
 * `goal_object_id` обязателен и берётся из справочника: поход без цели —
 * это не поход. Он же служит заголовком, если `announcement` пуст, — но `announcement`
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
 * ## Универсальный поход, без спортивных свойств
 *
 * Здесь только то, что есть у **любого** похода — от пикника на Олхинском
 * плато до горной шестёрки: цель, даты, маршрут, участники, видимость,
 * цена. Вид спорта, категория сложности и официальность (выпуск МКК,
 * зачёт) — свойства **только спортивных** походов, и описывать их будут
 * отдельные таблицы. В `trips` их нет намеренно: поле, осмысленное
 * у меньшинства записей, в общей таблице превращается в набор NULL-ов,
 * который тащат все запросы ленты.
 *
 * Руководитель спортивного похода — не организатор, и это тоже отдельная
 * история: роли участников (`roles`, `trip_participant_roles`) для того
 * и заведены связкой, чтобы новая роль была строкой, а не колонкой.
 *
 * ## Коммерция
 *
 * `is_commercial` — про то, что организатор зарабатывает. Цена участия
 * есть **только** у коммерческого похода, и там она обязательна: чтобы
 * коммерсы не увиливали, а называли прайс сразу. Скидки — потом, поверх
 * названной цены.
 *
 * У некоммерческого похода платы за участие нет вовсе — ни нулевой, ни
 * символической. Бывают **расходы** (заброска, закупка продуктов), но это
 * другая сущность: у расходов есть суммы, статьи и вопрос «кто кому
 * должен», и в одно поле они не помещаются. Поэтому CHECK двусторонний:
 * коммерческий без цены запрещён, а некоммерческий с ценой — тоже.
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
  'chk_trips_commercial_needs_price',
  `"is_commercial" = false OR "price_rub" IS NOT NULL`,
)
@Check(
  'chk_trips_price_only_commercial',
  `"price_rub" IS NULL OR "is_commercial"`,
)
@Check(
  'chk_trips_price_note_only_commercial',
  `"price_note" IS NULL OR "is_commercial"`,
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

  /** Цель похода — она же имя похода в ленте. */
  @Index('IDX_trips_goal_object_id')
  @Column({ name: 'goal_object_id', type: 'bigint' })
  goalObjectId: string;

  @ManyToOne(() => GeoObject, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'goal_object_id' })
  goalObject: GeoObject;

  /**
   * Анонс: короткий текст, который видно в ленте.
   *
   * **Имя похода — это цель, а не анонс.** Народ смотрит сначала на цель
   * («пик Грандиозный»), потом на когда, потом на кого; три похода на Витязь
   * в ленте — норма, а не повод заставлять придумывать уникальное имя.
   * Поэтому поле необязательное и короткое: это подпись к цели, а не её
   * замена.
   */
  @Column({ type: 'varchar', length: 120, nullable: true })
  announcement: string | null;

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
   * Где собираются участники: «у вокзала, платформа 2».
   *
   * Отдельно от маршрута намеренно. Маршрут — это план движения, он
   * не меняется в день выхода; а место и время сбора меняются в последний
   * момент («перенесли на час позже»), и искать их в тексте в день похода
   * никто не будет. Короткое поле, которое видно сразу.
   */
  @Column({ name: 'meeting_place', type: 'varchar', length: 200, nullable: true })
  meetingPlace: string | null;

  /**
   * Когда собираются. Момент, а не дата: «в 8:00» — половина смысла сбора.
   *
   * Связи с `starts_at` нет намеренно: сбор бывает накануне вечером,
   * а бывает и за неделю до выхода — «собираемся обсудить раскладку».
   * Ограничение «сбор не позже старта» звучало бы логично и запретило бы
   * второе.
   */
  @Column({ name: 'meeting_at', type: 'timestamptz', nullable: true })
  meetingAt: Date | null;

  /**
   * Заброска: как добираемся до начала маршрута — обычный текст.
   *
   * Своё поле, а не абзац маршрута: заброска — первое, что читает человек,
   * решающий, идти ли с вами («электричка в 6:40 от вокзала» против
   * «две машины, выезд в пятницу вечером» — это разный уровень затрат).
   * Маршрут при этом остаётся маршрутом.
   *
   * Не markdown и без ссылок на объекты намеренно: индекс упоминаний
   * (`trip_route_elements`) собирается из маршрута, и ссылка на объект
   * отсюда сделала бы фильтр «походы про Витязь» неполным — объект был бы
   * в походе, но не в индексе.
   */
  @Column({ name: 'transfer_text', type: 'text', nullable: true })
  transferText: string | null;

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

  @Column({ name: 'is_commercial', type: 'boolean', default: false })
  isCommercial: boolean;

  /**
   * Официальный поход: зачётный выход, оформленный по правилам, — в обиходе
   * этой среды так называют то, что раньше стояло здесь как «спортивный».
   *
   * Здесь это **только флаг** — детали (вид спорта, дисциплина, категория
   * трудности, регистрация в МЧС) живут в отдельных таблицах, потому что
   * нужны меньшинству записей и своим словарём. Флаг открывает вкладку
   * «Спорт» на странице похода; наполнение вкладки появится отдельной
   * задачей. Спортивные *мероприятия* — сборы, соревнования — вообще
   * отдельная сущность и отдельный раздел: у них другая жизнь, другие
   * участники и другой смысл, и сваливать их в `trips` значило бы получить
   * таблицу, где половина полей пуста у половины строк.
   *
   * Флаг отдельный от `is_commercial`: официальный поход бывает и платным,
   * и бесплатным, а коммерческий — не обязательно официальным.
   *
   * `is_official`, а не `is_sport`: слово поправил заказчик. «Спортивный
   * опыт» в профиле — другой домен и переименования не касается.
   */
  @Column({ name: 'is_official', type: 'boolean', default: false })
  isOfficial: boolean;

  /**
   * Цена участия в рублях. Только у коммерческого похода и там обязательна
   * (`chk_trips_commercial_needs_price`); у некоммерческого её быть не может
   * (`chk_trips_price_only_commercial`). Расходы некоммерческого похода —
   * не это поле, см. описание класса.
   */
  @Column({ name: 'price_rub', type: 'int', nullable: true })
  priceRub: number | null;

  /** Что входит в стоимость: markdown. Осмысленно только с ценой. */
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
