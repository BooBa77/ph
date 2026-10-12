/**
 * Учебный календарь — в коде, как и праздники.
 *
 * Почему не в базе. Каникулы назначает Минпросвещения рекомендациями,
 * школы вправе сдвигать, а вузам вообще никто не указ: пока регион и
 * учебное заведение у нас одни, таблица была бы справочником ради
 * полутора десятков дат. Понадобятся вузы и регионы — перенесём
 * в таблицу, как государственный календарь.
 *
 * Важно: «учусь» — это не «весь год выходными». Каникулы не совпадают
 * с производственным календарём: 27–30 октября 2026 по госкалендарю
 * рабочие дни, а школьник отдыхает. Поэтому режим «учусь» считается
 * как 5/2 плюс государственные праздники плюс каникулы отсюда.
 */

/** Вид каникул. Метка для пользователя собирается из него. */
export type EducationBreakKind =
  | 'autumn'
  | 'winter'
  | 'spring'
  | 'summer'
  | 'extra';

export interface EducationBreak {
  /** Учебный год: он пересекает календарный, поэтому и хранится так. */
  academicYear: string;
  kind: EducationBreakKind;
  label: string;
  /** Включительно. */
  from: string;
  to: string;
}

/**
 * 2026-2027, четвертная система, рекомендации Минпросвещения.
 * Дополнительные каникулы — для первых классов.
 */
export const EDUCATION_BREAKS: EducationBreak[] = [
  {
    academicYear: '2026-2027',
    kind: 'autumn',
    label: 'Осенние каникулы',
    from: '2026-10-26',
    to: '2026-11-03',
  },
  {
    academicYear: '2026-2027',
    kind: 'winter',
    label: 'Зимние каникулы',
    from: '2026-12-31',
    to: '2027-01-10',
  },
  {
    academicYear: '2026-2027',
    kind: 'extra',
    label: 'Дополнительные каникулы (1 классы)',
    from: '2027-02-15',
    to: '2027-02-21',
  },
  {
    academicYear: '2026-2027',
    kind: 'spring',
    label: 'Весенние каникулы',
    from: '2027-03-27',
    to: '2027-04-04',
  },
  {
    academicYear: '2026-2027',
    kind: 'summer',
    label: 'Летние каникулы',
    from: '2027-05-27',
    to: '2027-08-31',
  },
];

const iso = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

/** Разбор `YYYY-MM-DD` в локальную дату: `new Date(iso)` читает UTC. */
const parseIso = (value: string): Date => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year as number, (month as number) - 1, day as number);
};

/** Попадает ли каникулярный отрезок в календарный год. */
function overlapsYear(item: EducationBreak, year: number): boolean {
  return parseIso(item.from).getFullYear() <= year && parseIso(item.to).getFullYear() >= year;
}

/** Есть ли учебный календарь, покрывающий этот календарный год. */
export function hasEducationCalendar(year: number): boolean {
  return EDUCATION_BREAKS.some((item) => overlapsYear(item, year));
}

/**
 * Каникулы года: дата → метка.
 *
 * Если отрезки пересекаются (так бывает у дополнительных каникул первых
 * классов и зимних), выигрывает тот, что идёт позже в списке: порядок
 * в `EDUCATION_BREAKS` — от общих к частным.
 */
export function educationBreaksForYear(year: number): Map<string, string> {
  const result = new Map<string, string>();

  for (const item of EDUCATION_BREAKS) {
    if (!overlapsYear(item, year)) continue;

    const from = parseIso(item.from);
    const to = parseIso(item.to);
    const cursor = new Date(Math.max(from.getTime(), new Date(year, 0, 1).getTime()));
    const last = new Date(Math.min(to.getTime(), new Date(year, 11, 31).getTime()));

    while (cursor.getTime() <= last.getTime()) {
      result.set(iso(cursor), item.label);
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return result;
}
