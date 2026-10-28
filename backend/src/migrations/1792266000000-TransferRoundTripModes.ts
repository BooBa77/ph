import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Туда-обратно» бывает всем, кроме общественного транспорта (28.10.2026).
 *
 * Уточнение заказчика: «билеты на общественный транспорт — раздельно в
 * каждую сторону; бензин для своего ТС — за два конца; наёмный транспорт —
 * за два конца. Получается, всё, кроме общественного транспорта».
 *
 * Утром того же дня флаг отвязали от **вида компенсации** — и это осталось
 * верным: пара возможна и с «безвозмездно», и с общим расходом. Но привязка
 * к транспорту вернулась, только теперь по `mode`: у автобуса, ж/д, корабля
 * и вертолёта пары не бывает вовсе, потому что билет покупают в каждую
 * сторону отдельно.
 *
 * Данные чистим до установки CHECK-а: пара на рейсе — это ошибка, которую
 * до сих пор можно было завести. Зеркало такой пары убираем (без исходной
 * оно бессмысленно), а флаг на исходной снимаем — карточка остаётся, люди
 * и точки в ней никуда не деваются.
 */
export class TransferRoundTripModes1792266000000 implements MigrationInterface {
  name = 'TransferRoundTripModes1792266000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "trip_transfer_legs" m
       USING "trip_transfer_legs" s
       WHERE m."round_trip_source_id" = s."id"
         AND s."mode" IN ('bus', 'train', 'ship', 'helicopter')
    `);

    await queryRunner.query(`
      UPDATE "trip_transfer_legs"
         SET "is_round_trip" = false
       WHERE "is_round_trip" = true
         AND "mode" IN ('bus', 'train', 'ship', 'helicopter')
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_round_trip"
        CHECK (
          "is_round_trip" = false
          OR "mode" NOT IN ('bus', 'train', 'ship', 'helicopter')
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_round_trip"
    `);
  }
}
