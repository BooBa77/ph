<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'

import AppHeader from '@/components/layout/AppHeader.vue'
import SeasonDecor from '@/components/layout/SeasonDecor.vue'
import DecorDiagnostics from '@/components/layout/DecorDiagnostics.vue'
import InstallHintDialog from '@/components/ui/InstallHintDialog.vue'
import { useAppStore } from '@/stores/app'
import { useSwUpdate } from '@/composables/useSwUpdate'
import { useTheme } from '@/composables/useTheme'
import { registerPwaInstall } from '@/composables/usePwaInstall'

const route = useRoute()
const appStore = useAppStore()
const { updatePending, applyUpdate } = useSwUpdate()

// Инициализация темы. Вызывается ОДИН РАЗ за жизнь приложения.
// Ставит data-theme на <html> и следит за изменениями.
useTheme()

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
    Сезонный декор — первым в разметке и под содержимым (z-index: -1
    внутри компонента). Позиция fixed, поэтому порядок в DOM на слои
    не влияет, но так он хотя бы читается в том же порядке, что и
    рисуется.
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

  <!--
    Диагностика сезонного декора: показывается только по `?diag` в адресе.
    Нужна была, чтобы разобраться, почему у одного человека листья видны,
    а у другого нет. Оставлена: следующий такой случай снова упрётся
    в недоступное окружение.
  -->
  <DecorDiagnostics />
</template>
