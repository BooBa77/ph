import type { UserGender } from '../users/gender.types';
import type { NotificationKind } from './entities/notification.entity';
import { TRIP_TIME_ZONE } from './weekend';

/**
 * Приоритеты и тексты уведомлений — одно место (26.11.2026).
 *
 * §2.2 и §7 `topics/notifications.md`: приоритет — правило секции похода,
 * а тексты собираются там, где заводятся карточки. До этого шага строки
 * разошлись бы по сервисам-владельцам событий: у каждого свой заголовок,
 * свой анонс и своё «руб.» вместо «₽». Здесь лежат только чистые функции,
 * поэтому их проверяет юнит без базы.
 */

/**
 * Шкала заказчика (§2.2): 10 — деньги к действию, 9 — смена похода,
 * 8 — маршрут, 7 — деньги-напоминание, 6 — состав, 5 — подготовка,
 * 4 — роли, 3 — альманах, 0 — чаты.
 *
 * Незнакомый вид получает «средний» 5 — так новый тип не проваливается
 * в конец молча, а сразу виден в середине списка.
 */
export const NOTIFICATION_PRIORITY: Record<NotificationKind, number> = {
  money_transfer: 10,
  trip_dates: 9,
  trip_cancelled: 9,
  trip_goal: 9,
  trip_route: 8,
  payment_request: 7,
  trip_deposit: 7,
  participant_joined: 6,
  participant_left: 6,
  transfer_seat: 5,
  transfer_lost: 5,
  tent_lost: 5,
  meals_layout: 5,
  meals_purchase: 5,
  role_assigned: 4,
  role_removed: 4,
  trip_expense: 5,
  almanac_created: 3,
  almanac_changed: 3,
  trip_chat: 0,
  direct_chat: 0,
};

/** Приоритет вида; незнакомый вид — 5 («средний»). */
export function notificationPriority(kind: NotificationKind): number {
  return NOTIFICATION_PRIORITY[kind] ?? 5;
}

/** Готовые тексты карточки: заголовок, анонс и содержимое. */
export interface NotificationText {
  title: string;
  announce: string;
  body: string;
}

/**
 * Род человека для согласования глагола (§3.0).
 *
 * `null` возможен только у строки, вставленной в обход профиля: колонка
 * `users.gender` объявлена `NOT NULL DEFAULT 'm'`. Но текст не должен
 * падать из-за данных, поэтому неизвестный род даёт форму «сделал(а)».
 */
export type TextGender = UserGender | null | undefined;

/** Согласовать глагол с полом: `agree(gender, 'назначен', 'назначена')`. */
export function agree(gender: TextGender, male: string, female: string): string {
  if (gender === 'f') return female;
  if (gender === 'm') return male;

  return `${male}(а)`;
}

/**
 * Сумма в тексте — «руб.», как решил заказчик (§3.0).
 *
 * Старые денежные тексты (`₽`) не трогаем: они уже согласованы и живут
 * своей жизнью. Здесь только новые виды, у которых «руб.» — часть решения.
 */
export function formatRub(amountRub: number): string {
  return `${amountRub} руб.`;
}

/**
 * Дата в тексте — `ДД.ММ.ГГГГ` в поясе проекта (§3.0).
 *
 * Это **снимок события**, а не пересчёт под смотрящего: человек в другом
 * поясе увидит дату, которая была в Иркутске в момент переноса. Так решил
 * заказчик, и это осознанное ограничение.
 */
export function formatTripDate(at: Date | null): string {
  if (at === null) return '—';

  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: TRIP_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(at);

  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${value('day')}.${value('month')}.${value('year')}`;
}

/**
 * Диапазон дат для анонса: обычно «начало - конец».
 *
 * У «Планирую» бывает только начало или только конец, поэтому одна
 * недостающая дата не превращает текст в «— - —»: пишем «с …» или «до …».
 */
export function formatTripDateRange(
  startsAt: Date | null,
  endsAt: Date | null,
): string {
  if (startsAt !== null && endsAt !== null) {
    return `${formatTripDate(startsAt)} - ${formatTripDate(endsAt)}`;
  }
  if (startsAt !== null) return `с ${formatTripDate(startsAt)}`;
  if (endsAt !== null) return `до ${formatTripDate(endsAt)}`;

  return 'даты уточняются';
}

/**
 * «Запрос платежа» — адресный текст по §3.6.
 *
 * Старое «Организатор запросил платёж по походу «…»» больше не подходит:
 * карточка снова адресная, а имя похода называет заголовок секции.
 */
export function paymentRequestText(authorName: string): NotificationText {
  return {
    title: 'Запрос платежа',
    announce: 'Организатор призывает к оплате',
    body:
      `${authorName} призывает участников компенсировать расходы, ` +
      'внести залог.',
  };
}

/**
 * «Установлен залог» — прежний `trip_finance:deposit`, вид `trip_deposit`.
 *
 * Текст не меняется (решение заказчика п.8): новые заголовки и тексты
 * придут вместе с панелью в части 2.
 */
export function depositText(
  tripName: string,
  amountRub: number,
): NotificationText {
  const body =
    `В походе «${tripName}» установлен залог ` +
    `${amountRub} ₽ с человека. Залог можно покрыть расходами ` +
    'или переводом — подробности в «Бухгалтерии».';

  return { title: 'Установлен залог', announce: body, body };
}

/** Перенос дат — `trip_dates`, приоритет 9 (§3.2). */
export function tripDatesText(
  authorName: string,
  authorGender: TextGender,
  startsAt: Date | null,
  endsAt: Date | null,
): NotificationText {
  return {
    title: 'Перенос похода',
    announce: `Новые даты: ${formatTripDateRange(startsAt, endsAt)}`,
    body:
      `${authorName} ${agree(authorGender, 'изменил', 'изменила')} даты ` +
      'похода. Нужно пересмотреть разделы Трансфер, Ночёвки, Питание.',
  };
}

/** Смена цели — `trip_goal`, приоритет 9 (§3.4). */
export function tripGoalText(goalName: string): NotificationText {
  return {
    title: 'Смена цели похода',
    announce: goalName,
    body:
      'Нас невозможно сбить с пути, нам пофигу куда идти. Что-то ' +
      `не сложилось, но мы не унываем и теперь это — ${goalName}`,
  };
}

/** Изменение маршрута — `trip_route`, приоритет 8 (§3.5). */
export function tripRouteText(routeText: string): NotificationText {
  return {
    title: 'Изменение маршрута похода',
    // Анонс — тот же маршрут: до 75 символов его обрезает клиент.
    announce: routeText,
    body: routeText,
  };
}

/** Новый участник — `participant_joined`, приоритет 6 (§3.8). */
export function participantJoinedText(
  name: string,
  gender: TextGender,
): NotificationText {
  return {
    title: 'Новый участник',
    announce: name,
    body: `${name} ${agree(gender, 'готов', 'готова')} участвовать`,
  };
}

/**
 * Отказ от участия — `participant_left`, приоритет 6 (§3.9).
 *
 * Про `declined` добавляется «и покинул(а) группу»: переход в `maybe` или
 * `helping` — это не выход, а смена планов.
 */
export function participantLeftText(
  name: string,
  gender: TextGender,
  status: string,
): NotificationText {
  const prefix = `${name} не может принять участие в походе`;
  const body =
    status === 'declined'
      ? `${prefix} и ${agree(gender, 'покинул', 'покинула')} группу.`
      : prefix;

  return { title: 'Отказ от участия', announce: name, body };
}

/**
 * Формы названий ролей для текстов (§3.15–§3.16).
 *
 * Справочник ролей — данные, а не код, поэтому падежи нельзя вывести
 * алгоритмом. Заказчик зафиксировал шесть ролей 17.11.2026; для незнакомой
 * роли остаётся название в нижнем регистре — лучше, чем «назначен (null)»,
 * и повод дописать форму, когда роль появится.
 */
interface RoleForms {
  instrumental: string;
  genitive: string;
}

const ROLE_FORMS: Record<string, RoleForms> = {
  organizer: { instrumental: 'организатором', genitive: 'организатора' },
  coOrganizer: { instrumental: 'соорганизатором', genitive: 'соорганизатора' },
  doctor: { instrumental: 'медиком', genitive: 'медика' },
  photographer: { instrumental: 'фотографом', genitive: 'фотографа' },
  quartermaster: { instrumental: 'завхозом', genitive: 'завхоза' },
  repairman: { instrumental: 'реммастером', genitive: 'реммастера' },
  technicalLeader: {
    instrumental: 'техническим лидером',
    genitive: 'технического лидера',
  },
};

/** Падежи роли; незнакомая роль — её название в нижнем регистре. */
export function roleForms(role: { code: string; name: string }): RoleForms {
  return (
    ROLE_FORMS[role.code] ?? {
      instrumental: role.name.toLowerCase(),
      genitive: role.name.toLowerCase(),
    }
  );
}

/** Роль назначена — `role_assigned`, приоритет 4 (§3.15). */
export function roleAssignedText(
  name: string,
  gender: TextGender,
  role: { code: string; name: string },
): NotificationText {
  const body =
    `${name} ${agree(gender, 'назначен', 'назначена')} ` +
    `${roleForms(role).instrumental} похода`;

  return { title: `${role.name} похода`, announce: body, body };
}

/** Роль снята — `role_removed`, приоритет 4 (§3.16). */
export function roleRemovedText(
  name: string,
  gender: TextGender,
  role: { code: string; name: string },
): NotificationText {
  const body =
    `${name} ${agree(gender, 'освобождён', 'освобождена')} от роли ` +
    roleForms(role).genitive;

  return { title: 'Снятие роли', announce: body, body };
}

/**
 * Общественный расход — `trip_expense`, приоритет 5 (§3.17).
 *
 * Анонс без глагола («Анна Продукты 300 руб.»), содержимое с глаголом:
 * в свёрнутой карточке важнее «кто и сколько», в раскрытой — что сделано.
 */
export function tripExpenseText(
  payerName: string,
  payerGender: TextGender,
  description: string,
  amountRub: number,
): NotificationText {
  const amount = formatRub(amountRub);

  return {
    title: 'Общественный расход',
    announce: `${payerName} ${description} ${amount}`,
    body: `${payerName} ${agree(payerGender, 'оплатил', 'оплатила')} ${description} ${amount}`,
  };
}

/** Альманах создан — `almanac_created`, приоритет 3 (§3.18). */
export function almanacCreatedText(): NotificationText {
  return {
    title: 'Альманах',
    announce: 'создан альманах похода',
    body: 'Организатор создал альманах похода из записей участников',
  };
}

/** Альманах изменён — `almanac_changed`, приоритет 3 (§3.19). */
export function almanacChangedText(
  authorName: string,
  authorGender: TextGender,
): NotificationText {
  return {
    title: 'Альманах',
    announce: 'Альманах похода изменён',
    body: `${authorName} ${agree(authorGender, 'дополнил', 'дополнила')} альманах похода`,
  };
}

/**
 * Билет на проезд — `transfer_seat`, приоритет 5 (§3.10).
 *
 * Карточка личная: человек стал **принятым** пассажиром личного автомобиля.
 * Анонс называет машину, чтобы свёрнутая карточка отвечала на вопрос «куда
 * меня посадили», а содержимое — что произошло. Марки и номера может не быть
 * (свой транспорт без карточки техники в каталоге): тогда анонс остаётся
 * «водитель {имя}» — «водитель Анна, , » не читается.
 */
export function transferSeatText(
  driverName: string,
  vehicleTitle: string | null,
  vehiclePlate: string | null,
): NotificationText {
  const vehicle =
    vehicleTitle !== null && vehiclePlate !== null
      ? `${vehicleTitle}, ${vehiclePlate}`
      : null;

  return {
    title: 'Билет на проезд',
    announce: vehicle
      ? `водитель ${driverName}, ${vehicle}`
      : `водитель ${driverName}`,
    body: `Ты добавлен пассажиром в автомобиль, водитель ${driverName}`,
  };
}

/**
 * Проблемы с транспортом — `transfer_lost`, приоритет 5 (§3.11).
 *
 * Текст не называет ни машину, ни поход: место потеряно, и это всё, что
 * важно. Ключ дедупликации — поход, поэтому потеря второй машины обновляет
 * ту же карточку, а не заводит вторую.
 */
export function transferLostText(): NotificationText {
  return {
    title: 'Проблемы с транспортом',
    announce: 'Тебе не на чем ехать в поход',
    body: 'Автомобиль, пассажиром которого ты являлся, стал недоступен',
  };
}

/**
 * Проблемы с палаткой — `tent_lost`, приоритет 5 (§3.12).
 *
 * Анонс согласуется с полом (§3.0): «остался» / «осталась». Рода нет —
 * «остался(а)», как и у остальных текстов.
 */
export function tentLostText(gender: TextGender): NotificationText {
  return {
    title: 'Проблемы с палаткой',
    // Согласуется только глагол: `agree` на всей фразе дал бы
    // «Ты остался без палатки(а)».
    announce: `Ты ${agree(gender, 'остался', 'осталась')} без палатки`,
    body: 'Палатка, в которую тебя определили, стала недоступна',
  };
}

/**
 * Раскладка — `meals_layout`, приоритет 5 (§3.13).
 *
 * Без слова «завхоз»: общую раскладку правит и организатор, и
 * соорганизатор, и роль тут ни при чём — важен сам факт правки.
 */
export function mealsLayoutText(
  authorName: string,
  authorGender: TextGender,
): NotificationText {
  const body = `${authorName} ${agree(authorGender, 'изменил', 'изменила')} раскладку`;

  return { title: 'Раскладка', announce: body, body };
}

/**
 * Строка системного сообщения в чат питания (§3.14).
 *
 * Та же фраза, что в содержимом карточки, но без слова «общие»: в чате еды
 * и так речь об общих продуктах, а карточка говорит это явно. Обе строки
 * здесь рядом, чтобы род глагола не согласовали в двух местах по-разному.
 */
export function mealsPurchaseMessage(
  buyerName: string,
  buyerGender: TextGender,
): string {
  return `${buyerName} ${agree(buyerGender, 'закупил', 'закупила')} продукты`;
}

/**
 * Закупка продуктов — `meals_purchase`, приоритет 5 (§3.14).
 *
 * Покупателя можно выбрать (в том числе виртуального), поэтому имя в тексте
 * — имя покупателя, а не того, кто поставил галочку. Анонс — только имя:
 * в свёрнутой карточке важно «кто», подробность даёт раскрытие.
 */
export function mealsPurchaseText(
  buyerName: string,
  buyerGender: TextGender,
): NotificationText {
  return {
    title: 'Закупка продуктов',
    announce: buyerName,
    body: `${buyerName} ${agree(buyerGender, 'закупил', 'закупила')} общие продукты`,
  };
}

/**
 * Анонс карточки чата: «автор: последнее сообщение» (§3.20).
 *
 * У личного диалога `senderName` — собеседник, у чата похода — автор
 * сообщения. Имя необязательно: системная строка без автора остаётся
 * просто текстом. Содержимое по-прежнему хранит только текст сообщения:
 * старый фронт рисует его в свёрнутой карточке.
 */
export function chatAnnounce(senderName: string | null, body: string): string {
  return senderName ? `${senderName}: ${body}` : body;
}
