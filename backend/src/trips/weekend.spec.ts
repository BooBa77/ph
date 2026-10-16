import { describe, expect, it } from 'vitest';

import { nextWeekendRange } from './weekend';

/**
 * Тесты окна «следующие выходные».
 *
 * Часовой пояс здесь — не деталь, а суть: пятница 20:00 UTC это уже
 * суббота в Иркутске, и «следующие выходные» для этого момента — не
 * завтрашняя суббота, а через неделю. Поэтому в тестах есть проверка
 * ровно на такой момент.
 */
const IRKUTSK = 'Asia/Irkutsk';

/** Как выглядит момент в поясе проекта: «Sat 00:00». */
function localLabel(at: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: IRKUTSK,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

describe('nextWeekendRange', () => {
  it('в пятницу даёт ближайшую субботу и понедельник после неё', () => {
    // Пятница 16.10.2026, 18:00 в Иркутске.
    const { start, end } = nextWeekendRange(
      new Date('2026-10-16T10:00:00.000Z'),
    );

    expect(localLabel(start)).toContain('Sat');
    expect(localLabel(start)).toContain('00:00');
    expect(localLabel(end)).toContain('Mon');
    expect(end.getTime() - start.getTime()).toBe(48 * 60 * 60 * 1000);

    expect(start.toISOString()).toBe('2026-10-16T16:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-18T16:00:00.000Z');
  });

  it('в понедельник даёт субботу через пять дней', () => {
    const { start } = nextWeekendRange(new Date('2026-10-19T10:00:00.000Z'));

    // Понедельник 19.10 → суббота 24.10, местная полночь.
    expect(start.toISOString()).toBe('2026-10-23T16:00:00.000Z');
  });

  /**
   * Главное правило, которое проговорил заказчик: в субботу «следующие
   * выходные» — это не сегодняшние. Иначе в субботу утром фильтр показывал
   * бы походы, которые уже начались.
   */
  it('в субботу и воскресенье выходные сдвигаются на неделю', () => {
    const saturday = nextWeekendRange(new Date('2026-10-17T10:00:00.000Z'));
    const sunday = nextWeekendRange(new Date('2026-10-18T10:00:00.000Z'));

    expect(saturday.start.toISOString()).toBe('2026-10-23T16:00:00.000Z');
    expect(sunday.start.toISOString()).toBe('2026-10-23T16:00:00.000Z');
  });

  /**
   * Ловушка пояса: 16.10.2026 20:00 UTC — это 04:00 субботы в Иркутске.
   * Расчёт по UTC дал бы «эти выходные», расчёт по поясу проекта —
   * следующие, и это правильный ответ.
   */
  it('пятница вечером по UTC — уже суббота в Иркутске', () => {
    const { start } = nextWeekendRange(new Date('2026-10-16T20:00:00.000Z'));

    expect(start.toISOString()).toBe('2026-10-23T16:00:00.000Z');
  });

  it('окно всегда ровно двое суток и начинается в местную полночь', () => {
    for (const day of ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']) {
      const { start, end } = nextWeekendRange(new Date(`${day}T05:00:00.000Z`));

      expect(end.getTime() - start.getTime()).toBe(48 * 60 * 60 * 1000);
      expect(localLabel(start)).toContain('00:00');
      expect(localLabel(end)).toContain('00:00');
    }
  });
});
