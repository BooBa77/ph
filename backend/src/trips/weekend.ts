/**
 * «Следующие выходные» — окно времени для фильтра ленты походов.
 *
 * Отдельный модуль, а не пара строк внутри SQL, по двум причинам.
 *
 * **Часовой пояс.** Выходные начинаются в субботу по местному времени,
 * а сервер живёт в UTC: `date_trunc('week', now())` в SQL дал бы субботу
 * по Гринвичу, то есть Иркутскую пятницу. Регион у проекта один —
 * Прибайкалье, поэтому пояс зафиксирован, а не берётся из окружения:
 * «выходные» — понятие календаря пользователя, а не настройка сервера.
 *
 * **Проверяемость.** Расчёт окна — чистая функция от момента времени:
 * её можно проверить тестом на любой день недели, включая субботу
 * и воскресенье, а не ждать настоящей субботы.
 */

/**
 * Пояс проекта. Иркутск — UTC+8 круглый год: переводов часов там нет
 * с 2014 года, но расчёт всё равно идёт через `Intl`, а не сложением
 * восьми часов: так он останется верным, если пояс когда-нибудь поменяют.
 */
export const TRIP_TIME_ZONE = 'Asia/Irkutsk';

/** Окно выходных: с местной полуночи субботы по местную полночь понедельника. */
export interface WeekendRange {
  /** Начало субботы (включительно). */
  start: Date;
  /** Начало понедельника (не включительно). */
  end: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Части календарной даты в заданном поясе. */
function localDateParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);

  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    weekday: WEEKDAYS.indexOf(value('weekday') as (typeof WEEKDAYS)[number]),
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
  };
}

/**
 * Смещение пояса в минутах для конкретного момента.
 *
 * Считается через `Intl`, а не таблицей: пояс с переводами часов даёт
 * разное смещение летом и зимой, и жёсткие «+8» однажды соврали бы.
 */
function timeZoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);

  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  // `hour` в en-US при hour12: false приходит как «24» для полуночи.
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour') % 24,
    value('minute'),
    value('second'),
  );

  const instant = at.getTime() - at.getMilliseconds();
  return (asUtc - instant) / 60_000;
}

/** Местная полночь календарного дня, выраженная моментом UTC. */
function zonedMidnight(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day);
  const offset = timeZoneOffsetMinutes(timeZone, new Date(guess));
  return new Date(guess - offset * 60_000);
}

/**
 * Окно следующих выходных.
 *
 * Правило простое и его стоит проговорить: берётся **ближайшая суббота,
 * которая ещё не наступила**. В понедельник это суббота через пять дней,
 * в пятницу — завтрашняя, а в субботу и воскресенье — суббота следующей
 * недели: на вопрос «куда пойти в следующие выходные», заданный в субботу,
 * «эти выходные» — плохой ответ, они уже идут.
 */
export function nextWeekendRange(
  now: Date = new Date(),
  timeZone: string = TRIP_TIME_ZONE,
): WeekendRange {
  const { weekday, year, month, day } = localDateParts(now, timeZone);

  // Полдень как точка отсчёта: при переходе через сутки не важно,
  // каким было время суток, а полдень защищает от краевых случаев.
  const cursor = Date.UTC(year, month - 1, day, 12);

  let daysAhead = (6 - weekday + 7) % 7;
  if (daysAhead === 0) daysAhead = 7;

  const saturday = new Date(cursor + daysAhead * DAY_MS);
  const monday = new Date(saturday.getTime() + 2 * DAY_MS);

  return {
    start: zonedMidnight(
      saturday.getUTCFullYear(),
      saturday.getUTCMonth() + 1,
      saturday.getUTCDate(),
      timeZone,
    ),
    end: zonedMidnight(
      monday.getUTCFullYear(),
      monday.getUTCMonth() + 1,
      monday.getUTCDate(),
      timeZone,
    ),
  };
}
