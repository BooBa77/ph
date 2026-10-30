<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import SidebarIcon from '@/components/ui/SidebarIcon.vue'
import { siteSections } from '@/components/layout/site-sections'
import { useLogout } from '@/composables/useLogout'
import { useAuthStore } from '@/stores/auth'

/**
 * Меню сайта — колонка на десктопе.
 *
 * Одно меню на всё приложение: разделы сайта и аккаунта в одном списке,
 * и на главной, и в кабинете.
 *
 * **Мобилы здесь больше нет** (решение заказчика 26.10.2026). Раньше на
 * узком экране сверху висела полоса ярлыков — первые пять разделов без
 * подписей плюс гамбургер с остальным. Ярлыки без подписей узнавались
 * плохо, занимали верх страницы и дублировали гамбургер: разделы либо
 * в меню, либо в полосе. Теперь на телефоне меню одно — гамбургер в шапке
 * (`MobileMenu`), а эта колонка живёт только от `md`.
 *
 * **Админка — по флагу профиля** (30.10.2026): пункт «Админка» добавляет
 * `siteSections`, и та же функция кормит гамбургер. Список решается в одном
 * месте, чтобы два меню не разошлись.
 */
const auth = useAuthStore()
const { isConfirming, isLoggingOut, ask, cancel, confirm } = useLogout()

const sections = computed(() => siteSections(auth.user?.isAdmin === true))
</script>

<template>
  <nav class="hidden md:flex md:flex-col" aria-label="Разделы сайта">
    <RouterLink
      v-for="section in sections"
      :key="section.to"
      :to="section.to"
      class="flex items-center gap-2 rounded-none px-4 py-2 text-sm text-muted no-underline transition-colors hover:bg-surface hover:text-text"
      active-class="bg-surface font-medium text-primary"
      :aria-label="section.label"
    >
      <span class="h-5 w-5 shrink-0"><SidebarIcon :name="section.icon" /></span>
      <span>{{ section.label }}</span>
    </RouterLink>

    <!-- Выход: отделён чертой, живёт внизу списка -->
    <div class="mt-3 border-t border-border pt-3">
      <button
        v-if="!isConfirming"
        type="button"
        class="flex w-full cursor-pointer items-center gap-2 rounded-none px-4 py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-text"
        @click="ask()"
      >
        <span class="h-5 w-5 shrink-0"><SidebarIcon name="logout" /></span>
        <span>Выйти</span>
      </button>

      <div v-else class="flex flex-col gap-1 px-4 py-2">
        <span class="text-xs text-muted">Выйти из аккаунта?</span>
        <div class="flex gap-1">
          <button
            type="button"
            :disabled="isLoggingOut"
            class="flex-1 cursor-pointer rounded border border-border bg-surface px-2 py-1 text-xs text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            @click="confirm()"
          >
            {{ isLoggingOut ? '…' : 'Да' }}
          </button>
          <button
            type="button"
            :disabled="isLoggingOut"
            class="flex-1 cursor-pointer rounded border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
            @click="cancel()"
          >
            Нет
          </button>
        </div>
      </div>
    </div>
  </nav>
</template>
