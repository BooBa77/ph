<script setup lang="ts">
import { usePwaInstall } from '@/composables/usePwaInstall'

/**
 * Подсказка по установке приложения.
 *
 * Появляется, когда браузер не умеет показать свой диалог установки,
 * а пользователь всё-таки нажал «Установить приложение»: Safari и Firefox
 * события beforeinstallprompt не присылают, и без объяснения кнопка
 * выглядит сломанной.
 *
 * Живёт на уровне приложения, а не внутри меню: меню закрывается перед
 * показом подсказки, и подсказка вместе с ним исчезла бы.
 */
const { showHint } = usePwaInstall()
</script>

<template>
  <div
    v-if="showHint"
    class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
    role="dialog"
    aria-modal="true"
    aria-label="Как установить приложение"
    @click.self="showHint = false"
  >
    <div class="w-full max-w-md rounded-2xl bg-surface p-4 shadow-xl">
      <h2 class="mb-2 text-lg font-semibold text-text">
        Как установить приложение
      </h2>

      <div class="flex flex-col gap-3 text-sm text-text">
        <div>
          <div class="font-medium">iPhone и iPad (Safari)</div>
          <p class="text-muted">
            Кнопка «Поделиться» внизу экрана → «На экран „Домой“» → «Добавить».
          </p>
        </div>

        <div>
          <div class="font-medium">Android (Chrome)</div>
          <p class="text-muted">
            Меню «⋮» справа сверху → «Установить приложение» →
            «Установить».
          </p>
        </div>

        <div>
          <div class="font-medium">Компьютер (Chrome, Edge)</div>
          <p class="text-muted">
            Значок установки в адресной строке справа, либо меню «⋮» →
            «Установить PeakHunter».
          </p>
        </div>
      </div>

      <div class="mt-4 flex justify-end">
        <button
          type="button"
          class="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          @click="showHint = false"
        >
          Понятно
        </button>
      </div>
    </div>
  </div>
</template>
