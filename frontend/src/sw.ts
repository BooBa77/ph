/// <reference lib="webworker" />
/**
 * Service Worker PeakHunter.
 * Собирается Vite (injectManifest), получает список precache-файлов
 * через self.__WB_MANIFEST.
 *
 * Логика обновления:
 * - НЕ вызываем skipWaiting() в install — иначе новая версия активируется сразу,
 *   и пользователь может потерять введённые данные.
 * - Ждём команду { type: 'SKIP_WAITING' } с фронта (её шлёт useSwUpdate,
 *   когда isUserBusy === false).
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

const PRECACHE = 'ph-precache-v1'
const RUNTIME = 'ph-runtime-v1'

// Workbox injectManifest подставляет сюда список ассетов сборки
const precacheManifest = self.__WB_MANIFEST

// Установка: кэшируем precache, но НЕ активируемся немедленно
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => {
      return cache.addAll(
        precacheManifest
          .filter((entry) => entry.url)
          .map((entry) => entry.url)
      )
    })
  )
  // никакого self.skipWaiting() здесь — ждём команду с фронта
})

// Активация: чистим старые кэши, берём контроль над вкладками
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => k !== PRECACHE && k !== RUNTIME)
          .map((k) => caches.delete(k))
      )
      await self.clients.claim()
    })()
  )
})

// Сообщение с фронта: { type: 'SKIP_WAITING' } — активируемся немедленно
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

// Fetch: пока просто «сначала кэш, потом сеть» для статики.
// API не кэшируем — стратегии для него добавим отдельно.
self.addEventListener('fetch', (event) => {
  const request = event.request

  // Пропускаем не-GET и запросы к API — они не должны кэшироваться
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.pathname.startsWith('/api/')) return

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request)
    })
  )
})