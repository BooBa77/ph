<!-- frontend/src/components/layout/AppHeader.vue -->

<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'

import { logout } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const isLoggingOut = ref(false)

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
    class="flex items-center justify-between border-b border-border bg-surface px-4 py-3"
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

      <button
        type="button"
        :disabled="isLoggingOut"
        class="cursor-pointer rounded border border-border px-3 py-1 text-sm text-text transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
        @click="handleLogout"
      >
        {{ isLoggingOut ? 'Выходим…' : 'Выйти' }}
      </button>
    </div>
  </header>
</template>