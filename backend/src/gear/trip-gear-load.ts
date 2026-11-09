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
 *    больше свободной доли (`target_i − W_i`). Тяжёлое среди остатка
 *    сначала предлагается мужчинам: если у кого-то из них есть свободная
 *    доля, вещь идёт ему (09.11.2026, правило ниже).
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

/**
 * Тяжёлая вещь — та, что забирает заметную часть рюкзака (09.11.2026).
 *
 * Заказчик посмотрел раскладку «Витязя»: топор 900 г достался Марине,
 * а тан 800 г и пилу — мужчинам. Он сказал прямо: «если у тебя заложена
 * логика распределения тяжёлых вещей в первую очередь, то тогда нужно
 * учитывать и пол — тяжёлые вещи мужикам».
 *
 * Порог **относительный**: половина средней доли `T` — то есть вещь,
 * которая заметно утяжелит рюкзак именно в этом походе. Плюс пол в 300 г:
 * горелку или пилу в 150 г «тяжёлой» называть смешно, пол для них роли
 * не играет. Гендерное правило не закрепляет вещь за мужчиной навсегда:
 * если у мужчин свободной доли уже нет, вещь достаётся самому свободному,
 * кем бы он ни был.
 */
const HEAVY_ITEM_MIN_GRAMS = 300;
const HEAVY_ITEM_SHARE = 0.5;

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
  /**
   * Питается отдельно (06.11.2026) — не ест общий котёл и не несёт его.
   * Заказчик: «Рюкзаки питающихся самостоятельно в этом не участвуют».
   * На снаряжение это не влияет: палатку он несёт как все.
   */
  eatsSeparately?: boolean;
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
 *
 * `initialWeights` — уже лежащий на людях груз (06.11.2026). Нужен
 * «Питанию»: когда меняется состав пакетов, оно перераскладывает **только
 * пакеты**, не трогая снаряжение, и свободная доля человека считается
 * от снаряжения, которое за ним уже закреплено.
 *
 * **Пакеты еды не раскладываются «питающимся отдельно»** (решение
 * заказчика 06.11.2026): они не едят общий котёл и не должны его нести.
 * Если едоков нет вовсе, пакеты остаются нераспределёнными — экран так
 * и скажет.
 */
export function allocateLoad(
  units: LoadUnit[],
  people: LoadPerson[],
  coefficient: number = GEAR_CAPACITY_COEFFICIENT,
  initialWeights?: ReadonlyMap<string, number>,
): LoadAllocation {
  const assignments = new Map<string, string>();
  const targets = new Map<string, number>();
  const weights = new Map<string, number>();

  const doctor = people.find((person) => person.isDoctor) ?? null;
  const doctorMissing =
    doctor === null && units.some((unit) => unit.isFirstAid === true);

  for (const person of people) {
    weights.set(person.userId, initialWeights?.get(person.userId) ?? 0);
  }

  const initialTotal = people.reduce(
    (sum, person) => sum + (initialWeights?.get(person.userId) ?? 0),
    0,
  );
  const totalWeight =
    units.reduce((sum, unit) => sum + unit.weightGrams, 0) + initialTotal;
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

  // С какого веса вещь считается тяжёлой в этом походе (09.11.2026).
  const heavyThreshold = Math.max(share * HEAVY_ITEM_SHARE, HEAVY_ITEM_MIN_GRAMS);

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
  //
  // Пакеты еды ищут несущего только среди тех, кто ест общий котёл:
  // «питающийся отдельно» груз общей еды не берёт (06.11.2026).
  // Тяжёлое сначала предлагаем мужчинам (09.11.2026): если у кого-то
  // из них ещё есть свободная доля, вещь идёт ему, иначе — как раньше,
  // самому свободному из всех.
  const foodPeople = people.filter((person) => person.eatsSeparately !== true);
  for (const unit of pool.sort(compareUnits)) {
    const candidates = unit.kind === 'package' ? foodPeople : people;
    const receivers =
      unit.weightGrams >= heavyThreshold
        ? menWithRoom(candidates, targets, weights)
        : candidates;
    const person = freestPerson(receivers, targets, weights);
    // Едоков нет — пакет остаётся нераспределённым, а не «у любого».
    if (!person) continue;
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

/** Свободная доля человека: сколько он ещё может взять. */
function freeShare(
  person: LoadPerson,
  targets: Map<string, number>,
  weights: Map<string, number>,
): number {
  return (targets.get(person.userId) ?? 0) - (weights.get(person.userId) ?? 0);
}

/**
 * Кому предлагать тяжёлую вещь: мужчинам со свободной долей (09.11.2026).
 *
 * Если мужчин нет вовсе или у всех уже перегруз, возвращаем весь список:
 * правило «тяжёлое — мужчинам» не должно оставлять вещь нераспределённой
 * и не должно валить на одного человека весь груз похода.
 */
function menWithRoom(
  people: LoadPerson[],
  targets: Map<string, number>,
  weights: Map<string, number>,
): LoadPerson[] {
  const men = people.filter(
    (person) => person.gender === 'm' && freeShare(person, targets, weights) > 0,
  );

  return men.length > 0 ? men : people;
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
    const free = freeShare(person, targets, weights);
    // Строго больше: при равных долях выигрывает первый в составе.
    if (free > bestFree) {
      best = person;
      bestFree = free;
    }
  }

  return best;
}
