<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useAppStore } from '@/stores/app'

/**
 * Сезонный фон за содержимым страницы.
 *
 * Осень — падающие листья. Замысел: оформление должно ощущаться, а не
 * мешать, поэтому слой лежит ПОД содержимым (z-index: -1), не ловит
 * клики (pointer-events: none) и скрыт от скринридеров (aria-hidden):
 * это украшение, а не информация.
 *
 * Как сделано:
 *   - формы и траектории — CSS-анимации, JS только раздаёт случайные
 *     параметры в CSS-переменные. Анимировать в JS каждый кадр было бы
 *     и дороже, и хуже: браузер умеет крутить transform на композиторе,
 *     не трогая главный поток;
 *   - параметры (позиция, скорость, задержка, размер, амплитуда качания)
 *     считаются один раз при монтировании. Отрицательная задержка
 *     запускает анимацию «с середины», поэтому листья видны сразу,
 *     а не сыплются все одновременно с нуля;
 *   - качание и вращение — на внутреннем элементе, падение — на внешнем.
 *     Две анимации не могут делить одно свойство transform, поэтому
 *     transform'ов ровно столько, сколько анимаций.
 *
 * Разметка пустая до монтирования: случайные значения на сервере и в
 * браузере разошлись бы, а при пустом начальном состоянии расхождению
 * взяться неоткуда.
 */

interface Leaf {
  /** Позиция по горизонтали, % ширины экрана. */
  left: number
  /** Сколько летит сверху донизу, секунды. */
  duration: number
  /** Отрицательная задержка — лист стартует «уже в пути». */
  delay: number
  /** Размер, rem. */
  size: number
  /** Амплитуда качания, px. */
  sway: number
  /** Скорость вращения вокруг своей оси, секунды на оборот. */
  spin: number
  /** Направление вращения: 1 или -1. */
  direction: 1 | -1
  /** Цвет из осенней палитры. */
  color: string
}

/** Осенняя палитра — приглушённая, чтобы фон не спорил с текстом. */
const AUTUMN_COLORS = [
  '#c4421a', // клён
  '#d97b2b', // охра
  '#a8621a', // кора
  '#8f4b1f', // тёмная медь
  '#c9a227', // жёлтый лист
]

/** Сколько листьев. На узком экране меньше: и места меньше, и батарея. */
function leafCount(): number {
  if (typeof window === 'undefined') return 0
  return window.innerWidth < 640 ? 8 : 14
}

function makeLeaves(): Leaf[] {
  return Array.from({ length: leafCount() }, () => ({
    left: Math.random() * 100,
    duration: 9 + Math.random() * 8,
    delay: -Math.random() * 12,
    size: 0.7 + Math.random() * 0.7,
    sway: 18 + Math.random() * 42,
    spin: 4 + Math.random() * 6,
    direction: Math.random() < 0.5 ? -1 : 1,
    color:
      AUTUMN_COLORS[Math.floor(Math.random() * AUTUMN_COLORS.length)] ??
      AUTUMN_COLORS[0]!,
  }))
}

const appStore = useAppStore()
const leaves = ref<Leaf[]>([])

onMounted(() => {
  leaves.value = makeLeaves()
})

/** Слой показываем только осенью: у зимы, весны и лета свой декор (пока нет). */
const isAutumn = computed(() => appStore.currentTheme === 4)
</script>

<template>
  <div
    v-if="isAutumn"
    class="season-decor pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    aria-hidden="true"
  >
    <span
      v-for="(leaf, index) in leaves"
      :key="index"
      class="season-decor__leaf"
      :style="{
        '--left': `${leaf.left}%`,
        '--duration': `${leaf.duration}s`,
        '--delay': `${leaf.delay}s`,
        '--size': `${leaf.size}rem`,
        '--sway': `${leaf.sway}px`,
        '--spin': `${leaf.spin}s`,
        '--direction': String(leaf.direction),
        '--color': leaf.color,
      }"
    >
      <svg viewBox="0 0 24 24" fill="currentColor">
        <!--
          Простой лист с прожилками. Одна форма на все размеры: на 14–24 px
          детали всё равно не читаются, а разница в силуэте между клёном
          и берёзой в этом масштабе не видна.
        -->
        <path
          d="M12 2c3.6 2.4 6.4 5.6 6.4 9.2 0 3.4-2.4 6.2-5.4 7.4V22a.9.9 0 0 1-1.8 0v-3.4C8.2 17.4 5.8 14.6 5.8 11.2 5.8 7.6 8.6 4.4 12 2Z"
        />
        <path
          d="M12 4v14M12 9l3.2-2.2M12 9 8.8 6.8M12 13.5l3.4-2.4M12 13.5l-3.4-2.4"
          stroke="rgba(0,0,0,.18)"
          stroke-width="1"
          fill="none"
        />
      </svg>
    </span>
  </div>
</template>

<style scoped>
/*
  Падение — на внешнем элементе. translate3d вместо translateY: браузер
  уводит анимацию на композитор, и она не заставляет перерисовывать
  страницу на каждом кадре.
*/
.season-decor__leaf {
  position: absolute;
  top: -8vh;
  left: var(--left);
  width: var(--size);
  height: var(--size);
  color: var(--color);
  will-change: transform;
  animation: leaf-fall var(--duration) linear var(--delay) infinite;
}

.season-decor__leaf svg {
  display: block;
  width: 100%;
  height: 100%;
  /* Качание и вращение — на самом SVG: у внешнего элемента transform
     уже занят падением, а два transform'а на одном элементе не уживаются. */
  animation:
    leaf-sway calc(var(--duration) / 4) ease-in-out var(--delay) infinite alternate,
    leaf-spin var(--spin) linear var(--delay) infinite;
  transform-origin: 50% 45%;
}

@keyframes leaf-fall {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(0, 108vh, 0);
  }
}

@keyframes leaf-sway {
  from {
    margin-left: calc(var(--sway) / -2);
  }
  to {
    margin-left: calc(var(--sway) / 2);
  }
}

@keyframes leaf-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(calc(360deg * var(--direction)));
  }
}

/*
  Просьба «меньше движения» в системе — уважаем: убираем падение целиком,
  оставляя слой пустым. Анимация фона не стоит того, чтобы провоцировать
  укачивание и головокружение у тех, кто об этом попросил.
*/
@media (prefers-reduced-motion: reduce) {
  .season-decor {
    display: none;
  }
}
</style>
