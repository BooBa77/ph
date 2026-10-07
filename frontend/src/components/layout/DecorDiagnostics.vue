<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { usePreferencesStore } from '@/stores/preferences'

const preferences = usePreferencesStore()

/**
 * Диагностика сезонного оформления. Показывается только по `?diag`
 * в адресе.
 *
 * Зачем в проекте: декор у меня работает, а у пользователя его не видно
 * — и разница в окружениях мне недоступна. Спрашивать «откройте DevTools
 * и посмотрите computed styles» — плохой путь: долго, и легко перепутать.
 * Экран показывает те же факты, что я снимал бы сам: сколько листьев
 * в DOM, сколько попадает в окно, идёт ли анимация, видит ли браузер
 * уменьшенное движение. Пользователь делает скриншот — и вопрос закрыт.
 */
const show = ref(false)

const facts = ref<Record<string, unknown>>({})

/** Снять текущие факты о слое декора. */
function collect() {
  const decor = document.querySelector('.season-decor') as HTMLElement | null
  const leaves = [...document.querySelectorAll<HTMLElement>('.season-decor__leaf')]

  const rects = leaves.map((leaf) => leaf.getBoundingClientRect())

  // Вычисленные стили первого листа. Это ключевая часть: если анимация
  // не применилась, здесь будет «none», и сразу видно, что дело в CSS,
  // а не в позициях. Именно такого факта мне не хватало, когда я гадал.
  const first = leaves[0]
  const firstStyle = first ? getComputedStyle(first) : null
  const firstSvgStyle = first?.querySelector('svg')
    ? getComputedStyle(first.querySelector('svg')!)
    : null

  facts.value = {
    адрес: location.pathname + location.search,
    сезон: document.documentElement.getAttribute('data-theme'),
    /**
     * Когда тема ставилась в последний раз.
     *
     * Пустое значение — тема не ставилась вовсе: значит атрибут на <html>
     * пропал, и браузер показывает дефолтную палитру из themes.css,
     * а это зима. Ровно этим объяснялась жалоба «после выхода наступает
     * зима», и эту строку я добавил, чтобы отличать «тема потерялась»
     * от «тема поставилась, но не та».
     */
    'тема поставлена': document.documentElement.getAttribute('data-theme-init') ?? 'НЕ СТАВИЛАСЬ',
    'элемент .season-decor': decor ? 'есть' : 'НЕТ',
    'класс слоя': decor?.className ?? '—',
    'листьев в DOM': leaves.length,
    'листьев в окне': rects.filter((r) => r.bottom > 0 && r.top < window.innerHeight)
      .length,
    'z-index слоя': decor ? getComputedStyle(decor).zIndex : '—',
    'display слоя': decor ? getComputedStyle(decor).display : '—',
    'opacity слоя': decor ? getComputedStyle(decor).opacity : '—',
    'окно, px': `${window.innerWidth}×${window.innerHeight}`,
    'анимация в настройках': preferences.seasonAnimations ? 'включена' : 'выключена',
    '1-й лист: анимация': firstStyle?.animationName ?? '—',
    '1-й лист: длительность': firstStyle?.animationDuration ?? '—',
    '1-й лист: задержка': firstStyle?.animationDelay ?? '—',
    '1-й лист: transform': firstStyle?.transform ?? '—',
    '1-й лист: opacity': firstSvgStyle?.opacity ?? '—',
    '1-й лист: animation (svg)': firstSvgStyle?.animationName ?? '—',
    '1-й лист: anim-объектов': first?.getAnimations?.().length ?? 0,
    'всего anim-объектов': leaves.reduce(
      (sum, leaf) => sum + (leaf.getAnimations?.().length ?? 0),
      0,
    ),
    'prefers-reduced-motion': window.matchMedia?.('(prefers-reduced-motion: reduce)')
      .matches
      ? 'reduce (игнорируем)'
      : 'no-preference',
    'позиции первых листьев': rects
      .slice(0, 5)
      .map((r) => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}px`)
      .join(' | '),
  }
}

onMounted(() => {
  show.value = new URLSearchParams(location.search).has('diag')
})

/**
 * Снимаем факты ПОСЛЕ отрисовки, а не в onMounted.
 *
 * На этом панель уже один раз попалась: листья появляются только после
 * того, как Vue отрисует список (`leaves` заполняется в onMounted
 * самого декора), и замер в своём onMounted показывал ноль при живых
 * листьях в DOM. `flush: 'post'` гарантирует, что DOM уже обновлён.
 *
 * Следим и за настройкой анимации: переключение меняет классы, и факты
 * должны обновиться.
 */
watch(
  [show, () => preferences.seasonAnimations],
  () => {
    if (show.value) collect()
  },
  { flush: 'post' },
)

/**
 * И за появлением листьев: у декора свой порядок монтирования, и его
 * список может заполниться позже нашей панели.
 */
watch(
  () => document.querySelectorAll('.season-decor__leaf').length,
  () => {
    if (show.value) collect()
  },
  { flush: 'post' },
)

/** Пересобираем факты и при смене размера окна: позиции зависят от высоты. */
function onResize() {
  if (show.value) collect()
}

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

/** Панель не должна мешать кликам по интерфейсу под ней. */
const rows = computed(() => Object.entries(facts.value))
</script>

<template>
  <div
    v-if="show"
    class="fixed top-2 left-2 z-[100] max-w-[92vw] rounded-lg border border-border bg-surface/95 p-3 font-mono text-[11px] leading-snug text-text shadow-xl"
  >
    <div class="mb-2 flex items-center gap-2">
      <strong>Диагностика декора</strong>
      <button
        type="button"
        class="cursor-pointer rounded border border-border px-2 py-0.5"
        @click="collect"
      >
        Обновить
      </button>
      <button
        type="button"
        class="cursor-pointer rounded border border-border px-2 py-0.5"
        @click="preferences.toggleSeasonAnimations()"
      >
        Анимация: {{ preferences.seasonAnimations ? 'вкл' : 'выкл' }}
      </button>
      <button
        type="button"
        class="cursor-pointer rounded border border-border px-2 py-0.5"
        @click="show = false"
      >
        Скрыть
      </button>
    </div>

    <div v-for="[key, value] in rows" :key="key" class="whitespace-nowrap">
      {{ key }}: <span class="text-primary">{{ value }}</span>
    </div>
  </div>
</template>
