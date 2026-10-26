<!-- frontend/src/components/layout/AppHeader.vue -->

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import { useMobileMenuStore } from '@/stores/mobileMenu'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import SidebarIcon from '@/components/ui/SidebarIcon.vue'
import logoUrl from '@/assets/logo.svg'

/**
 * Шапка приложения.
 *
 * Слева знак-«домой», справа — гамбургер и аватарка. Ни текстового меню,
 * ни выхода здесь нет: разделы живут в колонке на десктопе и в гамбургере
 * на мобиле, а выход — там же, внизу списка.
 *
 * **Гамбургер появился 26.10.2026** (решение заказчика). Раньше разделы
 * на телефоне висели полосой ярлыков сверху, а гамбургер стоял последним
 * в этой полосе и открывал «остальное». Полоса убрана: меню одно, кнопок
 * для него одна, и стоит она в шапке — там, где её ищут.
 *
 * Кнопка показывается только на узком экране (`md:hidden`): на десктопе
 * меню уже стоит колонкой слева, второй способ открыть те же разделы
 * заставлял бы выбирать.
 *
 * Про аватарку: она сразу ведёт в личный кабинет, без выпадашки —
 * промежуточный клик ради одного пункта лишнее действие.
 */
const auth = useAuthStore()
const appStore = useAppStore()
const menu = useMobileMenuStore()

/** Аватарка ведёт в тот раздел кабинета, где пользователь был в прошлый раз. */
const profilePath = computed(() => appStore.lastProfilePath)
</script>

<template>
  <header
    class="relative flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3"
  >
    <RouterLink
      to="/"
      class="flex min-w-0 items-center gap-2 text-lg font-semibold text-text no-underline"
      aria-label="На главную"
    >
      <!--
        Знак подключаем импортом из `src/assets`, а не ссылкой на
        `public/logo.svg`: Vite добавит к имени хэш содержимого, и после
        обновления знака браузер скачает новый файл. Ссылка на public
        ломалась дважды: файл в проде отдавался с кэшем на 30 дней,
        и старый знак жил в браузере даже после деплоя.

        alt пустой, а не «PeakHunter»: рядом стоит текстовая подпись
        (на мобиле скрыта, но остаётся в дереве доступности из-за
        aria-label у ссылки). Дубль имени ссылки скринридер читал бы дважды.
      -->
      <img :src="logoUrl" alt="" width="28" height="28" class="h-7 w-7 shrink-0" />
      <span class="hidden sm:inline">PeakHunter</span>
    </RouterLink>

    <div class="flex min-w-0 shrink items-center gap-1">
      <!-- Меню: на мобиле открывает панель (разделы сайта или вкладки
           похода — что положила страница), на десктопе скрыто -->
      <button
        id="site-menu-button"
        type="button"
        class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-text transition-colors hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:hidden"
        :aria-expanded="menu.isOpen"
        aria-controls="site-mobile-menu"
        aria-label="Меню"
        data-test="menu-button"
        @click="menu.toggle()"
      >
        <span class="block h-6 w-6"><SidebarIcon name="menu" /></span>
      </button>

      <RouterLink
        v-if="auth.user"
        :to="profilePath"
        class="flex min-w-0 items-center gap-2 rounded-full border border-border bg-bg py-1 pr-1 pl-1 text-sm text-text no-underline transition-colors hover:border-primary sm:pr-3"
        aria-label="Личный кабинет"
      >
        <UserAvatar :src="auth.user.avatarUrl" :size="32" :alt="auth.user.displayName" />
        <!--
          Имя показываем на всех экранах, включая узкие. Длинное — режем
          многоточием, а не прячем: имя в шапке нужно, чтобы понимать,
          под кем ты вошёл. Место под него освобождает логотип: на узких
          экранах от него остаётся только знак.
        -->
        <span class="mr-1 truncate">{{ auth.user.displayName }}</span>
      </RouterLink>
    </div>
  </header>
</template>
