<script setup lang="ts">
import { computed } from 'vue'

import { usePwaInstall } from '@/composables/usePwaInstall'

/**
 * Блок установки приложения в личном кабинете.
 *
 * Зачем отдельный блок, если кнопка есть в меню шапки: установка — это
 * не повседневное действие, и в меню её легко не заметить. В кабинете
 * у неё есть место, чтобы объяснить, зачем это нужно.
 *
 * Если браузер не умеет предлагать установку (Safari, Firefox), вместо
 * кнопки показываем путь руками — иначе пользователь решает, что
 * приложение сломано, а не что браузер другой.
 */
const { canInstall, promptInstall } = usePwaInstall()

/** Показывать ли блок целиком: скрыт только когда приложение уже установлено. */
const visible = computed(() => canInstall.value)
</script>

<template>
  <section v-if="visible">
    <h2 class="mb-2 text-xl font-semibold text-text">Приложение</h2>

    <div class="flex flex-col gap-3 py-3 md:flex-row md:items-center md:gap-6">
      <div class="text-sm text-muted md:w-48 md:shrink-0">Установка</div>

      <div class="flex flex-col gap-2">
        <p class="text-sm text-text">
          PeakHunter можно поставить на телефон или компьютер — откроется
          в своём окне, без адресной строки, и будет работать при плохой связи.
        </p>

        <button
          type="button"
          class="w-fit cursor-pointer rounded-lg border border-border bg-surface px-3 py-1 text-sm text-text transition-colors hover:border-primary"
          @click="promptInstall"
        >
          Установить приложение
        </button>

        <p class="text-xs text-muted">
          Если кнопка ничего не показала — установите через меню браузера:
          в Safari «Поделиться» → «На экран „Домой“», в Chrome и Firefox —
          пункт «Установить приложение» в меню.
        </p>
      </div>
    </div>
  </section>
</template>
