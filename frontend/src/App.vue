<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'

import AppHeader from '@/components/layout/AppHeader.vue'
import { useAppStore } from '@/stores/app'
import { useSwUpdate } from '@/composables/useSwUpdate'

const route = useRoute()
const appStore = useAppStore()
const { updatePending, applyUpdate } = useSwUpdate()

/**
 * Шапку не показываем на страницах с meta.hideHeader = true.
 * Сейчас это только /auth (страница логина).
 * Через meta — гибче, чем хардкод по имени роута: позже появятся
 * другие публичные страницы, которым тоже надо скрыть шапку.
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

<style scoped></style>