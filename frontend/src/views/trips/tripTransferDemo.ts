import type { TripTransferLeg, TripTransferPerson } from '@/types/trips'

/**
 * Данные для макета вкладки «Трансфер».
 *
 * **Временный файл.** Пока у вкладки нет API, экран показывает пример, чтобы
 * согласовать вид и порядок действий; правки живут в памяти страницы.
 * Удаляется вместе с переходом на `GET /api/trips/:id/transfer` — сам экран
 * при этом меняет только источник данных, разметка остаётся.
 *
 * Состав примерный, а правила в нём настоящие:
 *
 * - водитель своей машины — **пассажир этой же машины** (он занимает место);
 * - у наёмной машины аккаунта нет, поэтому водителя в составе не ищи —
 *   место он всё равно занимает, и это видно в счёте мест;
 * - «без машины» — это `carId: null`, а не отсутствие человека в строке;
 * - Игорь едет туда наёмной машиной и не едет обратно — так на экране видно,
 *   что состав строк не обязан совпадать.
 */
export interface TransferDemo {
  travelers: TripTransferPerson[]
  legs: TripTransferLeg[]
}

const ANNA: TripTransferPerson = { userId: 'demo-anna', displayName: 'Анна' }
const PETR: TripTransferPerson = { userId: 'demo-petr', displayName: 'Пётр' }
const IGOR: TripTransferPerson = { userId: 'demo-igor', displayName: 'Игорь' }
const MARINA: TripTransferPerson = { userId: 'demo-marina', displayName: 'Марина' }

/** Местное время: человек увидит его в своём поясе, а не в гринвичском. */
function at(day: number, hour: number, minute = 0): string {
  return new Date(2026, 10, day, hour, minute).toISOString()
}

export function makeTransferDemo(me: TripTransferPerson): TransferDemo {
  return {
    travelers: [me, ANNA, PETR, IGOR, MARINA],
    legs: [
      {
        id: 1,
        position: 1,
        departsAt: at(7, 8),
        fromPlace: 'Иркутск, автовокзал',
        toPlace: 'Олхинское плато, Витязь',
        mode: 'car',
        note: 'Сбор у первой платформы, выезжаем в восемь',
        cars: [
          {
            id: 11,
            ownership: 'own',
            driverUserId: me.userId,
            driverName: me.displayName,
            driverPhone: null,
            seats: 5,
            canEdit: true,
          },
          {
            id: 12,
            ownership: 'hired',
            driverUserId: null,
            driverName: 'Сергей',
            driverPhone: '+7 902 111-22-33',
            seats: 4,
            canEdit: false,
          },
        ],
        passengers: [
          { userId: me.userId, displayName: me.displayName, carId: 11 },
          { ...ANNA, carId: 11 },
          { ...PETR, carId: 12 },
          { ...IGOR, carId: 12 },
          { ...MARINA, carId: null },
        ],
      },
      {
        id: 2,
        position: 2,
        departsAt: at(9, 18),
        fromPlace: 'Олхинское плато, Витязь',
        toPlace: 'Иркутск, автовокзал',
        mode: 'bus',
        note: null,
        cars: [],
        passengers: [
          { userId: me.userId, displayName: me.displayName, carId: null },
          { ...ANNA, carId: null },
          { ...PETR, carId: null },
          { ...MARINA, carId: null },
        ],
      },
    ],
  }
}
