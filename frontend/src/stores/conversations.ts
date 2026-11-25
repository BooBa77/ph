// frontend/src/stores/conversations.ts

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { getConversation, listConversations, markConversationRead } from '@/api/conversations'
import { subscribeConversationEvents } from '@/api/events'
import type { ConversationEvent } from '@/api/events'
import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import type { Conversation } from '@/types/conversations'
import type { TripMessage } from '@/types/trips'
import { mutedConversations, unreadTotalOf, visibleConversations } from '@/utils/conversations'

/** Как часто обновлять ленту, пока вкладка открыта. */
const REFRESH_MS = 60_000

/**
 * Наблюдатель событий переписки: экран диалога и раскрытая строка колонки.
 *
 * Событие отдаётся вместе со строкой ленты, уже обновлённой сторо́м: второму
 * потребителю не нужен свой запрос, а `lastMessage` — это ровно то
 * сообщение, которое надо дописать в открытую переписку.
 */
export type ConversationEventListener = (
  event: ConversationEvent,
  row: Conversation | null,
) => void

/**
 * Лента сообщений — одна на всё приложение.
 *
 * **Почему стор, а не запрос в каждом компоненте.** Ленту показывают двое:
 * правая колонка от `xl` (`RightRail.vue`) и мобильная панель
 * (`MobileMessages.vue`, 23.11.2026). Оба компонента живут в разметке
 * всегда, а прячет их CSS по ширине экрана — значит, два запроса на каждую
 * минуту и два таймера там, где нужен один. Со стором лента запрашивается
 * один раз, а счётчик непрочитанного на мобиле и в колонке показывает одно
 * и то же число по построению, а не по совпадению.
 *
 * **Прочитал в одном месте — прочитано везде.** `markRead` меняет строку
 * в сторе, а не копию у компонента: иначе на мобиле бейдж погас бы только
 * после следующего обновления.
 *
 * **Живость — событиями, опрос остаётся страховкой.** С 24.11.2026 пока
 * лента кому-то нужна, стор держит один поток на человека
 * (`GET /api/conversations/events`) и правит строку по событию, а не
 * перечитывает список. Фокус окна и минута остаются: PWA на телефоне
 * рвёт поток при сворачивании, и без страховки лента замирала бы до
 * следующего открытия. Дублировать работу они не должны — событие правит
 * строку, полный перечень приходит только по фокусу и минуте.
 */
export const useConversationsStore = defineStore('conversations', () => {
  const rows = ref<Conversation[]>([])
  const isLoading = ref(true)
  const error = ref<string | null>(null)

  /** Лента: незаглушенные, деньги сверху. */
  const visible = computed(() => visibleConversations(rows.value))

  /** Заглушенные: их возвращают вручную. */
  const muted = computed(() => mutedConversations(rows.value))

  /** Счётчик непрочитанного без заглушенных. */
  const unreadTotal = computed(() => unreadTotalOf(rows.value))

  async function refresh(): Promise<void> {
    try {
      const data = await listConversations()

      rows.value = data.conversations
      error.value = null
    } catch (problem) {
      error.value =
        problem instanceof ApiError ? problem.message : 'Не удалось загрузить сообщения'
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Отметить диалог прочитанным.
   *
   * Сначала сервер, потом счётчик: если запрос не прошёл, бейдж честно
   * остаётся. Ошибку глотаем — отметка прочтения не повод не показывать
   * переписку, и следующий `refresh` всё поправит.
   */
  async function markRead(row: Conversation): Promise<void> {
    if (row.unreadCount === 0) return

    try {
      await markConversationRead(row.id)
      row.unreadCount = 0
    } catch {
      // См. комментарий выше.
    }
  }

  /**
   * Событие переписки от потока: правим строку, а не перечитываем список.
   *
   * Заказчик: «экран диалога не обновляется вовсе». Опрос по фокусу и минуте
   * остаётся страховкой (PWA на телефоне рвёт поток при сворачивании), но
   * работу он теперь не дублирует: событие правит одну строку.
   *
   * **Своё действие не перечитываем.** `actorId` сравнивается с моим id,
   * как в событиях похода: ответ `POST /messages` уже принёс сообщение,
   * а своя отметка прочтения уже обнулила счётчик.
   *
   * **`message` от другого.** Счётчик растёт сразу (даже если следующий
   * запрос не пройдёт), а текст дотягивается одним `GET /conversations/:id`:
   * в событии его нет намеренно — `ConversationDto` зависит от смотрящего.
   * Диалога в списке может не быть (его только что завёл собеседник) —
   * тогда полный перечень, но это редкий случай.
   */
  async function applyEvent(event: ConversationEvent): Promise<void> {
    /**
     * Кадр `notifications` — не про диалог (24.11.2026).
     *
     * Он едет по этому же потоку, но адресован панели уведомлений:
     * `conversationId` пуст, и дальше по коду строка ленты не нашлась бы,
     * а `refresh()` перечитал бы весь список диалогов на каждое закрытие
     * карточки. Свои уведомления перечитывает `stores/notifications.ts`.
     */
    if (event.kind === 'notifications') return

    const me = useAuthStore().user?.id ?? null

    if (event.actorId === me) return

    const id = String(event.conversationId)
    const row = rows.value.find((item) => item.id === id) ?? null

    if (event.kind === 'read') {
      // Метка прочтения собеседника: по ней экран рисует «Прочитано».
      if (!row) return
      row.peerLastReadAt = event.at
      notify(event, row)
      return
    }

    /**
     * Сообщение изменилось или исчезло (24.11.2026; удаление — 25.11.2026).
     *
     * `message_updated` — например, автосогласие через 72 часа заменило
     * просьбу подтвердить объяснением «время вышло», или человек поправил
     * свой текст. `message_deleted` — своё сообщение удалили физически.
     *
     * **Новое сообщение не пришло**, поэтому счётчик вручную не растёт:
     * строку перечитываем, и непрочитанное в ней остаётся серверным. При
     * удалении он даже уменьшается — сервер считает по строкам `messages`,
     * и удалённой там уже нет. Строка нужна целиком, а не только текст:
     * вместе с телом меняется и действие (перевод уже `confirmed`, и
     * «Подтверждаю» должно уйти), а при удалении последнего сообщения —
     * и `lastMessage`.
     */
    if (event.kind === 'message_updated' || event.kind === 'message_deleted') {
      if (!row) {
        await refresh()
        notify(event, rows.value.find((item) => item.id === id) ?? null)
        return
      }

      try {
        Object.assign(row, await getConversation(id))
      } catch {
        // Запрос не прошёл — текст, пришедший в кадре, экран диалога всё
        // равно заменит, а лента догонит следующим опросом.
      }

      notify(event, row)
      return
    }

    if (!row) {
      await refresh()
      notify(event, rows.value.find((item) => item.id === id) ?? null)
      return
    }

    row.unreadCount += 1

    try {
      Object.assign(row, await getConversation(id))
    } catch {
      // Запрос не прошёл — строка останется со старым текстом, но счётчик
      // уже вырос. Следующий опрос по фокусу поправит текст.
    }

    notify(event, row)
  }

  /**
   * Запомнить своё сообщение в строке ленты.
   *
   * Ответ `POST /messages` уже принёс его — перечитывать строку запросом
   * незачем. Без этой правки лента оставалась бы со старым текстом после
   * отправки из открытого диалога: событие своего автора стор не
   * применяет (правило «своё действие не перечитываем»), и до следующего
   * опроса строка врала бы. На живой проверке 24.11.2026 из-за этого
   * вверху ленты висел старый «Перевод», хотя человек только что написал.
   */
  function rememberMessage(conversationId: string, message: TripMessage): void {
    const row = rows.value.find((item) => item.id === conversationId)

    if (!row) return

    row.lastMessage = message
  }

  /**
   * Снять непрочитанное у диалога, открытого не из ленты.
   *
   * Экран `/messages/:id` открывается и по прямой ссылке: он сам зовёт
   * `POST /conversations/:id/read`, а строки в сторе в этот момент может
   * ещё не быть, и `markRead(row)` её не найдёт. Без этой правки бейдж
   * показывал бы уже прочитанное до следующего опроса — на живой проверке
   * 24.11.2026 так и вышло: диалог открыт, а в колонке «6».
   */
  function clearUnread(conversationId: string): void {
    const row = rows.value.find((item) => item.id === conversationId)

    if (row) row.unreadCount = 0
  }

  /** Наблюдатели события: открытый диалог и раскрытая строка колонки. */  const listeners = new Set<ConversationEventListener>()

  /** Подписаться на события переписки. Возвращает отписку. */
  function onEvent(listener: ConversationEventListener): () => void {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  }

  function notify(event: ConversationEvent, row: Conversation | null): void {
    for (const listener of listeners) listener(event, row)
  }

  /**
   * Держать ленту живой, пока она кому-то видна.
   *
   * Счётчик подписчиков, а не флаг: подписчиков двое (колонка и мобильная
   * панель), и уход одного не должен гасить обновления другого. Таймер,
   * подписка на фокус и поток событий заводятся на первом подписчике
   * и снимаются на последнем. Возвращает функцию «я больше не смотрю».
   */
  let holders = 0
  let timer: ReturnType<typeof setInterval> | null = null
  let stopEvents: (() => void) | null = null

  function onFocus(): void {
    void refresh()
  }

  function hold(): () => void {
    holders += 1

    if (holders === 1) {
      void refresh()
      window.addEventListener('focus', onFocus)
      timer = setInterval(() => {
        // Скрытая вкладка не тратит запросы: человек всё равно не увидит,
        // что там пришло, а счётчик прочтёт при возврате — по фокусу.
        if (document.visibilityState === 'visible') void refresh()
      }, REFRESH_MS)

      /**
       * Один поток на приложение, а не на компонент. Колонка и панель
       * живут в разметке одновременно, и две подписки означали бы два
       * соединения с одним и тем же адресом.
       */
      stopEvents = subscribeConversationEvents((event) => {
        void applyEvent(event)
      })
    }

    let released = false

    return () => {
      // Один подписчик — один возврат: двойной вызов не должен снимать
      // чужие подписки и глушить ленту.
      if (released) return
      released = true
      holders -= 1

      if (holders > 0) return

      window.removeEventListener('focus', onFocus)
      if (timer !== null) clearInterval(timer)
      timer = null

      if (stopEvents !== null) {
        stopEvents()
        stopEvents = null
      }
    }
  }

  return {
    rows,
    isLoading,
    error,
    visible,
    muted,
    unreadTotal,
    refresh,
    markRead,
    rememberMessage,
    clearUnread,
    applyEvent,
    onEvent,
    hold,
  }
})
