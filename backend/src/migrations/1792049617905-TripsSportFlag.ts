import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Флаг «спортивное мероприятие».
 *
 * Заказчик вернул признак, от которого я отказался раньше: **в `trips` это
 * только флаг**, а детали (вид спорта, категория сложности, выпуск МКК,
 * зачёт) живут в отдельных таблицах. Разница существенная: колонка-флаг
 * нужна всем запросам ленты — «покажи спортивные», — а спортивные
 * подробности нужны единицам записей и своим словарём.
 *
 * Флаг отдельный от `is_commercial`: спортивный поход бывает и платным,
 * и бесплатным, а коммерческий — не обязательно спортивным.
 */
export class TripsSportFlag1792049617905 implements MigrationInterface {
  name = 'TripsSportFlag1792049617905';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trips" ADD "is_sport" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "trips" DROP COLUMN "is_sport"`);
  }
}
