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
  name:
    | 'profile'
    | 'sport'
    | 'calendar'
    | 'settings'
    | 'trips'
    | 'checklist'
    | 'gear'
    | 'meals'
    | 'people'
    | 'install'
    | 'logout'
    | 'home'
    | 'menu'
    | 'close'
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

    <!-- Походы: рюкзак. Вершина уже занята спортивным опытом, а рюкзак
         читается в 20 px и не путается с ним -->
    <template v-else-if="name === 'trips'">
      <path d="M8 8V6a4 4 0 0 1 8 0v2" />
      <rect x="5" y="8" width="14" height="12" rx="2" />
      <path d="M9 13h6" />
    </template>

    <!-- Чек-листы: список с галочками. Три строки и три галочки —
         читается в 20 px, в отличие от «листа с плюсом» -->
    <template v-else-if="name === 'checklist'">
      <path d="M9 6h11" />
      <path d="M9 12h11" />
      <path d="M9 18h11" />
      <path d="M4 6l1.4 1.4L8 5" />
      <path d="M4 12l1.4 1.4L8 11" />
      <path d="M4 18l1.4 1.4L8 17" />
    </template>

    <!-- Снаряжение: палатка. Рюкзак уже занят походами, вершина —
         спортом, поэтому палатка: у неё свой силуэт и она читается
         в 20 px лучше, чем котелок -->
    <template v-else-if="name === 'gear'">
      <path d="M12 4L4 20h16z" />
      <path d="M12 11v9" />
      <path d="M12 11l4 9" />
    </template>

    <!-- Питание: котелок с паром. Кружка читалась бы как «напитки»,
         а котелок — это и есть походная еда -->
    <template v-else-if="name === 'meals'">
      <path d="M4 11h16" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M9 7c0-1 1-1.4 1-2.4" />
      <path d="M14 7c0-1 1-1.4 1-2.4" />
    </template>

    <!-- Контакты: двое людей. Профиль — один силуэт, и два читаются
         как «люди», а не как «мой аккаунт» -->
    <template v-else-if="name === 'people'">
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-2.7 2.7-4.5 6-4.5s6 1.8 6 4.5" />
      <circle cx="17" cy="9" r="2" />
      <path d="M15.5 15.6c2.6.3 4.5 1.9 4.5 4.4" />
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

    <!-- Гамбургер: остальные разделы на мобиле -->
    <template v-else-if="name === 'menu'">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </template>

    <!-- Крестик: закрыть панель меню -->
    <template v-else-if="name === 'close'">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </template>

    <!-- Дом: домик -->
    <template v-else>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" />
    </template>
  </svg>
</template>
