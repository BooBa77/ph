import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Личные вещи в «Взял» и раздел «в палатку» (06.11.2026).
 *
 * ## Что просил заказчик
 *
 * «Ты сейчас переносишь общественное снаряжение, предложенное участником,
 * в раздел его личных вещей (см. скрин). Это не верно в корне. Личные вещи —
 * это то, что помимо общественного: одежда, каска, трекинговые палочки и т.п.
 * Сюда автоматически должно попадать содержимое секции „Спальник“ из
 * „Ночёвок“ — это личное. И если эта секция есть (ночёвки не в гостинице),
 * то также создаём раздел „в палатку“ в секции Походы/Снаряжение/Взял
 * (перед Одежда и Снаряга)».
 *
 * ## Модель
 *
 * Личные вещи **уже есть** — это `trip_route_sleeping` (секция «Спальник»
 * «Ночёвок»). Копий в `trip_gear` не заводим: снаряжение похода и личные
 * вещи — две разные таблицы, и вторая копия задвоила бы вес и «Берём».
 * Значит, «Взял» читает личные строки оттуда, а `GET /gear` отдаёт их
 * отдельным массивом `sleeping` — это изменение кода, не схемы.
 *
 * Личные **разделы** «Взял» в схеме уже есть (`trip_gear_sections`).
 * Не хватало двух вещей:
 *
 * 1. **Раздел «в палатку»** — он встаёт первым у участника похода, где есть
 *    ночь не в гостинице. Здесь же — существующие данные: у тех, кто уже
 *    открывал вкладку, шаблоны засеяны, и без миграции новый раздел
 *    не появился бы никогда (отметка «уже сеяли» живёт в участии).
 * 2. **Код шаблона `template_code`** — раздел ищется по коду, а не по
 *    названию. Переименованный «Табор» раньше переставал находиться
 *    автораскладкой; заказчик переименовывает разделы именно для себя,
 *    и код переживает переименование. У раздела, заведённого руками, код
 *    пуст — он ничей шаблон.
 *
 * ## Совместимость
 *
 * Колонка nullable, `down` её просто снимает: созданные разделы — обычные
 * разделы, и удалять их на откате было бы потерей работы человека.
 */
export class TripGearPersonal1792284000000 implements MigrationInterface {
  name = 'TripGearPersonal1792284000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_gear_sections"
        ADD COLUMN "template_code" character varying(32) NULL
    `);

    // Коды существующим шаблонам: до этого они различались только названием.
    // Только корневые разделы: «Вода» внутри «Водной части» — это уже
    // название, придуманное человеком, а не шаблон.
    //
    // Пятью запросами, а не одним `CASE`: PostgreSQL отказывает `CASE`
    // из одних строковых литералов в присваивании `varchar` (ошибка 42804,
    // «You will need to rewrite or cast the expression»), и каст в миграции
    // читался бы хуже, чем прямые пары «название → код».
    const knownTemplates: Array<[string, string]> = [
      ['camp', 'Табор'],
      ['bikes', 'к Велосипедам'],
      ['water', 'Вода'],
      ['clothes', 'Одежда'],
      ['gear', 'Снаряга'],
    ];

    for (const [code, title] of knownTemplates) {
      await queryRunner.query(
        `UPDATE "trip_gear_sections"
            SET "template_code" = $1
          WHERE "parent_id" IS NULL
            AND "scope" IN ('shared', 'personal')
            AND "title" = $2`,
        [code, title],
      );
    }

    // «в палатку» — первым в личных разделах, поэтому порядок 5:
    // существующие шаблоны стоят с 10 и не сдвигаются. Только там, где
    // «Ночёвки» действительно требуют спальник (палатка, изба, машина).
    //
    // `NULL::bigint` обязателен: с `DISTINCT` PostgreSQL выводит тип
    // безымянного `NULL` как `text`, и вставка падает на `parent_id bigint`
    // (ошибка 42804). Колонку-родителя здесь не заполняем — это корень.
    await queryRunner.query(`
      INSERT INTO "trip_gear_sections"
        ("trip_id", "scope", "owner_user_id", "parent_id", "title",
         "template_code", "sort_order")
      SELECT DISTINCT s."trip_id", 'personal', s."owner_user_id", NULL::bigint,
             'в палатку', 'tent_inside', 5
        FROM "trip_gear_sections" s
       WHERE s."scope" = 'personal'
         AND s."parent_id" IS NULL
         AND s."owner_user_id" IS NOT NULL
         AND EXISTS (
           SELECT 1
             FROM "trip_route_nights" n
            WHERE n."trip_id" = s."trip_id"
              AND n."kind" IN ('tent', 'hut', 'car')
         )
         AND NOT EXISTS (
           SELECT 1
             FROM "trip_gear_sections" x
            WHERE x."trip_id" = s."trip_id"
              AND x."scope" = 'personal'
              AND x."owner_user_id" = s."owner_user_id"
              AND x."template_code" = 'tent_inside'
         )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Разделы остаются: они уже живут своей жизнью, а «в палатку» мог быть
    // переименован и наполнен. Откатываем только служебный код.
    await queryRunner.query(`
      ALTER TABLE "trip_gear_sections"
        DROP COLUMN IF EXISTS "template_code"
    `);
  }
}
