import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `trips.is_sport` → `trips.is_official`.
 *
 * Заказчик поправил слово: в этой среде говорят **«официальный поход»**,
 * а «спортивный» мимо словаря. Флаг при этом не меняет смысла — он
 * по-прежнему про зачётный, официально оформленный выход, и по-прежнему
 * открывает вкладку «Спорт» (её наполнение появится позже).
 *
 * Переименовывается только признак похода. **«Спортивный опыт» в профиле
 * не трогаем** — это другой домен: разряды по альпинизму и туризму,
 * и «официальный опыт» не значит ничего.
 *
 * Имя колонки меняется, а не «удалить и создать»: данные, права и
 * ограничения переезжают вместе с ней.
 */
export class TripsOfficialRename1792230000000 implements MigrationInterface {
  name = 'TripsOfficialRename1792230000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trips" RENAME COLUMN "is_sport" TO "is_official"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trips" RENAME COLUMN "is_official" TO "is_sport"`,
    );
  }
}
