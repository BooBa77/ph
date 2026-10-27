// frontend/src/stores/mobileMenu.ts

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/**
 * Какое из двух меню открыто.
 *
 * `site` — разделы сайта (кнопка в шапке), `trip` — вкладки похода (кнопка
 * на странице похода).
 */
export type MobileMenuMode = 'site' | 'trip'

/**
 * Пункт мобильного меню.
 *
 * Два источника пунктов: разделы сайта (ссылки) и вкладки похода (кнопки,
 * которые переключают содержимое, не меняя адрес). Поэтому пункт умеет и
 * `to`, и `onSelect` — что именно делать, решает тот, кто его положил.
 *
 * `available: false` — вкладка есть, но экрана ещё нет (Ф7): в меню она
 * видна и недоступна, чтобы карта похода читалась целиком.
 */
export interface MobileMenuEntry {
  /** Устойчивый ключ: по нему тесты и подсветка отличают пункты. */
  key: string
  label: string
  /** Имя иконки: из набора меню сайта или из набора вкладок похода. */
  icon: string
  iconSet?: 'site' | 'trip'
  /** Ссылка — у разделов сайта. */
  to?: string
  /** Действие — у вкладок похода. */
  onSelect?: () => void
  /** Активный пункт: подсвечивается. */
  active?: boolean
  /** Есть ли экран. У разделов сайта не задаётся — там всегда есть. */
  available?: boolean
}

/** Что страница положила в меню вместо разделов сайта. */
export interface MobileMenuContext {
  title: string
  items: MobileMenuEntry[]
}

/**
 * Состояние мобильных меню-панелей.
 *
 * **Почему отдельный стор, а не props.** Панель открывается кнопкой, а её
 * содержимое для похода даёт страница (`TripView` кладёт вкладки). Кнопки
 * и страница — соседние ветки дерева, и передать вкладки через props значило
 * бы протащить их через `App.vue`. Стор решает это одной записью: страница
 * объявила контекст — его можно открыть; страница ушла и контекст сняла —
 * кнопки вкладок на экране нет.
 *
 * **Два меню — две кнопки.** В шапке всегда разделы сайта, на странице
 * похода — свои вкладки; они не подменяют друг друга.
 */
export const useMobileMenuStore = defineStore('mobileMenu', () => {
  /**
   * Какое меню открыто. `null` — панель закрыта.
   *
   * Меню два, и они больше не подменяют друг друга (решение заказчика
   * 26.10.2026): гамбургер в шапке всегда открывает разделы сайта, а вкладки
   * похода — своя кнопка на странице похода, справа от её заголовка.
   * Раньше одна кнопка открывала то одно, то другое в зависимости от
   * страницы, и на походе нельзя было дотянуться до разделов сайта.
   */
  const mode = ref<MobileMenuMode | null>(null)

  /** Вкладки похода: их кладёт страница похода. */
  const context = ref<MobileMenuContext | null>(null)

  const isOpen = computed(() => mode.value !== null)
  const isSiteOpen = computed(() => mode.value === 'site')
  const isTripOpen = computed(() => mode.value === 'trip')

  /** Открыть разделы сайта (кнопка в шапке). */
  function openSite() {
    mode.value = 'site'
  }

  /** Открыть вкладки похода. Без контекста — нечего показывать. */
  function openTrip() {
    if (!context.value) return
    mode.value = 'trip'
  }

  function close() {
    mode.value = null
  }

  /** Шапка: тот же клик открывает и закрывает разделы сайта. */
  function toggleSite() {
    mode.value = mode.value === 'site' ? null : 'site'
  }

  /** Страница объявляет своё меню (вкладки похода). */
  function setContext(next: MobileMenuContext) {
    context.value = next
  }

  /**
   * Страница ушла: снимаем её пункты.
   *
   * Если в этот момент открыты вкладки похода, панель закрываем — иначе она
   * осталась бы висеть с пунктами покинутого похода.
   */
  function clearContext() {
    context.value = null
    if (mode.value === 'trip') mode.value = null
  }

  return {
    mode,
    context,
    isOpen,
    isSiteOpen,
    isTripOpen,
    openSite,
    openTrip,
    close,
    toggleSite,
    setContext,
    clearContext,
  }
})
