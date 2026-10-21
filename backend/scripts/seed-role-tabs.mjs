/**
 * Матрица «роль → вкладки похода»: кто что правит.
 *
 * **Данные, а не код** (правило `STANDARD.md` §6): завхозов может быть
 * несколько, роли назначают организаторы, и менять матрицу должен человек,
 * а не деплой. Скрипт безопасен к повторному запуску: права только
 * добавляются (существующие не удаляются), чтобы «перезалив» справочника
 * не отобрал доступ у тех, кому его выдали.
 *
 * **Право = право на правку.** Видят вкладки все участники похода (решение
 * заказчика 21.10.2026). Роль отвечает на вопрос «кто ведёт питание», а не
 * «кому видно питание».
 *
 * Организатор правит всё независимо от этой матрицы — правило в коде
 * (`TripsService.canEditTab`). Роль `organizer` всё равно засеяна со всеми
 * вкладками, чтобы матрица не врала при чтении глазами.
 *
 * Коды ролей — из `seed-roles.mjs`; коды вкладок — из `trip-tabs.md`
 * (`general, guest, members, sport, transfer, route, meals, gear,
 * firstAid, finance, diary`).
 *
 * Запуск:
 *   node scripts/seed-role-tabs.mjs
 *   npm run seed:role-tabs
 */
import pg from 'pg';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Нужен MIGRATION_DATABASE_URL или DATABASE_URL');
  process.exit(2);
}

const ALL_TABS = [
  'general',
  'guest',
  'members',
  'sport',
  'transfer',
  'route',
  'meals',
  'gear',
  'firstAid',
  'finance',
  'diary',
];

/**
 * Первая редакция матрицы.
 *
 * Не «истина в последней инстанции», а разумное начало: завхоз отвечает
 * за питание и снаряжение, медик — за аптечку, водитель — за трансфер,
 * бухгалтер — за деньги. Организатор и соорганизатор ведут всё: у второго
 * по решению заказчика «все функции подготовки, кроме удаления его самого».
 */
const MATRIX = {
  organizer: ALL_TABS,
  coOrganizer: ALL_TABS,
  technicalLeader: ['route', 'sport'],
  doctor: ['firstAid'],
  photographer: ['diary'],
  quartermaster: ['meals', 'gear'],
  repairman: ['gear'],
  driver: ['transfer'],
  accountant: ['finance'],
};

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query('BEGIN');

  for (const [code, tabs] of Object.entries(MATRIX)) {
    const role = await client.query('SELECT id FROM roles WHERE code = $1', [
      code,
    ]);

    if (role.rowCount === 0) {
      console.warn(`роль ${code} не найдена — пропускаем (запустите seed:roles)`);
      continue;
    }

    for (const tab of tabs) {
      await client.query(
        `INSERT INTO role_tab_permissions (role_id, tab)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [role.rows[0].id, tab],
      );
    }
  }

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
}

const summary = await client.query(
  `SELECT r.code, r.name, count(p.tab)::int AS tabs
     FROM roles r
     LEFT JOIN role_tab_permissions p ON p.role_id = r.id
    GROUP BY r.id, r.code, r.name
    ORDER BY r.id`,
);

console.log('Права ролей на вкладки:');
for (const row of summary.rows) {
  console.log(`  ${row.code.padEnd(16)} ${row.name.padEnd(22)} ${row.tabs}`);
}

await client.end();
