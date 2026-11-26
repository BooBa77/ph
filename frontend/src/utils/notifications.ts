import type { AppNotification, NotificationKind } from '@/types/notifications'

/**
 * Правила панели уведомлений: заголовки секций, анонс, свёрнутость и переходы.
 *
 * Логика, которая не рисует, а решает, живёт здесь и проверяется без
 * монтирования — тот же порядок, что у `utils/conversations.ts` для прежней
 * ленты. Панель показывают двое — колонка и мобильная панель, поэтому
 * заголовки, ключи хранилища и переходы не должны разойтись.
 */

/** Заголовок секции личных диалогов. */
export const PERSONAL_SECTION_TITLE = 'Сообщения'

/**
 * Заголовок секции похода (§1.2): «поход {цель похода}».
 *
 * Сервер отдаёт `tripName` уже готовым (`tripNameOf`): цель похода, а для
 * похода без цели — «поход #N». Второй префикс в этом случае не нужен,
 * иначе получилось бы «поход поход #5».
 */
export function tripSectionTitle(tripName: string): string {
  return tripName.startsWith('поход ') ? tripName : `поход ${tripName}`
}

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
 * Сколько символов анонса видно в свёрнутой карточке.
 *
 * Заказчик поднял лимит с 50 до 75 (25.11.2026): текст про залог и расходы
 * обрывался на середине фразы. Обрезка — по символам, а не `line-clamp`:
 * ширина колонки плавает (352 px, мобильная панель), а посимвольная
 * предсказуема и проверяется без браузера.
 */
export const NOTIFICATION_PREVIEW_CHARS = 75

/** Простой текст: пробелы и переводы строк схлопнуты в один пробел. */
export function plainText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Подпись под заголовком свёрнутой карточки.
 *
 * Текст длиннее 75 символов получает три точки, ровно 75 — обходится без них.
 */
export function previewLine(text: string, limit = NOTIFICATION_PREVIEW_CHARS): string {
  const plain = plainText(text)

  return plain.length > limit ? `${plain.slice(0, limit)}...` : plain
}

/**
 * Анонс карточки — **отдельное поле `announce`** (26.11.2026, §1.4).
 *
 * Раньше клиент обрезал `body`, и для видов, где содержимое начинается
 * с «Увы и ах ((( / По объективным причинам…», анонс получался бессмысленным.
 * Теперь сервер присылает готовый анонс; у чата в нём уже «автор: текст».
 * Пустая строка (легаси-строка) откатывается на `body`, чтобы карточка
 * не осталась без подписи.
 */
export function notificationPreview(notification: AppNotification): string {
  return previewLine(notification.announce || notification.body)
}

/**
 * Есть ли в секции что закрывать двойной галочкой (§1.3).
 *
 * `money_transfer` и `payment_request` сервер не трогает, поэтому кнопка,
 * которая не закроет ничего, не рисуется вовсе: в секции только перевод или
 * запрос платежа — значит, нажимать нечего.
 */
export function canReadAllSection(items: readonly AppNotification[]): boolean {
  return items.some(
    (item) => item.kind !== 'money_transfer' && item.kind !== 'payment_request',
  )
}

/**
 * Вкладка похода для вида уведомления (решение заказчика 26.11.2026, §8).
 *
 * Общая таблица вместо `if` в каждой карточке: новая карточка части 5
 * получает переход отсюда, а не третью копию правил. Виды, которых здесь
 * нет, ведут на саму страницу похода — без вкладки.
 */
const TRIP_TAB_BY_KIND: Partial<Record<NotificationKind, string>> = {
  money_transfer: 'finance',
  payment_request: 'finance',
  trip_deposit: 'finance',
  trip_route: 'route',
  tent_lost: 'route',
  participant_joined: 'members',
  participant_left: 'members',
  role_assigned: 'members',
  role_removed: 'members',
  transfer_seat: 'transfer',
  transfer_lost: 'transfer',
  meals_layout: 'meals',
  meals_purchase: 'meals',
  trip_expense: 'finance',
  almanac_created: 'guest',
  almanac_changed: 'guest',
}

/** Вкладка похода для вида уведомления; `null` — вкладки нет. */
export function tripTabOf(kind: NotificationKind): string | null {
  return TRIP_TAB_BY_KIND[kind] ?? null
}

/**
 * «Текущий список общих продуктов» — «Питание» с открытым модальным окном
 * закупки (решение заказчика, §8). Модалка живёт в адресе, поэтому переход
 * не требует состояния между экранами.
 */
export function shoppingRoute(tripId: string): {
  path: string
  query: Record<string, string>
} {
  return { path: `/trips/${tripId}`, query: { tab: 'meals', modal: 'shopping' } }
}

/**
 * Вкладка чата по виду диалога (решение заказчика, §8).
 *
 * `conversation.kind` — вид диалога, а не уведомления; карточка чата
 * перейдёт по этой таблице, когда в DTO появится вид диалога (часть 5).
 */
const CHAT_TAB_BY_CONVERSATION_KIND: Record<string, string> = {
  trip_guest: 'guest',
  trip_members: 'members',
  trip_meals: 'meals',
  trip_transfer: 'transfer',
  trip_route: 'route',
  trip_gear: 'gear',
  trip_first_aid: 'firstAid',
  trip_finance: 'finance',
}

/** Вкладка чата по `conversation.kind`; `null` — неизвестный вид. */
export function chatTabOf(conversationKind: string): string | null {
  return CHAT_TAB_BY_CONVERSATION_KIND[conversationKind] ?? null
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

/**
 * Ключи свёрнутости секций панели (26.11.2026, §1.2).
 *
 * Своя свёрнутость у каждого похода и отдельная у «Сообщений»:
 * `ph.notifications.trip.<tripId>.open` и
 * `ph.notifications.section.personal.open`. Прежний общий ключ
 * `ph.notifications.section.system.open` больше не читается и не пишется:
 * секции «Уведомления» больше нет, а старый ключ оставил бы панель
 * свёрнутой без всякой причины.
 *
 * Ключ секции в панели — либо `trip-<id>`, либо `personal`. Он же попадает
 * в `data-test` (`rail-toggle-trip-810`), поэтому хранилище и разметка
 * называют секцию одинаково.
 */
export const PERSONAL_SECTION_KEY = 'personal'

/** Ключ секции похода: `trip-<id>`. */
export function tripSectionKey(tripId: string): string {
  return `trip-${tripId}`
}

function sectionStorageKey(sectionKey: string): string {
  if (sectionKey === PERSONAL_SECTION_KEY) {
    return 'ph.notifications.section.personal.open'
  }

  return `ph.notifications.trip.${sectionKey.slice('trip-'.length)}.open`
}

/** Секция развёрнута? Нет записи или хранилище недоступно — да. */
export function readSectionOpen(sectionKey: string): boolean {
  try {
    return window.localStorage.getItem(sectionStorageKey(sectionKey)) !== '0'
  } catch {
    return true
  }
}

/** Запомнить свёрнутость секции. */
export function writeSectionOpen(sectionKey: string, open: boolean): void {
  try {
    window.localStorage.setItem(sectionStorageKey(sectionKey), open ? '1' : '0')
  } catch {
    // Хранилище недоступно — состояние проживёт до перезагрузки.
  }
}
