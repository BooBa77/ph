/**
 * Заливка шаблонов государственного производственного календаря.
 *
 * Читает `seed/calendar/ru-YYYY.json` (их готовит
 * `scripts/build-state-calendar.mjs` и проверяет по помесячным итогам
 * официального календаря) и кладёт в таблицу `calendar_state_production`.
 * Повторный запуск безопасен: строки обновляются по дате.
 *
 * Подключение: `MIGRATION_DATABASE_URL` (роль с правом писать в шаблон),
 * иначе `DATABASE_URL`. В проде это admin-действие, а не рантайм: шаблон
 * года меняется раз в год после постановления Правительства.
 *
 * Запуск:
 *   node scripts/seed-state-calendar.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = resolve(HERE, '../seed/calendar');

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

if (!url) {
  console.error('Нужен MIGRATION_DATABASE_URL или DATABASE_URL');
  process.exit(2);
}

/** Сколько дней в году: 366 у високосного. */
function daysInYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

function readSeedFiles() {
  return readdirSync(SEED_DIR)
    .filter((name) => /^ru-\d{4}\.json$/.test(name))
    .sort()
    .map((name) => {
      const path = join(SEED_DIR, name);
      const data = JSON.parse(readFileSync(path, 'utf8'));

      if (!Number.isInteger(data.year) || !Array.isArray(data.days)) {
        throw new Error(`${name}: нет года или массива дней`);
      }
      if (data.days.length !== daysInYear(data.year)) {
        throw new Error(
          `${name}: дней ${data.days.length}, а в ${data.year} году их ${daysInYear(data.year)}`,
        );
      }

      return { name, ...data };
    });
}

/** Короткая сводка по дням: сколько рабочих, выходных, сокращённых. */
function summarize(days) {
  const counts = { workday: 0, weekend: 0, short_workday: 0 };
  let labeled = 0;

  for (const day of days) {
    counts[day.dayType] = (counts[day.dayType] ?? 0) + 1;
    if (day.label) labeled += 1;
  }

  return { ...counts, labeled };
}

async function main() {
  const files = readSeedFiles();
  if (files.length === 0) {
    console.error(`В ${SEED_DIR} нет файлов ru-YYYY.json`);
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    for (const file of files) {
      const dates = file.days.map((day) => day.date);
      const types = file.days.map((day) => day.dayType);
      const labels = file.days.map((day) => day.label ?? null);

      const result = await client.query(
        `INSERT INTO calendar_state_production (date, day_type, label)
         SELECT * FROM unnest($1::date[], $2::text[], $3::text[])
         ON CONFLICT (date) DO UPDATE
           SET day_type = EXCLUDED.day_type, label = EXCLUDED.label`,
        [dates, types, labels],
      );

      const expected = summarize(file.days);
      const stored = await client.query(
        `SELECT
           count(*) FILTER (WHERE day_type = 'workday')::int       AS workday,
           count(*) FILTER (WHERE day_type = 'weekend')::int       AS weekend,
           count(*) FILTER (WHERE day_type = 'short_workday')::int AS short_workday,
           count(*) FILTER (WHERE label IS NOT NULL)::int          AS labeled
         FROM calendar_state_production
         WHERE date >= $1::date AND date < $1::date + interval '1 year'`,
        [`${file.year}-01-01`],
      );

      const got = stored.rows[0];
      const ok =
        got.workday === expected.workday &&
        got.weekend === expected.weekend &&
        got.short_workday === expected.short_workday &&
        got.labeled === expected.labeled;

      console.log(
        `${file.year}: ${file.name} → затронуто ${result.rowCount} строк, ` +
          `рабочих ${got.workday}, выходных ${got.weekend}, сокращённых ${got.short_workday}, ` +
          `с меткой ${got.labeled}${ok ? '' : '  <-- РАСХОЖДЕНИЕ С JSON'}`,
      );

      if (!ok) {
        throw new Error(`${file.year}: в базе не то, что в файле`);
      }
    }

    const years = await client.query(
      `SELECT extract(year FROM date)::int AS year, count(*)::int AS days
       FROM calendar_state_production GROUP BY 1 ORDER BY 1`,
    );
    console.log(
      'в шаблоне годы: ' + years.rows.map((row) => `${row.year} (${row.days})`).join(', '),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Не получилось:', error.message);
  process.exit(1);
});
