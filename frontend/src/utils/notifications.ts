import type { AppNotification, NotificationKind } from '@/types/notifications'

/**
 * Правила панели уведомлений: подписи секций и переходы по карточке.
 *
 * Логика, которая не рисует, а решает, живёт здесь и проверяется без
 * монтирования — тот же порядок, что у `utils/conversations.ts` для
 * прежней ленты. Панель теперь одна (две секции одного списка), но её
 * показывают двое — колонка и мобильная панель, поэтому заголовки и
 * переходы не должны разойтись.
 */

/** Заголовок первой секции (§14.1). */
export const SYSTEM_SECTION_TITLE = 'Системные уведомления'

/** Заголовок второй секции. */
export const PERSONAL_SECTION_TITLE = 'Личные сообщения'

/** Виды чатов: у них в карточке последние сообщения и поле быстрого ответа. */
const CHAT_KINDS: readonly NotificationKind[] = ['trip_chat', 'direct_chat']

/** Чат ли это: карточка раскрывается в последние сообщения и ответ. */
export function isChatNotification(notification: AppNotification): boolean {
  return CHAT_KINDS.includes(notification.kind)
}

/**
 * Сколько непрочитанных в чате показывает карточка.
 *
 * Счётчик секции считает **активные карточки**, а не сообщения: пять
 * сообщений в чате — одна карточка. Число непрочитанных у карточки чата
 * отдельное и приходит с сервера.
 */
export function chatUnreadOf(notification: AppNotification): number {
  return notification.unreadCount ?? 0
}

/**
 * Ключ свёрнутости секций «Гостевой» в `localStorage`.
 *
 * Тот же, что пишут `GuestTripView.vue` и `TripAlmanac.vue`: «Перейти»
 * из карточки альманаха должно открыть уже развёрнутую секцию, а не
 * свёрнутую. Ключ ищется в двух файлах, поэтому копия здесь документирована,
 * а не спрятана: добавится третья секция — обновлять все три.
 */
const GUEST_OPEN_STATE_PREFIX = 'ph.tripGuestView.open'

/**
 * Открыть секцию альманаха на «Гостевой» до перехода.
 *
 * Пишем только свой ключ, не затирая «Гостевой чат»: секции делят одну
 * запись, и запись целиком потеряла бы состояние второй.
 */
export function openAlmanacSection(tripId: string): void {
  try {
    const key = `${GUEST_OPEN_STATE_PREFIX}.${tripId}`
    const raw = window.localStorage.getItem(key)
    const parsed: unknown = raw === null ? {} : JSON.parse(raw)
    const state =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}

    window.localStorage.setItem(
      key,
      JSON.stringify({ ...state, almanac: true }),
    )
  } catch {
    // Хранилище недоступно — секция останется свёрнутой. Переход важнее.
  }
}
