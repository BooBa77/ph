<script setup lang="ts">
import { RouterView } from 'vue-router'

import ProfileSidebar from '@/components/layout/ProfileSidebar.vue'
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-8">
    <h1 class="mb-6 text-2xl font-bold text-text">Личный кабинет</h1>

    <!--
      Адаптив:
        - мобильный: flex-col — сайдбар сверху (горизонтальные табы),
          контент снизу;
        - десктоп (md:): flex-row — сайдбар слева фиксированной ширины,
          контент справа.

      Один и тот же DOM, разная раскладка через Tailwind-утилиты.
      Никаких v-if по ширине экрана — всё делает CSS.
    -->
    <div class="flex flex-col gap-6 md:flex-row md:gap-8">
      <ProfileSidebar class="md:w-56 md:shrink-0" />

      <div class="min-w-0 flex-1">
        <RouterView />
      </div>
    </div>
  </div>
</template>