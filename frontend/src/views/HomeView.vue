<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import HomeFooter from '@/components/layout/HomeFooter.vue'

const auth = useAuthStore()
</script>

<template>
  <!--
    Внешний контейнер (ширина, отступы) даёт общий каркас приложения:
    здесь только содержимое главной. min-h и mt-auto у футера — чтобы
    кнопка установки стояла внизу, а не висела посреди пустой страницы.
  -->
  <main class="flex min-h-[70vh] flex-col">
    <h1 class="text-3xl font-bold text-text">PeakHunter</h1>

    <p v-if="auth.user" class="mt-4 text-muted">
      Привет, <strong class="text-text">{{ auth.user.displayName }}</strong
      >!
    </p>

    <HomeFooter />
  </main>
</template>
