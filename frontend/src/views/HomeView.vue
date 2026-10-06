<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import HomeFooter from '@/components/layout/HomeFooter.vue'

const auth = useAuthStore()
</script>

<template>
  <!--
    min-h и flex-col с mt-auto у футера: главная пока почти пустая,
    и кнопка в футере должна стоять внизу страницы, а не висеть
    посреди экрана сразу под приветствием.
  -->
  <main class="mx-auto flex min-h-[80vh] max-w-3xl flex-col px-4 py-12">
    <h1 class="text-3xl font-bold text-text">PeakHunter</h1>

    <p v-if="auth.user" class="mt-4 text-muted">
      Привет, <strong class="text-text">{{ auth.user.displayName }}</strong
      >!
    </p>

    <HomeFooter />
  </main>
</template>
