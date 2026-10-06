<script setup lang="ts">
import { RouterView } from 'vue-router'

import ProfileSidebar from '@/components/layout/ProfileSidebar.vue'
import { useRememberProfilePath } from '@/composables/useRememberProfilePath'

// Запоминаем раздел, чтобы клик по аватарке в шапке возвращал сюда.
useRememberProfilePath()
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-8">
    <h1 class="mb-6 text-2xl font-bold text-text">Личный кабинет</h1>

    <!--
      Адаптив:
        - мобильный: flex-col — меню сверху горизонтальной полосой,
          где от пунктов остаются только иконки; контент снизу;
        - десктоп (md:): flex-row — меню слева фиксированной ширины,
          контент справа.

      Один и тот же DOM, разная раскладка через Tailwind-утилиты.
      Никаких v-if по ширине экрана — всё делает CSS.

      items-start, а не stretch: колонка меню не должна растягиваться
      на всю высоту контента — иначе «Выйти», прижатый к низу колонки,
      уезжает за контент и его не видно.
    -->
    <div class="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
      <ProfileSidebar class="md:w-56 md:shrink-0" />

      <div class="min-w-0 flex-1">
        <RouterView />
      </div>
    </div>
  </div>
</template>
