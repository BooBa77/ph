/**
 * Наполнение справочника географических объектов.
 *
 * Справочник админский: пользователи объекты не создают и не правят. Это
 * данные, а не код, поэтому сидим скриптом, а не миграцией — как роли.
 *
 * **Данные берутся из файлов, а не из этого файла.** Их кладёт сборщик
 * `nature-import.mjs` (или разбор сохранённых дампов, `--from-dir`):
 * `regions.json` — районы, `<раздел>.json` — объекты одного типа. Список
 * разделов в `COLLECTIONS` ниже; новый тип — ещё одна строка там, и больше
 * ничего править не надо. Раньше объекты были перечислены прямо здесь,
 * и с двух десятков записей это перестало масштабироваться: справочник
 * растёт сотнями.
 *
 * **Про идемпотентность.** У `objects` нет уникального ключа, по которому
 * можно было бы сделать `ON CONFLICT`: имя намеренно не уникально («семь рек
 * Осиновка» — норма, а во вселенной «Природы Байкала» есть разные объекты
 * с одним именем: «Черепаха» — это и `cherepaha`, и `kamencherepaha`).
 * Поэтому объект ищется по тройке (имя, тип, родитель), и вставка идёт
 * только если такого нет. Повторный запуск не наплодит дублей.
 *
 * **Ссылку (`url`) скрипт только заполняет, но не затирает.** Если ссылки
 * нет — появится; если уже стоит — останется своя. Так сид не спорит
 * ни с админом, ни со сборщиком.
 *
 * **Объекты не удаляются и не переименовываются.** Переименование задним
 * числом сломало бы смысл ссылок `[[object:N]]` в текстах маршрутов,
 * а удаление не пропустит внешний ключ, если объект уже упомянут.
 *
 * Запуск (из каталога backend):
 *   node scripts/seed-objects.mjs
 *   npm run seed:objects
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Нужен MIGRATION_DATABASE_URL или DATABASE_URL');
  process.exit(2);
}

/** Где лежат файлы сбора. Путь от каталога backend. */
const DATA_DIR = 'scripts/data/nature';

/** Адрес сайта-источника. */
const SITE = 'https://nature.baikal.ru';

/**
 * Что заливаем в справочник.
 *
 * `section` — код раздела сайта (`obj=<section>`), из него собирается
 * ссылка на страницу объекта. `type` — канонический тип заказчика
 * (район, река, перевал, вершина, озеро, водопад, каньон, источник,
 * **скальник**, хребет, залив, мыс, остров, пещера). Раздел сайта кодирует
 * тип однозначно, поэтому перевод механический.
 *
 * **Тип «скальник» сменил «скалу» 16.10.2026** — так его называют
 * в Прибайкалье. Маппинг и данные обязаны меняться вместе: сид ищет объект
 * по тройке (имя, тип, родитель), поэтому с одним лишь новым маппингом он
 * завёл бы рядом 120 дублей. Данные правит миграция
 * `1792224000000-ObjectsTypeSkalnik`.
 *
 * Сейчас собран один раздел — «Скалы»: 75 объектов из пяти районов.
 * Остальные 17 районов не собраны (сайт перестал отвечать на частые
 * запросы), поэтому справочник пока неполный и это видно по `collected`
 * в `regions.json`.
 */
const COLLECTIONS = [
  { type: 'скальник', section: 'skala', file: 'skala.json' },
  { type: 'вершина', section: 'peak', file: 'peak.json' },
  { type: 'перевал', section: 'pass', file: 'pass.json' },
  { type: 'река', section: 'river', file: 'river.json' },
  { type: 'озеро', section: 'lake', file: 'lake.json' },
  { type: 'каньон', section: 'kanion', file: 'kanion.json' },
  { type: 'источник', section: 'spring', file: 'spring.json' },
  { type: 'хребет', section: 'hrebet', file: 'hrebet.json' },
  { type: 'залив', section: 'zaliv', file: 'zaliv.json' },
  { type: 'мыс', section: 'mys', file: 'mys.json' },
  { type: 'остров', section: 'island', file: 'island.json' },
  { type: 'пещера', section: 'cave', file: 'cave.json' },
  // Водопады, пороги и шиверы лежат на сайте в одном разделе obj=waterfall,
  // поэтому ссылки у всех трёх типов строятся по нему же.
  { type: 'водопад', section: 'waterfall', file: 'waterfall.json' },
  { type: 'порог', section: 'waterfall', file: 'porog.json' },
  { type: 'шивера', section: 'waterfall', file: 'shivera.json' },
];

/** Прочитать файл данных. Ошибку не глотаем: без данных сид бессмыслен. */
function readData(file) {
  return JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'));
}

function buildTree() {
  const regions = readData('regions.json');

  return regions.map((region) => {
    const children = [];

    for (const collection of COLLECTIONS) {
      const objects = readData(collection.file);
      for (const object of objects) {
        if (object.region !== region.code) continue;
        children.push({
          name: object.name,
          type: collection.type,
          url: `${SITE}/obj.shtml?obj=${collection.section}&id=${object.slug}`,
        });
      }
    }

    return {
      // Короткое имя, а не «Олхинское плато (Шелеховский район)»: район
      // в справочнике — это цель похода, и уточнение в скобках в заголовке
      // похода читалось бы как мусор.
      name: region.nameShort || region.name,
      type: 'район',
      // Ссылка на район — это его собственный адрес на сайте (`/olha`),
      // он же стоит в разметке `reg.shtml`.
      url: `${SITE}/${region.code}`,
      children,
    };
  });
}

/**
 * Найти объект по тройке (имя, тип, родитель) или создать его.
 *
 * `parent_id IS NOT DISTINCT FROM $3` вместо `= $3`: у районов родителя нет,
 * и обычное сравнение с NULL не сработало бы никогда — каждый запуск
 * создавал бы новую копию района.
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

const tree = buildTree();
const client = new pg.Client({ connectionString: url });
await client.connect();

const results = [];

try {
  await client.query('BEGIN');
  await walk(client, tree, null, 0, results);
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
}

// Печатаем только изменения: полный список в сотни строк не читается,
// а сверить его удобнее запросом к базе.
const changed = results.filter((item) => item.created || item.urlFilled);
console.log('Справочник географических объектов:');
for (const item of changed.slice(0, 40)) {
  const mark = item.created ? 'создан' : 'заполнена ссылка';
  console.log(`  ${'  '.repeat(item.depth)}${item.node.name} — ${mark}`);
}
if (changed.length > 40) {
  console.log(`  … и ещё ${changed.length - 40}`);
}

const total = await client.query(
  `SELECT count(*)::int AS count,
          count(url)::int AS with_url
     FROM objects`,
);
const byType = await client.query(
  `SELECT type, count(*)::int AS count
     FROM objects
    GROUP BY type
    ORDER BY count DESC, type`,
);

console.log('');
console.log(
  `Создано сейчас: ${results.filter((item) => item.created).length}, ссылок заполнено: ${results.filter((item) => item.urlFilled).length}, всего в дереве: ${results.length}`,
);
console.log(
  `В справочнике: ${total.rows[0].count} объектов, из них со ссылкой ${total.rows[0].with_url}`,
);
console.log('По типам:');
for (const row of byType.rows) {
  console.log(`  ${row.type}: ${row.count}`);
}

await client.end();
