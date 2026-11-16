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

const PRECACHE = 'ph-precache-v2'
const RUNTIME = 'ph-runtime-v1'

/**
 * Чем отдаём оболочку приложения, когда сети нет.
 *
 * Порядок: собранный `index.html` из precache, затем корень. Второй вариант
 * нужен на случай, если сборка положила файл под другим ключом (старая
 * версия плагина, ручной precache) — тогда сработает хотя бы `/`.
 */
const NAVIGATION_FALLBACKS = ['/index.html', 'index.html', '/']

// Workbox injectManifest подставляет сюда список ассетов сборки
const precacheManifest = self.__WB_MANIFEST

// Установка: кэшируем precache, но НЕ активируемся немедленно
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => {
      return cache.addAll(precacheManifest.filter((entry) => entry.url).map((entry) => entry.url))
    }),
  )
  // никакого self.skipWaiting() здесь — ждём команду с фронта
})

// Активация: чистим старые кэши, берём контроль над вкладками
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => k !== PRECACHE && k !== RUNTIME).map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

// Сообщение с фронта: { type: 'SKIP_WAITING' } — активируемся немедленно
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

// Fetch: статика — из кеша, переходы по адресам — сеть, при обрыве оболочка.
// API здесь не кешируется: ответы похода хранит приложение в IndexedDB
// (там их можно отдать с погашенными правами и удалить при выходе).
self.addEventListener('fetch', (event) => {
  const request = event.request

  // Пропускаем не-GET и запросы к API — они не должны кэшироваться
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Чужие origin (например, внешние ссылки) не трогаем.
  if (url.origin !== self.location.origin) return

  // API не кешируем: у походных ответов своё хранилище в приложении.
  if (url.pathname.startsWith('/api/')) return

  /*
   * Переход по адресу в офлайне.
   *
   * Без этой ветки открытие `/trips/679` без сети давало сетевую ошибку
   * браузера: в кеше лежит `/index.html`, а не каждый возможный путь.
   * Сначала идём в сеть (за свежей оболочкой), при обрыве отдаём
   * сохранённую — дальше маршрутом занимается приложение.
   */
  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request))
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).catch(() => Response.error())
    }),
  )
})

/** Свежая оболочка из сети; если сети нет — сохранённая. */
async function navigationResponse(request: Request): Promise<Response> {
  try {
    return await fetch(request)
  } catch {
    const cache = await caches.open(PRECACHE)

    for (const fallback of NAVIGATION_FALLBACKS) {
      const cached = await cache.match(fallback)
      if (cached) return cached
    }

    return Response.error()
  }
}
