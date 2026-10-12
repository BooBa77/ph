/**
 * Генератор шаблона государственного производственного календаря.
 *
 * Что делает: из фактов о годе (переносы, сокращённые дни) собирает 365
 * записей «дата → РАБ/ВЫХ + метка» и проверяет результат по помесячным
 * итогам из официального календаря «КонсультантПлюс». Не сошлось хотя бы
 * в одном месяце — файл не пишется, скрипт падает.
 *
 * Зачем контрольная сумма: правила календаря неочевидны (см. пункт про
 * переносы ниже), а глазами 365 строк не проверить. Годовые итоги у 2025,
 * 2026 и 2027 совпадают (365/247/118), поэтому проверять надо помесячно.
 *
 * Запуск:
 *   node scripts/build-state-calendar.mjs
 *   node scripts/build-state-calendar.mjs --out ../seed/calendar
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Нерабочие праздничные дни по статье 112 ТК РФ: выходной независимо от дня недели. */
const HOLIDAYS = [
  { month: 1, day: 1, label: 'Новый год' },
  { month: 1, day: 2, label: 'Новогодние каникулы' },
  { month: 1, day: 3, label: 'Новогодние каникулы' },
  { month: 1, day: 4, label: 'Новогодние каникулы' },
  { month: 1, day: 5, label: 'Новогодние каникулы' },
  { month: 1, day: 6, label: 'Новогодние каникулы' },
  { month: 1, day: 7, label: 'Рождество Христово' },
  { month: 1, day: 8, label: 'Новогодние каникулы' },
  { month: 2, day: 23, label: 'День защитника Отечества' },
  { month: 3, day: 8, label: 'Международный женский день' },
  { month: 5, day: 1, label: 'Праздник Весны и Труда' },
  { month: 5, day: 9, label: 'День Победы' },
  { month: 6, day: 12, label: 'День России' },
  { month: 11, day: 4, label: 'День народного единства' },
]

/**
 * Тематические праздники: метка на дне, но день рабочий (или выходной
 * по календарю — тогда метка просто дополняет день недели).
 */
const THEMATIC = [
  { month: 8, day: 8, label: 'Международный день альпинизма' },
  { month: 9, day: 27, label: 'Всемирный день туризма' },
  { month: 12, day: 11, label: 'Международный день гор' },
  { month: 12, day: 16, label: 'День покорения вершин' },
]

/**
 * Факты по годам.
 *
 * `transfers` — переносы выходных из постановлений Правительства РФ,
 * парами «откуда → куда».
 *
 * `shortDays` — предпраздничные дни, когда работа сокращается на час.
 *
 * `monthly` — контрольная сумма: рабочие и выходные дни по месяцам,
 * из таблицы «Количество дней» официального календаря.
 */
const FACTS = {
  2025: {
    source: 'Постановление Правительства РФ от 04.10.2024 № 1335',
    transfers: [
      [[1, 4], [5, 2]],
      [[1, 5], [12, 31]],
      [[2, 23], [5, 8]],
      [[3, 8], [6, 13]],
      [[11, 1], [11, 3]],
    ],
    shortDays: [[3, 7], [4, 30], [6, 11]],
    monthly: [
      [17, 14], [20, 8], [21, 10], [22, 8], [18, 13], [19, 11],
      [23, 8], [21, 10], [22, 8], [23, 8], [19, 11], [22, 9],
    ],
  },
  2026: {
    source: 'Постановление Правительства РФ от 24.09.2025 № 1466',
    transfers: [
      [[1, 3], [1, 9]],
      [[1, 4], [12, 31]],
    ],
    shortDays: [[4, 30], [5, 8], [6, 11], [11, 3]],
    monthly: [
      [15, 16], [19, 9], [21, 10], [22, 8], [19, 12], [21, 9],
      [23, 8], [21, 10], [22, 8], [22, 9], [20, 10], [22, 9],
    ],
  },
  2027: {
    source: 'Постановление Правительства РФ от 17.09.2026 № 1187',
    transfers: [
      [[1, 2], [11, 5]],
      [[1, 3], [12, 31]],
      [[2, 20], [2, 22]],
    ],
    shortDays: [[2, 20], [4, 30], [6, 11], [11, 3]],
    monthly: [
      [15, 16], [19, 9], [22, 9], [22, 8], [19, 12], [21, 9],
      [22, 9], [22, 9], [22, 8], [21, 10], [20, 10], [22, 9],
    ],
  },
}

const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })

const iso = (date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const key = ([month, day]) => `${month}-${day}`
const isWeekendDay = (date) => date.getDay() === 0 || date.getDay() === 6
const holidayByKey = new Map(HOLIDAYS.map((item) => [key([item.month, item.day]), item]))
const thematicByKey = new Map(THEMATIC.map((item) => [key([item.month, item.day]), item]))

/** «перенос за 8 марта» — метка перенесённого выходного. */
const transferLabel = (date) => `перенос за ${DAY_MONTH.format(date)}`

/**
 * Новогодние каникулы (1–8 января) — исключение из правила переноса:
 * по статье 112 ТК РФ выходные, совпавшие с этими праздниками, не уезжают
 * на следующий рабочий день, а переносятся постановлением Правительства
 * (эти переносы перечислены в фактах года).
 */
const isNewYearHoliday = (date) => date.getMonth() === 0 && date.getDate() <= 8

/**
 * Собрать дни года.
 *
 * Порядок правил важен:
 *   1. база 5/2 — суббота и воскресенье выходные;
 *   2. нерабочие праздники — выходной независимо от дня недели;
 *   3. переносы по постановлению: «куда» становится выходным, а «откуда» —
 *      рабочим днём, если это была обычная суббота или воскресенье, и
 *      остаётся выходным, если это праздник. Из-за этого правила 1 ноября
 *      2025 года рабочий день, а 20 февраля 2027 — сокращённая рабочая
 *      суббота: без него ноябрь 2025 даёт 18 рабочих дней вместо 19;
 *   4. праздник, совпавший с выходным, уезжает на следующий рабочий день
 *      (8 марта 2026 — воскресенье, отдыхали 9 марта). 1–8 января —
 *      исключение: там переносит Правительство, см. пункт 3;
 *   5. сокращённые дни — рабочий день минус час;
 *   6. тематические метки — подпись на дне, выходным его не делают.
 *
 * Метки храним только у особых дней. Имя дня недели у обычного дня
 * подставляет заполнение личного календаря: держать 365 одинаковых
 * подписей в шаблоне незачем.
 */
function buildYear(year, facts) {
  const days = new Map()

  for (let date = new Date(year, 0, 1); date.getFullYear() === year; date.setDate(date.getDate() + 1)) {
    days.set(iso(date), {
      date: iso(date),
      dayType: isWeekendDay(date) ? 'weekend' : 'workday',
      label: null,
    })
  }

  // 2. Нерабочие праздники.
  for (const day of days.values()) {
    const date = new Date(`${day.date}T00:00:00`)
    const holiday = holidayByKey.get(key([date.getMonth() + 1, date.getDate()]))
    if (!holiday) continue
    day.dayType = 'weekend'
    day.label = holiday.label
  }

  // 3. Переносы выходных по постановлению Правительства.
  const decreeSources = new Set()

  for (const [from, to] of facts.transfers) {
    const fromDate = new Date(year, from[0] - 1, from[1])
    const fromKey = iso(fromDate)
    const toKey = iso(new Date(year, to[0] - 1, to[1]))
    const fromDay = days.get(fromKey)
    const toDay = days.get(toKey)
    if (!fromDay || !toDay) throw new Error(`${year}: перенос ${fromKey} → ${toKey} вне года`)

    decreeSources.add(fromKey)
    toDay.dayType = 'weekend'
    toDay.label = transferLabel(fromDate)

    if (fromDay.label === null) {
      // Уехал обычный выходной — значит, в этот день работают.
      fromDay.dayType = 'workday'
      fromDay.label = 'рабочая суббота'
    }
  }

  // 4. Праздник, совпавший с выходным, уезжает на следующий рабочий день.
  for (const day of [...days.values()]) {
    if (day.dayType !== 'weekend' || day.label === null) continue

    const date = new Date(`${day.date}T00:00:00`)
    if (!isWeekendDay(date) || isNewYearHoliday(date) || decreeSources.has(day.date)) continue

    const target = new Date(date)
    let guard = 0
    do {
      target.setDate(target.getDate() + 1)
      guard += 1
      if (guard > 10 || target.getFullYear() !== year) {
        throw new Error(`${year}: некуда перенести выходной ${day.date}`)
      }
    } while (days.get(iso(target))?.dayType !== 'workday')

    const targetDay = days.get(iso(target))
    targetDay.dayType = 'weekend'
    targetDay.label = transferLabel(date)
  }

  // 5. Сокращённые дни.
  for (const [month, dayOfMonth] of facts.shortDays) {
    const day = days.get(iso(new Date(year, month - 1, dayOfMonth)))
    if (!day) throw new Error(`${year}: сокращённый день ${month}-${dayOfMonth} вне года`)
    if (day.dayType === 'weekend') {
      throw new Error(`${year}: сокращённый день ${day.date} помечен выходным`)
    }
    day.dayType = 'short_workday'
  }

  // 6. Тематические метки.
  for (const day of days.values()) {
    const date = new Date(`${day.date}T00:00:00`)
    const thematic = thematicByKey.get(key([date.getMonth() + 1, date.getDate()]))
    if (!thematic) continue
    // Официальное название праздника важнее тематической подписи.
    day.label = day.label ?? thematic.label
  }

  return [...days.values()]
}

/** Проверка по помесячным итогам официального календаря. */
function verify(year, days, facts) {
  const problems = []
  const byMonth = Array.from({ length: 12 }, () => ({ work: 0, off: 0 }))

  for (const day of days) {
    const month = Number(day.date.slice(5, 7)) - 1
    if (day.dayType === 'weekend') byMonth[month].off += 1
    else byMonth[month].work += 1
  }

  const names = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']

  const rows = []
  for (let month = 0; month < 12; month += 1) {
    const [work, off] = facts.monthly[month]
    const got = byMonth[month]
    const ok = got.work === work && got.off === off
    if (!ok) problems.push(`${year} ${names[month]}: получено ${got.work}/${got.off}, ожидалось ${work}/${off}`)
    rows.push(`${names[month].padEnd(9)} ${String(got.work).padStart(2)}/${String(got.off).padStart(2)}${ok ? '' : '  <-- РАСХОЖДЕНИЕ'}`)
  }

  const totalWork = byMonth.reduce((sum, item) => sum + item.work, 0)
  const totalOff = byMonth.reduce((sum, item) => sum + item.off, 0)
  const yearWork = facts.monthly.reduce((sum, item) => sum + item[0], 0)
  const yearOff = facts.monthly.reduce((sum, item) => sum + item[1], 0)
  if (totalWork !== yearWork || totalOff !== yearOff) {
    problems.push(`${year} год: получено ${totalWork}/${totalOff}, ожидалось ${yearWork}/${yearOff}`)
  }

  return { rows, totalWork, totalOff, problems }
}

function main() {
  const outIndex = process.argv.indexOf('--out')
  const outDir = resolve(HERE, outIndex > -1 ? process.argv[outIndex + 1] : '../seed/calendar')
  mkdirSync(outDir, { recursive: true })

  let failed = false

  for (const [yearText, facts] of Object.entries(FACTS)) {
    const year = Number(yearText)
    const days = buildYear(year, facts)
    const { rows, totalWork, totalOff, problems } = verify(year, days, facts)

    console.log(`\n=== ${year} (${facts.source}) ===`)
    console.log(rows.join('\n'))
    console.log(`итого: ${totalWork} рабочих / ${totalOff} выходных`)

    if (problems.length > 0) {
      failed = true
      console.error('РАСХОЖДЕНИЯ:')
      for (const problem of problems) console.error(`  ${problem}`)
      continue
    }

    const file = resolve(outDir, `ru-${year}.json`)
    const output = {
      year,
      source: facts.source,
      // Пустую метку в файл не пишем: у 340 дней из 365 её нет, и null
      // в каждой строке — это 80% мусора в диффах.
      days: days.map(({ date, dayType, label }) => ({
        date,
        dayType,
        ...(label ? { label } : {}),
      })),
    }
    writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
    console.log(`записано: ${file}`)
  }

  if (failed) {
    console.error('\nКонтрольная сумма не сошлась — файлы не записаны.')
    process.exit(1)
  }
  console.log('\nВсе годы сошлись с официальным календарём.')
}

main()
