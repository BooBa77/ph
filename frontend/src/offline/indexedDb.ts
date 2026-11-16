/**
 * Тонкая обёртка над IndexedDB для офлайн-режима.
 *
 * Зачем своя, а не `idb`: единственная зависимость фронта — `idb` — тянет
 * установку пакета, а нужны нам три операции: положить, прочитать, удалить.
 * Всё остальное — обещания поверх колбэков, которых здесь двадцать строк.
 *
 * **Хранилище необязательное.** В приватном окне или при запрете хранилища
 * `indexedDB.open` может упасть или зависнуть; приложение обязано работать
 * дальше, просто без кеша. Поэтому все ошибки превращаются в `null`,
 * а не в исключение: офлайн-режим — улучшение, а не условие запуска.
 *
 * Схема (версия 1):
 *   responses — ответы API: ключ `path`, индекс `tripId`;
 *   state     — служебные значения: ключ `key`.
 */

/** Имя базы. Меняется только вместе с версией схемы. */
const DB_NAME = 'ph-offline'

/** Версия схемы. Новая версия — новая ветка в `onupgradeneeded`. */
const DB_VERSION = 1

export const RESPONSES_STORE = 'responses'
export const STATE_STORE = 'state'

export type OfflineStoreName = typeof RESPONSES_STORE | typeof STATE_STORE

let databasePromise: Promise<IDBDatabase | null> | null = null

/** Есть ли в браузере IndexedDB вообще. */
export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

/**
 * Открыть базу. Промис запоминается: открытие одно на жизнь вкладки,
 * а не на каждый запрос.
 */
export function openOfflineDatabase(): Promise<IDBDatabase | null> {
  if (databasePromise) return databasePromise

  if (!isIndexedDbAvailable()) {
    databasePromise = Promise.resolve(null)
    return databasePromise
  }

  databasePromise = new Promise<IDBDatabase | null>((resolve) => {
    let request: IDBOpenDBRequest

    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(RESPONSES_STORE)) {
        const responses = db.createObjectStore(RESPONSES_STORE, { keyPath: 'path' })
        // По индексу удаляем всё, что относилось к походу, который перестал
        // быть текущим: держать в телефоне чужие походы незачем.
        responses.createIndex('tripId', 'tripId', { unique: false })
      }

      if (!db.objectStoreNames.contains(STATE_STORE)) {
        db.createObjectStore(STATE_STORE, { keyPath: 'key' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    // `blocked` бывает, когда в другой вкладке открыта старая версия базы.
    request.onblocked = () => resolve(null)
  })

  return databasePromise
}

/**
 * Выполнить запрос в хранилище и дождаться результата.
 *
 * Возвращает `null` и когда хранилища нет, и когда запрос упал. Различать
 * эти случаи вызывающему коду не нужно: и то и другое значит «кеша нет».
 */
async function runRequest<T>(
  storeName: OfflineStoreName,
  mode: IDBTransactionMode,
  build: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  const db = await openOfflineDatabase()
  if (!db) return null

  return new Promise<T | null>((resolve) => {
    let request: IDBRequest

    try {
      const transaction = db.transaction(storeName, mode)
      const store = transaction.objectStore(storeName)
      request = build(store)
    } catch {
      resolve(null)
      return
    }

    let settled = false

    const finish = (value: T | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    request.onsuccess = () => finish((request.result as T | undefined) ?? null)
    request.onerror = () => finish(null)
  })
}

/** Прочитать запись по ключу. */
export async function getRecord<T>(storeName: OfflineStoreName, key: IDBValidKey): Promise<T | null> {
  return runRequest<T>(storeName, 'readonly', (store) => store.get(key))
}

/** Записать запись (создать или заменить). */
export async function putRecord(storeName: OfflineStoreName, value: unknown): Promise<boolean> {
  const result = await runRequest<IDBValidKey>(storeName, 'readwrite', (store) => store.put(value))
  return result !== null
}

/** Удалить запись по ключу. */
export async function deleteRecord(storeName: OfflineStoreName, key: IDBValidKey): Promise<void> {
  await runRequest<undefined>(storeName, 'readwrite', (store) => store.delete(key))
}

/** Прочитать все записи хранилища. */
export async function getAllRecords<T>(storeName: OfflineStoreName): Promise<T[]> {
  const records = await runRequest<T[]>(storeName, 'readonly', (store) => store.getAll())
  return records ?? []
}

/** Удалить все записи по значению индекса. */
export async function deleteByIndex(
  storeName: OfflineStoreName,
  indexName: string,
  value: IDBValidKey,
): Promise<void> {
  const db = await openOfflineDatabase()
  if (!db) return

  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const index = store.index(indexName)
      const cursorRequest = index.openKeyCursor(IDBKeyRange.only(value))

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (!cursor) return
        store.delete(cursor.primaryKey)
        cursor.continue()
      }

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

/** Очистить хранилище целиком. */
export async function clearStore(storeName: OfflineStoreName): Promise<void> {
  await runRequest<undefined>(storeName, 'readwrite', (store) => store.clear())
}
