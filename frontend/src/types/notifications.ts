/**
 * Уведомление правой панели (24.11.2026, §14 `topics/messages.md`).
 *
 * **Уведомление — не сообщение.** Его заводит только система: у него есть
 * вид, заголовок, текст и свой набор кнопок. Личное сообщение уведомлением
 * не является, но новое сообщение в чате рождает карточку «об этом чате» —
 * поэтому у чатов в карточке есть `preview` и `unreadCount`, а у денег
 * и альманаха их нет.
 *
 * Имя `AppNotification`, а не `Notification`: в браузере `Notification` —
 * глобальный класс Web Notifications, и одноимённый импорт в компоненте
 * молча затенял бы его.
 */

/**
 * Виды, которые заводит сервер (§14.2; `trip_finance` — 25.11.2026).
 *
 * `payment_request` остался от прежнего шага: новые такие карточки
 * не создаются, но старые строки должны читаться и закрываться оплатой.
 * `trip_finance` — общегрупповое уведомление о деньгах похода: залог
 * и распределение расходов.
 */
export type NotificationKind =
  | 'money_transfer'
  | 'payment_request'
  | 'trip_finance'
  | 'almanac'
  | 'trip_chat'
  | 'direct_chat'

/**
 * Раздел панели. Считает сервер по `kind`, клиент не угадывает:
 * `direct_chat` — личные сообщения, всё остальное — системные.
 */
export type NotificationSection = 'system' | 'personal'

/** Одно сообщение в раскрытии карточки чата (1–3 штуки, до 300 символов). */
export interface NotificationPreview {
  id: string
  body: string
  senderId: string | null
  senderName: string | null
  createdAt: string
}

/** Карточка панели — то, что отдаёт `GET /api/notifications`. */
export interface AppNotification {
  id: string
  kind: NotificationKind
  section: NotificationSection
  title: string
  body: string
  /** Диалог, если карточка про чат; по нему уходит быстрый ответ. */
  conversationId: string | null
  /** Поход: «Перейти» в бухгалтерию, гостевую и подтверждение перевода. */
  tripId: string | null
  /** Перевод, если карточка денежная: по нему подтверждение. */
  compensationId: string | null
  /** Непрочитанных в этом чате; только у чатов, иначе `null`. */
  unreadCount: number | null
  /**
   * Смотрящий вышел из похода; только у перевода, иначе `null`
   * (25.11.2026). «Бухгалтерия» ушедшему закрыта, поэтому подтверждение
   * доступно только в карточке — по этому флагу она объясняет почему.
   */
  viewerDeclined: boolean | null
  /** Последние сообщения чата; пусто у денег и альманаха. */
  preview: NotificationPreview[]
  createdAt: string
  updatedAt: string
}

/**
 * Оба раздела одним ответом.
 *
 * `systemCount`/`personalCount` сервер считает сам — это длины списков
 * активных карточек. Клиент после закрытия пересчитывает их по спискам:
 * одна и та же правка в двух местах разошлась бы.
 */
export interface NotificationList {
  system: AppNotification[]
  personal: AppNotification[]
  systemCount: number
  personalCount: number
}
