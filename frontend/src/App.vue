<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'

import AppHeader from '@/components/layout/AppHeader.vue'
import { useAppStore } from '@/stores/app'
import { useSwUpdate } from '@/composables/useSwUpdate'
import { useTheme } from '@/composables/useTheme'

const route = useRoute()
const appStore = useAppStore()
const { updatePending, applyUpdate } = useSwUpdate()

// Инициализация темы. Вызывается ОДИН РАЗ за жизнь приложения.
// Ставит data-theme на <html> и следит за изменениями.
useTheme()

/**
 * Шапку не показываем на страницах с meta.hideHeader = true.
 * Сейчас это только /auth (страница логина).
 */
const showHeader = computed(() => route.meta.hideHeader !== true)

/**
 * Как только обновление готово И пользователь не занят — применяем.
 * Если busy станет false позже — watcher сработает.
 */
watch(
  [updatePending, () => appStore.isUserBusy],
  ([pending, busy]) => {
    if (pending && !busy) {
      applyUpdate()
    }
  },
  { immediate: true }
)
</script>

<template>
  <AppHeader v-if="showHeader" />
  <RouterView />
</template>