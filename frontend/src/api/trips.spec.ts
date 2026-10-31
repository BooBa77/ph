import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  acceptRouteLodger,
  buildTripListQuery,
  fetchTripRoute,
  lodgeRoute,
  releaseRouteLodger,
  saveRouteNights,
} from '@/api/trips'
import type { RouteNightInput, TripRoute } from '@/types/trips'

/**
 * Тесты сборки строки запроса ленты.
 *
 * Главное правило здесь одно и оно неочевидное: **«любое значение» — это
 * отсутствие параметра, а не `false`**. `?isCommercial=false` просит
 * у бэкенда только бесплатные походы, и если однажды `undefined` начнёт
 * превращаться в `false`, лента молча покажет половину походов.
 */
describe('buildTripListQuery', () => {
  it('без параметров не приписывает даже вопросительный знак', () => {
    expect(buildTripListQuery()).toBe('')
    expect(buildTripListQuery({})).toBe('')
  })

  it('отбрасывает незаданное, но сохраняет false', () => {
    const query = buildTripListQuery({
      mine: false,
      isCommercial: false,
      isOfficial: undefined,
      when: undefined,
      limit: 20,
      offset: 0,
    })

    expect(query).toBe('?mine=false&isCommercial=false&limit=20&offset=0')
  })

  it('собирает фильтры анонсов целиком', () => {
    const query = buildTripListQuery({
      mine: false,
      objectId: 10,
      when: 'weekend',
      status: 'decided',
      isCommercial: true,
      isOfficial: true,
    })

    expect(query).toContain('objectId=10')
    expect(query).toContain('when=weekend')
    expect(query).toContain('status=decided')
    expect(query).toContain('isCommercial=true')
    expect(query).toContain('isOfficial=true')
    expect(query).toContain('mine=false')
  })
})

/**
 * Адреса «Ночёвок» — контракт, который из типов TypeScript не виден: метод
 * и путь живут в строке. Все ручки обязаны возвращать вкладку целиком,
 * поэтому проверяется и разворот ответа, а не только адрес.
 */
const ROUTE: TripRoute = { canEdit: true, nights: [], lodgers: [], travelers: [] }

interface RouteCall {
  url: string
  init: RequestInit
}

/** Подменяет fetch вкладкой «Ночёвки» и записывает вызовы. */
function mockRouteFetch(): {
  calls: RouteCall[]
  bodyOf: (index: number) => unknown
} {
  const calls: RouteCall[] = []

  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init })

    return new Response(JSON.stringify(ROUTE), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  vi.stubGlobal('fetch', mock)

  return {
    calls,
    bodyOf: (index: number) => JSON.parse(String(calls[index]!.init.body)) as unknown,
  }
}

describe('api/trips — ночёвки похода', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('вкладка целиком — GET /trips/:id/route', async () => {
    const { calls } = mockRouteFetch()

    await expect(fetchTripRoute('1')).resolves.toEqual(ROUTE)

    expect(calls[0]!.url).toBe('/api/trips/1/route')
    expect(calls[0]!.init.method).toBeUndefined()
  })

  it('сохранение уходит PUT-ом с таблицей ночей целиком', async () => {
    const { calls, bodyOf } = mockRouteFetch()

    const nights: RouteNightInput[] = [
      { position: 1, date: '2026-10-29', place: 'Слюдянка', options: [{ kind: 'hut' }] },
    ]

    await expect(saveRouteNights('1', nights)).resolves.toEqual(ROUTE)

    expect(calls[0]!.url).toBe('/api/trips/1/route/nights')
    expect(calls[0]!.init.method).toBe('PUT')
    expect(bodyOf(0)).toEqual({ nights })
  })

  it('посадка в палатку — PUT /lodgers/:userId с палаткой', async () => {
    const { calls, bodyOf } = mockRouteFetch()

    await expect(lodgeRoute('1', 'u-1', '12')).resolves.toEqual(ROUTE)

    expect(calls[0]!.url).toBe('/api/trips/1/route/lodgers/u-1')
    expect(calls[0]!.init.method).toBe('PUT')
    expect(bodyOf(0)).toEqual({ tentGearId: '12' })
  })

  it('принятие заявки — POST .../accept без тела', async () => {
    const { calls } = mockRouteFetch()

    await expect(acceptRouteLodger('1', 'u-1')).resolves.toEqual(ROUTE)

    expect(calls[0]!.url).toBe('/api/trips/1/route/lodgers/u-1/accept')
    expect(calls[0]!.init.method).toBe('POST')
    expect(calls[0]!.init.body).toBeUndefined()
  })

  it('освобождение места — DELETE, и ответ всё равно вкладка', async () => {
    const { calls } = mockRouteFetch()

    await expect(releaseRouteLodger('1', 'u-1')).resolves.toEqual(ROUTE)

    expect(calls[0]!.url).toBe('/api/trips/1/route/lodgers/u-1')
    expect(calls[0]!.init.method).toBe('DELETE')
  })
})
