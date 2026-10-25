<script setup lang="ts">
import { computed } from 'vue'

import SidebarIcon from '@/components/ui/SidebarIcon.vue'
import type { TripTabCode } from '@/types/trips'

/**
 * Иконки вкладок похода.
 *
 * Пять вкладок из десяти показывают те же рисунки, что и боковое меню
 * (домик, контакты, медаль, котелок, рюкзак), поэтому они не дублируются
 * здесь, а делегируются в `SidebarIcon`: две разные «Гостевые» с разными
 * домиками — это ровно та мелочь, из-за которой набор рассыпается.
 *
 * Остальные пять нарисованы тут: машина, маршрут, аптечка, деньги, дневник.
 *
 * Размер задаёт вызывающий (у svg `h-full w-full`), цвет — `currentColor`,
 * сетка 24 и штрих 2.4 те же, что в меню. Тип имени — `TripTabCode` из
 * `types/trips.ts`: один источник и для подписей, и для иконок.
 */
const props = defineProps<{ name: TripTabCode }>()

/** Вкладки, которые рисует боковое меню: ключ вкладки → ключ иконки меню. */
const SHARED = {
  guest: 'home',
  members: 'people',
  sport: 'sport',
  meals: 'meals',
  gear: 'gear',
} as const

const shared = computed(() => SHARED[props.name as keyof typeof SHARED] ?? null)
</script>

<template>
  <SidebarIcon v-if="shared" :name="shared" />

  <svg
    v-else
    class="h-full w-full"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- Трансфер: машина. Линия окна отделяет кабину от капота,
         без неё корпус читается как чемодан на колёсах -->
    <template v-if="name === 'transfer'">
      <path d="M4 16.4V13.2L5.9 9.9C6.2 9.4 6.7 9.1 7.3 9.1H16.7C17.3 9.1 17.8 9.4 18.1 9.9L20 13.2V16.4" />
      <path d="M4 13.4H20" />
      <circle cx="8" cy="17.4" r="1.6" />
      <circle cx="16" cy="17.4" r="1.6" />
    </template>

    <!--
      Маршрут: две точки и пунктир между ними. Промежуток 3.2 больше штриха
      2.4 намеренно: при круглых концах штрих удлиняется на 1.2 с каждой
      стороны, и при меньшем промежутке пунктир сливается в сплошную линию.
    -->
    <template v-else-if="name === 'route'">
      <circle cx="6" cy="17.5" r="1.7" />
      <circle cx="18" cy="6.5" r="1.7" />
      <path d="M7.7 16.6C12.5 15.2 11 9.6 16.3 7.4" stroke-dasharray="2.4 3.2" />
    </template>

    <!-- Аптечка: чемоданчик с ручкой и крестом -->
    <template v-else-if="name === 'firstAid'">
      <path
        d="M4.84 8.7H19.16C19.91 8.7 20.48 9.47 20.48 10.48V18.08C20.48 19.1 19.91 19.86 19.16 19.86H4.84C4.09 19.86 3.52 19.1 3.52 18.08V10.48C3.52 9.47 4.09 8.7 4.84 8.7Z"
      />
      <path d="M9.55 8.7V6.68C9.55 5.28 10.4 4.14 11.43 4.14H12.57C13.6 4.14 14.45 5.28 14.45 6.68V8.7" />
      <path d="M11.96 11.97V16.54" />
      <path d="M9.76 14.26H14.32" />
    </template>

    <!-- Бухгалтерия: знак доллара. Буква и вертикальная черта — отдельные
         пути: так черта проходит насквозь, как в настоящем знаке -->
    <template v-else-if="name === 'finance'">
      <path d="M15.85 6.62C15.85 4.31 8.15 4.31 8.15 8.15C8.15 12 15.85 11.23 15.85 15.08C15.85 18.92 8.15 18.92 8.15 16.62" />
      <path d="M12 3.54V20.46" />
    </template>

    <!-- Дневник: листок с загнутым углом и двумя строками -->
    <template v-else>
      <path d="M6 4.4H13.6L18 8.8V19.6H6Z" />
      <path d="M13.4 4.4V9H18" />
      <path d="M8.6 12.4H13" />
      <path d="M8.6 15.6H11.6" />
    </template>
  </svg>
</template>
