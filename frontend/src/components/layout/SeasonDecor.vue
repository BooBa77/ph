<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

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
  /**
   * Отрицательная задержка — лист стартует «уже в пути».
   *
   * Считается так, чтобы к первому кадру листья были разбросаны по всей
   * высоте экрана: иначе первые секунды экран пустой и включается «дождь
   * пошёл», а нужно ощущение, что листопад шёл всегда. Именно поэтому
   * казалось, что листьев нет: на шестой секунде успевали появиться три
   * штуки у верхней кромки.
   *
   * Стартовое положение задаётся не только задержкой, но и `--top`:
   * задержка разбрасывает листья по высоте, но точка, откуда начинается
   * отсчёт, у всех одна — над экраном. Без `--top` на широком мониторе
   * листья успевают пролететь одинаковые участки и идут «волной».
   */
  delay: number
  /** Стартовое смещение вниз от верхней кромки, vh. */
  top: number
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
  /** Прозрачность: дальние листья бледнее. */
  opacity: number
  /** Размытие, px: то же, что и прозрачность, — про глубину. */
  blur: number
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
  return window.innerWidth < 640 ? 10 : 18
}

function makeLeaves(): Leaf[] {
  return Array.from({ length: leafCount() }, () => {
    const duration = 9 + Math.random() * 8

    // «Дальние» листья: мельче, бледнее, размытее — даёт глубину,
    // из-за которой листопад читается как объём, а не как наклейки
    // на стекле.
    const isFar = Math.random() < 0.45

    return {
      left: Math.random() * 100,
      duration,
      delay: -Math.random() * duration,
      top: Math.random() * 100,
      size: isFar ? 0.7 + Math.random() * 0.4 : 1 + Math.random() * 0.8,
      sway: 18 + Math.random() * 42,
      spin: 4 + Math.random() * 6,
      direction: Math.random() < 0.5 ? -1 : 1,
      color:
        AUTUMN_COLORS[Math.floor(Math.random() * AUTUMN_COLORS.length)] ??
        AUTUMN_COLORS[0]!,
      opacity: isFar ? 0.28 + Math.random() * 0.18 : 0.45 + Math.random() * 0.2,
      blur: isFar ? 1.2 : 0,
    }
  })
}

const appStore = useAppStore()
const leaves = ref<Leaf[]>([])

/**
 * В системе просят меньше движения.
 *
 * Раньше я в этом случае просто прятал слой — и это была ошибка:
 * на машине с включённым «уменьшить движение» сезонное оформление
 * пропадало целиком, что выглядит как «листьев нет», а не как забота
 * о самочувствии. Правильнее оставить оформление, убрав движение:
 * листья висят на месте и медленно проявляются.
 */
const reduceMotion = ref(false)
let motionQuery: MediaQueryList | null = null

function applyMotionPreference(event: MediaQueryList | MediaQueryListEvent) {
  reduceMotion.value = event.matches
}

onMounted(() => {
  leaves.value = makeLeaves()

  if (typeof window.matchMedia === 'function') {
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    applyMotionPreference(motionQuery)
    motionQuery.addEventListener('change', applyMotionPreference)
  }
})

onBeforeUnmount(() => {
  motionQuery?.removeEventListener('change', applyMotionPreference)
})

/** Слой показываем только осенью: у зимы, весны и лета свой декор (пока нет). */
const isAutumn = computed(() => appStore.currentTheme === 4)
</script>

<template>
  <div
    v-if="isAutumn"
    class="season-decor pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    :class="{ 'season-decor--calm': reduceMotion }"
    aria-hidden="true"
  >
    <span
      v-for="(leaf, index) in leaves"
      :key="index"
      class="season-decor__leaf"
      :style="{
        '--left': `${leaf.left}%`,
        /*
          Стартовое положение задаём через bottom, а не через top+calc:
          так оно не зависит от того, как браузер посчитает calc от
          переменной. Лист стоит на `top + 8vh` выше верхней кромки
          (bottom: calc(100% + 8vh) при top: 0), дальше анимация ведёт
          его на 108vh вниз.
        */
        bottom: `calc(100% + 8vh - ${leaf.top}vh)`,
        '--duration': `${leaf.duration}s`,
        '--delay': `${leaf.delay}s`,
        '--size': `${leaf.size}rem`,
        '--sway': `${leaf.sway}px`,
        '--spin': `${leaf.spin}s`,
        '--direction': String(leaf.direction),
        '--color': leaf.color,
        '--opacity': String(leaf.opacity),
        '--blur': `${leaf.blur}px`,
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

<!--
  Стили НЕ scoped — и это осознанно.

  scoped добавляет данным атрибут, а к ключевым кадрам @keyframes — суффикс,
  и ссылка на анимацию в свойстве `animation` ломается: анимация просто
  не запускается, листья остаются висеть за верхней кромкой экрана.
  Именно на это я и купился в первой версии: тесты проходили (jsdom не
  считает стили), а в браузере листьев не было видно.

  Вместо scoped — префикс `season-decor` во всех селекторах: имена
  уникальные, конфликтов с другими компонентами не будет.
-->
<style>
.season-decor__leaf {
  /*
    Стартовое положение — своё у каждого листа, задано inline через
    bottom: `top + 8vh` выше верхней кромки. Анимация падения ведёт
    лист на 108vh вниз, а отрицательная задержка ставит его в середину
    пути: к первому кадру листья уже разбросаны по всему экрану.
  */
  position: absolute;
  left: var(--left);
  width: var(--size);
  height: var(--size);
  color: var(--color);
  will-change: transform;
  animation: season-leaf-fall var(--duration) linear var(--delay) infinite;
}

.season-decor__leaf svg {
  display: block;
  width: 100%;
  height: 100%;
  /* Прозрачность и размытие — на самой картинке, а не на обёртке:
     filter на обёртке заставил бы браузер держать лишний слой. */
  opacity: var(--opacity);
  filter: blur(var(--blur));
  /* Качание и вращение — здесь: у внешнего элемента transform уже занят
     падением, а два transform'а на одном элементе не уживаются. */
  animation:
    season-leaf-sway calc(var(--duration) / 4) ease-in-out var(--delay) infinite alternate,
    season-leaf-spin var(--spin) linear var(--delay) infinite;
  transform-origin: 50% 45%;
}

@keyframes season-leaf-fall {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(0, 108vh, 0);
  }
}

/*
  Качание — через margin-left, а не через transform: transform у этого
  элемента занят вращением, и вторая анимация его бы затирала.
  Отрицательный / положительный отступ считаются от центра, потому что
  left задан в процентах и элемент позиционирован по левому краю.
*/
@keyframes season-leaf-sway {
  from {
    margin-left: calc(var(--sway) / -2);
  }
  to {
    margin-left: calc(var(--sway) / 2);
  }
}

@keyframes season-leaf-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(calc(360deg * var(--direction)));
  }
}

/*
  Просьба «меньше движения» в системе — уважаем: убираем слой целиком.
  Анимация фона не стоит того, чтобы провоцировать укачивание.
*/
/*
  Просьба «меньше движения» в системе — уважаем, но оформление оставляем.
  Раньше слой просто исчезал, и это выглядело как поломка: сезонного
  декора нет, хотя он должен быть. Теперь листья висят на своих местах
  и медленно проявляются: движение убрано, сезон остался.

  Падение и вращение отключаем совсем, вместо них — мягкое мерцание
  прозрачности. Смещения сюда не добавляем намеренно: любое перемещение
  и есть то, о чём просили не делать.
*/
.season-decor--calm .season-decor__leaf {
  animation: season-leaf-calm 9s ease-in-out var(--delay) infinite alternate;
}

.season-decor--calm .season-decor__leaf svg {
  animation: none;
}

@keyframes season-leaf-calm {
  from {
    opacity: 0.15;
  }
  to {
    opacity: 0.7;
  }
}
</style>
