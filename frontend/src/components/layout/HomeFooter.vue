<script setup lang="ts">
import { computed } from 'vue'

import { usePwaInstall } from '@/composables/usePwaInstall'
import SidebarIcon from '@/components/ui/SidebarIcon.vue'

/**
 * Предложение вынести ярлык на рабочий стол — футер главной страницы.
 *
 * Слово «установить» намеренно не используем: люди относятся к установке
 * приложений настороженно, а тут ничего не устанавливается — браузер
 * кладёт ярлык, который открывает сайт в своём окне. Именно ради этого
 * и сделан PWA, так что и называть надо по-человечески.
 *
 * Показывается только когда ярлыка ещё нет. Если приложение уже
 * запущено отдельным окном или ярлык уже вынесли — блок исчезает
 * целиком, вместе с заголовком: пустой секции в футере быть не должно.
 */
const { canInstall, promptInstall } = usePwaInstall()

const visible = computed(() => canInstall.value)
</script>

<template>
  <footer
    v-if="visible"
    class="mx-auto mt-16 max-w-3xl border-t border-border px-4 py-8"
  >
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
      <span class="h-8 w-8 shrink-0 text-muted">
        <SidebarIcon name="install" />
      </span>

      <div class="flex flex-col gap-2">
        <p class="text-sm text-text">
          PeakHunter можно вынести ярлыком на рабочий стол — откроется
          в своём окне, без адресной строки, и будет работать при плохой связи.
        </p>

        <button
          type="button"
          class="w-fit cursor-pointer rounded-lg border border-border bg-surface px-3 py-1 text-sm text-text transition-colors hover:border-primary"
          @click="promptInstall"
        >
          Вынести ярлык на рабочий стол
        </button>

        <p class="text-xs text-muted">
          Если кнопка ничего не показала — сделайте это через меню браузера:
          в Safari «Поделиться» → «На экран „Домой“», в Chrome и Firefox —
          пункт установки приложения в меню.
        </p>
      </div>
    </div>
  </footer>
</template>
