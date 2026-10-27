<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'

import SidebarIcon from '@/components/ui/SidebarIcon.vue'
import { useMobileMenuStore } from '@/stores/mobileMenu'

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
 *
 * **Кнопка вкладок похода** (26.10.2026). На телефоне вкладки похода
 * открываются своей кнопкой справа от заголовка раздела, а гамбургер
 * в шапке остаётся меню сайта. Кнопка есть только там, где вкладки
 * действительно положила страница похода: `menu.context` заполняется
 * в `TripView`, поэтому на «Моих походах», в анонсах и в создании её нет.
 */
const menu = useMobileMenuStore()

const LINK_CLASS =
  'rounded-xl border border-border bg-surface px-4 py-2 text-sm text-text no-underline transition-colors hover:border-primary'
const ACTIVE_CLASS = 'border-primary font-medium text-primary'
</script>

<template>
  <!--
    Здесь `<div>`, а не `<main>`: внутри этой рамки рендерится страница
    похода, и у неё свой `<main>` (TripView). Вложенный `<main>` — ошибка
    разметки (второй landmark внутри первого), её нашли замером при разборе
    мобильной вёрстки 26.10.2026.
  -->
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between gap-2">
      <h1 class="text-3xl font-bold text-text">Походы</h1>

      <!--
        Вкладки похода — в этой же строке, справа от заголовка: место там
        есть, а в шапке кнопка занята меню сайта. На десктопе вкладки стоят
        строкой сверху, кнопка не нужна.
      -->
      <button
        v-if="menu.context"
        type="button"
        class="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm text-text transition-colors hover:border-primary md:hidden"
        data-test="trip-menu-button"
        @click="menu.openTrip()"
      >
        <span class="h-5 w-5 shrink-0"><SidebarIcon name="menu" /></span>
        <span>Разделы похода</span>
      </button>
    </div>

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
  </div>
</template>
