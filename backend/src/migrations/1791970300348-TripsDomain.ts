import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Домен походов: справочник географических объектов, роли, сами походы,
 * их варианты дат, участники, заявки и чаты.
 *
 * Схема сгенерирована из entity (`migration:generate`), поэтому имена
 * ключей и индексов — те же хэши, что ожидает TypeORM: `schema:log` не
 * должен показывать дрейф. Руками добавлено только то, чего entity
 * выразить не может, — права для роли приложения и триггеры.
 *
 * ## Чем это отличается от исходного обсуждения
 *
 * Расхождения не случайные, каждое — следствие того, что проект уже
 * устроен определённым образом:
 *
 * 1. **Таблицы во множественном числе** (`trips`, `objects`, `roles`,
 *    `chats`) — конвенция проекта: `users`, `calendar_activities`,
 *    `calendar_activity_types`.
 * 2. **`role` → `roles`**: `ROLE` — зарезервированное слово PostgreSQL,
 *    и таблица с таким именем требовала бы кавычек в каждом сыром
 *    запросе и в psql.
 * 3. **FK на пользователя — `uuid`**, а не `BIGINT`: `users.id` имеет
 *    тип `uuid`. Ходить `BIGINT`-ом в него нельзя.
 * 4. **Даты разделены на три слоя.** `trip_date_variants` — прогноз;
 *    `trips.starts_at`/`ends_at` — решение (по ним считается `ongoing`
 *    и `finished`, и `status = 'decided'` без них запрещён CHECK-ом);
 *    `trips.actual_started_at`/`actual_finished_at` — факт. Часы, а не
 *    дата: выбрано `timestamptz`.
 * 5. **Добавлены поля, которых в обсуждении не было:** `title` (иначе
 *    два похода на одну цель неразличимы в ленте), `requirements_text`
 *    (требования к участникам — это то, по чему решают, идти ли),
 *    спортивные признаки (`is_official`, `sport_kind`, `sport_type`,
 *    `sport_category`) и коммерческие (`is_commercial`, `price_rub`,
 *    `price_note`). Словари спорта взяты из `sport-experience.types.ts`,
 *    чтобы поход и профиль говорили одними словами.
 * 6. **`direct_messages` вынесена за рамки этой миграции.** Личные
 *    сообщения не ссылаются на походы и к этому домену не относятся;
 *    им место в отдельной миграции вместе со своим сервисом.
 *
 * ## Триггеры: почему не всё можно проверить CHECK-ом
 *
 * CHECK видит только одну строку. Три правила ниже — межстрочные, и в
 * схеме их выразить нечем:
 *
 * - `trg_objects_prevent_delete` — объект справочника, упомянутый в
 *   `trips.route_text` как `[[object:N]]`, удалять нельзя. Внешние ключи
 *   защищают `trip_route_elements` и `trips.goal_object_id`, но **текст
 *   маршрута — не таблица**, и FK туда не дотянется. Это вторая линия
 *   обороны: админский инструмент сначала заменяет ссылки, а триггер
 *   ловит забытые случаи. Поиск идёт `LIKE '%…%'`, то есть seq scan;
 *   для ручной админской операции это приемлемо.
 * - `trg_trips_validate_activity_types` — массив `activity_type_ids`
 *   внешнего ключа иметь не может, поэтому существование id проверяет
 *   триггер. На `is_active` он намеренно не смотрит: старый поход вправе
 *   ссылаться на архивный тип активности, просто в выборе такой больше
 *   не предлагается.
 * - `trg_trip_participants_prevent_organizer_delete` — организатора
 *   нельзя убрать из участников. Источник правды — `trips.organizer_user_id`,
 *   и потерять его нельзя даже ручной правкой в базе.
 */
export class TripsDomain1791970300348 implements MigrationInterface {
  name = 'TripsDomain1791970300348';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "objects" ("id" BIGSERIAL NOT NULL, "name" character varying(200) NOT NULL, "type" character varying(50) NOT NULL, "parent_id" bigint, CONSTRAINT "chk_objects_no_self_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id"), CONSTRAINT "PK_87b86663af0123508099f0d970a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_objects_parent_id" ON "objects" ("parent_id") `,
    );
    await queryRunner.query(`CREATE TABLE "trips" ("id" BIGSERIAL NOT NULL, "organizer_user_id" uuid NOT NULL, "goal_object_id" bigint NOT NULL, "title" character varying(120), "route_text" text NOT NULL DEFAULT '', "requirements_text" text, "visibility" character varying(20) NOT NULL DEFAULT 'public', "is_recruitment_closed" boolean NOT NULL DEFAULT false, "activity_type_ids" integer array NOT NULL DEFAULT '{}', "status" character varying(20) NOT NULL DEFAULT 'idea', "starts_at" TIMESTAMP WITH TIME ZONE, "ends_at" TIMESTAMP WITH TIME ZONE, "actual_started_at" TIMESTAMP WITH TIME ZONE, "actual_finished_at" TIMESTAMP WITH TIME ZONE, "is_official" boolean NOT NULL DEFAULT false, "sport_kind" character varying(20), "sport_type" character varying(20), "sport_category" character varying(4), "is_commercial" boolean NOT NULL DEFAULT false, "price_rub" integer, "price_note" text, "cancelled_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_trips_price_positive" CHECK ("price_rub" IS NULL OR "price_rub" > 0), CONSTRAINT "chk_trips_commercial_needs_price" CHECK ("is_commercial" = false OR "price_rub" IS NOT NULL), CONSTRAINT "chk_trips_official_needs_sport" CHECK ("is_official" = false OR (
        "sport_kind" IS NOT NULL
        AND ("sport_kind" <> 'tourism' OR "sport_type" IS NOT NULL)
        AND ("sport_kind" = 'skyrunning' OR "sport_category" IS NOT NULL)
      )), CONSTRAINT "chk_trips_sport_category" CHECK ("sport_category" IS NULL OR ("sport_kind" IS NOT NULL AND (("sport_kind" = 'tourism' AND "sport_category" IN ('1', '2', '3', '4', '5', '6')) OR ("sport_kind" = 'alpinism' AND "sport_category" IN ('1Б', '2А', '2Б', '3А', '3Б', '4А', '4Б', '5А', '5Б', '6А', '6Б'))))), CONSTRAINT "chk_trips_sport_type_is_tourism" CHECK ("sport_type" IS NULL OR ("sport_kind" IS NOT NULL AND "sport_kind" = 'tourism')), CONSTRAINT "chk_trips_sport_type" CHECK ("sport_type" IS NULL OR "sport_type" IN ('hiking', 'mountain', 'ski', 'water', 'caving', 'bicycle', 'horse', 'sailing', 'autoMoto')), CONSTRAINT "chk_trips_sport_kind" CHECK ("sport_kind" IS NULL OR "sport_kind" IN ('tourism', 'alpinism', 'skyrunning')), CONSTRAINT "chk_trips_idea_not_cancelled" CHECK ("status" <> 'idea' OR "cancelled_at" IS NULL), CONSTRAINT "chk_trips_actual_finish_needs_start" CHECK ("actual_finished_at" IS NULL OR "actual_started_at" IS NOT NULL), CONSTRAINT "chk_trips_actual_dates_order" CHECK ("actual_started_at" IS NULL OR "actual_finished_at" IS NULL OR "actual_finished_at" >= "actual_started_at"), CONSTRAINT "chk_trips_dates_order" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" >= "starts_at"), CONSTRAINT "chk_trips_decided_dates" CHECK ("status" <> 'decided' OR ("starts_at" IS NOT NULL AND "ends_at" IS NOT NULL)), CONSTRAINT "chk_trips_status" CHECK ("status" IN ('idea', 'planning', 'decided')), CONSTRAINT "chk_trips_visibility" CHECK ("visibility" IN ('public', 'private')), CONSTRAINT "PK_f71c231dee9c05a9522f9e840f5" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE INDEX "IDX_trips_organizer_user_id" ON "trips" ("organizer_user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_trips_goal_object_id" ON "trips" ("goal_object_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "trip_route_elements" ("trip_id" bigint NOT NULL, "object_id" bigint NOT NULL, CONSTRAINT "PK_a839995b96ed29ce803d7c86689" PRIMARY KEY ("trip_id", "object_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_trip_route_elements_object_id" ON "trip_route_elements" ("object_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "trip_participants" ("trip_id" bigint NOT NULL, "user_id" uuid NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'invited', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_trip_participants_status" CHECK ("status" IN ('invited', 'going', 'maybe', 'declined')), CONSTRAINT "PK_6ea8c2cf8e958697f6739f8a572" PRIMARY KEY ("trip_id", "user_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_trip_participants_user_id" ON "trip_participants" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "roles" ("id" BIGSERIAL NOT NULL, "code" character varying(50) NOT NULL, "name" character varying(100) NOT NULL, CONSTRAINT "UQ_f6d54f95c31b73fb1bdd8e91d0c" UNIQUE ("code"), CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "trip_participant_roles" ("trip_id" bigint NOT NULL, "user_id" uuid NOT NULL, "role_id" bigint NOT NULL, CONSTRAINT "PK_31ea16ff7165ee7e5cd6d2b9d89" PRIMARY KEY ("trip_id", "user_id", "role_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "trip_date_variants" ("id" BIGSERIAL NOT NULL, "trip_id" bigint NOT NULL, "year" smallint, "month" smallint, "day" smallint, "duration_days" smallint, "duration_delta" smallint NOT NULL DEFAULT '0', CONSTRAINT "chk_trip_date_variants_not_empty" CHECK ("year" IS NOT NULL OR "month" IS NOT NULL OR "day" IS NOT NULL OR "duration_days" IS NOT NULL), CONSTRAINT "chk_trip_date_variants_delta_needs_duration" CHECK ("duration_delta" = 0 OR "duration_days" IS NOT NULL), CONSTRAINT "chk_trip_date_variants_delta_nonneg" CHECK ("duration_delta" >= 0), CONSTRAINT "chk_trip_date_variants_duration_positive" CHECK ("duration_days" IS NULL OR "duration_days" > 0), CONSTRAINT "chk_trip_date_variants_day_needs_month" CHECK ("day" IS NULL OR "month" IS NOT NULL), CONSTRAINT "chk_trip_date_variants_day" CHECK ("day" IS NULL OR "day" BETWEEN 1 AND 31), CONSTRAINT "chk_trip_date_variants_month" CHECK ("month" IS NULL OR "month" BETWEEN 1 AND 12), CONSTRAINT "chk_trip_date_variants_year" CHECK ("year" IS NULL OR "year" BETWEEN 1960 AND 2100), CONSTRAINT "PK_1b1313e95890ae33df5f5c0fee3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_trip_date_variants_trip_id" ON "trip_date_variants" ("trip_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "trip_membership_requests" ("id" BIGSERIAL NOT NULL, "trip_id" bigint NOT NULL, "user_id" uuid NOT NULL, "direction" character varying(20) NOT NULL, "message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_trip_membership_requests_direction" CHECK ("direction" IN ('invite', 'apply')), CONSTRAINT "PK_b00ecb2f18079d655e54615b580" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_trip_membership_requests_trip_id" ON "trip_membership_requests" ("trip_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_trip_membership_requests_user_id" ON "trip_membership_requests" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_trip_membership_requests_trip_user" ON "trip_membership_requests" ("trip_id", "user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "chats" ("id" BIGSERIAL NOT NULL, "kind" character varying(30) NOT NULL, "trip_id" bigint, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0117647b3c4a4e5ff198aeb6206" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_chats_trip_kind" ON "chats" ("trip_id", "kind") WHERE "trip_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "group_messages" ("id" BIGSERIAL NOT NULL, "chat_id" bigint NOT NULL, "sender_id" uuid, "body" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f4b396868f303fa38023b61d742" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_group_messages_chat_created" ON "group_messages" ("chat_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "objects" ADD CONSTRAINT "FK_3e39671143c678ee5c777c1704a" FOREIGN KEY ("parent_id") REFERENCES "objects"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" ADD CONSTRAINT "FK_2da168f27aa5151aa14cc0ea895" FOREIGN KEY ("organizer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" ADD CONSTRAINT "FK_dd48e4de265545f3dd8bfe1ca05" FOREIGN KEY ("goal_object_id") REFERENCES "objects"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_route_elements" ADD CONSTRAINT "FK_d7b0e95abf395745fdf7f369963" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_route_elements" ADD CONSTRAINT "FK_e3e92ce5f270b49993208eee5ea" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_participants" ADD CONSTRAINT "FK_5269270f2abac0e35f4fcda0780" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_participants" ADD CONSTRAINT "FK_7941097e6894fce4e5cdb6ac302" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_participant_roles" ADD CONSTRAINT "FK_c0e39a69908222c90caa246b4c1" FOREIGN KEY ("trip_id", "user_id") REFERENCES "trip_participants"("trip_id","user_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_participant_roles" ADD CONSTRAINT "FK_6ce01290573939d62fb307d9892" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_date_variants" ADD CONSTRAINT "FK_49b27ab479acc61cd2dae9d5cdb" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_membership_requests" ADD CONSTRAINT "FK_1b6cbbc168e64b0cc6419ae29d0" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_membership_requests" ADD CONSTRAINT "FK_889611083cb03b6f1cf0cfee559" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "chats" ADD CONSTRAINT "FK_e30aacf096339353abd00b72c60" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "group_messages" ADD CONSTRAINT "FK_bd2fba09cbf551fc641e059500b" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "group_messages" ADD CONSTRAINT "FK_ada93de56050fe469b3c53fe49f" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    /**
     * Триггер-страховка: объект, упомянутый в тексте маршрута, не удаляем.
     *
     * `[[object:N]]` живёт строкой внутри markdown, поэтому внешним
     * ключом эта связь не выражается. Если админский инструмент
     * почему-то пропустил ссылку, удаление не пройдёт — иначе в тексте
     * осталась бы битая ссылка, которую нечем починить.
     */
    await queryRunner.query(`
            CREATE OR REPLACE FUNCTION objects_prevent_delete_if_referenced()
            RETURNS TRIGGER AS $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM trips
                    WHERE route_text LIKE '%[[object:' || OLD.id || ']]%'
                ) THEN
                    RAISE EXCEPTION 'Object % is still referenced in trips.route_text', OLD.id;
                END IF;
                RETURN OLD;
            END;
            $$ LANGUAGE plpgsql;
        `);
    await queryRunner.query(`
            CREATE TRIGGER trg_objects_prevent_delete
            BEFORE DELETE ON objects
            FOR EACH ROW
            EXECUTE FUNCTION objects_prevent_delete_if_referenced();
        `);

    /**
     * Массив `activity_type_ids` без внешнего ключа: существование id
     * проверяет триггер. Архивные (`is_active = false`) типы не
     * отвергаются — старый поход вправе на них ссылаться.
     */
    await queryRunner.query(`
            CREATE OR REPLACE FUNCTION trips_validate_activity_types()
            RETURNS TRIGGER AS $$
            BEGIN
                IF NEW.activity_type_ids IS NOT NULL
                   AND EXISTS (
                       SELECT 1
                       FROM unnest(NEW.activity_type_ids) AS aid
                       WHERE NOT EXISTS (
                           SELECT 1 FROM calendar_activity_types WHERE id = aid
                       )
                   )
                THEN
                    RAISE EXCEPTION 'trips.activity_type_ids contains missing ids: %', NEW.activity_type_ids;
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);
    await queryRunner.query(`
            CREATE TRIGGER trg_trips_validate_activity_types
            BEFORE INSERT OR UPDATE ON trips
            FOR EACH ROW
            EXECUTE FUNCTION trips_validate_activity_types();
        `);

    /**
     * Организатора из участников не убираем: он автор похода, даже
     * если сам не идёт и его статус — `declined`.
     *
     * Здесь можно было бы ожидать ловушку: `DELETE FROM trips` каскадом
     * удаляет участников, и триггер на строке организатора как будто
     * обязан найти родительский поход и завалить удаление всего похода.
     * **Проверено — не заваливает.** Каскад выполняется RI-триггером
     * с текущим снимком, в котором удаляемый поход уже не виден, поэтому
     * условие `EXISTS` ложно и удаление проходит. Прямой
     * `DELETE FROM trip_participants` идёт со снимком команды, поход
     * в нём виден — и организатор не удаляется.
     *
     * Отсюда сознательное решение: **обхода через `pg_trigger_depth()`
     * здесь нет.** Он был написан по рассуждению «каскад обязан мешать»,
     * тест это опроверг, и лишняя ветка убрана. Проверка поведения —
     * `.tmp-verify/trips-schema-check.mjs`, тесты «организатора удалить
     * нельзя» и «удаление похода проходит».
     */
    await queryRunner.query(`
            CREATE OR REPLACE FUNCTION trip_participants_prevent_organizer_delete()
            RETURNS TRIGGER AS $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM trips
                    WHERE id = OLD.trip_id AND organizer_user_id = OLD.user_id
                ) THEN
                    RAISE EXCEPTION 'Cannot remove organizer % from trip %', OLD.user_id, OLD.trip_id;
                END IF;
                RETURN OLD;
            END;
            $$ LANGUAGE plpgsql;
        `);
    await queryRunner.query(`
            CREATE TRIGGER trg_trip_participants_prevent_organizer_delete
            BEFORE DELETE ON trip_participants
            FOR EACH ROW
            EXECUTE FUNCTION trip_participants_prevent_organizer_delete();
        `);

    /**
     * Права для роли приложения.
     *
     * Честно о механизме: на проде `ALTER DEFAULT PRIVILEGES FOR ROLE
     * ph_migrator` **уже** выдаёт `ph_app` полный DML на новые таблицы
     * и `USAGE, SELECT` на их последовательности (проверено 15.10.2026
     * запросом к `pg_default_acl`). То есть этот блок ничего не сужает —
     * он документирует, что приложению нужно, и подстраховывает, если
     * миграцию когда-нибудь прогонят ролью без этих default privileges.
     * Если права когда-нибудь понадобится действительно ограничить,
     * этого блока мало: нужен `REVOKE`.
     *
     * Набор намеренно разный. Справочники и связи, которые приложение
     * только читает или пересобирает целиком, не получают `UPDATE`:
     * сообщения не редактируются, тикеты не правятся (их удаляют),
     * роли участника не меняются — их снимают и ставят заново.
     * В dev роли `ph_app` нет, поэтому блок проверяет её наличие.
     */
    await queryRunner.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
                    GRANT SELECT, INSERT, UPDATE, DELETE ON "objects" TO ph_app;
                    GRANT SELECT ON "roles" TO ph_app;
                    GRANT SELECT, INSERT, UPDATE, DELETE ON "trips" TO ph_app;
                    GRANT SELECT, INSERT, UPDATE, DELETE ON "trip_date_variants" TO ph_app;
                    GRANT SELECT, INSERT, DELETE ON "trip_route_elements" TO ph_app;
                    GRANT SELECT, INSERT, UPDATE, DELETE ON "trip_participants" TO ph_app;
                    GRANT SELECT, INSERT, DELETE ON "trip_participant_roles" TO ph_app;
                    GRANT SELECT, INSERT, DELETE ON "trip_membership_requests" TO ph_app;
                    GRANT SELECT, INSERT, DELETE ON "chats" TO ph_app;
                    GRANT SELECT, INSERT ON "group_messages" TO ph_app;
                END IF;
            END $$;
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Триггеры и функции снимаем до таблиц: функция пережила бы
    // DROP TABLE и осталась бы в базе мусором.
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_trip_participants_prevent_organizer_delete" ON "trip_participants"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_trips_validate_activity_types" ON "trips"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_objects_prevent_delete" ON "objects"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS trip_participants_prevent_organizer_delete()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS trips_validate_activity_types()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS objects_prevent_delete_if_referenced()`,
    );

    await queryRunner.query(
      `ALTER TABLE "group_messages" DROP CONSTRAINT "FK_ada93de56050fe469b3c53fe49f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "group_messages" DROP CONSTRAINT "FK_bd2fba09cbf551fc641e059500b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chats" DROP CONSTRAINT "FK_e30aacf096339353abd00b72c60"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_membership_requests" DROP CONSTRAINT "FK_889611083cb03b6f1cf0cfee559"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_membership_requests" DROP CONSTRAINT "FK_1b6cbbc168e64b0cc6419ae29d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_date_variants" DROP CONSTRAINT "FK_49b27ab479acc61cd2dae9d5cdb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_participant_roles" DROP CONSTRAINT "FK_6ce01290573939d62fb307d9892"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_participant_roles" DROP CONSTRAINT "FK_c0e39a69908222c90caa246b4c1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_participants" DROP CONSTRAINT "FK_7941097e6894fce4e5cdb6ac302"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_participants" DROP CONSTRAINT "FK_5269270f2abac0e35f4fcda0780"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_route_elements" DROP CONSTRAINT "FK_e3e92ce5f270b49993208eee5ea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_route_elements" DROP CONSTRAINT "FK_d7b0e95abf395745fdf7f369963"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" DROP CONSTRAINT "FK_dd48e4de265545f3dd8bfe1ca05"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" DROP CONSTRAINT "FK_2da168f27aa5151aa14cc0ea895"`,
    );
    await queryRunner.query(
      `ALTER TABLE "objects" DROP CONSTRAINT "FK_3e39671143c678ee5c777c1704a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_group_messages_chat_created"`,
    );
    await queryRunner.query(`DROP TABLE "group_messages"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_chats_trip_kind"`);
    await queryRunner.query(`DROP TABLE "chats"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_trip_membership_requests_trip_user"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_trip_membership_requests_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_trip_membership_requests_trip_id"`,
    );
    await queryRunner.query(`DROP TABLE "trip_membership_requests"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_trip_date_variants_trip_id"`,
    );
    await queryRunner.query(`DROP TABLE "trip_date_variants"`);
    await queryRunner.query(`DROP TABLE "trip_participant_roles"`);
    await queryRunner.query(`DROP TABLE "roles"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_trip_participants_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "trip_participants"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_trip_route_elements_object_id"`,
    );
    await queryRunner.query(`DROP TABLE "trip_route_elements"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_trips_goal_object_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_trips_organizer_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "trips"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_objects_parent_id"`);
    await queryRunner.query(`DROP TABLE "objects"`);
  }
}
