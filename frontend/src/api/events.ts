import { useAuthStore } from '@/stores/auth'

/**
 * Живые события похода — Server-Sent Events (06.11.2026).
 *
 * Заказчик: «пришло время SSE. Участники перетасовывают вещи и нужно видеть
 * изменения онлайн». Поток открывает вкладка, пока она на экране; событие —
 * сигнал «перечитай данные», а не сами данные (почему так — в
 * `TripEventsService` на бэкенде).
 *
 * **Потоков два** (12.11.2026): у «Снаряжения» (`/gear/events`) и
 * «Бухгалтерии» (`/finance/events`) свои адреса и свои права. Заказчик про
 * деньги: «здесь очень важен SSE, обычно за компенсацию берутся на обратной
 * дороге и все в раз».
 *
 * **Канал не фильтрует `scope`: фильтрует вкладка.** На бэкенде канал
 * событий один на поход (`TripEventsService`), поэтому в «Снаряжение»
 * прилетают и денежные события, и наоборот. `scope` в кадре и говорит
 * вкладке, её ли это изменение; без этой проверки «Бухгалтерия»
 * перечитывалась бы на каждое перетаскивание вещи.
 *
 * **Почему `fetch`, а не `EventSource`.** Нативный `EventSource` не умеет
 * заголовки, а вход в проекте — `Authorization: Bearer`: токен пришлось бы
 * класть в query-строку, то есть в логи nginx и историю прокси. `fetch`
 * с телом-стримом умеет и заголовок, и отмену, а разбор кадров SSE —
 * три десятка строк ниже.
 *
 * **Почему переподключаемся сами.** `fetch`-поток, в отличие от
 * `EventSource`, не переподключается. Обрыв связи, перезапуск бэкенда
 * в dev и засыпание вкладки — обычное дело, и молча замолчавшая вкладка
 * хуже, чем лишний запрос раз в несколько секунд.
 */

/** Что изменилось на вкладке: снаряжение, чек-листы, деньги, питание, дневник или ночёвки. */
export type TripEventScope = 'gear' | 'checklist' | 'finance' | 'meals' | 'diary' | 'route'

/** Адрес потока: у «Снаряжения», «Бухгалтерии», «Питания» и «Дневника» свои контроллеры. */
export type TripEventChannel = 'gear' | 'finance' | 'meals' | 'diary'

export interface TripEvent {
  scope: TripEventScope
  /** Кто изменил: своё действие клиент уже применил и не перечитывает. */
  actorId: string
  at: string
}

/** Паузы переподключения по попыткам; последняя повторяется. */
const RECONNECT_MS = [1000, 2000, 5000, 10_000, 15_000]

/**
 * Разобрать один кадр SSE (`event: …`/`data: …` до пустой строки).
 *
 * Возвращает `null` для всего, что не является событием вкладки: кадров
 * `: ping`, `retry: 3000`, неизвестных имён и битого JSON. Имя события
 * проверяется, чтобы будущий `event: chat` не притворился изменением
 * снаряжения и не вызвал лишний запрос.
 */
export function parseSseFrame(frame: string): TripEvent | null {
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
  if (eventName !== '' && eventName !== 'trip') return null

  try {
    const parsed: unknown = JSON.parse(data.join('\n'))

    return isTripEvent(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isTripEvent(value: unknown): value is TripEvent {
  if (typeof value !== 'object' || value === null) return false

  const event = value as Partial<TripEvent>

  return (
    (event.scope === 'gear' ||
      event.scope === 'checklist' ||
      event.scope === 'finance' ||
      event.scope === 'meals' ||
      event.scope === 'route') &&
    typeof event.actorId === 'string' &&
    typeof event.at === 'string'
  )
}

/**
 * Подписаться на изменения вкладки похода.
 *
 * `channel` выбирает адрес: «Снаряжение» слушает `/gear/events`
 * (по умолчанию — так вызывал единственный поток до 12.11.2026),
 * «Бухгалтерия» — `/finance/events`, «Питание» — `/meals/events`.
 *
 * Возвращает функцию отписки: она обрывает соединение и отменяет
 * запланированное переподключение. Вызывать обязательно при уходе
 * с вкладки — иначе браузер держит поток до закрытия страницы, а сервер
 * продолжает писать в него.
 */
export function subscribeTripEvents(
  tripId: string,
  onEvent: (event: TripEvent) => void,
  channel: TripEventChannel = 'gear',
): () => void {
  const controller = new AbortController()
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  /** Один запрос потока с текущим токеном из store. */
  async function request(token: string | null): Promise<Response> {
    const headers = new Headers({ Accept: 'text/event-stream' })
    if (token) headers.set('Authorization', `Bearer ${token}`)

    return fetch(`/api/trips/${tripId}/${channel}/events`, {
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

    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return

        // Кадры разделяются пустой строкой. CRLF приводим к LF сразу:
        // сервер пишет `\n`, но прокси вправе переписать перевод строки.
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

        let boundary = buffer.indexOf('\n\n')
        while (boundary !== -1) {
          const event = parseSseFrame(buffer.slice(0, boundary))
          buffer = buffer.slice(boundary + 2)
          if (event) onEvent(event)

          boundary = buffer.indexOf('\n\n')
        }
      }
    } finally {
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
