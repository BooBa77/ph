/**
 * Наполнение справочника продуктов.
 *
 * Продукты — **данные, а не код**: их правят и дополняют, поэтому сид
 * скриптом, а не миграцией (правило `STANDARD.md` §6). Повторный запуск
 * безопасен: строки обновляются по `name`.
 *
 * **Единица и вес единицы обязательны.** Без веса нельзя посчитать вес
 * раскладки — а именно он и нужен в походе. Для граммов вес единицы — 1,
 * для банки/упаковки/штуки — фактический вес.
 *
 * Пополнение справочника пользователями — отдельная задача (решено:
 * будущий функционал), поэтому приложению выдан только `SELECT`.
 *
 * Запуск (нужна живая dev-база):
 *   node scripts/seed-products.mjs
 *   npm run seed:products
 */
import pg from 'pg';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Нужен MIGRATION_DATABASE_URL или DATABASE_URL');
  process.exit(2);
}

/**
 * Базовый набор.
 *
 * Это не «полный список еды», а то, из чего собирается походная раскладка:
 * крупы, консервы, сладкое к чаю, лук-картошка, специи. Дальше справочник
 * пополняется отдельной задачей — и, скорее всего, через админку.
 *
 * Порядок — по смыслу, а не по алфавиту: его видно только в сиде, а поиск
 * в интерфейсе всё равно по подстроке.
 */
const PRODUCTS = [
  // Крупы и макароны
  { name: 'Гречка', unit: 'g', weightPerUnitGrams: 1 },
  { name: 'Рис', unit: 'g', weightPerUnitGrams: 1 },
  { name: 'Макароны', unit: 'g', weightPerUnitGrams: 1 },
  { name: 'Овсянка', unit: 'g', weightPerUnitGrams: 1 },
  { name: 'Пшено', unit: 'g', weightPerUnitGrams: 1 },
  { name: 'Кускус', unit: 'g', weightPerUnitGrams: 1 },

  // Консервы и мясо
  { name: 'Тушёнка', unit: 'can', weightPerUnitGrams: 340 },
  { name: 'Рыба консервированная', unit: 'can', weightPerUnitGrams: 240 },
  { name: 'Сгущёнка', unit: 'can', weightPerUnitGrams: 380 },
  { name: 'Колбаса сырокопчёная', unit: 'g', weightPerUnitGrams: 1 },

  // Сладкое и перекус
  { name: 'Сахар', unit: 'g', weightPerUnitGrams: 1 },
  { name: 'Сухофрукты', unit: 'g', weightPerUnitGrams: 1 },
  { name: 'Орехи', unit: 'g', weightPerUnitGrams: 1 },
  { name: 'Шоколад', unit: 'piece', weightPerUnitGrams: 90 },
  { name: 'Печенье', unit: 'pack', weightPerUnitGrams: 300 },
  { name: 'Халва', unit: 'pack', weightPerUnitGrams: 250 },

  // Хлеб и молочное
  { name: 'Хлеб', unit: 'piece', weightPerUnitGrams: 400 },
  { name: 'Сыр', unit: 'g', weightPerUnitGrams: 1 },
  { name: 'Сухое молоко', unit: 'pack', weightPerUnitGrams: 250 },

  // Напитки и приправы
  { name: 'Чай', unit: 'pack', weightPerUnitGrams: 100 },
  { name: 'Кофе', unit: 'pack', weightPerUnitGrams: 100 },
  { name: 'Соль', unit: 'g', weightPerUnitGrams: 1 },
  { name: 'Специи', unit: 'pack', weightPerUnitGrams: 20 },
  { name: 'Масло растительное', unit: 'g', weightPerUnitGrams: 1 },
  { name: 'Кисель', unit: 'pack', weightPerUnitGrams: 30 },

  // Овощи
  { name: 'Картофель', unit: 'g', weightPerUnitGrams: 1 },
  { name: 'Лук', unit: 'g', weightPerUnitGrams: 1 },
  { name: 'Морковь', unit: 'g', weightPerUnitGrams: 1 },
];

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query('BEGIN');

  for (const product of PRODUCTS) {
    await client.query(
      `INSERT INTO products (name, unit, weight_per_unit_grams)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE
         SET unit = EXCLUDED.unit,
             weight_per_unit_grams = EXCLUDED.weight_per_unit_grams`,
      [product.name, product.unit, product.weightPerUnitGrams],
    );
  }

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
}

const summary = await client.query(
  `SELECT unit, count(*)::int AS count, sum(weight_per_unit_grams)::int AS grams
     FROM products GROUP BY unit ORDER BY unit`,
);
const total = await client.query('SELECT count(*)::int AS count FROM products');

console.log(`Продуктов в справочнике: ${total.rows[0].count}`);
for (const row of summary.rows) {
  console.log(`  ${row.unit}: ${row.count}`);
}

await client.end();
