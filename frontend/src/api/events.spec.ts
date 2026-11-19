import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseSseFrame, subscribeTripEvents } from '@/api/events'
import type { TripEvent } from '@/api/events'
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
})
