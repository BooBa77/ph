import { describe, expect, it } from 'vitest';

import {
  isValidDiaryTimes,
  shouldApplyDiaryUpdate,
} from './trip-diary.types';

/**
 * Правило синхронизации дневника (16.11.2026).
 *
 * Спор двух устройств одного человека — единственный конфликт, который
 * у личного дневника бывает. Правило простое: побеждает более поздняя
 * правка. Проверяем его отдельно от базы: ошибка здесь тихо перезаписывает
 * записи, сделанные в поле.
 */
describe('синхронизация дневника', () => {
  it('более поздняя правка применяется', () => {
    expect(
      shouldApplyDiaryUpdate(
        new Date('2026-11-16T10:00:01.000Z'),
        new Date('2026-11-16T10:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('та же отметка не перезаписывает серверную версию', () => {
    const at = new Date('2026-11-16T10:00:00.000Z');

    // Это и есть идемпотентность: повторная отправка той же пачки
    // после обрыва не должна ничего менять.
    expect(shouldApplyDiaryUpdate(at, at)).toBe(false);
  });

  it('старая копия с другого устройства не затирает новую', () => {
    expect(
      shouldApplyDiaryUpdate(
        new Date('2026-11-15T20:00:00.000Z'),
        new Date('2026-11-16T10:00:00.000Z'),
      ),
    ).toBe(false);
  });
});

describe('времена записи дневника', () => {
  const created = new Date('2026-11-16T10:00:00.000Z');

  it('правка позже создания — нормально', () => {
    expect(
      isValidDiaryTimes(created, new Date('2026-11-16T10:05:00.000Z'), null),
    ).toBe(true);
  });

  it('правка раньше создания — ошибка', () => {
    expect(
      isValidDiaryTimes(created, new Date('2026-11-16T09:59:59.000Z'), null),
    ).toBe(false);
  });

  it('удаление раньше создания — ошибка', () => {
    expect(
      isValidDiaryTimes(
        created,
        new Date('2026-11-16T10:05:00.000Z'),
        new Date('2026-11-16T09:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('удаление позже создания — нормально', () => {
    expect(
      isValidDiaryTimes(
        created,
        new Date('2026-11-16T10:05:00.000Z'),
        new Date('2026-11-16T10:10:00.000Z'),
      ),
    ).toBe(true);
  });

  it('мусор вместо даты — ошибка', () => {
    expect(
      isValidDiaryTimes(created, new Date('не дата'), null),
    ).toBe(false);
  });
});
