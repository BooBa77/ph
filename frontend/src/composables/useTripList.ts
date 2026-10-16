import { computed, ref } from 'vue'

import { listTrips } from '@/api/trips'
import type { Trip, TripListQuery } from '@/types/trips'

/**
 * Загрузка страницы ленты походов с «показать ещё».
 *
 * Логика одна на две страницы раздела: «Мои походы» (`mine: true`) и
 * «Анонсы» (`mine: false`). Различий между ними ровно одно — фильтр,
 * и копия этого кода разошлась бы на первой же правке: в одном месте
 * появилась бы защита от гонки запросов, в другом нет.
 *
 * **Запрос описывается функцией, а не объектом.** У «Анонсов» фильтры
 * меняются, и запрос обязан собираться в момент вызова, а не один раз
 * при создании композабла.
 */
export function useTripList(query: () => TripListQuery, pageSize = 20) {
  const trips = ref<Trip[]>([])
  const total = ref(0)
  const isLoading = ref(true)
  const isLoadingMore = ref(false)
  const error = ref<string | null>(null)

  /**
   * Номер последнего запроса.
   *
   * Фильтры меняются быстро, и ответы приходят не в том порядке, в каком
   * ушли. Ответ на устаревший запрос не проходит проверку и не подменяет
   * список: иначе на экране оказались бы походы от прежнего набора условий.
   */
  let requestId = 0

  /** Сколько ещё осталось — по этому числу решаем, показывать ли «ещё». */
  const remaining = computed(() => Math.max(total.value - trips.value.length, 0))

  /**
   * Загрузить первую страницу (`reset`) или следующую.
   *
   * Доклеивать страницы к прежним фильтрам нельзя: в списке оказались бы
   * походы, под новые условия не подходящие. Поэтому смена фильтров —
   * это всегда `reset`.
   */
  async function load(reset = true) {
    const id = ++requestId
    const offset = reset ? 0 : trips.value.length

    if (reset) {
      isLoading.value = true
    } else {
      isLoadingMore.value = true
    }
    error.value = null

    try {
      const response = await listTrips({ ...query(), limit: pageSize, offset })
      if (id !== requestId) return

      trips.value = reset ? response.trips : [...trips.value, ...response.trips]
      total.value = response.total
    } catch {
      if (id !== requestId) return

      error.value = 'Не удалось загрузить походы'
      // При «показать ещё» уже загруженное не выбрасываем: часть списка
      // на экране лучше, чем пустота после неудачной догрузки.
      if (reset) {
        trips.value = []
        total.value = 0
      }
    } finally {
      if (id === requestId) {
        isLoading.value = false
        isLoadingMore.value = false
      }
    }
  }

  return {
    trips,
    total,
    isLoading,
    isLoadingMore,
    error,
    remaining,
    load,
    loadMore: () => load(false),
  }
}
