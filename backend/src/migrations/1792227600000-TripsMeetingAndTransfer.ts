import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Подготовка похода: место и время сбора плюс заброска.
 *
 * Каркас страницы похода показал, чего не хватает для «мяса»: человеку
 * мало знать, **куда** и **когда** идёт поход, — ему нужно знать, **где
 * и во сколько он встречается с остальными** и **как все добираются**.
 * Раньше это писалось текстом в маршруте, где и терялось.
 *
 * Три колонки, а не одна «дополнительная информация»: у них разная жизнь.
 * Место сбора — короткая строка, время сбора — момент (по нему можно
 * напомнить), заброска — текст (бывает и «пешком от электрички», и «две
 * машины, выезд в пятницу»). Свалив их в одно поле, мы потеряли бы
 * и сортировку, и напоминания.
 *
 * Всё `NULL`-able и без DEFAULT: у похода-мечты сбора ещё нет, и пустое
 * место не должно означать «сбор в полночь 1970 года».
 *
 * Часы сбора — `timestamptz`, как и остальные даты похода: см. разбор
 * трёх слоёв дат в `trip.entity.ts`.
 */
export class TripsMeetingAndTransfer1792227600000 implements MigrationInterface {
  name = 'TripsMeetingAndTransfer1792227600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trips"
         ADD COLUMN "meeting_place" character varying(200),
         ADD COLUMN "meeting_at" timestamptz,
         ADD COLUMN "transfer_text" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trips"
         DROP COLUMN "transfer_text",
         DROP COLUMN "meeting_at",
         DROP COLUMN "meeting_place"`,
    );
  }
}
