<!-- frontend/src/components/layout/AppHeader.vue -->

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import { logout } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'
import UserAvatar from '@/components/ui/UserAvatar.vue'

const auth = useAuthStore()

const isLoggingOut = ref(false)

/** Меню открыто. */
const isMenuOpen = ref(false)

/** Корень шапки — по нему ловим клик «мимо меню». */
const headerRef = ref<HTMLElement | null>(null)

const user = computed(() => auth.user)

/**
 * Клик мимо меню закрывает меню.
 *
 * Слушатель на документе, а не на кнопке с blur: blur срабатывает
 * раньше клика по пункту меню, и меню закрывалось бы, не дав нажать.
 */
function onDocumentClick(event: MouseEvent) {
  if (!isMenuOpen.value) return
  const target = event.target as Node | null
  if (headerRef.value && target && !headerRef.value.contains(target)) {
    isMenuOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))

async function handleLogout() {
  isLoggingOut.value = true
  try {
    await logout()
  } catch {
    // Даже если бэк упал — локально всё равно разлогинимся.
    // Сессия на бэке отзовётся сама по TTL, если что.
  } finally {
    auth.clear()
    isLoggingOut.value = false
    window.location.assign('/auth')
  }
}
</script>

<template>
  <header
    ref="headerRef"
    class="relative flex items-center justify-between border-b border-border bg-surface px-4 py-3"
  >
    <RouterLink to="/" class="text-lg font-semibold text-text no-underline">
      PeakHunter
    </RouterLink>

    <div class="flex items-center gap-4">
      <RouterLink
        to="/profile"
        class="text-sm text-primary no-underline hover:underline"
      >
        Личный кабинет
      </RouterLink>

      <!--
        Аватарка — это кнопка меню, а не отдельная ссылка: она ведёт
        и в профиль, и к выходу, а два кликабельных элемента на 32 пикселя
        рядом — это промахи и раздражение.
      -->
      <div v-if="user" class="relative">
        <button
          type="button"
          class="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-bg py-1 pr-3 pl-1 text-sm text-text transition-colors hover:border-primary"
          :aria-expanded="isMenuOpen"
          aria-haspopup="menu"
          @click="isMenuOpen = !isMenuOpen"
        >
          <UserAvatar :src="user.avatarUrl" :size="32" :alt="user.displayName" />
          <span class="max-w-32 truncate">{{ user.displayName }}</span>
        </button>

        <div
          v-if="isMenuOpen"
          class="absolute right-0 z-40 mt-2 w-44 rounded-xl border border-border bg-surface py-1 shadow-lg"
          role="menu"
        >
          <RouterLink
            to="/profile"
            class="block px-4 py-2 text-sm text-text no-underline transition-colors hover:bg-bg"
            role="menuitem"
            @click="isMenuOpen = false"
          >
            Профиль
          </RouterLink>

          <button
            type="button"
            :disabled="isLoggingOut"
            class="block w-full cursor-pointer px-4 py-2 text-left text-sm text-text transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
            role="menuitem"
            @click="handleLogout"
          >
            {{ isLoggingOut ? 'Выходим…' : 'Выйти' }}
          </button>
        </div>
      </div>

      <button
        v-else
        type="button"
        disabled
        class="rounded border border-border px-3 py-1 text-sm text-muted opacity-50"
      >
        Выйти
      </button>
    </div>
  </header>
</template>
