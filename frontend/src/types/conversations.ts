import type { MessageAction, TripMessage } from '@/types/trips'

/**
 * Диалог человека: личный или чат похода — один тип на оба.
 *
 * Разделение видов живёт в коде `kind`, а не в разных интерфейсах: список
 * приходит один, и лента правой колонки рисует его одним компонентом.
 * `peer` заполнен только у личных, `tripTitle` — только у походных.
 */
export interface ConversationPeer {
  id: string
  displayName: string
  avatarUrl: string | null
}

export interface Conversation {
  id: string
  /** `direct` | `trip_guest` | `trip_members` | `trip_meals` | … */
  kind: string
  /** Поход для чатов похода. null — личный диалог. */
  tripId: string | null
  /** Подпись: имя собеседника или название чата. */
  title: string
  /** Название похода. null — личный диалог. */
  tripTitle: string | null
  peer: ConversationPeer | null
  lastMessage: TripMessage | null
  /**
   * Действие диалога — одно, и какое именно, решает сервер (24.11.2026).
   *
   * Неразрешённый перевод выше просьбы о платеже: пока ждут «Подтверждаю»,
   * просьба строку не перекрывает. Поле необязательное: старые ответы и
   * кеш без него читаются по `lastMessage.action` (см. `rowAction`).
   */
  action?: MessageAction | null
  /** Сколько сообщений новее моего последнего прочтения. */
  unreadCount: number
  /** Уведомления заглушены: диалог не попадает в ленту. */
  muted: boolean
  /** Когда собеседник читал личный диалог. null — ещё не открывал. */
  peerLastReadAt: string | null
  /**
   * Моя метка прочтения — от неё сервер отсчитал `unreadCount` (25.11.2026).
   *
   * Экран `/messages/:id` ставит по ней разделитель «Новые сообщения»
   * и прокручивается к первому непрочитанному **до** `POST /read`: после
   * отметки прочтения граница сдвинулась бы и первое непрочитанное стало
   * бы непознаваемым. null — не читал (у чата похода — не вступал в состав).
   */
  myLastReadAt: string | null
}
