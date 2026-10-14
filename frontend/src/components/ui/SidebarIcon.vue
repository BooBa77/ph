<script setup lang="ts">
/**
 * Иконки бокового меню личного кабинета.
 *
 * Вектором и через `currentColor`, а не картинками: иконки должны
 * перекрашиваться вместе с темой (активный пункт — акцентным цветом),
 * а картинка в <img> цвет текста не наследует.
 *
 * Размер задаёт вызывающий через CSS: у иконки `width/height` в 100%
 * от родителя, поэтому одна и та же иконка годится и для пункта меню,
 * и для кнопки помельче.
 *
 * Форма — единый источник: `name` перечисляет допустимые значения,
 * опечатка в имени станет ошибкой типов, а не пустым местом в меню.
 */
defineProps<{
  name: 'profile' | 'sport' | 'calendar' | 'settings' | 'install' | 'logout' | 'home'
}>()
</script>

<template>
  <svg
    class="h-full w-full"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- Профиль: силуэт человека -->
    <template v-if="name === 'profile'">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
    </template>

    <!-- Календарь: лист с двумя кольцами. Один в один с «Сессиями» его
         не спутать — там два устройства, здесь рамка с шапкой -->
    <template v-else-if="name === 'calendar'">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4M16 3v4" />
    </template>

    <!-- Спортивный опыт: вершина с флажком на пути -->
    <template v-else-if="name === 'sport'">
      <path d="M3 20h18" />
      <path d="M5 20l6-12 4 8" />
      <path d="M15 20l3-4 3 4" />
    </template>

    <!-- Настройки: ползунки. Шестерёнка на 20 px превращается в кашу,
         а ползунки читаются в любом размере -->
    <template v-else-if="name === 'settings'">
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </template>

    <!-- Вынести ярлык: стрелка вниз в лоток -->
    <template v-else-if="name === 'install'">
      <path d="M12 3v11" />
      <path d="M8 10l4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </template>

    <!-- Выйти: стрелка из двери -->
    <template v-else-if="name === 'logout'">
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5" />
      <path d="M5 12h10" />
    </template>

    <!-- Дом: домик -->
    <template v-else>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" />
    </template>
  </svg>
</template>
