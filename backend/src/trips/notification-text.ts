import type { NotificationKind } from './entities/notification.entity';

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
 * «Запрос платежа» — единственный существующий вид, чей текст меняется
 * в этой сессии (решение заказчика 26.11.2026, §3.6).
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

/**
 * «Альманах изменён» — прежний `almanac`, вид `almanac_changed`.
 *
 * Текст прежний (п.8): меняется только код вида и ключ дедупликации.
 */
export function almanacChangedText(tripName: string): NotificationText {
  return {
    title: `Альманах «${tripName}»`,
    announce: `В походе «${tripName}» новая редакция альманаха`,
    body: `В походе «${tripName}» новая редакция альманаха`,
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
