/**
 * Наполнение справочника групп снаряжения (31.10.2026).
 *
 * Группа — **полка каталога**, а не тип: одна группа собирает вещи разных
 * типов («Костровое» — топор, пилу и розжиг). Группы — данные, а не код:
 * их правит админ в `/admin/gear`, поэтому сидим скриптом, а не миграцией.
 *
 * **Скрипт только вставляет и никогда не обновляет** — `ON CONFLICT
 * (code) DO NOTHING`. Имя и порядок — собственность админки: если админ
 * переименовал «Кров» в «Ночлег» или переставил полки, повторный прогон
 * не должен затирать его правки. `is_active` тоже не трогаем: группу,
 * погашенную в архив, сид обратно не включает.
 *
 * Набор — ровно тот, что нужен «Ночёвкам» (слова заказчика 31.10.2026):
 * Костровое (топор, пила, розжиг), Кухня (газ), Кров (палатка, тент)
 * и «Прочее» — умолчание для вещи без явной полки. Порядок 10/20/30/100:
 * «Прочее» последней, потому что это свалка, а не раздел.
 *
 * Миграция `1792273000000-GearGroups` заводит те же четыре строки — иначе
 * на свежей базе вещи некуда было бы положить. Сид нужен для базы, где
 * миграция уже прошла, а админ эти полки удалил бы... удалить их нельзя,
 * только архив; сид их не возвращает. Запускать его на проде нужно, потому
 * что он идемпотентен и безопасен, а не потому, что без него пусто.
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
 * Справочник групп.
 *
 * `code` — латиница по `^[a-z][a-z0-9_]*$`: он уходит в API и на него
 * опирается умолчание `other`. `sortOrder` — порядок секций каталога.
 */
const GROUPS = [
  { code: 'roof', name: 'Кров', sortOrder: 10 },
  { code: 'campfire', name: 'Костровое', sortOrder: 20 },
  { code: 'kitchen', name: 'Кухня', sortOrder: 30 },
  { code: 'other', name: 'Прочее', sortOrder: 100 },
];

const client = new pg.Client({ connectionString: url });
await client.connect();

const added = [];
const kept = [];

try {
  await client.query('BEGIN');

  for (const group of GROUPS) {
    const inserted = await client.query(
      `INSERT INTO gear_groups (code, name, sort_order)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO NOTHING`,
      [group.code, group.name, group.sortOrder],
    );
    (inserted.rowCount > 0 ? added : kept).push(group.code);
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
         count(i.id)::int AS items
    FROM gear_groups g
    LEFT JOIN gear_items i ON i.group_id = g.id
   GROUP BY g.id
   ORDER BY g.sort_order, g.name
`);

console.log('Группы снаряжения:');
for (const row of groups.rows) {
  console.log(
    `  ${row.code.padEnd(10)} ${row.name} — порядок ${row.sort_order}, вещей ${row.items}${row.is_active ? '' : '  (в архиве)'}`,
  );
}
console.log('');
console.log(`Добавлено: ${added.length === 0 ? '—' : added.join(', ')}`);
console.log(`Уже было: ${kept.length === 0 ? '—' : kept.join(', ')}`);
console.log('');
console.log(
  'Существующие строки сид не обновляет: имя и порядок — правки админа.',
);
console.log(
  '«Прочее» — умолчание для вещи без явной полки, в архив её не убирают.',
);

await client.end();
