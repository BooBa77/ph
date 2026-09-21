<script setup lang="ts">
import { watch } from 'vue'
import { RouterView } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { useSwUpdate } from '@/composables/useSwUpdate'

const appStore = useAppStore()
const { updatePending, applyUpdate } = useSwUpdate()

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
  <RouterView />
</template>

<style scoped></style>