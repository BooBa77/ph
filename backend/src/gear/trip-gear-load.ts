import { GEAR_CAPACITY_COEFFICIENT } from './gear.types';
import type { UserGender } from '../users/gender.types';

/**
 * Раскладка груза по рюкзакам — чистый расчёт без базы (06.11.2026).
 *
 * Правила заказчика 21.10.2026 целиком в `docs/ph/gear-distribution.md` §4.
 * Здесь только алгоритм: он вынесен из сервиса, потому что проверять его
 * на живых походах дорого, а на числах — дёшево. Единица груза — вещь
 * похода или пакет еды; обе неделимы: палатка и «Пакет 2» либо у человека
 * целиком, либо у другого.
 *
 * ## Что считается
 *
 * 1. Весь распределяемый вес `W_total` — сумма вещей и пакетов.
 * 2. `k_i` — коэффициент человека: М = 1, Ж = `GEAR_CAPACITY_COEFFICIENT`.
 *    `T = W_total / Σk_i`, `target_i = k_i × T`.
 * 3. Своё — владельцу, тяжёлое вперёд: вещь идёт владельцу, пока его вес
 *    не дошёл до `target_i`. Дошёл — в общий пул. Порядок «сначала тяжёлое»
 *    не косметика: тяжёлую вещь хуже всего переносить «не туда».
 * 4. Остаток и **все пакеты еды** уравниваются: единица уходит тому, у кого
 *    больше свободной доли (`target_i − W_i`).
 * 5. Аптечка — единственное закрепление: она сразу у медика и в уравнивании
 *    не участвует. Медика нет — аптечка становится обычной вещью, и это
 *    видно по флагу `doctorMissing`.
 *
 * ## Чего алгоритм не делает
 *
 * - **Не дробит груз.** Половину палатки нести нельзя.
 * - **Не учитывает вес тела и возраст.** Коэффициент — продуктовое решение,
 *   а не измеренная величина; в документации это сказано прямо.
 * - **Не запрещает перегруз.** Он показывается отклонением, а решают люди.
 */

/** Вид единицы груза: вещь похода или пакет еды. */
export type LoadUnitKind = 'gear' | 'package';

/** Единица груза, которую раскладывают по рюкзакам. */
export interface LoadUnit {
  kind: LoadUnitKind;
  /** Id строки `trip_gear` или `trip_meal_packages` — строками, как в API. */
  id: string;
  weightGrams: number;
  /** Владелец вещи; у пакета еды владельца нет. */
  ownerUserId: string | null;
  /** Аптечка: закреплена за медиком (правило §4). */
  isFirstAid?: boolean;
}

/** Человек, которому можно положить груз, — только идущий. */
export interface LoadPerson {
  userId: string;
  gender: UserGender;
  isDoctor: boolean;
}

/** Результат расчёта: кому что и с какой долей. */
export interface LoadAllocation {
  /** `gear:12` / `package:3` → id несущего. Отсутствие ключа — не распределено. */
  assignments: Map<string, string>;
  /** `target_i` — доля человека в граммах (дробная, округляется на экране). */
  targets: Map<string, number>;
  /** Сколько получилось у каждого после раскладки. */
  weights: Map<string, number>;
  doctorUserId: string | null;
  doctorMissing: boolean;
}

/** Ключ единицы в картах результата: вид и id не пересекаются. */
export function loadUnitKey(kind: LoadUnitKind, id: string): string {
  return `${kind}:${id}`;
}

/** Коэффициент переносимости: пол — единственное, что сейчас его меняет. */
export function capacityCoefficient(
  gender: UserGender,
  coefficient: number = GEAR_CAPACITY_COEFFICIENT,
): number {
  return gender === 'f' ? coefficient : 1;
}

/**
 * Разложить груз по людям.
 *
 * `people` приходит **в порядке состава**: при равных свободных долях
 * выигрывает тот, кто раньше в списке, — иначе один и тот же поход давал бы
 * разные ответы на двух прогонах, и «сохранилось не то» выглядело бы
 * ошибкой.
 */
export function allocateLoad(
  units: LoadUnit[],
  people: LoadPerson[],
  coefficient: number = GEAR_CAPACITY_COEFFICIENT,
): LoadAllocation {
  const assignments = new Map<string, string>();
  const targets = new Map<string, number>();
  const weights = new Map<string, number>();

  const doctor = people.find((person) => person.isDoctor) ?? null;
  const doctorMissing =
    doctor === null && units.some((unit) => unit.isFirstAid === true);

  for (const person of people) {
    weights.set(person.userId, 0);
  }

  const totalWeight = units.reduce((sum, unit) => sum + unit.weightGrams, 0);
  const capacity = people.reduce(
    (sum, person) => sum + capacityCoefficient(person.gender, coefficient),
    0,
  );
  // Людей нет — раскладывать некуда: всё остаётся нераспределённым.
  const share = capacity > 0 ? totalWeight / capacity : 0;
  for (const person of people) {
    targets.set(
      person.userId,
      capacityCoefficient(person.gender, coefficient) * share,
    );
  }

  const add = (personId: string, unit: LoadUnit): void => {
    assignments.set(loadUnitKey(unit.kind, unit.id), personId);
    weights.set(personId, (weights.get(personId) ?? 0) + unit.weightGrams);
  };

  // 5. Аптечка — до всего остального: её место не обсуждается.
  const rest: LoadUnit[] = [];
  for (const unit of units) {
    if (unit.isFirstAid !== true) {
      rest.push(unit);
      continue;
    }

    if (doctor) add(doctor.userId, unit);
    // Без медика аптечка ведёт себя как обычная вещь (§4).
    else rest.push(unit);
  }

  // 3. Своё — владельцу, тяжёлое вперёд.
  const heavyFirst = [...rest].sort(compareUnits);
  const pool: LoadUnit[] = [];
  for (const unit of heavyFirst) {
    const owner = unit.ownerUserId;
    if (
      owner !== null &&
      weights.has(owner) &&
      (weights.get(owner) ?? 0) < (targets.get(owner) ?? 0)
    ) {
      add(owner, unit);
    } else {
      pool.push(unit);
    }
  }

  // 4. Остаток и пакеты — тому, у кого больше свободной доли.
  for (const unit of pool.sort(compareUnits)) {
    const person = freestPerson(people, targets, weights);
    if (!person) break;
    add(person.userId, unit);
  }

  return {
    assignments,
    targets,
    weights,
    doctorUserId: doctor?.userId ?? null,
    doctorMissing,
  };
}

/**
 * Тяжёлое вперёд; при равном весе — по виду и id.
 *
 * Порядок в пуле влияет на итог: жадная раскладка «тяжёлым вперёд» даёт
 * меньше разброса, чем «как пришло». Tie-break по id — только ради
 * повторяемости: в базе порядок строк не гарантирован.
 */
function compareUnits(left: LoadUnit, right: LoadUnit): number {
  if (left.weightGrams !== right.weightGrams) {
    return right.weightGrams - left.weightGrams;
  }
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;

  return left.id.localeCompare(right.id, 'en', { numeric: true });
}

/** Кто самый свободный; при равенстве — раньше в составе. */
function freestPerson(
  people: LoadPerson[],
  targets: Map<string, number>,
  weights: Map<string, number>,
): LoadPerson | null {
  let best: LoadPerson | null = null;
  let bestFree = Number.NEGATIVE_INFINITY;

  for (const person of people) {
    const free =
      (targets.get(person.userId) ?? 0) - (weights.get(person.userId) ?? 0);
    // Строго больше: при равных долях выигрывает первый в составе.
    if (free > bestFree) {
      best = person;
      bestFree = free;
    }
  }

  return best;
}
