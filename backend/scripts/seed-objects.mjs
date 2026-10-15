/**
 * Наполнение справочника географических объектов.
 *
 * Справочник админский: пользователи объекты не создают и не правят. Это
 * данные, а не код, поэтому сидим скриптом, а не миграцией — как роли
 * и активности.
 *
 * **Про идемпотентность здесь сложнее, чем у ролей.** У `objects` нет
 * уникального ключа, по которому можно было бы сделать `ON CONFLICT`:
 * имя намеренно не уникально («семь рек Осиновка» — норма, различаются
 * они родителем и уточнением в имени). Поэтому объект ищется по тройке
 * (имя, тип, родитель), а вставка идёт только если такого нет. Повторный
 * запуск не наплодит дублей.
 *
 * **Объекты из списка не удаляются и не переименовываются.** Скрипт умеет
 * только добавлять. Переименование задним числом сломало бы смысл ссылок
 * `[[object:N]]` в текстах маршрутов, а удаление не пропустит внешний ключ,
 * если объект уже упомянут.
 *
 * `parent_id` — иерархия: «Олхинское плато → скальник Витязь». Вложенность
 * задаётся полем `children`, а не отдельным списком с id: так дерево видно
 * в одном месте и не надо следить за порядком объектов в массиве.
 *
 * Запуск:
 *   node scripts/seed-objects.mjs
 *   npm run seed:objects
 */
import pg from 'pg';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Нужен MIGRATION_DATABASE_URL или DATABASE_URL');
  process.exit(2);
}

/**
 * Дерево объектов.
 *
 * `type` — свободный текст, без словаря: типы (вершина, перевал, скальник,
 * плато) растут быстрее, чем мы успевали бы править CHECK, а заполняет
 * справочник админ.
 *
 * «ск. Витязь» назван сокращённо, как его и зовут в обиходе: имя объекта
 * подставляется в текст маршрута на место ссылки, и «скальник скальник
 * Витязь» из полного имени и типа читалось бы хуже.
 */
const OBJECTS = [
  {
    name: 'Олхинское плато',
    type: 'плато',
    children: [{ name: 'ск. Витязь', type: 'скальник' }],
  },
];

/**
 * Найти объект по тройке (имя, тип, родитель) или создать его.
 *
 * `parent_id IS NOT DISTINCT FROM $3` вместо `= $3`: у объектов верхнего
 * уровня родителя нет, и обычное сравнение с NULL не сработало бы никогда —
 * каждый запуск создавал бы новую копию верхнего объекта.
 */
async function upsertObject(client, node, parentId) {
  const found = await client.query(
    `SELECT id FROM objects
      WHERE name = $1 AND type = $2 AND parent_id IS NOT DISTINCT FROM $3
      LIMIT 1`,
    [node.name, node.type, parentId],
  );
  if (found.rowCount > 0) {
    return { id: found.rows[0].id, created: false };
  }

  const inserted = await client.query(
    `INSERT INTO objects (name, type, parent_id) VALUES ($1, $2, $3) RETURNING id`,
    [node.name, node.type, parentId],
  );
  return { id: inserted.rows[0].id, created: true };
}

/** Обойти дерево и вернуть плоский список с результатом по каждому узлу. */
async function walk(client, nodes, parentId, depth, results) {
  for (const node of nodes) {
    const { id, created } = await upsertObject(client, node, parentId);
    results.push({ node, id, created, depth });
    if (node.children?.length) {
      await walk(client, node.children, id, depth + 1, results);
    }
  }
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const results = [];

try {
  await client.query('BEGIN');
  await walk(client, OBJECTS, null, 0, results);
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
}

console.log('Справочник географических объектов:');
for (const { node, id, created, depth } of results) {
  console.log(
    `  ${'  '.repeat(depth)}${node.name} [${node.type}] — id ${id}${created ? ' (создан)' : ' (уже был)'}`,
  );
}

const total = await client.query('SELECT count(*)::int AS count FROM objects');
const roots = await client.query(
  'SELECT count(*)::int AS count FROM objects WHERE parent_id IS NULL',
);

console.log('');
console.log(
  `Создано сейчас: ${results.filter((item) => item.created).length} из ${results.length}`,
);
console.log(
  `Всего в справочнике: ${total.rows[0].count} (верхних уровней: ${roots.rows[0].count})`,
);

await client.end();
