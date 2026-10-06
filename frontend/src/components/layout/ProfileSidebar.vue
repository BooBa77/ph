<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'

import { logout } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'
import SidebarIcon from '@/components/ui/SidebarIcon.vue'

/**
 * Боковое меню личного кабинета.
 *
 * На десктопе — колонка слева с подписями, на мобиле — полоса сверху,
 * где от пунктов остаются только иконки. Один и тот же DOM, раскладка
 * через CSS: два разных меню разъехались бы по составу пунктов.
 *
 * Выход живёт здесь, а не в шапке: шапка — про навигацию по приложению,
 * а выход относится к аккаунту, которому и посвящён кабинет. Заодно
 * на мобиле шапка разгружается — иначе в неё не влезали ни имя, ни
 * аватарка, ни логотип.
 */
const auth = useAuthStore()

/** Спрашиваем подтверждение перед выходом. */
const isConfirmingLogout = ref(false)
const isLoggingOut = ref(false)

async function confirmLogout() {
  isLoggingOut.value = true
  try {
    await logout()
  } catch {
    // Даже если бэк упал — локально всё равно разлогинимся.
    // Сессия на бэке отзовётся сама по TTL.
  } finally {
    auth.clear()
    isLoggingOut.value = false
  }
}
</script>

<template>
  <nav
    class="flex items-stretch gap-1 overflow-x-auto md:flex-col md:gap-0"
    aria-label="Разделы личного кабинета"
  >
    <RouterLink
      to="/profile/personal"
      class="flex flex-1 items-center justify-center gap-2 rounded px-3 py-2 text-sm text-muted no-underline transition-colors hover:bg-bg hover:text-text md:flex-none md:justify-start md:rounded-none md:px-4 md:hover:bg-surface"
      active-class="bg-bg font-medium text-primary md:bg-surface"
    >
      <span class="h-5 w-5 shrink-0"><SidebarIcon name="profile" /></span>
      <span class="hidden md:inline">Профиль</span>
    </RouterLink>

    <!--
      Разделов пока нет: ссылки ведут в никуда, поэтому это не RouterLink,
      а неактивные пункты. Как только разделы появятся — станут ссылками
      с теми же иконками.
    -->
    <span
      class="flex flex-1 cursor-not-allowed items-center justify-center gap-2 rounded px-3 py-2 text-sm text-muted/50 md:flex-none md:justify-start md:rounded-none md:px-4"
    >
      <span class="h-5 w-5 shrink-0"><SidebarIcon name="sessions" /></span>
      <span class="hidden md:inline">Сессии (скоро)</span>
    </span>

    <span
      class="flex flex-1 cursor-not-allowed items-center justify-center gap-2 rounded px-3 py-2 text-sm text-muted/50 md:flex-none md:justify-start md:rounded-none md:px-4"
    >
      <span class="h-5 w-5 shrink-0"><SidebarIcon name="settings" /></span>
      <span class="hidden md:inline">Настройки (скоро)</span>
    </span>

    <!-- Выход: отделён чертой от разделов, на мобиле — в общем ряду -->
    <div class="md:mt-3 md:border-t md:border-border md:pt-3">
      <button
        v-if="!isConfirmingLogout"
        type="button"
        class="flex w-full cursor-pointer items-center justify-center gap-2 rounded px-3 py-2 text-sm text-muted transition-colors hover:bg-bg hover:text-text md:justify-start md:rounded-none md:px-4 md:hover:bg-surface"
        @click="isConfirmingLogout = true"
      >
        <span class="h-5 w-5 shrink-0"><SidebarIcon name="logout" /></span>
        <span class="hidden md:inline">Выйти</span>
      </button>

      <div v-else class="flex flex-col gap-1 px-3 py-2 md:px-4">
        <span class="hidden text-xs text-muted md:block">Выйти из аккаунта?</span>
        <div class="flex gap-1">
          <button
            type="button"
            :disabled="isLoggingOut"
            class="flex-1 cursor-pointer rounded border border-border bg-surface px-2 py-1 text-xs text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            @click="confirmLogout"
          >
            {{ isLoggingOut ? '…' : 'Да' }}
          </button>
          <button
            type="button"
            :disabled="isLoggingOut"
            class="flex-1 cursor-pointer rounded border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
            @click="isConfirmingLogout = false"
          >
            Нет
          </button>
        </div>
      </div>
    </div>
  </nav>
</template>
