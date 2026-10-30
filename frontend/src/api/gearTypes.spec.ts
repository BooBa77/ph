import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  archiveGearType,
  archiveGearTypeAttribute,
  archiveGearAttributeOption,
  createGearAttributeOption,
  createGearType,
  createGearTypeAttribute,
  fetchAdminGearTypes,
  fetchGearTypes,
  updateGearAttributeOption,
  updateGearType,
  updateGearTypeAttribute,
} from '@/api/gearTypes'
import type { AdminGearType } from '@/types/gearTypes'

/**
 * Тесты API-клиента справочника: адреса, методы и разворот ответа.
 *
 * Проверяется перечень путей, а не смысл данных: это контракт, который
 * нельзя получить из типов TypeScript (метод и адрес живут в строке).
 * Ошибку с сообщением бэкенда проверяем один раз — разбор тела общий
 * с остальными клиентами (`api/client.ts`).
 */

const tent: AdminGearType = {
  id: 1,
  code: 'tent',
  name: 'Палатка',
  sortOrder: 0,
  isActive: true,
  attributes: [
    {
      id: 1,
      code: 'seats',
      name: 'Вместимость',
      valueKind: 'number',
      unit: 'мест',
      allowCustomValue: false,
      isRequired: true,
      sortOrder: 0,
      isActive: true,
      options: [],
    },
  ],
}

interface Call {
  url: string
  init: RequestInit
}

/** Подменяет fetch ответом и записывает вызовы. */
function mockFetch(body: unknown = { items: [tent] }, status = 200) {
  const calls: Call[] = []

  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init })

    if (status === 204) return new Response(null, { status })

    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  vi.stubGlobal('fetch', mock)

  return {
    calls,
    /** Тело запроса как объект: JSON-строка проверяется после разбора. */
    bodyOf: (index: number) => JSON.parse(String(calls[index]!.init.body)) as unknown,
  }
}

describe('api/gearTypes — справочник типов', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('публичный список идёт в GET /gear-types и разворачивает items', async () => {
    const { calls } = mockFetch()

    await expect(fetchGearTypes()).resolves.toEqual([tent])

    expect(calls[0]!.url).toBe('/api/gear-types')
    expect(calls[0]!.init.body).toBeUndefined()
  })

  it('админский список идёт в GET /gear/admin/types', async () => {
    const { calls } = mockFetch()

    await expect(fetchAdminGearTypes()).resolves.toEqual([tent])

    expect(calls[0]!.url).toBe('/api/gear/admin/types')
  })

  it('создание типа — POST с кодом, именем и порядком', async () => {
    const { calls, bodyOf } = mockFetch(tent, 201)

    await createGearType({ code: 'axe', name: 'Топор', sortOrder: 10 })

    expect(calls[0]!.url).toBe('/api/gear/admin/types')
    expect(calls[0]!.init.method).toBe('POST')
    expect(bodyOf(0)).toEqual({ code: 'axe', name: 'Топор', sortOrder: 10 })
  })

  it('правка типа — PATCH на его id', async () => {
    const { calls, bodyOf } = mockFetch(tent)

    await updateGearType(7, { name: 'Палатка', isActive: false })

    expect(calls[0]!.url).toBe('/api/gear/admin/types/7')
    expect(calls[0]!.init.method).toBe('PATCH')
    expect(bodyOf(0)).toEqual({ name: 'Палатка', isActive: false })
  })

  it('архив типа — DELETE, ответ 204 читается как undefined', async () => {
    const { calls } = mockFetch(null, 204)

    await expect(archiveGearType(7)).resolves.toBeUndefined()

    expect(calls[0]!.url).toBe('/api/gear/admin/types/7')
    expect(calls[0]!.init.method).toBe('DELETE')
  })

  it('характеристика создаётся под типом', async () => {
    const { calls, bodyOf } = mockFetch({ ...tent.attributes[0] }, 201)

    await createGearTypeAttribute(2, {
      code: 'volume',
      name: 'Объём',
      valueKind: 'number',
      unit: 'л',
      isRequired: true,
      fillMissing: 5,
    })

    expect(calls[0]!.url).toBe('/api/gear/admin/types/2/attributes')
    expect(calls[0]!.init.method).toBe('POST')
    expect(bodyOf(0)).toEqual({
      code: 'volume',
      name: 'Объём',
      valueKind: 'number',
      unit: 'л',
      isRequired: true,
      fillMissing: 5,
    })
  })

  it('правка характеристики идёт по паре «тип — характеристика»', async () => {
    const { calls, bodyOf } = mockFetch({ ...tent.attributes[0] })

    await updateGearTypeAttribute(2, 5, { name: 'Объём', isActive: true })

    expect(calls[0]!.url).toBe('/api/gear/admin/types/2/attributes/5')
    expect(calls[0]!.init.method).toBe('PATCH')
    expect(bodyOf(0)).toEqual({ name: 'Объём', isActive: true })
  })

  it('архив характеристики — DELETE по той же паре', async () => {
    const { calls } = mockFetch(null, 204)

    await expect(archiveGearTypeAttribute(2, 5)).resolves.toBeUndefined()

    expect(calls[0]!.url).toBe('/api/gear/admin/types/2/attributes/5')
    expect(calls[0]!.init.method).toBe('DELETE')
  })

  it('вариант списка создаётся по тройке «тип — характеристика — варианты»', async () => {
    const { calls, bodyOf } = mockFetch(
      { id: 7, code: 'thread', name: 'резьбовой', sortOrder: 10, isActive: true },
      201,
    )

    await createGearAttributeOption(2, 5, {
      code: 'thread',
      name: 'резьбовой',
      sortOrder: 10,
    })

    expect(calls[0]!.url).toBe('/api/gear/admin/types/2/attributes/5/options')
    expect(calls[0]!.init.method).toBe('POST')
    expect(bodyOf(0)).toEqual({
      code: 'thread',
      name: 'резьбовой',
      sortOrder: 10,
    })
  })

  it('правка варианта — PATCH по его id внутри характеристики', async () => {
    const { calls, bodyOf } = mockFetch({
      id: 7,
      code: 'thread',
      name: 'резьбовое',
      sortOrder: 10,
      isActive: true,
    })

    await updateGearAttributeOption(2, 5, 7, { name: 'резьбовое', isActive: true })

    expect(calls[0]!.url).toBe('/api/gear/admin/types/2/attributes/5/options/7')
    expect(calls[0]!.init.method).toBe('PATCH')
    expect(bodyOf(0)).toEqual({ name: 'резьбовое', isActive: true })
  })

  it('архив варианта — DELETE по той же тройке', async () => {
    const { calls } = mockFetch(null, 204)

    await expect(archiveGearAttributeOption(2, 5, 7)).resolves.toBeUndefined()

    expect(calls[0]!.url).toBe('/api/gear/admin/types/2/attributes/5/options/7')
    expect(calls[0]!.init.method).toBe('DELETE')
  })

  it('характеристика-список создаётся вместе с вариантами', async () => {
    const { calls, bodyOf } = mockFetch(
      { ...tent.attributes[0], valueKind: 'select', options: [] },
      201,
    )

    await createGearTypeAttribute(2, {
      code: 'connection',
      name: 'Соединение',
      valueKind: 'select',
      allowCustomValue: true,
      options: [{ code: 'thread', name: 'резьбовой' }],
    })

    expect(bodyOf(0)).toEqual({
      code: 'connection',
      name: 'Соединение',
      valueKind: 'select',
      allowCustomValue: true,
      options: [{ code: 'thread', name: 'резьбовой' }],
    })
  })

  it('403 от сервера приходит ApiError с сообщением бэкенда', async () => {
    mockFetch({ message: 'Раздел только для администратора' }, 403)

    await expect(fetchAdminGearTypes()).rejects.toMatchObject({
      status: 403,
      message: 'Раздел только для администратора',
    })
  })
})
