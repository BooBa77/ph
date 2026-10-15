/**
 * Наполнение справочника географических объектов.
 *
 * Справочник админский: пользователи объекты не создают и не правят. Это
 * данные, а не код, поэтому сидим скриптом, а не миграцией — как роли.
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
 * своя. Так сид не спорит с админом и с парсером.
 *
 * **Объекты из списка не удаляются и не переименовываются.** Скрипт умеет
 * добавлять и дописывать пустую ссылку. Переименование задним числом
 * сломало бы смысл ссылок `[[object:N]]` в текстах маршрутов, а удаление
 * не пропустит внешний ключ, если объект уже упомянут.
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
 * Скальники Олхинского плато.
 *
 * Собрано 15.10.2026 со страницы
 * `https://nature.baikal.ru/objs.shtml?obj=skala&rg=olha` — это **все**
 * объекты раздела «Скалы» этого района, 64 штуки. Порядок — как на сайте
 * (по первой букве): так список можно сверить с источником глазами.
 *
 * Формат: `[слаг на сайте, название, тип]`. Слаг нужен только для ссылки
 * на страницу объекта; тип по умолчанию «скальник».
 *
 * **Тип взят с сайта, а не выровнен под один.** Сайт называет три объекта
 * утёсами, один — «скалами», у двух тип не указан вовсе (у них он выведен
 * из названия: «скальник на склоне пади Кривой» и «скала Шаманка (утёс
 * Шаманский)»). Поле `type` в справочнике свободное, и выдумывать
 * единообразие там, где источник его не даёт, значит однажды разойтись
 * с сайтом. Приведёт к общему виду админ, если решит, что это нужно.
 *
 * **Псевдонимы.** У шести записей сайт показывает «ходовое имя →
 * каноническое»: «Кетчуп → скальники у истоков Большой Олхи»,
 * «Уксус → …» (тот же объект), «Сёстры → Две Сестры»,
 * «Обзорный → Вороний Глаз», «Ящер → Ворона»,
 * «Шелеховские Камни → Кривыши». В справочнике имя одно, и взято
 * каноническое — правая часть; ходовые имена перечислены здесь, чтобы
 * не потеряться, если однажды появится поиск по синонимам.
 *
 * Три названия описательные, а не именные: «на горе 1029 м», «скальник
 * на склоне пади Кривой», «у остановки 5234 км». Сайт не даёт им имён,
 * а объекты настоящие — оставлены как есть, чтобы справочник не терял
 * места, куда ходят.
 */
const OLHA_SKALA = [
  ['skala_1029', 'на горе 1029 м', 'скалы'],
  ['angarskii', 'Ангарский'],
  ['arka_sk', 'Арка'],
  ['belaycerkov', 'Белая Церковь'],
  ['lzhebelayacerkov', 'Белая Церковь Ложная'],
  ['vvedenskiiutes', 'Введенский', 'утёс'],
  ['verblyud', 'Верблюд'],
  ['vityaz', 'Витязь'],
  ['vorona', 'Ворона'],
  ['voroniy_glaz', 'Вороний Глаз'],
  ['vorota', 'Ворота'],
  ['garnitur_sk', 'Гарнитур'],
  ['gat_1964_sk', 'ГАТ 1964'],
  ['123376', 'Годзилла'],
  ['gorodiche', 'Городище'],
  ['dvesestry', 'Две Сестры'],
  ['divan_sk', 'Диван'],
  ['sk_zakir', 'Закировский'],
  ['zerkala', 'Зеркала'],
  ['idol', 'Идол'],
  ['idutschie_k_reke', 'Идущие к реке'],
  ['izgnaniya', 'Изгнания'],
  ['kaimurastuyskiy', 'Каймурастуйский'],
  ['big_olha', 'скальники у истоков Большой Олхи'],
  ['kleopatra_sk', 'Клеопатра'],
  ['krasnyi_kamen', 'Красный Камень'],
  ['krepost', 'Крепость'],
  ['pad_krivaya', 'скальник на склоне пади Кривой'],
  ['shirokii', 'Кривыши'],
  ['kudliny_kamni', 'Кудлины Камни'],
  ['kulak', 'Кулак'],
  ['sk_kurum', 'Курумный'],
  ['lapa', 'Лапа'],
  ['lev', 'Лев'],
  ['mariin', 'Марьин', 'утёс'],
  ['medvezhata', 'Медвежата'],
  ['sk_murena', 'Мурена'],
  ['myunhauzen', 'Мюнхаузен'],
  ['12344', 'Надежда'],
  ['olhinskie_stolby', 'Олхинские Столбы'],
  ['ostrog_sk', 'Острог'],
  ['papka', 'Папка'],
  ['108120', 'Пищеблок'],
  ['politehnicheskii', 'Политехнический'],
  ['sibiryak', 'Сибиряк'],
  ['skala', 'Скала', 'утёс'],
  ['smolenskii', 'Смоленский'],
  ['old_krepost', 'Старая Крепость'],
  ['staruha', 'Старуха'],
  ['social', 'Малая Старуха'],
  ['tanki', 'Танки'],
  ['trolly', 'Тролли'],
  ['5234', 'у остановки 5234 км'],
  ['uglovoy', 'Угловой'],
  ['faraon', 'Фараон'],
  ['carevna_lyagushka', 'Царевна Лягушка'],
  ['cherepaha', 'Черепаха'],
  ['chernayaskala', 'Чёрная Скала'],
  ['shamanka_irkut', 'скала Шаманка (утёс Шаманский)', 'утёс'],
  ['shahtai', 'Камень Шахтай'],
  ['shahtanskie', 'Камни Шахтанские'],
  ['shinihtinskie', 'Камни Шинихтинские'],
  ['shulminskie', 'Шульминские Камни'],
  ['equilibrium', 'Эквилибриум'],
];

/**
 * Адрес страницы объекта на «Природе Байкала».
 *
 * Без `rg=olha`: параметр района на странице объекта не нужен, и ссылка
 * без него проверена вручную (открывается страница «скальник Витязь»).
 * Все объекты раздела «Скалы» живут под одним `obj=skala`, включая утёсы.
 */
const objectUrl = (slug) =>
  `https://nature.baikal.ru/obj.shtml?obj=skala&id=${slug}`;

/**
 * Дерево объектов.
 *
 * Вложенность задаётся полем `children`, а не отдельным списком с id: так
 * дерево видно в одном месте и не надо следить за порядком объектов
 * в массиве.
 *
 * У «Олхинского плато» ссылка ведёт на страницу района — это собственный
 * адрес сайта из его же разметки (`<a href="/olha">`), а не догадка.
 */
const OBJECTS = [
  {
    name: 'Олхинское плато',
    type: 'плато',
    url: 'https://nature.baikal.ru/olha',
    children: OLHA_SKALA.map(([slug, name, type = 'скальник']) => ({
      name,
      type,
      url: objectUrl(slug),
    })),
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
for (const { node, created, urlFilled, depth } of results) {
  // Полный список из 64 скальников в консоль не печатаем: он не читается,
  // а сверить его удобнее запросом к базе.
  if (depth === 0) {
    console.log(`  ${node.name} [${node.type}]`);
  } else if (created || urlFilled) {
    const marks = [created ? 'создан' : 'ссылка заполнена'].filter(Boolean);
    console.log(`    ${node.name} [${node.type}] — ${marks.join(', ')}`);
  }
}

const total = await client.query(
  `SELECT count(*)::int AS count,
          count(url)::int AS with_url,
          count(*) FILTER (WHERE parent_id IS NULL)::int AS roots
     FROM objects`,
);
const byType = await client.query(
  `SELECT type, count(*)::int AS count
     FROM objects
    WHERE parent_id IS NOT NULL
    GROUP BY type
    ORDER BY count DESC, type`,
);

console.log('');
console.log(
  `Создано сейчас: ${results.filter((item) => item.created).length} из ${results.length}`,
);
console.log(
  `Всего в справочнике: ${total.rows[0].count} объектов, из них со ссылкой ${total.rows[0].with_url} (верхних уровней: ${total.rows[0].roots})`,
);
console.log('По типам (без верхнего уровня):');
for (const row of byType.rows) {
  console.log(`  ${row.type}: ${row.count}`);
}

await client.end();
