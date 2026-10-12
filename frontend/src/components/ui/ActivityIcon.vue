<script setup lang="ts">
import { computed } from 'vue'

import {
  ICON_STROKE_WIDTH,
  ICON_VIEWBOX,
  activityIconShapes,
} from '@/assets/activity-icons'

/**
 * Иконка активности: линии цветом, который задал родитель.
 *
 * Набор — Tabler Icons (MIT), он нарисован под толщину 2 при сетке 24×24,
 * поэтому здесь именно 2: с другой толщиной фирменные скругления и просветы
 * перестают читаться.
 *
 * Заливка живёт не здесь, а в клетке календаря: цвет группы закрашивает
 * область дня, а иконка рисуется поверх — светлой или тёмной, смотря что
 * читается на этом цвете (см. `contrastTextColor` в странице календаря).
 *
 * Компонент декоративный: `aria-hidden` обязателен. Без него скринридер
 * прочитает содержимое иконки внутри кнопки дня поверх подписи самой клетки,
 * а названия активностей мы и так кладём в `aria-label` клетки словами.
 */
const props = defineProps<{
  /** Ключ иконки из `calendar_activity_types.icon`. */
  name: string
}>()

const shapes = computed(() => activityIconShapes(props.name))

/**
 * Сетка и толщина линии.
 *
 * Иконки из набора Tabler нарисованы в 24×24 с линией 2, собственные
 * рисунки — в своей сетке (64×64 с линией 2.5). Координаты не пересчитываем:
 * чужой готовый SVG кладётся в проект как есть, а сетку с толщиной
 * подставляет компонент.
 */
const viewBox = computed(() => ICON_VIEWBOX[props.name] ?? '0 0 24 24')
const strokeWidth = computed(() => ICON_STROKE_WIDTH[props.name] ?? 2)
</script>

<template>
  <svg
    :viewBox="viewBox"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="h-full w-full"
    aria-hidden="true"
    focusable="false"
    draggable="false"
  >
    <!-- Фигуры рисуем прямо здесь: их до пяти на иконку, и отдельный слой
         со спрайтом и <use> тут ничего не сэкономит, а отладку усложнит. -->
    <template v-for="(shape, index) in shapes" :key="index">
      <path v-if="shape.kind === 'path'" :d="shape.d" />
      <circle v-else-if="shape.kind === 'circle'" :cx="shape.cx" :cy="shape.cy" :r="shape.r" />
      <line v-else :x1="shape.x1" :y1="shape.y1" :x2="shape.x2" :y2="shape.y2" />
    </template>
  </svg>
</template>
