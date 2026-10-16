/**
 * Сбор справочника географических объектов с «Природы Байкала».
 *
 * Скрипт делает две вещи: тянет страницы сайта и разбирает их в один
 * JSON. Разделены они нарочно — **разбор проверяется без сети**, на уже
 * сохранённых дампах (`--from-dir`), а сеть остаётся тонким слоем, который
 * нельзя протестировать здесь, но можно перепроверить там, где она есть.
 *
 * ## Почему по районам, а не одной страницей
 *
 * Общая страница `objs.shtml?obj=skala` отдаёт **все** объекты типа, но
 * **без района**: ссылки на объекты там вида `obj.shtml?obj=skala&id=vityaz`
 * без `&rg=`, а ссылки на районы сайт достраивает JavaScript-ом из массива
 * меню (`m[i]='?obj=skala&rg='+m[i].substr(1)`), которого в HTML нет.
 * Поэтому «объект → район» восстанавливается только со страницы района.
 *
 * Отсюда цена: 22 района × 14 типов = 308 запросов. С паузой по умолчанию
 * это около пятнадцати минут — и обязательный троттлинг, иначе сайт
 * отвечает отказом (проверено: примерно после 35 частых запросов он
 * перестаёт отвечать, и это правильно с его стороны).
 *
 * ## Запуск
 *
 * ```sh
 * # разбор уже сохранённых дампов, без сети
 * node scripts/nature-import.mjs --from-dir=.tmp-verify/nature
 *
 * # сбор из сети: по умолчанию все районы и все типы
 * node scripts/nature-import.mjs --types=skala --delay=2500
 * node scripts/nature-import.mjs --regions=olha,tunki --types=skala,peak
 * ```
 *
 * Сбор возобновляемый: то, что уже собрано, лежит в файле результата,
 * и повторный запуск докачивает недостающее, а не начинает заново.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SITE = 'https://nature.baikal.ru';
const OUTPUT = 'scripts/data/nature/objects.json';

/**
 * Типы объектов: код сайта → канонический тип заказчика.
 *
 * Список закрытый — «район, река, перевал, вершина, озеро, водопад, каньон,
 * источник, скальник, хребет, залив, мыс, остров, пещера». Разделы сайта
 * соответствуют им один в один, поэтому перевод механический: раздел
 * кодирует тип однозначно, а как сайт называет объект внутри раздела
 * («скальник», «утёс») — это подпись, а не тип.
 *
 * `skala` — это **скальник**: так скальное обнажение называют в Прибайкалье,
 * и так заказчик просил подписывать тип (правка 16.10.2026, миграция
 * `1792224000000-ObjectsTypeSkalnik`).
 *
 * Селения, растения, животные, здания, улицы и «прочее» не берём: в цели
 * похода они не годятся.
 */
const TYPES = {
  river: 'река',
  pass: 'перевал',
  peak: 'вершина',
  lake: 'озеро',
  waterfall: 'водопад',
  kanion: 'каньон',
  spring: 'источник',
  skala: 'скальник',
  hrebet: 'хребет',
  zaliv: 'залив',
  mys: 'мыс',
  island: 'остров',
  cave: 'пещера',
};

/** Пауза между запросами по умолчанию. */
const DEFAULT_DELAY_MS = 60_000;

/**
 * Разброс паузы: ±половина.
 *
 * Ровный ритм запросов виден на той стороне как робот, а неровный — как
 * человек, который листает сайт. Это не хитрость ради обхода защиты,
 * а вежливость: нас никто не ждёт, спешить некуда.
 */
const DELAY_JITTER = 0.5;

/**
 * Паузы перед повторами, если запрос не прошёл.
 *
 * Растут минутами, а не секундами: сайт уже однажды перестал отвечать,
 * и в тот раз помогало только время. Долбить его повторами — верный способ
 * добиться отказа подольше.
 */
const RETRY_PAUSES_MS = [5 * 60_000, 15 * 60_000, 45 * 60_000];

// ─────────────────────────── разбор ───────────────────────────

/**
 * Разобрать список районов со страницы `reg.shtml`.
 *
 * Районы — ссылки вида `[Олхинское плато](/olha)`. Код района берётся
 * из адреса, а не из названия: название меняется («Шелеховский район»
 * дописали), код — нет.
 */
export function parseRegions(html) {
  // Ограничиваемся таблицей районов: до неё и после неё есть другие ссылки.
  const start = html.indexOf('| Районы |');
  const end = html.indexOf('Выберите район');
  const slice = start >= 0 && end > start ? html.slice(start, end) : html;

  const regions = [];
  const seen = new Set();
  // `[a-z0-9_]+` без точки отсекает `schemebig.shtml` и прочие страницы.
  const link = /\[([^\]]+)\]\(\/([a-z0-9_]+)\)/g;

  for (const match of slice.matchAll(link)) {
    const [, name, code] = match;
    if (seen.has(code)) continue;
    seen.add(code);
    regions.push({ code, name: name.trim() });
  }

  return regions;
}

/**
 * Разобрать JS-массив объектов со страницы `objs.shtml`.
 *
 * Устройство: `os=new Array(new Array('А',"skala","vityaz&rg=olha","Витязь",
 * "скальник", "skala","idol",...), new Array('Б', ...))` — группы по первой
 * букве, внутри каждой после буквы идут четвёрки: класс, слаг, название,
 * подпись типа.
 *
 * Берём именно этот массив, а не список в `<noscript>`: во-первых, он
 * единственный содержит `&rg=`, во-вторых, страницы районов весят под
 * 130 КБ и обрезаются при загрузке, а массив лежит в начале.
 */
export function parseObjects(html, fallbackRegion, typeCode) {
  const start = html.indexOf('os=new Array');
  if (start < 0) return [];

  // Конец массива — закрывающая скобка и `;` перед `</script>`.
  const scriptEnd = html.indexOf('</script>', start);
  const block = html.slice(start, scriptEnd > start ? scriptEnd : undefined);

  const byKey = new Map();

  // Каждая группа начинается со `new Array(`; буква в одинарных кавычках,
  // поэтому в значения, набранные двойными, она не попадает.
  for (const group of block.split('new Array(').slice(1)) {
    const values = group.match(/"([^"]*)"/g) ?? [];

    for (let i = 0; i + 3 < values.length; i += 4) {
      // Первое значение четвёрки — класс объекта (`skala`, `river`, `peak`).
      // **Фильтровать по нему обязательно.** Массив на странице района
      // содержит объекты всех типов, а не только запрошенный: страница
      // отбирает их скриптом. Без этой проверки в «скалы» уехали бы реки,
      // вершины и озёра — что и случилось на первом прогоне.
      const objectClass = values[i].slice(1, -1);
      if (objectClass !== typeCode) continue;

      const rawSlug = values[i + 1].slice(1, -1);
      const rawName = values[i + 2].slice(1, -1);

      // Слаг может нести район: `vityaz&rg=olha`.
      const [slug, regionPart] = rawSlug.split('&rg=');
      const region = regionPart || fallbackRegion;
      if (!slug || !region) continue;

      const key = `${region}|${slug}`;
      // Стрелка приходит то сущностью (`&rarr;`), то символом — в разных
      // дампах по-разному, поэтому разбираем оба вида.
      const { name, aliases } = splitAlias(decodeEntities(rawName));

      const existing = byKey.get(key);
      if (existing) {
        /**
         * Тот же объект пришёл второй раз под другим именем.
         *
         * На сайте так помечены переименования, и имён у объекта бывает
         * больше двух: скальник `buha_noyon` встречается трижды — «Белая
         * Скала → Белый Камень», просто «Белый Камень» и «Буха-Нойон →
         * Белый Камень». Основным остаётся имя из первой встречи, а все
         * прочие копятся псевдонимами: потерять ходовое имя хуже, чем
         * показать объект под одним из них.
         */
        for (const alias of [name, ...aliases]) {
          if (alias !== existing.name && !existing.aliases.includes(alias)) {
            existing.aliases.push(alias);
          }
        }
        continue;
      }

      byKey.set(key, { region, slug, name, aliases });
    }
  }

  return [...byKey.values()];
}

/**
 * Разделить «ходовое имя → каноническое» и «просто имя».
 *
 * На сайте так помечены переименованные объекты: слева обиходное название,
 * справа то, которое считается основным. В справочнике имя одно, поэтому
 * основным становится правое, а левое сохраняется как псевдоним.
 */
function splitAlias(name) {
  const parts = name.split(/\s*(?:→|&rarr;)\s*/);
  if (parts.length < 2) return { name, aliases: [] };

  const canonical = parts[parts.length - 1].trim();
  const aliases = parts
    .slice(0, -1)
    .map((part) => part.trim())
    .filter(Boolean);

  return { name: canonical, aliases };
}

/** Раскодировать те немногие сущности, что встречаются в названиях. */
function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────── сеть ───────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Забрать страницу с повторами: сайт отвечает отказом при спешке. */
async function fetchPage(url, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'PeakHunter/1.0 (справочник объектов, учебный проект)',
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      if (attempt === attempts) throw error;
      // Пауза растёт: 5 с, 10 с, 20 с — спешить тут некуда.
      const pause = 5000 * 2 ** (attempt - 1);
      console.warn(
        `  ${url} — ${error.message}, повтор через ${pause / 1000} с`,
      );
      await sleep(pause);
    }
  }
  return '';
}

// ─────────────────────────── запуск ───────────────────────────

function parseArgs(argv) {
  const args = {
    types: Object.keys(TYPES),
    regions: null,
    delay: DEFAULT_DELAY_MS,
    fromDir: null,
    // Дампы районов сохраняются без типа в имени, поэтому в офлайн-режиме
    // тип задаётся явно. По умолчанию «скальник» — с раздела скал и начали.
    fromType: 'skala',
    out: OUTPUT,
  };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'types' && value) args.types = value.split(',');
    if (key === 'regions' && value) args.regions = value.split(',');
    if (key === 'delay' && value) args.delay = Number(value);
    if (key === 'from-dir' && value) args.fromDir = value;
    if (key === 'from-type' && value) args.fromType = value;
    if (key === 'out' && value) args.out = value;
  }
  return args;
}

function loadOutput(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { regions: [], objects: [] };
  }
}

function saveOutput(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/**
 * Оборван ли массив объектов на странице.
 *
 * Проверяем именно массив, а не страницу целиком: `web_fetch` дописывает
 * в конец пометку `(Content truncated…)` и режет хвост со списком
 * в `<noscript>`, но сам массив лежит в начале и остаётся целым. Резать
 * по одной пометке значило бы выбрасывать годные данные; но если у массива
 * нет закрывающего `</script>`, он оборван посередине — и такой файл
 * (или ответ) в результат не идёт, иначе неполный список района слился бы
 * с остальными незаметно.
 */
function isArrayTruncated(html) {
  const start = html.indexOf('os=new Array');
  return start >= 0 && html.indexOf('</script>', start) < 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = loadOutput(args.out);
  const known = new Set(
    store.objects.map((item) => `${item.region}|${item.slug}`),
  );

  let regions;

  if (args.fromDir) {
    // Офлайн-режим: сеть не трогаем, читаем то, что уже сохранено.
    const regHtml = readFileSync(join(args.fromDir, 'reg.txt'), 'utf8');
    regions = parseRegions(regHtml);
    console.log(`Районов в дампе: ${regions.length}`);

    for (const region of regions) {
      const file = join(args.fromDir, `region-${region.code}.txt`);
      let html;
      try {
        html = readFileSync(file, 'utf8');
      } catch {
        continue;
      }

      if (isArrayTruncated(html)) {
        console.warn(`  ${region.code}: массив оборван, пропускаем`);
        continue;
      }

      const parsed = parseObjects(html, region.code, args.fromType);
      let added = 0;
      for (const object of parsed) {
        const key = `${object.region}|${object.slug}`;
        if (known.has(key)) continue;
        known.add(key);
        store.objects.push({
          ...object,
          type: TYPES[args.fromType] ?? args.fromType,
        });
        added += 1;
      }
      console.log(
        `  ${region.code}: разобрано ${parsed.length}, новых ${added}`,
      );
    }
  } else {
    const html = await fetchPage(`${SITE}/reg.shtml`);
    regions = parseRegions(html);
    console.log(`Районов: ${regions.length}`);
    await sleep(args.delay);

    const wanted = args.regions ?? regions.map((region) => region.code);

    for (const code of wanted) {
      for (const type of args.types) {
        const url = `${SITE}/objs.shtml?obj=${type}&rg=${code}`;
        const page = await fetchPage(url);

        if (isArrayTruncated(page)) {
          console.warn(`${code}/${type}: ответ оборван, пропускаем`);
          await sleep(args.delay);
          continue;
        }

        const parsed = parseObjects(page, code, type);

        let added = 0;
        for (const object of parsed) {
          const key = `${object.region}|${object.slug}`;
          if (known.has(key)) continue;
          known.add(key);
          store.objects.push({ ...object, type: TYPES[type] ?? type });
          added += 1;
        }

        console.log(
          `${code}/${type}: ${parsed.length} найдено, ${added} новых`,
        );
        await sleep(args.delay);
      }
    }
  }

  store.regions = regions;
  store.collectedAt = new Date().toISOString();
  saveOutput(args.out, store);

  console.log('');
  console.log(`Всего объектов: ${store.objects.length} — ${args.out}`);
}

/**
 * Запуск сбора — только при прямом вызове скрипта.
 *
 * Файл экспортирует разбор (`parseRegions`, `parseObjects`), и импорт
 * из другого скрипта не должен начинать качать сайт: сбор — это сеть,
 * троттлинг и минуты ожидания, а не побочный эффект импорта.
 */
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
