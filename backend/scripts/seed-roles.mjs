/**
 * Наполнение справочника ролей участника похода.
 *
 * Роли — данные, а не код: их можно дополнять и переименовывать, поэтому
 * сидим скриптом, а не миграцией. Повторный запуск безопасен: строки
 * обновляются по `code`, новые добавляются.
 *
 * **Набор ролей зафиксирован заказчиком 17.11.2026:** «оставляем роли:
 * Соорганизатор, Завхоз, Медик, Технический лидер, Реммастер, Фотограф».
 * `organizer` остаётся служебной — её выдаёт сервер автору похода, в списке
 * назначения она неактивна. `driver` и `accountant` погашены: роль,
 * которую однажды назначили, физически удалить нельзя (`ON DELETE RESTRICT`
 * из `trip_participant_roles`), поэтому именно `is_active = false`.
 *
 * **`is_active` скрипт только гасит у `RETIRED` и никогда не возвращает.**
 * Роль, погашенная вручную, повторным запуском не поднимется: «перестали
 * предлагать» — решение админа. Возврат роли — отдельное действие.
 *
 * **Роли из списка не удаляются.** На роль ссылаются прошлые походы,
 * поэтому убрать её из справочника физически нельзя — можно только погасить.
 * Скрипт про это честно печатает в конце.
 *
 * Порядок массива — порядок в интерфейсе (выборка идёт по `id`).
 *
 * Запуск:
 *   node scripts/seed-roles.mjs
 *   npm run seed:roles
 */
import pg from 'pg';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Нужен MIGRATION_DATABASE_URL или DATABASE_URL');
  process.exit(2);
}

/**
 * Коды — латиницей и camelCase, как значения остальных словарей проекта
 * (`autoMoto`, `distanceHiking`): они уходят в API и в ссылки.
 * Подписи — русские: их видит человек.
 */
const ROLES = [
  { code: 'organizer', name: 'Организатор' },
  { code: 'coOrganizer', name: 'Соорганизатор' },
  { code: 'doctor', name: 'Медик' },
  { code: 'photographer', name: 'Фотограф' },
  { code: 'quartermaster', name: 'Завхоз' },
  { code: 'repairman', name: 'Реммастер' },
  { code: 'technicalLeader', name: 'Технический лидер' },
];

/** Погашенные роли: в выборе их больше нет, у прошлых походов они остаются. */
const RETIRED = ['driver', 'accountant'];

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query('BEGIN');

  for (const role of ROLES) {
    await client.query(
      `INSERT INTO roles (code, name)
       VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
      [role.code, role.name],
    );
  }

  // Погашенные роли остаются строками: на них ссылаются прошлые походы.
  await client.query(
    `UPDATE roles SET is_active = false WHERE code = ANY($1::text[]) AND is_active`,
    [RETIRED],
  );

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
}

const all = await client.query(
  `SELECT code, name, is_active FROM roles ORDER BY id`,
);
const used = await client.query(
  `SELECT count(DISTINCT role_id)::int AS count FROM trip_participant_roles`,
);

console.log('Справочник ролей:');
for (const row of all.rows) {
  console.log(
    `  ${row.code.padEnd(16)} ${row.name}${row.is_active ? '' : '  (погашена)'}`,
  );
}
console.log('');
console.log(`Всего ролей в справочнике: ${all.rowCount}`);
console.log(`Ролей, уже назначенных в походах: ${used.rows[0].count}`);
console.log(
  'Роль, которая перестала быть нужной, гасится через is_active, а не удаляется:',
);
console.log(
  'на неё ссылаются прошлые походы, и внешний ключ удаление не пропустит.',
);

await client.end();
