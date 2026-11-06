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

  it('пропускает heartbeat, retry и данные неизвестного вида', () => {
    expect(parseSseFrame(': ping')).toBeNull()
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
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

    const headers = new Headers(calls[0]!.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Authorization')).toBe('Bearer token-123')
    expect(calls[0]!.credentials).toBe('include')

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
