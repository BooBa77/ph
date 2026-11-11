/**
 * Чистые правила заявки на объединение семей (11.11.2026, шаг 2).
 *
 * Здесь нет базы: только то, что можно доказать без неё — порядок пары,
 * полный набор пар участников и сравнение состава заявки. Отдельный файл
 * нужен и для юнит-тестов (`family-union.spec.ts`), и для того, чтобы
 * правило «пара хранится один раз» жило в одном месте, а не повторялось
 * в сервисе и в миграции.
 */

/**
 * Канонический порядок пары для `family_links`.
 *
 * В базе пара хранится один раз, `user_a_id < user_b_id`
 * (`chk_family_links_pair`), чтобы две строки об одном родстве были
 * невозможны. Postgres сравнивает `uuid` побайтно, а каноническая запись
 * uuid — нижний регистр; `ParseUUIDPipe` регистр не меняет, поэтому
 * приводим обе стороны сами.
 */
export function familyPair(left: string, right: string): [string, string] {
  const first = left.toLowerCase();
  const second = right.toLowerCase();

  return first < second ? [first, second] : [second, first];
}

/**
 * Все пары участников — по одной на каждое родство внутри заявки.
 *
 * Объединение семей создаёт **полный граф** связей между участниками:
 * после согласия все они родные друг другу, а не только «через инициатора».
 * Пары возвращаются в каноническом порядке и без повторов — по ним
 * сервис делает `INSERT ... ON CONFLICT DO NOTHING`.
 */
export function crossPairs(userIds: string[]): Array<[string, string]> {
  const unique = [...new Set(userIds.map((id) => id.toLowerCase()))];
  const pairs: Array<[string, string]> = [];

  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      pairs.push(familyPair(unique[i], unique[j]));
    }
  }

  return pairs;
}

/**
 * Совпадает ли состав заявки с набором людей.
 *
 * Нужно, чтобы «встречная инициатива того же состава» считалась согласием,
 * а не плодила вторую такую же заявку (решение заказчика). Порядок и
 * регистр значения не имеют, повторы тоже: сравниваются множества.
 */
export function sameMembers(left: string[], right: string[]): boolean {
  const first = new Set(left.map((id) => id.toLowerCase()));
  const second = new Set(right.map((id) => id.toLowerCase()));

  if (first.size !== second.size) return false;

  for (const id of first) {
    if (!second.has(id)) return false;
  }

  return true;
}
