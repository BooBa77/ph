<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'

/**
 * Раздел «Походы»: рамка и навигация.
 *
 * Три раздела и три адреса: `/trips` — мои походы, `/trips/announces` —
 * анонсы других, `/trips/new` — создание. Раньше здесь было две ссылки
 * и «/trips» вёл на анонсы; заказчик сказал, что корень раздела должен
 * показывать **свои** походы, и это правильно: человек приходит сюда
 * за тем, что уже начал, а не за чужими планами.
 *
 * Это ссылки, а не кнопки: они меняют адрес, поэтому работают «назад»
 * в браузере, переживают перезагрузку и открываются в новой вкладке.
 */
const LINK_CLASS =
  'rounded-xl border border-border bg-surface px-4 py-2 text-sm text-text no-underline transition-colors hover:border-primary'
const ACTIVE_CLASS = 'border-primary font-medium text-primary'
</script>

<template>
  <main class="flex flex-col gap-6">
    <h1 class="text-3xl font-bold text-text">Походы</h1>

    <nav class="flex flex-wrap gap-2" aria-label="Разделы походов">
      <RouterLink
        to="/trips"
        :class="LINK_CLASS"
        exact-active-class="border-primary font-medium text-primary"
      >
        Мои походы
      </RouterLink>

      <RouterLink to="/trips/announces" :class="LINK_CLASS" :active-class="ACTIVE_CLASS">
        Анонсы
      </RouterLink>

      <RouterLink to="/trips/new" :class="LINK_CLASS" :active-class="ACTIVE_CLASS">
        Создать поход
      </RouterLink>
    </nav>

    <RouterView />
  </main>
</template>
