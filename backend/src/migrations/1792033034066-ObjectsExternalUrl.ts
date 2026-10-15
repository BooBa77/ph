import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ссылка на внешнюю страницу объекта справочника.
 *
 * Справочник наполняется с «Природы Байкала» (nature.baikal.ru), и объекту
 * нужна ссылка на его страницу там: справочник у нас — это список целей,
 * а описание, фотографии и подходы живут на сайте.
 *
 * Колонка необязательная и без формата: адреса у сайта свои
 * (`?obj=skala&id=vityaz`), а `CHECK` на «похоже на URL» ничего не гарантирует
 * и мешал бы, если однажды появится второй источник. Пустое значение —
 * норма: объект заводят раньше, чем находят его описание.
 *
 * Существующие объекты получают `NULL`, и это правильное поведение:
 * подставлять им что-либо догадкой нельзя, ссылки заполняет сид или админ.
 */
export class ObjectsExternalUrl1792033034066 implements MigrationInterface {
  name = 'ObjectsExternalUrl1792033034066';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "objects" ADD "url" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "objects" DROP COLUMN "url"`);
  }
}
