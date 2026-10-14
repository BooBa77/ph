<script setup lang="ts">
import { RouterView } from 'vue-router'

import { useRememberProfilePath } from '@/composables/useRememberProfilePath'

/**
 * Обёртка раздела «Личный кабинет».
 *
 * Ни меню, ни колонки здесь нет: и то и другое живёт в общем каркасе
 * приложения (`App.vue` + `SiteSidebar.vue`), потому что разделы сайта
 * и разделы аккаунта — один список. У обёртки осталась одна обязанность:
 * запоминать последний открытый раздел, чтобы клик по аватарке в шапке
 * возвращал туда, где человек был.
 */
useRememberProfilePath()
</script>

<template>
  <RouterView />
</template>
