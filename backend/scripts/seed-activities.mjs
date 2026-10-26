/**
 * Наполнение справочника активностей и первый админ.
 *
 * Группы и типы — данные, а не код: их можно править и дополнять, поэтому
 * сидим скриптом, а не миграцией. Повторный запуск безопасен: строки
 * обновляются по `code`, а новые добавляются.
 *
 * Иконки — ключи из `frontend/src/assets/activity-icons.ts`. Если ключа
 * в файле нет, фронт нарисует заглушку, поэтому порядок такой: сначала
 * иконка в коде, потом строка здесь.
 *
 * Запуск:
 *   node scripts/seed-activities.mjs [--admin=email@example.com]
 */
import pg from 'pg';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Нужен MIGRATION_DATABASE_URL или DATABASE_URL');
  process.exit(2);
}

/**
 * Группы и типы.
 *
 * Порядок массива — порядок закладок в модалке дня (сортируем по id).
 * Цвет живёт только у группы: иконки рисуются линиями через `currentColor`,
 * поэтому одна и та же иконка годится для любой группы.
 */
const GROUPS = [
  {
    code: 'sport',
    label: 'Спорт',
    color: '#1d6fb8',
    types: [
      { code: 'run', label: 'Бег', icon: 'run' },
      { code: 'bike', label: 'Велосипед', icon: 'bike' },
      { code: 'skates', label: 'Ролики', icon: 'skates' },
      { code: 'gym', label: 'Спортзал', icon: 'gym' },
    ],
  },
  {
    code: 'home',
    label: 'Дом',
    color: '#f2b705',
    types: [
      { code: 'sick', label: 'Болезнь', icon: 'sick' },
      { code: 'kids', label: 'Дети', icon: 'kids' },
      { code: 'repair', label: 'Ремонт', icon: 'repair' },
      { code: 'garden', label: 'Огород', icon: 'garden' },
      { code: 'parents', label: 'Родители', icon: 'parents' },
    ],
  },
  {
    code: 'work',
    label: 'Работа',
    color: '#6b7280',
    types: [
      { code: 'trip', label: 'Командировка', icon: 'trip' },
      { code: 'shift', label: 'Вахта', icon: 'shift' },
      { code: 'overtime', label: 'Сверхурочная работа', icon: 'overtime' },
    ],
  },
  {
    code: 'city',
    label: 'Город',
    color: '#8e44ad',
    types: [
      { code: 'cinema', label: 'Кино', icon: 'cinema' },
      { code: 'theatre', label: 'Театр', icon: 'theatre' },
      { code: 'party', label: 'Пьянка', icon: 'party' },
    ],
  },
];

const adminArg = process.argv.find((arg) => arg.startsWith('--admin='));
const adminEmail = adminArg ? adminArg.slice('--admin='.length) : null;

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query('BEGIN');

  for (const group of GROUPS) {
    const saved = await client.query(
      `INSERT INTO calendar_activity_groups (code, label, color)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, color = EXCLUDED.color
       RETURNING id`,
      [group.code, group.label, group.color],
    );
    const groupId = saved.rows[0].id;

    for (const type of group.types) {
      await client.query(
        `INSERT INTO calendar_activity_types (code, label, group_id, icon)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE
           SET label = EXCLUDED.label, group_id = EXCLUDED.group_id, icon = EXCLUDED.icon`,
        [type.code, type.label, groupId, type.icon],
      );
    }
  }

  if (adminEmail) {
    // Ищем пользователя по способу входа: email лежит в auth_identities.
    const found = await client.query(
      `SELECT user_id FROM auth_identities
        WHERE provider = 'email' AND lower(provider_user_id) = lower($1)
        LIMIT 1`,
      [adminEmail],
    );

    if (found.rowCount === 0) {
      console.warn(`Админ не добавлен: пользователь с адресом ${adminEmail} не найден`);
    } else {
      await client.query(
        `INSERT INTO admin_users (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [found.rows[0].user_id],
      );
      console.log(`Админ: ${adminEmail}`);
    }
  }

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
}

const summary = await client.query(
  `SELECT g.label AS group_label, count(t.id)::int AS types
     FROM calendar_activity_groups g
     LEFT JOIN calendar_activity_types t ON t.group_id = g.id
    GROUP BY g.id, g.label
    ORDER BY g.id`,
);
const admins = await client.query('SELECT count(*)::int AS count FROM admin_users');

console.log('Справочник активностей:');
for (const row of summary.rows) {
  console.log(`  ${row.group_label}: ${row.types}`);
}
console.log(`Админов в базе: ${admins.rows[0].count}`);

await client.end();
