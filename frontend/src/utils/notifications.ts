import type { AppNotification, NotificationKind, NotificationSection } from '@/types/notifications'

/**
 * Правила панели уведомлений: подписи секций, приоритеты, превью и переходы.
 *
 * Логика, которая не рисует, а решает, живёт здесь и проверяется без
 * монтирования — тот же порядок, что у `utils/conversations.ts` для
 * прежней ленты. Панель теперь одна (две независимые секции), но её
 * показывают двое — колонка и мобильная панель, поэтому заголовки
 * и переходы не должны разойтись.
 */

/** Заголовок первой секции: деньги, альманах и чаты похода (25.11.2026). */
export const SYSTEM_SECTION_TITLE = 'Уведомления'

/** Заголовок второй секции: личные диалоги. */
export const PERSONAL_SECTION_TITLE = 'Сообщения'

/** Виды чатов: у них в карточке последние сообщения и поле быстрого ответа. */
const CHAT_KINDS: readonly NotificationKind[] = ['trip_chat', 'direct_chat']

/**
 * Шкала приоритета уведомлений (25.11.2026).
 *
 * 10 — деньги и действие (перевод, общегрупповые деньги похода, легаси
 * «запрос платежа»); 5 — альманах и любые будущие «средние» виды; 1 — чат
 * похода. Личные сообщения в этой шкале не участвуют: у них своя секция
 * и свой порядок («непрочитанные, затем свежие»), смешивать их
 * с уведомлениями заказчик запретил.
 *
 * Незнакомый вид не должен проваливаться в конец молча: для него
 * действует «средний» приоритет 5 — так новый вид сразу виден в середине,
 * а не после чатов.
 */
export const NOTIFICATION_PRIORITY: Record<NotificationKind, number> = {
  money_transfer: 10,
  trip_finance: 10,
  payment_request: 10,
  almanac: 5,
  trip_chat: 1,
  direct_chat: 0,
}

/** Приоритет вида; незнакомый вид — 5 («средний»). */
export function notificationPriority(kind: NotificationKind): number {
  return NOTIFICATION_PRIORITY[kind] ?? 5
}

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
 * Сколько символов текста видно в свёрнутой карточке (25.11.2026).
 *
 * Заказчик: «под заголовком — plain(text), обрезанный до 50 символов,
 * с „...“ в конце». Это подпись, а не текст: в раскрытии строки-превью нет
 * вовсе, поэтому дубля последнего сообщения не бывает.
 *
 * 25.11.2026, замечание после живого теста: «увеличим длину анонса
 * до 75 символов». 50 не хватало — текст про залог и расходы обрывался
 * на середине фразы. Одну строку по вёрстке не обещаем: ширина колонки
 * плавает (352 px, мобильная панель), а `line-clamp` заказчик уже отверг
 * — обрезка по символам предсказуема и проверяется без браузера.
 */
export const NOTIFICATION_PREVIEW_CHARS = 75

/** Простой текст: пробелы и переводы строк схлопнуты в один пробел. */
export function plainText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Подпись под заголовком свёрнутой карточки.
 *
 * Режем **по символам**, а не `line-clamp`: заказчик просил именно
 * «обрезанный до 50 символов с „...“ в конце», затем поднял лимит до 75.
 * Текст длиннее 75 символов получает три точки, ровно 75 — обходится без них.
 */
export function previewLine(text: string, limit = NOTIFICATION_PREVIEW_CHARS): string {
  const plain = plainText(text)

  return plain.length > limit ? `${plain.slice(0, limit)}...` : plain
}

/**
 * Что показать в подписи свёрнутой карточки.
 *
 * У чата это последнее сообщение (в `preview` уже лежит обрезанное сервером
 * до 300 символов), у денег и альманаха — тело карточки. Пустой текст
 * превращается в пустую строку: подпись просто не рисуется.
 */
export function notificationPreview(notification: AppNotification): string {
  const source = isChatNotification(notification)
    ? (notification.preview.at(-1)?.body ?? notification.body)
    : notification.body

  return previewLine(source)
}

/**
 * Порядок в «Уведомлениях»: приоритет, внутри — свежие сверху.
 *
 * Сервер отдаёт `updated_at DESC`; клиент переставляет по шкале, потому что
 * приоритет — правило интерфейса, а не запроса: один и тот же список
 * показывают колонка и мобильная панель.
 */
export function sortSystemNotifications(
  list: readonly AppNotification[],
): AppNotification[] {
  return [...list].sort((left, right) => {
    const byPriority =
      notificationPriority(right.kind) - notificationPriority(left.kind)

    if (byPriority !== 0) return byPriority

    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  })
}

/**
 * Порядок в «Сообщениях»: сначала непрочитанные, затем по времени.
 *
 * Смешивать с «Уведомлениями» нельзя (заказчик): у личных сообщений своя
 * семантика — «ответили, а я не читал» важнее свежести прочитанного.
 */
export function sortPersonalNotifications(
  list: readonly AppNotification[],
): AppNotification[] {
  return [...list].sort((left, right) => {
    const leftUnread = chatUnreadOf(left) > 0 ? 1 : 0
    const rightUnread = chatUnreadOf(right) > 0 ? 1 : 0

    if (leftUnread !== rightUnread) return rightUnread - leftUnread

    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  })
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
 * Свёрнутость секций правой колонки — **своя у каждой** (25.11.2026).
 *
 * Заказчик: «у каждой секции свой заголовок, свой счётчик, свой chevron
 * и своё состояние свёрнутости в localStorage». Поэтому не один флаг
 * панели, а два ключа: свернуть «Уведомления» и оставить открытыми
 * «Сообщения» — нормальный сценарий.
 *
 * По умолчанию секция развёрнута: карточек мало, прятать их за кликом
 * незачем. Ошибку хранилища (приватный режим, запрет) глотаем — это
 * удобство, а не данные.
 */
const RAIL_OPEN_STATE_PREFIX = 'ph.notifications.section'

function railOpenKey(section: NotificationSection): string {
  return `${RAIL_OPEN_STATE_PREFIX}.${section}.open`
}

/** Секция развёрнута? Нет записи или хранилище недоступно — да. */
export function readSectionOpen(section: NotificationSection): boolean {
  try {
    return window.localStorage.getItem(railOpenKey(section)) !== '0'
  } catch {
    return true
  }
}

/** Запомнить свёрнутость секции. */
export function writeSectionOpen(
  section: NotificationSection,
  open: boolean,
): void {
  try {
    window.localStorage.setItem(railOpenKey(section), open ? '1' : '0')
  } catch {
    // Хранилище недоступно — состояние проживёт до перезагрузки.
  }
}
