import type { Conversation } from '@/types/conversations'
import type { MessageAction, TripMessage } from '@/types/trips'

/**
 * Общие правила ленты сообщений: порядок строк и их подписи.
 *
 * Лента теперь живёт в двух местах — правая колонка на десктопе
 * (`RightRail.vue`) и мобильная панель (`MobileMessages.vue`, 23.11.2026).
 * Копия сортировки в каждом компоненте разошлась бы при первой же правке:
 * заказчик поставил деньги наверх — и на мобиле они оказались бы внизу,
 * потому что там «сортировку забыли». Поэтому правила здесь одни.
 *
 * Функции чистые: строка диалога приходит аргументом, ничего не читают
 * и не пишут. Так их можно проверить без монтирования компонента.
 */

/**
 * Действие строки — поле диалога, а не последнего сообщения (24.11.2026).
 *
 * Сервер сам решает, какое действие показать: неразрешённый перевод важнее
 * просьбы о платеже, и пришедшая позже просьба строку больше не перекрывает.
 * `lastMessage.action` — запасной путь только для **старых** ответов и кеша,
 * где поля `action` ещё нет вовсе. Если сервер прислал `action: null`, значит
 * действий у диалога нет: подставлять действие последнего сообщения нельзя,
 * иначе чужая просьба о платеже показала бы «Перейти» тому, кому она
 * не адресована.
 */
export function rowAction(row: Conversation): MessageAction | null {
  if (row.action !== undefined) return row.action

  return row.lastMessage?.action ?? null
}

/** Ждёт ли строка моего ответа (денежное действие). */
export function hasPendingAction(row: Conversation): boolean {
  return rowAction(row)?.canRespond === true
}

/**
 * Есть ли у строки действие, ради которого она раскрывается на месте
 * (24.11.2026).
 *
 * Так было только у перевода, ждущего ответа: это задача, и уводить человека
 * на другой экран ради одной кнопки — потеря того, ради чего колонка
 * делалась. С этого шага так же ведёт себя «Организатор запросил платёж»:
 * кнопка «Перейти» должна быть видна сразу, а не после перехода в переписку.
 */
export function hasRowAction(row: Conversation): boolean {
  const action = rowAction(row)

  if (!action) return false

  return action.canRespond === true || action.kind === 'payment_request'
}

/** Просьба организатора о платеже: у неё кнопка «Перейти», а не «Да / Нет». */
export function isPaymentRequest(row: Conversation): boolean {
  return rowAction(row)?.kind === 'payment_request'
}

/** Сумма перевода в строке, если действие денежное. */
export function amountOf(row: Conversation): number | null {
  const amount = rowAction(row)?.payload?.amountRub

  return typeof amount === 'number' ? amount : null
}

/**
 * Порядок ленты: сначала ждущие ответа, потом по времени последнего сообщения.
 *
 * Заказчик: «сообщениям про деньги максимальный приоритет». Строка с
 * неотвеченным действием всплывает над остальными, даже если написана раньше:
 * это не переписка, а задача, и ждать её нельзя.
 */
export function byImportance(left: Conversation, right: Conversation): number {
  const leftUrgent = hasPendingAction(left) ? 1 : 0
  const rightUrgent = hasPendingAction(right) ? 1 : 0

  if (leftUrgent !== rightUrgent) return rightUrgent - leftUrgent

  const leftAt = left.lastMessage?.createdAt ?? ''
  const rightAt = right.lastMessage?.createdAt ?? ''

  return rightAt.localeCompare(leftAt)
}

/**
 * Лента: незаглушенные диалоги в порядке важности.
 *
 * «Скрыть чат» = заглушить уведомления, поэтому заглушенные в ленту
 * не попадают вовсе — их место внизу, под «Скрытые чаты».
 */
export function visibleConversations(rows: Conversation[]): Conversation[] {
  return rows.filter((row) => !row.muted).sort(byImportance)
}

/** Заглушенные диалоги: их возвращают вручную. */
export function mutedConversations(rows: Conversation[]): Conversation[] {
  return rows.filter((row) => row.muted)
}

/** Счётчик непрочитанного: заглушенные не считаются, их человек и гасил. */
export function unreadTotalOf(rows: Conversation[]): number {
  return rows.reduce((sum, row) => sum + (row.muted ? 0 : row.unreadCount), 0)
}

/** Заголовок строки: у денег — сумма, у остальных — имя или название чата. */
export function conversationHeading(row: Conversation): string {
  const amount = amountOf(row)

  if (amount !== null && hasPendingAction(row)) {
    return `Перевод ${amount.toLocaleString('ru-RU')} ₽`
  }

  return row.peer?.displayName ?? row.title
}

/** Подпись под заголовком: поход для чатов, первая строка для людей. */
export function conversationSubtitle(row: Conversation): string {
  if (row.tripId) {
    return row.tripTitle ? `${row.title} · ${row.tripTitle}` : row.title
  }

  return row.lastMessage?.body.replace(/\s+/g, ' ').slice(0, 80) ?? 'Пока пусто'
}

/** Время последнего сообщения: «14:05» для сегодняшних, «12.11» для старых. */
export function conversationTime(iso: string | undefined): string {
  if (!iso) return ''

  const date = new Date(iso)
  const today = new Date()

  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }

  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

/** Куда ведёт строка: личный диалог — экраном, чат похода — своей вкладкой. */
export function isDirectConversation(row: Conversation): boolean {
  return row.tripId === null
}

/**
 * Где начинаются новые сообщения (25.11.2026).
 *
 * Индекс первого сообщения, которое человек ещё не читал: чужое и созданное
 * позже границы прочтения. Граница приходит из диалога (`myLastReadAt`) и
 * снимается **до** `POST /read`; своих сообщений считать не нужно, как и
 * системных строк — сервер непрочитанное считает ровно по этому правилу
 * (`countUnread`), и разделитель обязан совпасть со счётчиком.
 *
 * `null` — новых нет. Если граница ушла за загруженную страницу
 * (непрочитанных больше, чем пришло сообщений), первым непрочитанным
 * оказывается первое загруженное: разделитель встанет над ним, а не
 * пропадёт, и прокрутка покажет то, что реально пришло.
 */
export function firstUnreadIndex(
  messages: TripMessage[],
  boundary: string | null,
  myId: string | null,
): number | null {
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]

    if (!message || message.isSystem) continue
    if (message.senderId === null || message.senderId === myId) continue
    if (boundary !== null && message.createdAt <= boundary) continue

    return index
  }

  return null
}
