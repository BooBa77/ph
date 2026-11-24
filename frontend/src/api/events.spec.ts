import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  parseConversationFrame,
  parseSseFrame,
  subscribeConversationEvents,
  subscribeTripEvents,
} from '@/api/events'
import type { ConversationEvent, TripEvent } from '@/api/events'
import { useAuthStore } from '@/stores/auth'

/**
 * Поток живых событий вкладки (06.11.2026).
 *
 * Разбор кадров проверяется отдельно от сети: `parseSseFrame` — чистая
 * функция, и именно в ней живут все «а вдруг прокси добавил комментарий»
 * и «а вдруг пришёл неизвестный вид события».
 */
function event(overrides: Partial<TripEvent> = {}): TripEvent {
  return {
    scope: 'gear',
    actorId: 'user-1',
    at: '2026-11-06T10:00:00.000Z',
    ...overrides,
  }
}

function frame(payload: unknown, name = 'trip'): string {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}`
}

describe('parseSseFrame', () => {
  it('читает кадр события вкладки', () => {
    expect(parseSseFrame(frame(event()))).toEqual(event())
    expect(parseSseFrame(frame(event({ scope: 'checklist' })))).toEqual(
      event({ scope: 'checklist' }),
    )
  })

  it('понимает денежные события «Бухгалтерии»', () => {
    expect(parseSseFrame(frame(event({ scope: 'finance' })))).toEqual(
      event({ scope: 'finance' }),
    )
  })

  it('понимает события «Питания»', () => {
    expect(parseSseFrame(frame(event({ scope: 'meals' })))).toEqual(
      event({ scope: 'meals' }),
    )
  })

  it('понимает ночёвки, дневник и свойства похода', () => {
    expect(parseSseFrame(frame(event({ scope: 'route' })))).toEqual(
      event({ scope: 'route' }),
    )
    // `diary` тип знал с самого начала, а проверка его выбрасывала:
    // подписка «Дневника» была мёртвой до 19.11.2026.
    expect(parseSseFrame(frame(event({ scope: 'diary' })))).toEqual(
      event({ scope: 'diary' }),
    )
    expect(parseSseFrame(frame(event({ scope: 'trip' })))).toEqual(
      event({ scope: 'trip' }),
    )
  })

  it('пропускает heartbeat, retry и данные неизвестного вида', () => {    expect(parseSseFrame(': ping')).toBeNull()
    expect(parseSseFrame('retry: 3000')).toBeNull()
    // Чужое имя события не должно притворяться изменением снаряжения.
    expect(parseSseFrame(frame(event(), 'chat'))).toBeNull()
    expect(parseSseFrame(frame({ scope: 'unknown', actorId: 'u', at: 't' }))).toBeNull()
    expect(parseSseFrame('event: trip\ndata: {битый json')).toBeNull()
  })

  it('склеивает многострочные данные и понимает CRLF', () => {
    const pretty = JSON.stringify(event(), null, 2)
      .split('\n')
      .map((line) => `data: ${line}`)
      .join('\r\n')

    expect(parseSseFrame(pretty.replace(/\r\n/g, '\n'))).toEqual(event())
  })
})

/**
 * Переписка (24.11.2026): тот же формат кадра, но своё имя события
 * и своя проверка данных. `ConversationDto` в кадре не едет — только
 * `conversationId`, `kind`, `actorId` и `at`.
 */
function conversationEvent(overrides: Partial<ConversationEvent> = {}): ConversationEvent {
  return {
    conversationId: '1268',
    kind: 'message',
    actorId: 'user-1',
    at: '2026-11-24T09:00:00.000Z',
    ...overrides,
  }
}

function conversationFrame(payload: unknown, name = 'conversation'): string {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}`
}

describe('parseConversationFrame', () => {
  it('читает «сообщение» и «прочитано»', () => {
    expect(parseConversationFrame(conversationFrame(conversationEvent()))).toEqual(
      conversationEvent(),
    )
    expect(
      parseConversationFrame(
        conversationFrame(conversationEvent({ kind: 'read', actorId: 'user-2' })),
      ),
    ).toEqual(conversationEvent({ kind: 'read', actorId: 'user-2' }))
  })

  /**
   * Переписанный текст (24.11.2026): в кадре id сообщения и новый текст,
   * `actorId` пуст — автосогласие действует без человека, и событие
   * применяют все.
   */
  it('читает «сообщение изменилось» вместе с id и текстом', () => {
    const payload = conversationEvent({
      kind: 'message_updated',
      actorId: '',
      messageId: '346',
      body: 'Время ожидания подтверждения вышло',
    })

    expect(parseConversationFrame(conversationFrame(payload))).toEqual(payload)
  })

  it('отбрасывает «сообщение изменилось» без id или текста', () => {
    // Заменять в открытом диалоге нечего — кадр бесполезен, а без текста
    // пришлось бы перечитывать историю страницами.
    expect(
      parseConversationFrame(
        conversationFrame(
          conversationEvent({ kind: 'message_updated', actorId: '', body: 'Текст' }),
        ),
      ),
    ).toBeNull()
    expect(
      parseConversationFrame(
        conversationFrame(
          conversationEvent({
            kind: 'message_updated',
            actorId: '',
            messageId: '346',
          }),
        ),
      ),
    ).toBeNull()
  })

  it('не принимает кадр похода и неизвестный вид', () => {
    // Имя события чужое — это не переписка.
    expect(parseConversationFrame(frame(event()))).toBeNull()
    expect(
      parseConversationFrame(conversationFrame(conversationEvent({ kind: 'typing' as 'read' }))),
    ).toBeNull()
    expect(
      parseConversationFrame(conversationFrame({ conversationId: '1268', kind: 'message' })),
    ).toBeNull()
  })

  it('пропускает heartbeat и битый JSON', () => {
    expect(parseConversationFrame(': ping')).toBeNull()
    expect(parseConversationFrame('retry: 3000')).toBeNull()
    expect(parseConversationFrame('event: conversation\ndata: {битый json')).toBeNull()
  })

  /**
   * Карточка панели изменилась (24.11.2026). Отдельного потока у уведомлений
   * нет (§14.2): сигнал едет по потоку переписки, `conversationId` и
   * `actorId` у него пустые — карточка не всегда про диалог, а изменила её
   * система. Пустые строки обязаны проходить проверку вида, иначе кадр
   * молча пропадёт и панель обновится только по минуте.
   */
  it('читает сигнал «уведомления изменились» с пустыми id', () => {
    const payload = conversationEvent({
      kind: 'notifications',
      conversationId: '',
      actorId: '',
    })

    expect(parseConversationFrame(conversationFrame(payload))).toEqual(payload)
  })
})

/** Ответ-поток: отдаёт подготовленные куски и закрывается. */
function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('subscribeTripEvents', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('идёт на поток вкладки с Bearer-токеном и отдаёт события', async () => {
    useAuthStore().accessToken = 'token-123'

    const calls: RequestInit[] = []
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        urls.push(String(input))
        calls.push(init)

        return streamResponse([
          'retry: 3000\n\n',
          `${frame(event())}\n\n: ping\n\n`,
        ])
      }),
    )

    const received: TripEvent[] = []
    const stop = subscribeTripEvents('679', (incoming) => received.push(incoming))

    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0]).toEqual(event())

    // Без канала — «Снаряжение»: так вызывал единственный поток до 12.11.2026.
    expect(urls[0]).toBe('/api/trips/679/gear/events')

    const headers = new Headers(calls[0]!.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Authorization')).toBe('Bearer token-123')
    expect(calls[0]!.credentials).toBe('include')

    stop()
  })

  it('«Бухгалтерия» слушает свой поток', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input))

        return streamResponse([`${frame(event({ scope: 'finance' }))}\n\n`])
      }),
    )

    const received: TripEvent[] = []
    const stop = subscribeTripEvents('679', (incoming) => received.push(incoming), 'finance')

    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(urls[0]).toBe('/api/trips/679/finance/events')
    expect(received[0]?.scope).toBe('finance')

    stop()
  })

  it('«Питание» слушает свой поток', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input))

        return streamResponse([`${frame(event({ scope: 'meals' }))}\n\n`])
      }),
    )

    const received: TripEvent[] = []
    const stop = subscribeTripEvents('679', (incoming) => received.push(incoming), 'meals')

    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(urls[0]).toBe('/api/trips/679/meals/events')
    expect(received[0]?.scope).toBe('meals')

    stop()
  })

  it('после отписки не открывает соединение заново', async () => {
    useAuthStore().accessToken = 'token-123'

    const fetchMock = vi.fn(async () => streamResponse([`${frame(event())}\n\n`]))
    vi.stubGlobal('fetch', fetchMock)

    const stop = subscribeTripEvents('679', () => {})
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    // Поток закрылся — вкладка планирует переподключение; отписка должна
    // отменить этот таймер, иначе тест оставил бы висящий запрос.
    stop()

    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  /**
   * Один поход — одно соединение (24.11.2026).
   *
   * Шапка слушает «Снаряжение», вкладка — свой канал, а на бэкенде канал
   * один на поход: кадры у потоков одинаковые. Два соединения на страницу
   * занимали по слоту HTTP/1.1 каждое, и вместе с потоком переписки
   * ссылка на поход во второй вкладке выбирала все шесть слотов браузера —
   * после этого любой запрос (в том числе POST кнопки уведомлений) стоял
   * в очереди браузера и не уходил в сеть.
   */
  it('делит одно соединение на все вкладки похода', async () => {
    useAuthStore().accessToken = 'token-123'

    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input))

        return streamResponse([`${frame(event())}\n\n`])
      }),
    )

    const header: TripEvent[] = []
    const finance: TripEvent[] = []

    const stopHeader = subscribeTripEvents('770', (incoming) => header.push(incoming))
    const stopFinance = subscribeTripEvents('770', (incoming) => finance.push(incoming), 'finance')

    await vi.waitFor(() => expect(header).toHaveLength(1))
    expect(finance).toHaveLength(1)
    // Адрес — у первого подписчика; второго соединения нет вовсе.
    expect(urls).toEqual(['/api/trips/770/gear/events'])

    stopHeader()
    stopFinance()
  })

  it('отписка одной вкладки не рвёт поток остальным', async () => {
    useAuthStore().accessToken = 'token-123'

    const fetchMock = vi.fn(async () => streamResponse(['']))
    vi.stubGlobal('fetch', fetchMock)

    const stopHeader = subscribeTripEvents('771', () => {})
    const stopFinance = subscribeTripEvents('771', () => {}, 'finance')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    stopHeader()
    // Соединение одно и оно живо: повторный подписчик вкладки заводит
    // не второй запрос, а второго слушателя.
    const stopDiary = subscribeTripEvents('771', () => {}, 'diary')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    stopFinance()
    stopDiary()

    // Последний ушёл — поток закрыт и снят с учёта: новый подписчик
    // открывает соединение заново.
    const stopAgain = subscribeTripEvents('771', () => {})
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    stopAgain()
  })
})

describe('subscribeConversationEvents', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('идёт на общий поток человека с Bearer-токеном', async () => {
    useAuthStore().accessToken = 'token-123'

    const urls: string[] = []
    const calls: RequestInit[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        urls.push(String(input))
        calls.push(init)

        return streamResponse(['retry: 3000\n\n', `${conversationFrame(conversationEvent())}\n\n`])
      }),
    )

    const received: ConversationEvent[] = []
    const stop = subscribeConversationEvents((incoming) => received.push(incoming))

    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0]).toEqual(conversationEvent())

    // Адрес без id: человека сервер берёт из токена — подписаться
    // на чужой поток нечем.
    expect(urls[0]).toBe('/api/conversations/events')

    const headers = new Headers(calls[0]!.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Authorization')).toBe('Bearer token-123')
    expect(calls[0]!.credentials).toBe('include')

    stop()
  })

  it('кадр похода перепиской не считается', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse([`${frame(event())}\n\n`, `${conversationFrame(conversationEvent())}\n\n`]),
      ),
    )

    const received: ConversationEvent[] = []
    const stop = subscribeConversationEvents((incoming) => received.push(incoming))

    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0]).toEqual(conversationEvent())

    stop()
  })

  /**
   * Панель уведомлений и переписка живут на одном соединении (24.11.2026).
   *
   * Кадр `notifications` приходит в тот же поток, что и сообщения, поэтому
   * два стора подписываются на один адрес. Второй `openSseStream` занял бы
   * второе соединение HTTP/1.1 из шести, которые держит браузер: на экране
   * похода это уже приводило к тому, что любой запрос вставал в очередь.
   */
  it('делит одно соединение между перепиской и панелью уведомлений', async () => {
    useAuthStore().accessToken = 'token-123'

    const fetchMock = vi.fn(async () =>
      streamResponse([`${conversationFrame(conversationEvent())}\n\n`]),
    )
    vi.stubGlobal('fetch', fetchMock)

    const feed: ConversationEvent[] = []
    const panel: ConversationEvent[] = []

    const stopFeed = subscribeConversationEvents((incoming) => feed.push(incoming))
    const stopPanel = subscribeConversationEvents((incoming) => panel.push(incoming))

    await vi.waitFor(() => expect(feed).toHaveLength(1))
    expect(panel).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Ушёл один подписчик — второй продолжает получать кадры с того же
    // соединения, нового запроса нет.
    stopFeed()
    const late: ConversationEvent[] = []
    const stopLate = subscribeConversationEvents((incoming) => late.push(incoming))

    expect(fetchMock).toHaveBeenCalledTimes(1)

    stopPanel()
    stopLate()
  })

  it('после отписки не открывает соединение заново', async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse([`${conversationFrame(conversationEvent())}\n\n`]),
    )
    vi.stubGlobal('fetch', fetchMock)

    const stop = subscribeConversationEvents(() => {})
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    stop()

    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  /**
   * Полуоткрытое соединение (24.11.2026): прокси держит ответ открытым,
   * конца ответа вкладка не видит, и без сторожа поток молчал бы вечно.
   * Сервер шлёт `: ping` раз в 25 с, поэтому минута тишины — это обрыв.
   */
  it('переоткрывает поток, если тот замолчал', async () => {
    vi.useFakeTimers()

    try {
      const stalled = () =>
        new Response(
          new ReadableStream<Uint8Array>({
            // Ни данных, ни закрытия: так выглядит полусгнившее соединение.
            start() {},
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(stalled())
        .mockResolvedValueOnce(
          streamResponse([`${conversationFrame(conversationEvent())}\n\n`]),
        )
      vi.stubGlobal('fetch', fetchMock)

      const received: ConversationEvent[] = []
      const stop = subscribeConversationEvents((incoming) => received.push(incoming))

      await vi.advanceTimersByTimeAsync(1000)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(received).toHaveLength(0)

      // Минута тишины — сторож рвёт чтение; переподключение идёт по паузам
      // 1 → 2 → 5… с, поэтому прокручиваем и первую паузу.
      await vi.advanceTimersByTimeAsync(60_000 + 1000)

      // Второй ответ в моке закрывается сразу, поэтому дальше поток
      // переоткрывается снова — важно, что запросов стало больше одного.
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(received).toHaveLength(1)

      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
