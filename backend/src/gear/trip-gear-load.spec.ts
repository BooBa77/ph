import { describe, expect, it } from 'vitest';

import {
  allocateLoad,
  capacityCoefficient,
  loadUnitKey,
  type LoadPerson,
  type LoadUnit,
} from './trip-gear-load';

/**
 * Автораспределение груза — правила 21.10.2026
 * (`docs/ph/gear-distribution.md` §4).
 *
 * Проверяем числами, а не через базу: правила продуктовые, и ошибка в них
 * тихая — раскладка просто окажется несправедливой, ни один запрос
 * не упадёт. Поэтому здесь дёшево перебрать углы: владелец, тяжесть,
 * коэффициент пола, аптечка, пустой состав.
 */

const man = (id: string, isDoctor = false): LoadPerson => ({
  userId: id,
  gender: 'm',
  isDoctor,
});

const woman = (id: string, isDoctor = false): LoadPerson => ({
  userId: id,
  gender: 'f',
  isDoctor,
});

const gear = (
  id: string,
  weightGrams: number,
  ownerUserId: string | null,
  isFirstAid = false,
): LoadUnit => ({
  kind: 'gear',
  id,
  weightGrams,
  ownerUserId,
  isFirstAid,
});

const pack = (id: string, weightGrams: number): LoadUnit => ({
  kind: 'package',
  id,
  weightGrams,
  ownerUserId: null,
});

describe('коэффициент переносимости', () => {
  it('мужчина — 1, женщина — 0,8 по умолчанию', () => {
    expect(capacityCoefficient('m')).toBe(1);
    expect(capacityCoefficient('f')).toBe(0.8);
  });

  it('коэффициент можно пересмотреть, не трогая алгоритм', () => {
    expect(capacityCoefficient('f', 0.7)).toBe(0.7);
    expect(capacityCoefficient('m', 0.7)).toBe(1);
  });
});

describe('allocateLoad', () => {
  it('своё — владельцу: две вещи на своих хозяевах', () => {
    const result = allocateLoad(
      [gear('1', 3000, 'a'), gear('2', 1000, 'b')],
      [man('a'), man('b')],
    );

    expect(result.assignments.get(loadUnitKey('gear', '1'))).toBe('a');
    expect(result.assignments.get(loadUnitKey('gear', '2'))).toBe('b');
    expect(result.weights.get('a')).toBe(3000);
    expect(result.weights.get('b')).toBe(1000);
  });

  it('тяжёлая вещь остаётся у владельца даже с перегрузом: не дробим', () => {
    const result = allocateLoad([gear('1', 5000, 'a')], [man('a'), man('b')]);

    // Доля «a» — 2500 г (5000 / 2), но палатку на 5 кг пополам не разрежешь.
    expect(result.assignments.get(loadUnitKey('gear', '1'))).toBe('a');
    expect(result.targets.get('a')).toBeCloseTo(2500, 1);
    expect(result.weights.get('a')).toBe(5000);
  });

  it('остаток и пакеты — тому, у кого больше свободной доли', () => {
    const result = allocateLoad(
      [gear('1', 1000, 'a'), pack('7', 3000)],
      [man('a'), man('b')],
    );

    expect(result.assignments.get(loadUnitKey('gear', '1'))).toBe('a');
    // «a» занят своей верёвкой, свободнее «b» — пакет уходит ему.
    expect(result.assignments.get(loadUnitKey('package', '7'))).toBe('b');
  });

  it('доля зависит от пола: мужчина получает больше при том же грузе', () => {
    const result = allocateLoad([pack('1', 4000)], [man('a'), woman('b')]);

    // k = 1 + 0,8 = 1,8; T = 4000 / 1,8 ≈ 2222; доли — 2222 и 1778.
    expect(result.targets.get('a')).toBeCloseTo(2222.22, 1);
    expect(result.targets.get('b')).toBeCloseTo(1777.78, 1);
    // Пакет один и он неделим — уходит первому в составе.
    expect(result.assignments.get(loadUnitKey('package', '1'))).toBe('a');
  });

  it('аптечка закреплена за медиком, даже если её владелец — другой', () => {
    const result = allocateLoad(
      [gear('1', 500, 'b', true), gear('2', 1000, 'b')],
      [man('a', true), man('b')],
    );

    expect(result.assignments.get(loadUnitKey('gear', '1'))).toBe('a');
    expect(result.doctorUserId).toBe('a');
    expect(result.doctorMissing).toBe(false);
  });

  it('медика нет — аптечка едет как обычная вещь, и это видно по флагу', () => {
    const result = allocateLoad([gear('1', 500, 'b', true)], [
      man('a'),
      man('b'),
    ]);

    expect(result.doctorMissing).toBe(true);
    expect(result.doctorUserId).toBeNull();
    // Без медика аптечка — обычная вещь: своё едет владельцу, «b».
    expect(result.assignments.get(loadUnitKey('gear', '1'))).toBe('b');
  });

  it('вещь «пока не решил» — в пул: её владельца нет среди идущих', () => {
    const result = allocateLoad(
      [gear('1', 1000, 'maybe'), pack('2', 1000)],
      [man('a')],
    );

    expect(result.assignments.get(loadUnitKey('gear', '1'))).toBe('a');
    expect(result.assignments.get(loadUnitKey('package', '2'))).toBe('a');
  });

  it('никого в составе — ничего не распределено', () => {
    const result = allocateLoad([gear('1', 1000, 'a'), pack('2', 500)], []);

    expect(result.assignments.size).toBe(0);
    expect(result.targets.size).toBe(0);
    expect(result.doctorMissing).toBe(false);
  });

  it('два прогона дают одинаковый ответ: порядок не зависит от входа', () => {
    const units = [
      gear('10', 2000, 'a'),
      gear('11', 2000, 'b'),
      pack('3', 1000),
      pack('2', 1000),
    ];
    const people = [man('a'), man('b')];

    const first = allocateLoad(units, people);
    const second = allocateLoad([...units].reverse(), people);

    for (const unit of units) {
      const key = loadUnitKey(unit.kind, unit.id);
      expect(first.assignments.get(key)).toBe(second.assignments.get(key));
    }
  });

  it('пакеты общей еды не достаются питающемуся отдельно', () => {
    // Заказчик 06.11.2026: «Рюкзаки питающихся самостоятельно в этом
    // не участвуют». Снаряжение он по-прежнему несёт.
    const result = allocateLoad([pack('1', 1000)], [
      { ...man('a'), eatsSeparately: true },
      man('b'),
    ]);

    expect(result.assignments.get(loadUnitKey('package', '1'))).toBe('b');
  });

  it('все питаются отдельно — пакеты остаются нераспределёнными', () => {
    const result = allocateLoad(
      [gear('1', 1000, 'a'), pack('2', 500)],
      [
        { ...man('a'), eatsSeparately: true },
        { ...man('b'), eatsSeparately: true },
      ],
    );

    expect(result.assignments.get(loadUnitKey('gear', '1'))).toBe('a');
    expect(result.assignments.has(loadUnitKey('package', '2'))).toBe(false);
  });

  it('пакет уходит менее загруженному: «Питание» не трогает снаряжение', () => {
    // `initialWeights` — уже лежащие на людях вещи: пересборка пакетов
    // считается от них, а не с нуля.
    const result = allocateLoad(
      [pack('1', 1000)],
      [man('a'), man('b')],
      undefined,
      new Map([
        ['a', 3000],
        ['b', 0],
      ]),
    );

    expect(result.assignments.get(loadUnitKey('package', '1'))).toBe('b');
  });
});
