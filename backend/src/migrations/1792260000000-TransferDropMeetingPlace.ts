import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Место сбора убрано из похода (27.10.2026).
 *
 * Решение заказчика по новой редакции «Трансфера»: **общего места сбора
 * нет**. С тех пор как каждая часть группы едет своей карточкой со своим
 * временем и точкой отправления, общая строка «где встречаемся» стала
 * третьим источником правды о выезде — и первым, который разойдётся.
 *
 * История поля: заведено 21.10.2026 (`TripsMeetingAndTransfer`) вместе
 * с временем сбора и текстом заброски, тогда же решено, что его место —
 * во вкладке «Трансфер». Вкладка появилась 27.10.2026 и показала, что
 * общее место там не нужно: у каждой карточки своя точка.
 *
 * Значения не переносятся — их некуда переносить: карточки создаются
 * людьми заново, а строка «Иркутск, автовокзал» без времени и способа
 * доставки не описывает ни одного перемещения.
 */
export class TransferDropMeetingPlace1792260000000 implements MigrationInterface {
  name = 'TransferDropMeetingPlace1792260000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips" DROP COLUMN IF EXISTS "meeting_place"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips"
        ADD COLUMN "meeting_place" character varying(200)
    `);
  }
}
