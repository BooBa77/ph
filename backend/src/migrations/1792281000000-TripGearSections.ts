import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Разделы «Берём» и «Взял» вкладки «Снаряжение» похода (05.11.2026).
 *
 * ## Что просил заказчик
 *
 * «В секциях „Берём“ и „Взял“ в Походы/Снаряжение будет возможность
 * создавать (редактировать и удалять) разделы, типа „Альпинизм“, „Пешка“,
 * а какие-то даже шаблонами встают, например, „Табор“, если есть ночёвки
 * и/или Готовка».
 *
 * План вкладки (`docs/ph/gear-tab.md` §3) описывал это раньше: вложенные
 * сворачиваемые разделы, произвольная вложенность, удаление раздела
 * высыпает вещи в корень, шаблоны — стартовый набор, а не ограничение.
 *
 * ## Модель
 *
 * **Одна таблица на оба вида разделов.** Общественный и личный раздел
 * отличаются только владельцем, а поля у них одни и те же: название,
 * порядок, родитель. Две таблицы дали бы два одинаковых CRUD-набора
 * и два способа ошибиться в них по-разному — тот же довод, что
 * у `checklists` с четырьмя областями.
 *
 * - `scope = 'shared'` — раздел похода, его видит весь состав и правит
 *   тот, кому дали вкладку «Снаряжение» (`owner_user_id` пуст);
 * - `scope = 'personal'` — раздел человека в «Взял», видит и правит только
 *   владелец (`owner_user_id` есть).
 *
 * **Вложенность — `parent_id` на себя.** Глубина не ограничена: заказчик
 * просил «Альпинизм» → «Верёвки», и отдельное поле глубины тут ничего
 * не добавляет. Цикл («раздел — родитель самого себя») ловит сервис:
 * SQL-ом такое не проверить без триггера на всю цепочку.
 *
 * **Вещь помнит два раздела, а не один.** В «Берём» вещь лежит
 * в общественном разделе, в «Взял» — в личном; это два разных ответа
 * на два разных вопроса, и общая колонка заставляла бы их вытеснять
 * друг друга. Поэтому у `trip_gear` две nullable-колонки.
 *
 * **`ON DELETE SET NULL` — и есть «высыпается в корень».** Заказчик:
 * «удаление секции не теряет вещи». Удаляем раздел — вещи остаются
 * в походе и показываются в корне своей большой секции. Дочерние разделы
 * уходят каскадом (`parent_id ON DELETE CASCADE`), и их вещи тоже
 * освобождаются: `SET NULL` срабатывает на каждую удаляемую строку.
 *
 * **Чем раздел отличается от «Не берём».** Отклонённые вещи живут
 * отдельным блоком и в разделах не показываются: «не берём» — решение,
 * а раздел — место. Если вещь вернули, она встаёт туда, где лежала.
 *
 * ## Шаблоны
 *
 * Шаблон — стартовый набор: создаётся один раз и дальше живёт обычной
 * строкой, которую можно переименовать и удалить. Отметка «уже засеяли»
 * лежит в `trips.gear_sections_seeded_at` и `trip_participants…`: без неё
 * удалённый «Табор» возвращался бы при каждом открытии вкладки, и «удалять»
 * означало бы «удалять до перезагрузки».
 *
 * - общественные: «Табор» — если в «Ночёвках» есть стоянка (палатка, изба,
 *   машина) или готовка, либо в походе есть палатка/тент; «к Велосипедам» —
 *   если среди типов похода есть велосипед; «Вода» — если есть водный тип
 *   (пока в справочнике его нет, но код готов);
 * - личные: «Снаряга», «Одежда».
 *
 * ## Права в базе
 *
 * Внешние ключи на разделы — обычные (по `id`), а не составные
 * `(trip_id, id)`: `ON DELETE SET NULL` у составного ключа обнулил бы
 * и `trip_id`, а он `NOT NULL`. «Раздел из чужого похода» поэтому ловит
 * триггер `trg_trip_gear_section_scope`: он же проверяет, что в
 * `shared_section_id` не попал личный раздел и наоборот.
 */
export class TripGearSections1792281000000 implements MigrationInterface {
  name = 'TripGearSections1792281000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Разделы: общие и личные в одной таблице.
    await queryRunner.query(`
      CREATE TABLE "trip_gear_sections" (
        "id" BIGSERIAL NOT NULL,
        "trip_id" bigint NOT NULL,
        "scope" varchar(20) NOT NULL,
        "owner_user_id" uuid,
        "parent_id" bigint,
        "title" varchar(60) NOT NULL,
        "sort_order" int NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_gear_sections" PRIMARY KEY ("id"),
        CONSTRAINT "chk_trip_gear_sections_scope" CHECK (
          ("scope" = 'shared' AND "owner_user_id" IS NULL)
          OR ("scope" = 'personal' AND "owner_user_id" IS NOT NULL)
        ),
        CONSTRAINT "chk_trip_gear_sections_title" CHECK (
          char_length(btrim("title")) BETWEEN 1 AND 60
        ),
        CONSTRAINT "chk_trip_gear_sections_order" CHECK ("sort_order" >= 0),
        CONSTRAINT "FK_trip_gear_sections_trip"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_trip_gear_sections_owner"
          FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_trip_gear_sections_parent"
          FOREIGN KEY ("parent_id") REFERENCES "trip_gear_sections"("id") ON DELETE CASCADE
      )
    `);

    /**
     * Пара `(trip_id, id)` уникальна тривиально, но нужна, если когда-нибудь
     * понадобится составной ключ «как у `trip_gear`». Индекс объявлен
     * в сущности — TypeORM должен видеть его в метаданных.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_gear_sections_trip_id"
          ON "trip_gear_sections" ("trip_id", "id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_gear_sections_owner"
          ON "trip_gear_sections" ("owner_user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_gear_sections_parent"
          ON "trip_gear_sections" ("parent_id")
    `);

    // 2. Отметки «шаблоны уже засеяли» — по одной на поход и на человека.
    await queryRunner.query(
      `ALTER TABLE "trips" ADD COLUMN "gear_sections_seeded_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_participants" ADD COLUMN "gear_sections_seeded_at" timestamptz`,
    );

    // 3. Место вещи в общественном и в личном разделе.
    await queryRunner.query(
      `ALTER TABLE "trip_gear" ADD COLUMN "shared_section_id" bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_gear" ADD COLUMN "personal_section_id" bigint`,
    );

    await queryRunner.query(`
      ALTER TABLE "trip_gear"
        ADD CONSTRAINT "FK_trip_gear_shared_section"
          FOREIGN KEY ("shared_section_id") REFERENCES "trip_gear_sections"("id")
          ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_gear"
        ADD CONSTRAINT "FK_trip_gear_personal_section"
          FOREIGN KEY ("personal_section_id") REFERENCES "trip_gear_sections"("id")
          ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_trip_gear_shared_section"
          ON "trip_gear" ("shared_section_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_gear_personal_section"
          ON "trip_gear" ("personal_section_id")
    `);

    /**
     * Раздел обязан быть из этого же похода и своего вида. API проверяет
     * то же самое, но строка, вставленная скриптом или будущей ручкой,
     * мимо сервиса не должна связать вещи двух походов.
     */
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION trip_gear_check_section_scope()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."shared_section_id" IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM "trip_gear_sections" s
           WHERE s."id" = NEW."shared_section_id"
             AND s."trip_id" = NEW."trip_id"
             AND s."scope" = 'shared'
        ) THEN
          RAISE EXCEPTION 'trip_gear.shared_section_id % не общественный раздел похода %',
            NEW."shared_section_id", NEW."trip_id";
        END IF;

        IF NEW."personal_section_id" IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM "trip_gear_sections" s
           WHERE s."id" = NEW."personal_section_id"
             AND s."trip_id" = NEW."trip_id"
             AND s."scope" = 'personal'
        ) THEN
          RAISE EXCEPTION 'trip_gear.personal_section_id % не личный раздел похода %',
            NEW."personal_section_id", NEW."trip_id";
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_trip_gear_section_scope"
        BEFORE INSERT OR UPDATE OF
          "shared_section_id", "personal_section_id", "trip_id"
        ON "trip_gear"
        FOR EACH ROW EXECUTE FUNCTION trip_gear_check_section_scope()
    `);

    /** Права приложению — как у остальных таблиц снаряжения. */
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "trip_gear_sections" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "trip_gear_sections_id_seq" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_trip_gear_section_scope" ON "trip_gear"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS trip_gear_check_section_scope()`,
    );

    await queryRunner.query(
      `ALTER TABLE "trip_gear" DROP CONSTRAINT "FK_trip_gear_shared_section"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_gear" DROP CONSTRAINT "FK_trip_gear_personal_section"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_gear" DROP COLUMN "shared_section_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_gear" DROP COLUMN "personal_section_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "trip_participants" DROP COLUMN "gear_sections_seeded_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" DROP COLUMN "gear_sections_seeded_at"`,
    );

    await queryRunner.query(`DROP TABLE "trip_gear_sections"`);
  }
}
