<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
</script>

<template>
  <main class="mx-auto max-w-3xl px-4 py-12">
    <h1 class="text-3xl font-bold text-text">PeakHunter</h1>

    <p v-if="auth.user" class="mt-4 text-muted">
      Привет, <strong class="text-text">{{ auth.user.displayName }}</strong
      >!
    </p>
  </main>
</template>