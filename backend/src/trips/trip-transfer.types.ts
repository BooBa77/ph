/**
 * Словари «Трансфера» — вкладки подготовки похода (`transfer.md`).
 *
 * Один список нужен сразу в трёх местах — DTO (валидация), entity (CHECK)
 * и Swagger (`enum`), поэтому он живёт здесь, а не в каждом файле.
 *
 * Переделано 27.10.2026 по разбору заказчика: перемещение — это одна
 * карточка со своим способом доставки, временем и компенсацией. Машина
 * перестала быть отдельной сущностью: у поезда и вертолёта пассажиры те же,
 * а «мест» и «водителя» у них нет.
 */
import type { TripTab } from './trip-tabs';

/**
 * Куда едем: туда или обратно.
 *
 * Раньше сторона выводилась из точек маршрута, и это оказалось хрупко:
 * «Иркутск → Витязь» и «Витязь → Иркутск» — единственный способ отличить
 * одну половину подготовки от другой, а обратный выезд часто вообще без
 * точек («как получится»). Теперь сторона — поле, и на экране это две
 * области с своими кнопками.
 */
export const TRANSFER_DIRECTIONS = ['there', 'back'] as const;

export type TransferDirection = (typeof TRANSFER_DIRECTIONS)[number];

/**
 * Способы доставки, сгруппированные для выпадающего списка.
 *
 * Группа — это только порядок и подпись в интерфейсе, в базе её нет:
 * `mode` остаётся одним кодом. «Пешком» убрано (27.10.2026): пешие
 * переходы — это маршрут, а не заброска, и в карточке транспорта они
 * выглядели как транспорт.
 */
export const TRANSFER_MODE_GROUPS = [
  {
    code: 'land',
    label: 'Земля',
    modes: ['car', 'bus', 'train', 'horses', 'atv'],
  },
  {
    code: 'water',
    label: 'Вода',
    modes: ['boat', 'ship', 'airboat'],
  },
  {
    code: 'air',
    label: 'Воздух',
    modes: ['helicopter'],
  },
  {
    code: 'other',
    label: 'Другое',
    modes: ['other'],
  },
] as const;

export const TRANSFER_MODES = TRANSFER_MODE_GROUPS.flatMap(
  (group) => group.modes,
) as readonly TransferMode[];

export type TransferMode = (typeof TRANSFER_MODE_GROUPS)[number]['modes'][number];

export const TRANSFER_MODE_LABELS: Record<TransferMode, string> = {
  car: 'Авто',
  bus: 'Автобус',
  train: 'Ж/д',
  horses: 'Кони',
  atv: 'Квадроцикл',
  boat: 'Лодка',
  ship: 'Корабль',
  airboat: 'Аэролодка',
  helicopter: 'Вертолёт',
  other: 'Другое',
};

/**
 * Способы, которые **не могут быть личным транспортом**: автобус, поезд,
 * корабль и вертолёт — это рейсы, на них покупают билеты, и «наше ТС»
 * у них не бывает. Участник такую карточку завести может (он нашёл рейс),
 * но с флагом «наше ТС» она не создаётся — иначе у поезда появился бы
 * владелец, который им не распоряжается.
 */
export const TRANSFER_PUBLIC_MODES = [
  'bus',
  'train',
  'ship',
  'helicopter',
] as const;

/** Личный транспорт: только на нём бывает флаг «наше ТС» и владелец. */
export const TRANSFER_PERSONAL_MODES = TRANSFER_MODES.filter(
  (mode) => !(TRANSFER_PUBLIC_MODES as readonly string[]).includes(mode),
);

/**
 * Компенсация расходов на перемещение.
 *
 * `free` — безвозмездно: владелец ТС ни с кем не считается;
 * `ticket` — цена билета: только у рейсов (автобус, ж/д, корабль, вертолёт);
 * `shared` — общий расход (бензин, аренда) делится на всех, кто едет;
 * `sharedPerPassenger` — общий расход на пассажиров: считается на каждого.
 *
 * У общих расходов есть флаг «туда-обратно»: бензин туда и обратно платят
 * один раз, а не в каждой карточке. У рейсов его нет — билет и так
 * в одну сторону.
 */
export const TRANSFER_COMPENSATIONS = [
  'free',
  'ticket',
  'shared',
  'sharedPerPassenger',
] as const;

export type TransferCompensation = (typeof TRANSFER_COMPENSATIONS)[number];

export const TRANSFER_COMPENSATION_LABELS: Record<TransferCompensation, string> = {
  free: 'Безвозмездно',
  ticket: 'Цена билета',
  shared: 'Общий расход',
  sharedPerPassenger: 'Общий расход на пассажиров',
};

/** Компенсации, у которых бывает флаг «туда-обратно». */
export const TRANSFER_ROUND_TRIP_COMPENSATIONS = [
  'shared',
  'sharedPerPassenger',
] as const;

/**
 * Статус пассажира карточки.
 *
 * `requested` — человек попросился на чужое ТС и ждёт владельца;
 * `accepted` — едет. На общественном транспорте заявки нет: купил билет —
 * едешь. На личном ТС принимает владелец (решение заказчика 27.10.2026),
 * а уйти человек может сам в любом статусе.
 */
export const TRANSFER_PASSENGER_STATUSES = ['requested', 'accepted'] as const;

export type TransferPassengerStatus =
  (typeof TRANSFER_PASSENGER_STATUSES)[number];

export const TRANSFER_PASSENGER_STATUS_LABELS: Record<
  TransferPassengerStatus,
  string
> = {
  requested: 'Просится',
  accepted: 'Едет',
};

/** Вкладка, право на правку которой открывает чужие карточки. */
export const TRANSFER_TAB: TripTab = 'transfer';

/**
 * Чаты похода, которые видит **только состав**.
 *
 * Гостевой доступен всем, кто видит публичный поход; членский, питания
 * и трансфера — только участникам. Список живёт здесь, потому что правило
 * проверяется в трёх местах сервиса походов.
 */
export const PARTICIPANT_ONLY_CHAT_KINDS = [
  'trip_members',
  'trip_meals',
  'trip_transfer',
] as const;
