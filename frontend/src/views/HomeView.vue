<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import HomeFooter from '@/components/layout/HomeFooter.vue'

const auth = useAuthStore()
</script>

<template>
  <main class="mx-auto flex min-h-[70vh] max-w-3xl flex-col px-4 py-12">
    <h1 class="text-3xl font-bold text-text">PeakHunter</h1>

    <p v-if="auth.user" class="mt-4 text-muted">
      Привет, <strong class="text-text">{{ auth.user.displayName }}</strong
      >!
    </p>

    <!--
      mt-auto прижимает футер к низу страницы: на главной пока нечего
      показывать, и предложение вынести ярлык не должно висеть посреди
      пустоты сразу под приветствием.
    -->
    <HomeFooter class="mt-auto" />
  </main>
</template>
