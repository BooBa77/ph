/**
 * Уведомления правой панели (24.11.2026; секции по походам — 26.11.2026).
 *
 * **Уведомление — не сообщение.** Его заводит только система: у него есть
 * вид, заголовок, анонс, содержимое и свой набор кнопок. Личное сообщение
 * уведомлением не является, но новое сообщение в чате рождает карточку
 * «об этом чате» — поэтому у чатов в карточке есть `preview` и
 * `unreadCount`, а у денег и альманаха их нет.
 *
 * **Секция больше не поле карточки.** С 26.11.2026 сервер отдаёт готовые
 * `sections` по походам и `personal` отдельно; `section` у карточки удалён,
 * а панель ничего не вычисляет по `kind`. Куда положить карточку, решает
 * `tripId` и место в ответе.
 *
 * Имя `AppNotification`, а не `Notification`: в браузере `Notification` —
 * глобальный класс Web Notifications, и одноимённый импорт в компоненте
 * молча затенял бы его.
 */

/**
 * Виды, которые заводит сервер (§2.2 `topics/notifications.md`).
 *
 * Список совпадает с CHECK в базе (миграция 103): двадцать видов походов
 * и личный диалог. Серверные генераторы новых типов появятся в частях 3–4,
 * но тип известен уже сейчас — иначе следующая часть начиналась бы
 * с правки этого объединения и всех `Record` по нему.
 */
export type NotificationKind =
  | 'money_transfer'
  | 'trip_dates'
  | 'trip_cancelled'
  | 'trip_goal'
  | 'trip_route'
  | 'payment_request'
  | 'trip_deposit'
  | 'participant_joined'
  | 'participant_left'
  | 'transfer_seat'
  | 'transfer_lost'
  | 'tent_lost'
  | 'meals_layout'
  | 'meals_purchase'
  | 'role_assigned'
  | 'role_removed'
  | 'trip_expense'
  | 'almanac_created'
  | 'almanac_changed'
  | 'trip_chat'
  | 'direct_chat'

/** Одно сообщение в раскрытии карточки чата (1–3 штуки). */
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
  title: string
  /**
   * Анонс свёрнутой карточки (26.11.2026). Отдельный текст, а не начало
   * `body`: у половины новых видов анонс формулируется иначе. Клиент режет
   * его до 75 символов (`utils/notifications.ts`).
   */
  announce: string
  /** Содержимое раскрытой карточки — полный текст типа. */
  body: string
  /** Диалог, если карточка про чат; по нему уходит быстрый ответ. */
  conversationId: string | null
  /** Поход: заголовок секции, «Перейти» и подтверждение перевода. */
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
 * Секция похода (§1.1, §6).
 *
 * `tripName` — готовое имя от сервера (`tripNameOf`: цель, иначе «поход #N»);
 * префикс «поход» клиент добавляет сам. Порядок секций и карточек задан
 * сервером — клиент его **не пересортировывает**.
 */
export interface NotificationSectionDto {
  tripId: string
  tripName: string
  startsAt: string | null
  items: AppNotification[]
}

/**
 * Ответ `GET /api/notifications`: секции походов, «Сообщения» и счётчики.
 *
 * `tripCount` — число секций, `personalCount` — личных карточек, `total` —
 * все активные карточки. Счётчик секции — длина её `items`, а не
 * непрочитанные сообщения: пять сообщений в чате остаются одной карточкой.
 */
export interface NotificationList {
  sections: NotificationSectionDto[]
  personal: AppNotification[]
  tripCount: number
  personalCount: number
  total: number
}

/** Ответ `POST /api/notifications/read-all` (§5.3). */
export interface ReadAllResult {
  /** Сколько карточек закрыто. */
  closed: number
  /** Сколько активных карточек в походе осталось. */
  left: number
}
