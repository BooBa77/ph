/**
 * Наполнение справочника **рекомендуемых** групп снаряжения (02.11.2026).
 *
 * Группы с 02.11.2026 бывают двумя видами:
 *
 * - **рекомендуемые** (`gear_group_templates`) — их ведёт админ, они
 *   приходят новым пользователям копиями и определяют, в какую группу
 *   попадёт новый тип;
 * - **личные** (`gear_groups`) — копии у каждого человека, которые он
 *   вправе переименовать, переставить и удалить.
 *
 * Скрипт сидит только **рекомендуемые** группы: личные создаёт API при
 * первом открытии каталога (`GearGroupsService.ensure`), и трогать их
 * сидом нельзя — это правки людей.
 *
 * **Скрипт только вставляет и никогда не обновляет** — `ON CONFLICT (code)
 * DO NOTHING`. Имя и порядок — собственность админки: если админ
 * переименовал «Кров» в «Ночлег», повторный прогон не должен затирать
 * его правку. `is_active` тоже не трогаем.
 *
 * Набор — пять групп: Кров (палатка, тент, спальник, коврик), Костровое
 * (топор, пила, розжиг, таган), Кухня (горелка, газ), Посуда (котёл,
 * половник, нож) и «Прочее» — умолчание. Порядок 10/20/30/40/100:
 * «Прочее» последней, потому что это свалка, а не раздел. Личная копия
 * «Прочего» у человека тоже всегда последняя.
 *
 * Миграция `1792278000000-PersonalGearGroups` заводит те же строки — иначе
 * на свежей базе новому пользователю нечего было бы копировать. Сид нужен
 * для базы, где миграция уже прошла, а админ эти группы завёл бы заново...
 * удалить их нельзя, только архив; сид архивные не возвращает.
 *
 * Запуск (нужна живая dev-база):
 *   node scripts/seed-gear-groups.mjs
 *   npm run seed:gear-groups
 */
import pg from 'pg';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Нужен MIGRATION_DATABASE_URL или DATABASE_URL');
  process.exit(2);
}

/**
 * Рекомендуемые группы.
 *
 * `code` — латиница по `^[a-z][a-z0-9_]*$`: он уходит в API и на него
 * опирается умолчание `other`. `sortOrder` — порядок секций каталога.
 */
const GROUPS = [
  { code: 'roof', name: 'Кров', sortOrder: 10 },
  { code: 'campfire', name: 'Костровое', sortOrder: 20 },
  { code: 'kitchen', name: 'Кухня', sortOrder: 30 },
  { code: 'dishes', name: 'Посуда', sortOrder: 40 },
  { code: 'other', name: 'Прочее', sortOrder: 100 },
];

/**
 * Какие типы рекомендуются в какую группу.
 *
 * Только при первом заполнении: `recommended_group_id IS NULL`. Если админ
 * уже выбрал группу типу, сид её не перезаписывает — это его решение.
 */
const RECOMMENDED = {
  roof: ['tent', 'shelter', 'sleeping_bag', 'mat'],
  campfire: ['axe', 'saw', 'firestarter', 'tagan'],
  kitchen: ['stove', 'gas'],
  dishes: ['kettle', 'ladle', 'knife'],
};

const client = new pg.Client({ connectionString: url });
await client.connect();

const added = [];
const kept = [];
let linked = 0;

try {
  await client.query('BEGIN');

  for (const group of GROUPS) {
    const inserted = await client.query(
      `INSERT INTO gear_group_templates (code, name, sort_order)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO NOTHING`,
      [group.code, group.name, group.sortOrder],
    );
    (inserted.rowCount > 0 ? added : kept).push(group.code);
  }

  for (const [code, types] of Object.entries(RECOMMENDED)) {
    const group = await client.query(
      'SELECT id FROM gear_group_templates WHERE code = $1',
      [code],
    );
    const groupId = group.rows[0]?.id;
    if (!groupId) continue;

    const result = await client.query(
      `UPDATE gear_types
          SET recommended_group_id = $1
        WHERE code = ANY($2)
          AND recommended_group_id IS NULL`,
      [groupId, types],
    );
    linked += result.rowCount;
  }

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
}

const groups = await client.query(`
  SELECT g.code,
         g.name,
         g.is_active,
         g.sort_order,
         count(t.id)::int AS types
    FROM gear_group_templates g
    LEFT JOIN gear_types t ON t.recommended_group_id = g.id
   GROUP BY g.id
   ORDER BY g.sort_order, g.name
`);

console.log('Рекомендуемые группы снаряжения:');
for (const row of groups.rows) {
  console.log(
    `  ${row.code.padEnd(10)} ${row.name} — порядок ${row.sort_order}, рекомендованных типов ${row.types}${row.is_active ? '' : '  (в архиве)'}`,
  );
}
console.log('');
console.log(`Добавлено: ${added.length === 0 ? '—' : added.join(', ')}`);
console.log(`Уже было: ${kept.length === 0 ? '—' : kept.join(', ')}`);
console.log(`Типам впервые назначена группа: ${linked}`);
console.log('');
console.log(
  'Существующие строки сид не обновляет: имя и порядок — правки админа.',
);
console.log(
  'Личные группы людей сид не трогает — это их собственные настройки.',
);
console.log(
  '«Прочее» — умолчание для типа без рекомендации, в архив её не убирают.',
);

await client.end();
