import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Поход — универсальная сущность: спортивные свойства уехали в отдельные
 * таблицы, цена стала строго коммерческой.
 *
 * Владелец пересмотрел решение в тот же день, когда схема была заведена
 * (`90af8c6`), и это записано **отдельной миграцией, а не правкой
 * предыдущей**. Предыдущая уже применена, а в проекте есть ровно такой же
 * прецедент — `DropUnusedUserFieldsAndAddDisplayNameHistory`. История
 * «сначала завели, потом убрали» честнее подправленной задним числом.
 *
 * 1. **Спорт уходит из `trips`.** `is_official`, `sport_kind`, `sport_type`,
 *    `sport_category` и пять CHECK-ов к ним удаляются. Вид спорта, категория
 *    сложности и официальность (выпуск МКК, зачёт участникам) — свойства
 *    **только спортивных** походов; описывать их будут отдельные таблицы
 *    со своими словарями. В общей таблице походов такие поля превращаются
 *    в набор NULL-ов, который тащат все запросы ленты, а смысл имеют
 *    у меньшинства записей.
 * 2. **Цена — только у коммерческого похода.** Добавлены два CHECK-а:
 *    `price_rub` и `price_note` у некоммерческого похода запрещены.
 *    Некоммерческий поход платы за участие не имеет вовсе; бывают
 *    **расходы** (заброска, закупка продуктов), но это другая сущность —
 *    с суммами, статьями и вопросом «кто кому должен», в одно поле она
 *    не помещается. Прежняя схема допускала у некоммерческого похода цену
 *    как «взнос на заброску» — это и было неверно.
 * 3. **`roles.is_active`.** Роль, которая перестала быть нужной, гасится,
 *    а не удаляется: на неё ссылаются прошлые походы, и `ON DELETE RESTRICT`
 *    всё равно не даст её убрать. Та же замена удалению, что у типов
 *    активностей в календаре.
 */
export class TripsDropSportFieldsAndTightenPrice1792028672606 implements MigrationInterface {
  name = 'TripsDropSportFieldsAndTightenPrice1792028672606';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trips" DROP CONSTRAINT "chk_trips_official_needs_sport"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" DROP CONSTRAINT "chk_trips_sport_category"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" DROP CONSTRAINT "chk_trips_sport_type_is_tourism"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" DROP CONSTRAINT "chk_trips_sport_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" DROP CONSTRAINT "chk_trips_sport_kind"`,
    );
    await queryRunner.query(`ALTER TABLE "trips" DROP COLUMN "is_official"`);
    await queryRunner.query(`ALTER TABLE "trips" DROP COLUMN "sport_kind"`);
    await queryRunner.query(`ALTER TABLE "trips" DROP COLUMN "sport_type"`);
    await queryRunner.query(`ALTER TABLE "trips" DROP COLUMN "sport_category"`);
    await queryRunner.query(
      `ALTER TABLE "roles" ADD "is_active" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" ADD CONSTRAINT "chk_trips_price_note_only_commercial" CHECK ("price_note" IS NULL OR "is_commercial")`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" ADD CONSTRAINT "chk_trips_price_only_commercial" CHECK ("price_rub" IS NULL OR "is_commercial")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trips" DROP CONSTRAINT "chk_trips_price_only_commercial"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" DROP CONSTRAINT "chk_trips_price_note_only_commercial"`,
    );
    await queryRunner.query(`ALTER TABLE "roles" DROP COLUMN "is_active"`);
    await queryRunner.query(
      `ALTER TABLE "trips" ADD "sport_category" character varying(4)`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" ADD "sport_type" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" ADD "sport_kind" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" ADD "is_official" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" ADD CONSTRAINT "chk_trips_sport_kind" CHECK (((sport_kind IS NULL) OR ((sport_kind)::text = ANY ((ARRAY['tourism'::character varying, 'alpinism'::character varying, 'skyrunning'::character varying])::text[]))))`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" ADD CONSTRAINT "chk_trips_sport_type" CHECK (((sport_type IS NULL) OR ((sport_type)::text = ANY ((ARRAY['hiking'::character varying, 'mountain'::character varying, 'ski'::character varying, 'water'::character varying, 'caving'::character varying, 'bicycle'::character varying, 'horse'::character varying, 'sailing'::character varying, 'autoMoto'::character varying])::text[]))))`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" ADD CONSTRAINT "chk_trips_sport_type_is_tourism" CHECK (((sport_type IS NULL) OR ((sport_kind IS NOT NULL) AND ((sport_kind)::text = 'tourism'::text))))`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" ADD CONSTRAINT "chk_trips_sport_category" CHECK (((sport_category IS NULL) OR ((sport_kind IS NOT NULL) AND ((((sport_kind)::text = 'tourism'::text) AND ((sport_category)::text = ANY ((ARRAY['1'::character varying, '2'::character varying, '3'::character varying, '4'::character varying, '5'::character varying, '6'::character varying])::text[]))) OR (((sport_kind)::text = 'alpinism'::text) AND ((sport_category)::text = ANY ((ARRAY['1Б'::character varying, '2А'::character varying, '2Б'::character varying, '3А'::character varying, '3Б'::character varying, '4А'::character varying, '4Б'::character varying, '5А'::character varying, '5Б'::character varying, '6А'::character varying, '6Б'::character varying])::text[])))))))`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" ADD CONSTRAINT "chk_trips_official_needs_sport" CHECK (((is_official = false) OR ((sport_kind IS NOT NULL) AND (((sport_kind)::text <> 'tourism'::text) OR (sport_type IS NOT NULL)) AND (((sport_kind)::text = 'skyrunning'::text) OR (sport_category IS NOT NULL)))))`,
    );
  }
}
