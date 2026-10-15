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
 * **Ссылку (`url`) скрипт только заполняет, но не затирает.** Если у
 * объекта ссылки нет — она появится из списка; если уже стоит — останется
 * своя. Так сид не спорит с админом и с парсером nature.baikal.ru, который
 * наполняет справочник отдельно.
 *
 * **Объекты из списка не удаляются и не переименовываются.** Скрипт умеет
 * добавлять и дописывать пустую ссылку. Переименование задним числом
 * сломало бы смысл ссылок `[[object:N]]` в текстах маршрутов, а удаление
 * не пропустит внешний ключ, если объект уже упомянут.
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
 * справочник админ. Имя при этом не дублирует тип: «скальник» живёт
 * в `type`, а в `name` — только «Витязь», потому что имя подставляется
 * в текст маршрута на место ссылки.
 *
 * `url` — страница объекта на «Природе Байкала». **Ссылки не выдумываются.**
 * Тот адрес, что стоит ниже, проверен вручную: страница открывается и
 * называется «скальник Витязь», район — Олхинское плато. Остальные
 * скальники добавлены без ссылок: их слаги на сайте неизвестны, а
 * выдуманный адрес хуже пустого — по нему уйдёт человек и ничего не найдёт.
 * Заполнит их парсер nature.baikal.ru.
 */
const OBJECTS = [
  {
    name: 'Олхинское плато',
    type: 'плато',
    children: [
      {
        name: 'Витязь',
        type: 'скальник',
        url: 'https://nature.baikal.ru/obj.shtml?obj=skala&id=vityaz',
      },
      { name: 'Идол', type: 'скальник' },
      { name: 'Старуха', type: 'скальник' },
    ],
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
    `SELECT id, url FROM objects
      WHERE name = $1 AND type = $2 AND parent_id IS NOT DISTINCT FROM $3
      LIMIT 1`,
    [node.name, node.type, parentId],
  );

  if (found.rowCount > 0) {
    const id = found.rows[0].id;
    let urlFilled = false;

    // `AND url IS NULL` — это и есть «заполняем пустое, не затираем чужое».
    if (node.url && found.rows[0].url === null) {
      await client.query(
        `UPDATE objects SET url = $2 WHERE id = $1 AND url IS NULL`,
        [id, node.url],
      );
      urlFilled = true;
    }

    return { id, created: false, urlFilled };
  }

  const inserted = await client.query(
    `INSERT INTO objects (name, type, parent_id, url)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [node.name, node.type, parentId, node.url ?? null],
  );
  return { id: inserted.rows[0].id, created: true, urlFilled: false };
}

/** Обойти дерево и вернуть плоский список с результатом по каждому узлу. */
async function walk(client, nodes, parentId, depth, results) {
  for (const node of nodes) {
    const outcome = await upsertObject(client, node, parentId);
    results.push({ node, depth, ...outcome });
    if (node.children?.length) {
      await walk(client, node.children, outcome.id, depth + 1, results);
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
for (const { node, id, created, urlFilled, depth } of results) {
  const marks = [
    created ? 'создан' : 'уже был',
    urlFilled ? 'ссылка заполнена' : null,
  ].filter(Boolean);
  console.log(
    `  ${'  '.repeat(depth)}${node.name} [${node.type}] — id ${id} (${marks.join(', ')})`,
  );
}

const total = await client.query(
  `SELECT count(*)::int AS count,
          count(url)::int AS with_url
     FROM objects`,
);
const roots = await client.query(
  'SELECT count(*)::int AS count FROM objects WHERE parent_id IS NULL',
);

console.log('');
console.log(
  `Создано сейчас: ${results.filter((item) => item.created).length} из ${results.length}`,
);
console.log(
  `Всего в справочнике: ${total.rows[0].count} объектов, из них ссылкой ${total.rows[0].with_url} (верхних уровней: ${roots.rows[0].count})`,
);

await client.end();
