/**
 * Наполнение справочника типов снаряжения и их характеристик (Stage A,
 * дополнено в Stage B 30.10.2026).
 *
 * Типы — **данные, а не код** (`STANDARD.md` §6): их правит админ в
 * `/admin/gear`, поэтому сидим скриптом, а не миграцией.
 *
 * **Скрипт только вставляет и никогда не обновляет** — `ON CONFLICT DO
 * NOTHING` у типов, у характеристик и у вариантов списков. Имя,
 * обязательность и порядок — собственность админки: если админ
 * переименовал «Пилу» или снял обязательность у «Привода», повторный
 * прогон сида не должен затирать его правки. Это отличается от
 * `seed:roles`, где имя обновляется, — там роли приходят из кода матрицы
 * прав, а здесь справочник живёт сам.
 *
 * **`is_active` не трогаем**, как и остальные сиды: выключенный админом тип
 * повторный прогон обратно не включает. Возврат — отдельное действие.
 *
 * **`fillMissing` сиду не нужен:** скрипт пишет напрямую в базу и обходит
 * API. Обязательные характеристики сида (`seats`, `drive`, `blade`,
 * `content`, `volume`) заведены так с самого начала, а вещей в dev на
 * момент сида нет; у вещей из старого каталога пустое значение остаётся
 * пустым, и это чинится правкой вещи или `fillMissing` в админке, а не
 * выдуманным «3 места» для всех палаток.
 *
 * **Восемь типов — это то, на что опираются экраны** (заказчик 30.10.2026:
 * «в Ночёвках используем забинденные типы палатка, топор и пр.; в разделе
 * „Палатки“ — `tent` и `shelter`»). Поэтому в сиде есть не только
 * «Палатка», но и «Тент» (`shelter`), «Горелка» (`stove`) и «Таган»
 * (`tagan`): «Костровое» набирается шестью кнопками — топор, пила, розжиг,
 * таган, горелка, газовый баллон.
 *
 * Категорий старого каталога («Спальник», «Рюкзак», «Одежда», «Обувь»,
 * «Техническое снаряжение», «Прочее», «Кухня и посуда») здесь нет
 * намеренно: их завела миграция `1792271000000-GearItemTypes`, когда
 * переводила виды вещей в типы. Сид их не дублирует.
 *
 * `stove.connection` — единственная характеристика-список в сиде: она
 * показывает админу, как выглядит четвёртый вид значения и его варианты.
 *
 * Запуск (нужна живая dev-база):
 *   node scripts/seed-gear-types.mjs
 *   npm run seed:gear-types
 */
import pg from 'pg';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Нужен MIGRATION_DATABASE_URL или DATABASE_URL');
  process.exit(2);
}

/**
 * Справочник.
 *
 * `code` — латиница по `^[a-z][a-z0-9_]*$`: на него опираются фильтры
 * Stage B. `valueKind` — вид значения (`number` / `text` / `bool`), по нему
 * в Stage B выбирается колонка. `sortOrder` у всех 0: порядок задаёт админ,
 * а до его правок характеристики идут в порядке вставки (`id`).
 */
const TYPES = [
  {
    code: 'tent',
    name: 'Палатка',
    attributes: [
      {
        code: 'seats',
        name: 'Вместимость',
        valueKind: 'number',
        unit: 'мест',
        isRequired: true,
      },
      { code: 'model', name: 'Модель', valueKind: 'text' },
    ],
  },
  {
    code: 'axe',
    name: 'Топор',
    attributes: [
      { code: 'brand', name: 'Бренд', valueKind: 'text' },
      { code: 'length', name: 'Длина', valueKind: 'number', unit: 'см' },
    ],
  },
  {
    code: 'saw',
    name: 'Пила',
    attributes: [
      {
        code: 'drive',
        name: 'Привод',
        valueKind: 'text',
        isRequired: true,
      },
      {
        code: 'blade',
        name: 'Тип полотна',
        valueKind: 'text',
        isRequired: true,
      },
      { code: 'brand', name: 'Бренд', valueKind: 'text' },
      {
        code: 'length',
        name: 'Длина',
        valueKind: 'number',
        unit: 'см',
      },
    ],
  },
  {
    code: 'firestarter',
    name: 'Розжиг',
    attributes: [
      {
        code: 'content',
        name: 'Содержимое',
        valueKind: 'text',
        isRequired: true,
      },
    ],
  },
  {
    code: 'gas',
    name: 'Газовый баллон',
    attributes: [
      {
        code: 'volume',
        name: 'Объём',
        valueKind: 'number',
        unit: 'л',
        isRequired: true,
      },
      { code: 'is_new', name: 'Новый', valueKind: 'bool' },
    ],
  },
  {
    // Тент — не палатка: под ним ночуют, но места он не держит. Отдельный
    // тип, потому что «Палатки» ночёвок собираются из `tent` + `shelter`,
    // а до Stage B тент жил только строкой на экране.
    code: 'shelter',
    name: 'Тент',
    attributes: [
      { code: 'area', name: 'Площадь', valueKind: 'number', unit: 'м²' },
      { code: 'material', name: 'Материал', valueKind: 'text' },
    ],
  },
  {
    code: 'stove',
    name: 'Горелка',
    attributes: [
      { code: 'power', name: 'Мощность', valueKind: 'number', unit: 'Вт' },
      {
        code: 'connection',
        name: 'Соединение',
        valueKind: 'select',
        options: [
          { code: 'thread', name: 'резьбовой' },
          { code: 'collet', name: 'цанговый' },
          { code: 'gravity', name: 'гравитационный' },
        ],
      },
    ],
  },
  {
    code: 'tagan',
    name: 'Таган',
    attributes: [{ code: 'material', name: 'Материал', valueKind: 'text' }],
  },
];

const client = new pg.Client({ connectionString: url });
await client.connect();

const added = { types: 0, attributes: 0, options: 0 };
const kept = { types: 0, attributes: 0, options: 0 };

try {
  await client.query('BEGIN');

  for (const type of TYPES) {
    const inserted = await client.query(
      `INSERT INTO gear_types (code, name, sort_order)
       VALUES ($1, $2, 0)
       ON CONFLICT (code) DO NOTHING`,
      [type.code, type.name],
    );
    if (inserted.rowCount > 0) added.types += 1;
    else kept.types += 1;

    // После DO NOTHING id берём отдельным запросом: RETURNING у пропущенной
    // вставки пуст, а характеристикам нужен id типа в любом случае.
    const found = await client.query(
      'SELECT id FROM gear_types WHERE code = $1',
      [type.code],
    );
    const typeId = found.rows[0].id;

    for (const attribute of type.attributes) {
      const row = await client.query(
        `INSERT INTO gear_type_attributes
           (gear_type_id, code, name, value_kind, unit, is_required, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, 0)
         ON CONFLICT (gear_type_id, code) DO NOTHING`,
        [
          typeId,
          attribute.code,
          attribute.name,
          attribute.valueKind,
          attribute.unit ?? null,
          attribute.isRequired ?? false,
        ],
      );
      if (row.rowCount > 0) added.attributes += 1;
      else kept.attributes += 1;

      // Варианты списка (`select`) — после характеристики: их код уникален
      // внутри неё, а id характеристики нужен для вставки.
      if (!attribute.options || attribute.options.length === 0) continue;

      const attributeRow = await client.query(
        'SELECT id FROM gear_type_attributes WHERE gear_type_id = $1 AND code = $2',
        [typeId, attribute.code],
      );
      const attributeId = attributeRow.rows[0].id;

      for (const option of attribute.options) {
        const optionRow = await client.query(
          `INSERT INTO gear_attribute_options
             (gear_type_attribute_id, code, name, sort_order)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (gear_type_attribute_id, code) DO NOTHING`,
          [attributeId, option.code, option.name, option.sortOrder ?? 0],
        );
        if (optionRow.rowCount > 0) added.options += 1;
        else kept.options += 1;
      }
    }
  }

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
}

const types = await client.query(`
  SELECT t.code,
         t.name,
         t.is_active,
         count(a.id)::int AS attributes,
         count(a.id) FILTER (WHERE a.is_required)::int AS required,
         count(o.id)::int AS options
    FROM gear_types t
    LEFT JOIN gear_type_attributes a ON a.gear_type_id = t.id
    LEFT JOIN gear_attribute_options o ON o.gear_type_attribute_id = a.id
   GROUP BY t.id
   ORDER BY t.sort_order, t.name
`);

console.log('Справочник типов снаряжения:');
for (const row of types.rows) {
  console.log(
    `  ${row.code.padEnd(14)} ${row.name} — характеристик ${row.attributes}, обязательных ${row.required}, вариантов ${row.options}${row.is_active ? '' : '  (в архиве)'}`,
  );
}
console.log('');
console.log(
  `Добавлено: типов ${added.types}, характеристик ${added.attributes}, вариантов ${added.options}`,
);
console.log(
  `Уже было: типов ${kept.types}, характеристик ${kept.attributes}, вариантов ${kept.options}`,
);
console.log('');
console.log(
  'Существующие строки сид не обновляет: имя, обязательность и порядок — правки админа.',
);
console.log(
  'Тип или характеристика, которых больше не нужно предлагать, гасятся через is_active, а не удаляются.',
);

await client.end();
