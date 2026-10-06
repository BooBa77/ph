<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useAppStore } from '@/stores/app'
import { usePreferencesStore } from '@/stores/preferences'

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
 *
 * Про «меньше движения»: системную настройку `prefers-reduced-motion`
 * здесь НЕ слушаем. Раньше слушали и прятали слой — на машине, где
 * анимации выключены в системе (Chrome наследует это из настроек
 * Windows), сезонного оформления не было вовсе, и выглядело это как
 * поломка. Отключение теперь своё: переключатель в настройках кабинета
 * (`usePreferencesStore`), по умолчанию анимация включена.
 */

interface Leaf {
  /** Позиция по горизонтали, % ширины экрана. */
  left: number
  /**
   * Стартовое смещение вниз от верхней кромки, vh.
   *
   * Нужно вместе с отрицательной задержкой: задержка разбрасывает листья
   * по высоте, но точка отсчёта у всех одна — над экраном. Без `top`
   * первые секунды экран пустой, а потом листья идут волной сверху.
   */
  top: number
  /** Сколько летит сверху донизу, секунды. */
  duration: number
  /** Отрицательная задержка — лист стартует «уже в пути». */
  delay: number
  /** Размер, rem. */
  size: number
  /** Амплитуда качания, px. */
  sway: number
  /**
   * Оборотов вокруг своей оси за один прогон.
   *
   * В оборотах, а не в секундах на оборот: скорость падения уже задана
   * переменной `--duration`, и при её изменении вращение не должно
   * уезжать — иначе лист начинает крутиться как пропеллер.
   */
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
    // Скорость: 45–90 секунд на полный прогон. Первая версия летела за
    // 9–17 секунд — по отзыву «раз в пять быстрее, чем надо»; медленное
    // падение читается как листопад, быстрое — как помехи на экране.
    // Считаем внутри цикла: у каждого листа своя скорость, иначе они
    // летят синхронно и картинка выглядит механической.
    const duration = 45 + Math.random() * 45

    // «Дальние» листья: мельче, бледнее, размытее — даёт глубину,
    // из-за которой листопад читается как объём, а не как наклейки
    // на стекле.
    const isFar = Math.random() < 0.45

    return {
      left: Math.random() * 100,
      top: Math.random() * 100,
      duration,
      // Разброс по всей высоте: см. комментарий к полю delay.
      delay: -Math.random() * duration,
      size: isFar ? 0.7 + Math.random() * 0.4 : 1 + Math.random() * 0.8,
      sway: 18 + Math.random() * 42,
      // Вращение — «в оборотах за прогон», а не в секундах: при смене
      // скорости падения лист не должен начать крутиться как пропеллер.
      spin: 0.5 + Math.random() * 1.5,
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
const preferences = usePreferencesStore()
const leaves = ref<Leaf[]>([])

/**
 * Высота окна — для расстояния падения.
 *
 * В CSS это значение подставляется переменной, а не пишется как `108vh`
 * в самих ключевых кадрах. Причина: `vh` внутри `@keyframes` считаются
 * не от окна, а от содержащего блока, и у `position: fixed` это давало
 * падение всего на пятую часть экрана. Проверено замером: при окне
 * 924 px лист пролетал 180 px.
 */
const fallDistance = ref('100vh')

onMounted(() => {
  leaves.value = makeLeaves()
  applyFallDistance()

  // Пересчитываем при смене размера: значение в пикселях, а не в vh.
  window.addEventListener('resize', applyFallDistance)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', applyFallDistance)
})

function applyFallDistance() {
  fallDistance.value = `${window.innerHeight + 160}px`
}

/** Слой показываем только осенью: у зимы, весны и лета свой декор (пока нет). */
const isAutumn = computed(() => appStore.currentTheme === 4)

/**
 * Анимация выключена пользователем: листья остаются, но висят на месте
 * и медленно мерцают. Оформление не исчезает — исчезает движение.
 */
const isStatic = computed(() => !preferences.seasonAnimations)
</script>

<template>
  <div
    v-if="isAutumn"
    class="season-decor pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    :class="{ 'season-decor--static': isStatic }"
    :style="{ '--fall': fallDistance }"
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
        /* Вращение: время на один оборот — из числа оборотов за прогон. */
        '--spin-duration': `${leaf.duration / leaf.spin}s`,
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
    season-leaf-spin var(--spin-duration) linear var(--delay) infinite;
  transform-origin: 50% 45%;
}

/*
  Расстояние падения приходит переменной `--fall` (её ставит JS по высоте
  окна). Написать здесь `108vh` нельзя: `vh` внутри @keyframes считаются
  от содержащего блока, а не от окна, и у position: fixed это давало
  смещение на пятую часть экрана вместо полной высоты.
*/
@keyframes season-leaf-fall {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(0, var(--fall), 0);
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
  Анимация выключена в настройках: листья висят на своих местах
  и медленно мерцают. Движение убрано, оформление осталось.

  Падение и вращение отключаем совсем, вместо них — мягкое изменение
  прозрачности. Смещения сюда не добавляем намеренно: любое перемещение
  и есть то, что просили выключить.
*/
.season-decor--static .season-decor__leaf {
  animation: season-leaf-calm 9s ease-in-out var(--delay) infinite alternate;
}

.season-decor--static .season-decor__leaf svg {
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
