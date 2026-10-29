/**
 * Наполнение справочника типов снаряжения и их характеристик (Stage A).
 *
 * Типы — **данные, а не код** (`STANDARD.md` §6): их правит админ в
 * `/admin/gear`, поэтому сидим скриптом, а не миграцией.
 *
 * **Скрипт только вставляет и никогда не обновляет** — `ON CONFLICT DO
 * NOTHING` у типов и у характеристик. Имя, обязательность и порядок —
 * собственность админки: если админ переименовал «Пилу» или снял
 * обязательность у «Привода», повторный прогон сида не должен затирать
 * его правки. Это отличается от `seed:roles`, где имя обновляется, — там
 * роли приходят из кода матрицы прав, а здесь справочник живёт сам.
 *
 * **`is_active` не трогаем**, как и остальные сиды: выключенный админом тип
 * повторный прогон обратно не включает. Возврат — отдельное действие.
 *
 * **`fillMissing` сиду не нужен:** скрипт пишет напрямую в базу и обходит
 * API, а у сидовых атрибутов `isRequired` ставится без замещающего
 * значения. В Stage A писать замещающее всё равно некуда — таблицы значений
 * (`gear_item_attributes`) ещё нет.
 *
 * **Пять типов, без dev-заглушек.** `technical`, «прочее», тент и прочее
 * не сидим: пустой тип без характеристик ничего не проверяет. Их заводит
 * админ. `is_new` у газового баллона вместо `used` — намеренно: `true`
 * означает «новый», а не «использованный».
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
];

const client = new pg.Client({ connectionString: url });
await client.connect();

const added = { types: 0, attributes: 0 };
const kept = { types: 0, attributes: 0 };

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
         count(a.id) FILTER (WHERE a.is_required)::int AS required
    FROM gear_types t
    LEFT JOIN gear_type_attributes a ON a.gear_type_id = t.id
   GROUP BY t.id
   ORDER BY t.sort_order, t.name
`);

console.log('Справочник типов снаряжения:');
for (const row of types.rows) {
  console.log(
    `  ${row.code.padEnd(14)} ${row.name} — характеристик ${row.attributes}, обязательных ${row.required}${row.is_active ? '' : '  (в архиве)'}`,
  );
}
console.log('');
console.log(`Добавлено: типов ${added.types}, характеристик ${added.attributes}`);
console.log(`Уже было: типов ${kept.types}, характеристик ${kept.attributes}`);
console.log('');
console.log(
  'Существующие строки сид не обновляет: имя, обязательность и порядок — правки админа.',
);
console.log(
  'Тип или характеристика, которых больше не нужно предлагать, гасятся через is_active, а не удаляются.',
);

await client.end();
