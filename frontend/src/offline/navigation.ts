/**
 * Куда пускать в офлайне.
 *
 * Правило заказчика: без связи в PWA доступен **только текущий по датам
 * поход**, остальное либо не видно, либо не активно. Здесь — вторая половина
 * правила: если адрес ведёт не туда, человека разворачивает на текущий поход,
 * а если текущего нет — на экран «Нет связи».
 *
 * Функция чистая, чтобы её можно было проверить без роутера и без сети.
 */

import type { RouteLocationRaw } from 'vue-router'

/** Имена маршрутов, которые в офлайне разрешены как есть. */
const ALWAYS_ALLOWED = new Set(['trips-mine', 'offline'])

/**
 * Разрешён ли переход.
 *
 * `tripId` — параметр `:id` для маршрута похода, пустая строка для остальных.
 * `currentTripIds` — походы, которые идут сейчас и сохранены на устройстве.
 */
export function offlineRedirect(
  routeName: unknown,
  tripId: string,
  currentTripIds: readonly string[],
): RouteLocationRaw | null {
  if (typeof routeName === 'string' && ALWAYS_ALLOWED.has(routeName)) return null

  if (routeName === 'trip' && currentTripIds.includes(tripId)) return null

  // Один текущий поход — открываем его: это единственное, что в офлайне
  // имеет смысл смотреть.
  if (currentTripIds.length === 1) {
    return { name: 'trip', params: { id: currentTripIds[0] } }
  }

  // Несколько текущих — «Мои походы» покажет только их (список фильтруется
  // в офлайне), и человек выберет сам.
  if (currentTripIds.length > 1) return { name: 'trips-mine' }

  return { name: 'offline' }
}
