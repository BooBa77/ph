<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <nav
    class="flex flex-row gap-1 overflow-x-auto md:flex-col md:gap-0 md:overflow-visible"
  >
    <RouterLink
      to="/profile/personal"
      class="whitespace-nowrap rounded px-3 py-2 text-sm text-muted transition-colors hover:bg-bg hover:text-text md:rounded-none md:px-4 md:py-2 md:hover:bg-surface"
      active-class="bg-bg font-medium text-primary md:bg-surface"
    >
      Профиль
    </RouterLink>

    <!--
      Пункты ниже пока не работают — разделов нет. Оставляем как
      подсказку на будущее. Когда появятся — превратим в RouterLink.
    -->
    <span
      class="whitespace-nowrap rounded px-3 py-2 text-sm text-muted/50 md:rounded-none md:px-4 md:py-2"
    >
      Сессии (скоро)
    </span>
    <span
      class="whitespace-nowrap rounded px-3 py-2 text-sm text-muted/50 md:rounded-none md:px-4 md:py-2"
    >
      Настройки (скоро)
    </span>
  </nav>
</template>