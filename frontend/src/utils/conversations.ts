import type { Conversation } from '@/types/conversations'

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

/** Ждёт ли строка моего ответа (денежное действие). */
export function hasPendingAction(row: Conversation): boolean {
  return row.lastMessage?.action?.canRespond === true
}

/** Сумма перевода в строке, если действие денежное. */
export function amountOf(row: Conversation): number | null {
  const amount = row.lastMessage?.action?.payload?.amountRub

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
