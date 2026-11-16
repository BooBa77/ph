import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Свежесть данных похода для офлайн-копии (16.11.2026).
 *
 * Заказчик: «Нужно понимать, что данные в кэше актуальны, вести у похода
 * какое-то поле „время последнего редактирования“ (включая чаты), по нему
 * сверять кэш и автоматически обновлять».
 *
 * Две колонки, а не одна, — разные задачи (решение `lifecycle.md` §2.2):
 *
 * - `content_updated_at` — **время** правки, его показываем человеку
 *   («данные на 14:32»);
 * - `content_revision` — **монотонный счётчик** того же события; по нему
 *   решаем «кэш устарел». Две правки в одну миллисекунду время не различит,
 *   а счётчик различит всегда. И часы сервера не влияют на решение:
 *   сравниваются числа, а не моменты.
 *
 * **Почему счётчик, а не `updated_at` самой строки.** `trips.updated_at`
 * двигается только правкой шапки похода; питание, снаряжение, деньги и
 * состав живут в других таблицах, и их изменения его не трогают.
 * `content_revision` поднимает приложение (`touchTrip`) в том же запросе,
 * что и правка, поэтому счётчик растёт на любую правку похода.
 *
 * Начальные значения: `0` и время последнего изменения строки. Для старых
 * походов это не идеальная правда, но кэша у них ещё нет — сравнение
 * с нулём начнётся с первого же сохранения.
 *
 * Чаты в счётчик **не входят** намеренно: одно сообщение заставляло бы
 * перечитывать все вкладки. У чатов свои курсоры (`lastMessageId`),
 * их отдаёт `GET /trips/:id/cache-state`.
 */
export class TripContentRevision1792299000000 implements MigrationInterface {
  name = 'TripContentRevision1792299000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips"
        ADD COLUMN "content_revision" bigint NOT NULL DEFAULT 0,
        ADD COLUMN "content_updated_at" timestamptz NOT NULL DEFAULT now()
    `);

    // Стартовая отметка — последнее известное изменение строки похода.
    await queryRunner.query(`
      UPDATE "trips" SET "content_updated_at" = COALESCE("updated_at", now())
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips"
        DROP COLUMN "content_updated_at",
        DROP COLUMN "content_revision"
    `);
  }
}
