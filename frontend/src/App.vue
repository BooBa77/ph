<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'

import AppHeader from '@/components/layout/AppHeader.vue'
import SeasonDecor from '@/components/layout/SeasonDecor.vue'
import InstallHintDialog from '@/components/ui/InstallHintDialog.vue'
import { useAppStore } from '@/stores/app'
import { useSwUpdate } from '@/composables/useSwUpdate'
import { useTheme } from '@/composables/useTheme'
import { useAuthRedirect } from '@/composables/useAuthRedirect'
import { registerPwaInstall } from '@/composables/usePwaInstall'

const route = useRoute()
const appStore = useAppStore()
const { updatePending, applyUpdate } = useSwUpdate()

// Инициализация темы. Вызывается ОДИН РАЗ за жизнь приложения.
// Ставит data-theme на <html> и следит за изменениями.
useTheme()

/**
 * Уход на страницу входа, как только пользователь перестал быть
 * авторизованным. Вызывается здесь один раз: следить надо за всем
 * приложением, а не за одной страницей.
 */
useAuthRedirect()

/**
 * Подписка на события установки PWA.
 *
 * Вызывается здесь, а не в компоненте: браузер присылает
 * beforeinstallprompt один раз при загрузке страницы, задолго до того,
 * как пользователь откроет меню или личный кабинет. Подпишись мы внутри
 * компонента — событие к тому моменту уже улетело, и кнопка установки
 * не появилась бы никогда.
 */
registerPwaInstall()

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
  <!--
    Сезонный декор. Позиция fixed и `z-index: 0`, а содержимое страницы
    лежит выше за счёт `#app { position: relative; z-index: 1 }`
    в main.css. Именно так, а не отрицательным z-index: с `-10` слой
    уходил ПОД непрозрачный фон body, и листья были не видны, хотя
    в DOM жили и координаты у них были правильные.
  -->
  <SeasonDecor />

  <AppHeader v-if="showHeader" />
  <RouterView />

  <!--
    Подсказка, как вынести ярлык, — на уровне приложения: кнопка живёт
    в футере главной, а подсказка понадобится и из других мест, когда
    предложение переедет в «Сессии».
  -->
  <InstallHintDialog />
</template>
