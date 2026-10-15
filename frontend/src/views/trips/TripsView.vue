<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'

/**
 * Раздел «Походы» — пока временная закладка в меню.
 *
 * Две кнопки вместо придуманной навигации: «Анонсы» (что уже есть) и
 * «Создать поход». Как это разложится по меню, когда разделов станет
 * больше, ещё не решено, и городить структуру заранее — значит переделывать
 * её дважды.
 *
 * Это ссылки, а не кнопки: они переключают раздел, то есть меняют адрес.
 * Выглядят кнопками, работают как навигация — назад в браузере тоже
 * работает, чего с кнопкой и локальным состоянием не было бы.
 */
</script>

<template>
  <main class="flex flex-col gap-6">
    <h1 class="text-3xl font-bold text-text">Походы</h1>

    <nav class="flex flex-wrap gap-2" aria-label="Разделы походов">
      <RouterLink
        to="/trips/announces"
        class="rounded-xl border border-border bg-surface px-4 py-2 text-sm text-text no-underline transition-colors hover:border-primary"
        active-class="border-primary font-medium text-primary"
      >
        Анонсы
      </RouterLink>

      <RouterLink
        to="/trips/new"
        class="rounded-xl border border-border bg-surface px-4 py-2 text-sm text-text no-underline transition-colors hover:border-primary"
        active-class="border-primary font-medium text-primary"
      >
        Создать поход
      </RouterLink>
    </nav>

    <RouterView />
  </main>
</template>
