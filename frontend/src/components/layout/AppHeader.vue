<!-- frontend/src/components/layout/AppHeader.vue -->

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import { useMobileMenuStore } from '@/stores/mobileMenu'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import SidebarIcon from '@/components/ui/SidebarIcon.vue'
import logoUrl from '@/assets/logo-mark.png'

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
 * **Кнопка открывает только разделы сайта** — на любой странице, включая
 * поход. Вкладки похода открываются своей кнопкой рядом с заголовком
 * раздела: одна кнопка на два разных меню путала, и с похода нельзя было
 * дотянуться до разделов сайта.
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
    class="relative flex items-center justify-between gap-3 border-b border-border bg-surface py-3 pr-1 pl-4 md:pr-4"
  >
    <RouterLink
      to="/"
      class="flex min-w-0 items-center gap-2 text-lg font-semibold text-text no-underline"
      aria-label="На главную"
    >
      <!--
        Знак — присланный рисунок (двое у горы), а не нарисованный кодом
        вектор: с 28.10.2026 в шапке стоит иллюстрация заказчика. Подключаем
        импортом из `src/assets`, а не ссылкой на `public`: Vite добавит
        к имени хэш содержимого, и после обновления знака браузер скачает
        новый файл. Ссылка на public ломалась дважды: файл в проде
        отдавался с кэшем на 30 дней, и старый знак жил в браузере даже
        после деплоя.

        alt пустой, а не «PeakHunter»: рядом стоит текстовая подпись
        (на мобиле скрыта, но остаётся в дереве доступности из-за
        aria-label у ссылки). Дубль имени ссылки скринридер читал бы дважды.
      -->
      <!--
        Знак крупнее шапки и свисает под её полосу. 96 px при строке 44 px:
        отрицательные отступы -mt-2 и -mb-12 съедают 8 сверху и 48 снизу,
        поэтому в высоте строки участвует 40 px, а не 96 — шапка остаётся
        68 px, как была, а сам знак выходит на 34 px ниже полосы (сверху
        остаётся 6 px). Свисающая часть рисуется поверх контента: для этого
        `relative z-10`, иначе её закроет следующий блок.
      -->
      <img
        :src="logoUrl"
        alt=""
        width="96"
        height="96"
        class="relative z-10 -mt-2 -mb-12 h-24 w-24 shrink-0"
      />
      <span class="hidden sm:inline">PeakHunter</span>
    </RouterLink>

    <div class="flex min-w-0 shrink items-center gap-1">
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

      <!-- Меню: на мобиле открывает разделы сайта — всегда, на любой
           странице. Вкладки похода открываются своей кнопкой на странице
           похода (решение заказчика 26.10.2026) -->
      <button
        id="site-menu-button"
        type="button"
        class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-text transition-colors hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:hidden"
        :aria-expanded="menu.isSiteOpen"
        aria-controls="site-mobile-menu"
        aria-label="Меню"
        data-test="menu-button"
        @click="menu.toggleSite()"
      >
        <span class="block h-6 w-6"><SidebarIcon name="menu" /></span>
      </button>
    </div>
  </header>
</template>
