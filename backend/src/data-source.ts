import 'reflect-metadata';
import { DataSource } from 'typeorm';

/**
 * DataSource для TypeORM CLI (миграции).
 * Используется ТОЛЬКО командами migration:generate / migration:run / migration:revert.
 * Рантайм приложения (NestJS) использует свою конфигурацию в app.module.ts.
 *
 * Подключается под MIGRATION_DATABASE_URL (юзер ph_migrator с DDL-правами),
 * а не под DATABASE_URL (юзер ph_app, только DML).
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});