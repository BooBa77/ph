<!-- frontend/src/components/layout/AppHeader.vue -->

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import UserAvatar from '@/components/ui/UserAvatar.vue'

/**
 * Шапка приложения.
 *
 * Состав — ровно два элемента: логотип-«домой» и аватарка. Ни меню,
 * ни выхода здесь нет:
 *   - аватарка сразу ведёт в личный кабинет, без выпадашки: промежуточный
 *     клик ради одного пункта — лишнее действие;
 *   - выход живёт в боковом меню кабинета, рядом с остальным, что
 *     относится к аккаунту.
 *
 * Про мобилу отдельно: «PeakHunter» текстом съедал половину строки,
 * а имя пользователя рядом с аватаркой вообще не помещалось и
 * обрезалось. Поэтому на узких экранах остаётся знак логотипа и
 * аватарка, а имя показывается целиком начиная с `sm` — сжимать его
 * до «Байкальский в…» смысла нет, это не несёт информации.
 */
const auth = useAuthStore()
const appStore = useAppStore()

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
        Логотип — <img>, а не инлайн-SVG: файл нужен и как иконка
        приложения, и в письмах, и как favicon. Один источник, а не
        копия разметки в компоненте.

        alt пустой, а не «PeakHunter»: рядом стоит текстовая подпись
        (на мобиле скрыта, но в дереве доступности остаётся из-за
        aria-label у ссылки). Дубль имени ссылки скринридер читал бы
        дважды.
      -->
      <img
        src="/logo.svg"
        alt=""
        width="28"
        height="28"
        class="h-7 w-7 shrink-0"
      />
      <span class="hidden sm:inline">PeakHunter</span>
    </RouterLink>

    <RouterLink
      v-if="auth.user"
      :to="profilePath"
      class="flex min-w-0 shrink items-center gap-2 rounded-full border border-border bg-bg py-1 pr-1 pl-1 text-sm text-text no-underline transition-colors hover:border-primary sm:pr-3"
      aria-label="Личный кабинет"
    >
      <UserAvatar
        :src="auth.user.avatarUrl"
        :size="32"
        :alt="auth.user.displayName"
      />
      <!--
        Имя показываем на всех экранах, включая узкие. Длинное — режем
        многоточием, а не прячем: имя в шапке нужно, чтобы понимать,
        под кем ты вошёл. Место под него освобождает логотип: на узких
        экранах от него остаётся только знак.
      -->
      <span class="mr-1 truncate">{{ auth.user.displayName }}</span>
    </RouterLink>
  </header>
</template>
