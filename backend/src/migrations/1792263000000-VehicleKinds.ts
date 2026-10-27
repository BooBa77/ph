import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Типы личной техники отдельно от способов доставки (27.10.2026).
 *
 * Заказчик: техника живёт в «Снаряжении», и для учёта нужны **тип**
 * (автомобиль, снегоход, квадроцикл, мотоцикл, велосипед, лодка), марка,
 * госномер и вместимость (необязательная).
 *
 * Прошлая редакция хранила в `vehicles.mode` способ доставки — это было
 * неверно: у способа есть рейсы (автобус, поезд, корабль, вертолёт),
 * которых в личной технике быть не может, а мотоцикла, снегохода
 * и велосипеда в способе не было вовсе. Теперь `kind` — свой список,
 * а связь «тип → способ» однозначна и живёт в коде
 * (`VEHICLE_KIND_TO_MODE`).
 *
 * `title` переименовано в `brand`: там всегда лежала марка («Нива»).
 * `note` убран — в списке нужных полей его не было.
 *
 * Данные dev переносятся грубо, но без потерь строк: старый `mode`
 * отображается в ближайший тип (аэролодка и лошади → лодка и автомобиль),
 * потому что это демонстрационные записи, а не пользовательские.
 */
export class VehicleKinds1792263000000 implements MigrationInterface {
  name = 'VehicleKinds1792263000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "vehicles" ADD COLUMN "kind" character varying(20)`);

    await queryRunner.query(`
      UPDATE "vehicles"
         SET "kind" = CASE "mode"
           WHEN 'atv' THEN 'atv'
           WHEN 'boat' THEN 'boat'
           WHEN 'airboat' THEN 'boat'
           WHEN 'horses' THEN 'car'
           ELSE 'car'
         END
    `);

    await queryRunner.query(`ALTER TABLE "vehicles" ALTER COLUMN "kind" SET NOT NULL`);

    await queryRunner.query(`
      ALTER TABLE "vehicles" DROP CONSTRAINT IF EXISTS "chk_vehicles_mode"
    `);

    await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN "mode"`);
    await queryRunner.query(`ALTER TABLE "vehicles" RENAME COLUMN "title" TO "brand"`);
    await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN "note"`);

    await queryRunner.query(`
      ALTER TABLE "vehicles"
        ADD CONSTRAINT "chk_vehicles_kind" CHECK ("kind" IN (
          'car', 'snowmobile', 'atv', 'motorcycle', 'bicycle', 'boat'
        ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vehicles" DROP CONSTRAINT IF EXISTS "chk_vehicles_kind"
    `);

    await queryRunner.query(`ALTER TABLE "vehicles" ADD COLUMN "note" character varying(500)`);
    await queryRunner.query(`ALTER TABLE "vehicles" RENAME COLUMN "brand" TO "title"`);

    await queryRunner.query(`
      ALTER TABLE "vehicles" ADD COLUMN "mode" character varying(20)
    `);

    await queryRunner.query(`
      UPDATE "vehicles"
         SET "mode" = CASE "kind"
           WHEN 'snowmobile' THEN 'other'
           WHEN 'motorcycle' THEN 'other'
           WHEN 'bicycle' THEN 'other'
           WHEN 'atv' THEN 'atv'
           WHEN 'boat' THEN 'boat'
           ELSE 'car'
         END
    `);

    await queryRunner.query(`ALTER TABLE "vehicles" ALTER COLUMN "mode" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN "kind"`);

    await queryRunner.query(`
      ALTER TABLE "vehicles"
        ADD CONSTRAINT "chk_vehicles_mode" CHECK ("mode" IN (
          'car', 'horses', 'atv', 'boat', 'airboat', 'other'
        ))
    `);
  }
}
