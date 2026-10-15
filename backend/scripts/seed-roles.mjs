/**
 * Наполнение справочника ролей участника похода.
 *
 * Роли — данные, а не код: их можно дополнять и переименовывать, поэтому
 * сидим скриптом, а не миграцией. Повторный запуск безопасен: строки
 * обновляются по `code`, новые добавляются.
 *
 * **`is_active` скрипт не трогает.** Если роль однажды погасили, повторный
 * запуск не вернёт её в строй: «перестали предлагать» — решение админа,
 * а не следствие того, что кто-то перезалил справочник. Возврат роли —
 * отдельное действие.
 *
 * **Роли из списка не удаляются.** На роль ссылаются прошлые походы
 * (`ON DELETE RESTRICT` из `trip_participant_roles`), поэтому убрать её
 * из справочника физически нельзя — можно только погасить. Скрипт про это
 * честно печатает в конце.
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
  { code: 'repairman', name: 'Ремонтник' },
  { code: 'driver', name: 'Водитель' },
  { code: 'accountant', name: 'Бухгалтер' },
  { code: 'technicalLeader', name: 'Технический лидер' },
];

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
