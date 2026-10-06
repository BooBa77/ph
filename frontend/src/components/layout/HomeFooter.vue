<script setup lang="ts">
import { computed } from 'vue'

import { usePwaInstall } from '@/composables/usePwaInstall'

/**
 * Предложение вынести ярлык на рабочий стол — футер главной страницы.
 *
 * Только кнопка, без объяснений и картинок. Первая версия была блоком
 * с абзацем текста, подсказкой и крупной иконкой — и читалась как
 * отдельная страница посреди пустой главной. Здесь это второстепенное
 * действие: кому надо — нажмёт, кому нет — не споткнётся.
 *
 * «Установить» не говорим: ничего не устанавливается, браузер кладёт
 * ярлык, который открывает сайт в своём окне. Ради отказа от слова
 * «установка» в том числе и сделан PWA.
 *
 * Когда ярлык уже есть, блок исчезает целиком — пустой секции в футере
 * быть не должно. Пояснения, что делать, если кнопка ничего не показала,
 * остались в подсказке (InstallHintDialog), она открывается по нажатию.
 */
const { canInstall, promptInstall } = usePwaInstall()

const visible = computed(() => canInstall.value)
</script>

<template>
  <footer v-if="visible" class="mt-auto flex justify-center pt-12">
    <button
      type="button"
      class="cursor-pointer rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:border-primary hover:text-text"
      @click="promptInstall"
    >
      Вынести ярлык на рабочий стол
    </button>
  </footer>
</template>
