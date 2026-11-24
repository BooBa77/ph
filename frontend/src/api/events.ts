import { useAuthStore } from '@/stores/auth'

/**
 * Живые события — Server-Sent Events (06.11.2026; переписка — 24.11.2026).
 *
 * Заказчик: «пришло время SSE. Участники перетасовывают вещи и нужно видеть
 * изменения онлайн». Поток открывает вкладка, пока она на экране; событие —
 * сигнал «перечитай данные», а не сами данные (почему так — в
 * `TripEventsService` и `ConversationEventsService` на бэкенде).
 *
 * **Потоков четыре вида.** У «Снаряжения» (`/gear/events`), «Бухгалтерии»
 * (`/finance/events`), «Питания» (`/meals/events`) и «Дневника»
 * (`/diary/events`) свои адреса и свои права — они на поход. Пятый —
 * переписка (`/api/conversations/events`), и он **на человека**: чатов
 * у человека девять, а вкладка одна. Чаты похода едут по нему же:
 * сообщения в них те же самые.
 *
 * **Канал не фильтрует `scope`: фильтрует вкладка.** На бэкенде канал
 * событий один на поход (`TripEventsService`), поэтому в «Снаряжение»
 * прилетают и денежные события, и наоборот. `scope` в кадре и говорит
 * вкладке, её ли это изменение.
 *
 * **Почему `fetch`, а не `EventSource`.** Нативный `EventSource` не умеет
 * заголовки, а вход в проекте — `Authorization: Bearer`: токен пришлось бы
 * класть в query-строку, то есть в логи nginx и историю прокси. `fetch`
 * с телом-стримом умеет и заголовок, и отмену, а разбор кадров SSE —
 * несколько десятков строк ниже.
 *
 * **Почему переподключаемся сами.** `fetch`-поток, в отличие от
 * `EventSource`, не переподключается. Обрыв связи, перезапуск бэкенда
 * в dev и засыпание вкладки — обычное дело, и молча замолчавшая вкладка
 * хуже, чем лишний запрос раз в несколько секунд.
 */

/**
 * Что изменилось: снаряжение, чек-листы, деньги, питание, дневник, ночёвки
 * или свойства самого похода.
 */
export type TripEventScope = 'gear' | 'checklist' | 'finance' | 'meals' | 'diary' | 'route' | 'trip'

/** Адрес потока: у «Снаряжения», «Бухгалтерии», «Питания» и «Дневника» свои контроллеры. */
export type TripEventChannel = 'gear' | 'finance' | 'meals' | 'diary'

export interface TripEvent {
  scope: TripEventScope
  /** Кто изменил: своё действие клиент уже применил и не перечитывает. */
  actorId: string
  at: string
}

/**
 * Что произошло в переписке: пришло сообщение или диалог прочитали.
 *
 * `ConversationDto` здесь не едет намеренно: он зависит от смотрящего
 * (`unreadCount`, `peer`, `peerLastReadAt`), и один объект на всех отдал бы
 * чужое непрочитанное. По `conversationId` клиент находит строку и
 * дотягивает её одним `GET /api/conversations/:id`.
 */
export type ConversationEventKind = 'message' | 'read'

export interface ConversationEvent {
  conversationId: string
  kind: ConversationEventKind
  /** Кто действовал: своё действие клиент уже применил и не перечитывает. */
  actorId: string
  at: string
}

/** Паузы переподключения по попыткам; последняя повторяется. */
const RECONNECT_MS = [1000, 2000, 5000, 10_000, 15_000]

/**
 * Сколько тишины терпим, прежде чем считать поток мёртвым.
 *
 * Сервер пишет пустой комментарий раз в 25 секунд (`trip-events-stream.ts`),
 * так что минута без единого байта — это уже не «тихо в переписке»,
 * а оборванное соединение. Нужно оно потому, что **обрыв не всегда виден**:
 * 24.11.2026 на живой проверке бэкенд перезапустили посреди потока, а вкладка
 * не получила ни `loadingFailed`, ни конца ответа — dev-прокси Vite держал
 * ответ открытым, и TCP-обрыв до неё не дошёл. Клиент ждал бы вечно, и живое
 * сообщение после перезапуска не приходило бы вовсе. На мобильной сети
 * бывает то же самое: полусгнившее соединение, по которому ничего не идёт.
 */
const IDLE_TIMEOUT_MS = 60_000

/**
 * Разобрать кадр SSE на имя события и данные.
 *
 * Возвращает `null` для всего, что не несёт события: кадров `: ping`,
 * `retry: 3000` и прочих полей. Имя события отдаётся отдельно — какой
 * поток его слушает, решает вызывающий.
 */
function readSseFrame(frame: string): { name: string; data: string } | null {
  const data: string[] = []
  let eventName = ''

  for (const line of frame.split('\n')) {
    if (line === '' || line.startsWith(':')) continue

    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    // Один пробел после двоеточия — часть формата, а не данных.
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')

    if (field === 'event') eventName = value
    else if (field === 'data') data.push(value)
  }

  if (data.length === 0) return null

  return { name: eventName, data: data.join('\n') }
}

/**
 * Разобрать кадр известного потока.
 *
 * `eventName` проверяется, чтобы будущий `event: chat` не притворился
 * изменением снаряжения, а кадр переписки не был принят за событие
 * вкладки. Пустое имя допускается: так сервер писал до 12.11.2026,
 * и такие кадры должны продолжать работать.
 */
function parseFrame<T>(
  frame: string,
  eventName: string,
  isEvent: (value: unknown) => value is T,
): T | null {
  const read = readSseFrame(frame)

  if (!read) return null
  if (read.name !== '' && read.name !== eventName) return null

  try {
    const parsed: unknown = JSON.parse(read.data)

    return isEvent(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Разобрать один кадр события вкладки (`event: trip`/`data: …` до пустой
 * строки).
 *
 * Возвращает `null` для всего, что не является событием вкладки: кадров
 * `: ping`, `retry: 3000`, неизвестных имён и битого JSON.
 */
export function parseSseFrame(frame: string): TripEvent | null {
  return parseFrame(frame, 'trip', isTripEvent)
}

/**
 * Разобрать один кадр события переписки (`event: conversation`).
 *
 * Отдельная функция, а не параметр у `parseSseFrame`: у потоков разная
 * проверка данных, и общий парсер пришлось бы учить обоим видам событий —
 * тогда кадр похода мог бы вернуться как событие переписки.
 */
export function parseConversationFrame(frame: string): ConversationEvent | null {
  return parseFrame(frame, 'conversation', isConversationEvent)
}

/**
 * Известный ли это scope.
 *
 * `diary` добавлен 19.11.2026: тип его знал, а проверка нет — кадры дневника
 * молча выбрасывались, и подписка «Дневника» была мёртвой. `trip` —
 * свойства похода для шапки страницы.
 */
const TRIP_EVENT_SCOPES: readonly TripEventScope[] = [
  'gear',
  'checklist',
  'finance',
  'meals',
  'diary',
  'route',
  'trip',
]

function isTripEvent(value: unknown): value is TripEvent {
  if (typeof value !== 'object' || value === null) return false

  const event = value as Partial<TripEvent>

  return (
    TRIP_EVENT_SCOPES.includes(event.scope as TripEventScope) &&
    typeof event.actorId === 'string' &&
    typeof event.at === 'string'
  )
}

/** Виды событий переписки: всё остальное — не наше. */
const CONVERSATION_EVENT_KINDS: readonly ConversationEventKind[] = ['message', 'read']

function isConversationEvent(value: unknown): value is ConversationEvent {
  if (typeof value !== 'object' || value === null) return false

  const event = value as Partial<ConversationEvent>

  return (
    typeof event.conversationId === 'string' &&
    CONVERSATION_EVENT_KINDS.includes(event.kind as ConversationEventKind) &&
    typeof event.actorId === 'string' &&
    typeof event.at === 'string'
  )
}

/**
 * Открыть поток и отдавать разобранные кадры — общий низ для всех потоков.
 *
 * Здесь всё, что не зависит от того, чьи это события: `Bearer`-заголовок,
 * refresh при 401, разбор кадров по пустой строке, отмена и
 * переподключение с паузами. Адрес, разбор кадра и обработчик приходят
 * снаружи — раньше это было одним `subscribeTripEvents`, и второй поток
 * (переписка) завёл бы вторую копию переподключения.
 *
 * Возвращает функцию отписки: она обрывает соединение и отменяет
 * запланированное переподключение. Вызывать обязательно при уходе
 * с экрана — иначе браузер держит поток до закрытия страницы, а сервер
 * продолжает писать в него.
 */
function openSseStream<T>(options: {
  url: string
  /** Разобрать кадр; `null` — кадр не нашего вида. */
  parse: (frame: string) => T | null
  onEvent: (event: T) => void
}): () => void {
  const controller = new AbortController()
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  /** Один запрос потока с текущим токеном из store. */
  async function request(token: string | null): Promise<Response> {
    const headers = new Headers({ Accept: 'text/event-stream' })
    if (token) headers.set('Authorization', `Bearer ${token}`)

    return fetch(options.url, {
      headers,
      credentials: 'include',
      signal: controller.signal,
    })
  }

  async function connect(): Promise<void> {
    if (controller.signal.aborted) return

    try {
      let response = await request(useAuthStore().accessToken)

      /**
       * Access-токен живёт 30 минут, а поток — дольше. Отказ по `401`
       * лечится тем же refresh, что у `apiFetch`, но один раз: если и
       * после обновления 401, значит сессии нет — переподключаться
       * бессмысленно, вход покажет следующий экран.
       */
      if (response.status === 401) {
        const refreshed = await useAuthStore().refreshAccessToken()

        if (!refreshed.accessToken) return
        response = await request(refreshed.accessToken)

        if (response.status === 401) return
      }

      if (!response.ok || !response.body) {
        throw new Error(`Поток событий ответил ${response.status}`)
      }

      // Соединение установилось — следующая пауза снова начинается с 1 с.
      attempt = 0
      await readStream(response.body)
    } catch {
      // Сеть, обрыв, отмена — всё лечится переподключением. Ошибку
      // на экран не выносим: живые обновления — удобство, а не данные,
      // и красить вкладку красным из-за них незачем.
    }

    scheduleReconnect()
  }

  async function readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let idle: ReturnType<typeof setTimeout> | null = null

    /**
     * Сторож тишины: любой байт (в том числе `: ping`) сдвигает срок.
     * Когда срок вышел, отменяем чтение — это закрывает поток, и
     * `connect()` штатно уходит в переподключение.
     */
    const armIdle = (): void => {
      if (idle !== null) clearTimeout(idle)

      idle = setTimeout(() => {
        idle = null
        void reader.cancel().catch(() => undefined)
      }, IDLE_TIMEOUT_MS)
    }

    armIdle()

    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return

        // Байты пришли — поток жив, даже если это только heartbeat.
        armIdle()

        // Кадры разделяются пустой строкой. CRLF приводим к LF сразу:
        // сервер пишет `\n`, но прокси вправе переписать перевод строки.
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

        let boundary = buffer.indexOf('\n\n')
        while (boundary !== -1) {
          const event = options.parse(buffer.slice(0, boundary))
          buffer = buffer.slice(boundary + 2)
          if (event) options.onEvent(event)

          boundary = buffer.indexOf('\n\n')
        }
      }
    } finally {
      if (idle !== null) clearTimeout(idle)
      reader.releaseLock()
    }
  }

  function scheduleReconnect(): void {
    if (controller.signal.aborted || reconnectTimer !== null) return

    const delay = RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)]
    attempt += 1

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, delay)
  }

  void connect()

  return () => {
    controller.abort()
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }
}

/**
 * Подписаться на изменения вкладки похода.
 *
 * `channel` выбирает адрес: «Снаряжение» слушает `/gear/events`
 * (по умолчанию — так вызывал единственный поток до 12.11.2026),
 * «Бухгалтерия» — `/finance/events`, «Питание» — `/meals/events`,
 * «Дневник» — `/diary/events`.
 */
export function subscribeTripEvents(
  tripId: string,
  onEvent: (event: TripEvent) => void,
  channel: TripEventChannel = 'gear',
): () => void {
  return openSseStream({
    url: `/api/trips/${tripId}/${channel}/events`,
    parse: parseSseFrame,
    onEvent,
  })
}

/**
 * Подписаться на события переписки — один поток на человека.
 *
 * Адрес без id: сервер берёт человека из токена, подписаться на чужой
 * поток нечем. Поток открывает стор ленты (`stores/conversations.ts`),
 * пока лента кому-то нужна: подписчиков двое (колонка и мобильная панель),
 * и одна вкладка не должна держать два соединения.
 */
export function subscribeConversationEvents(
  onEvent: (event: ConversationEvent) => void,
): () => void {
  return openSseStream({
    url: '/api/conversations/events',
    parse: parseConversationFrame,
    onEvent,
  })
}
