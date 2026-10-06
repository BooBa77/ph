<script setup lang="ts">
import { useAppStore } from '@/stores/app'
import { useTheme } from '@/composables/useTheme'
import type { Season } from '@/types/theme'
import { SEASON_LABELS, SEASON_ORDER } from '@/types/season-labels'

/**
 * Переключатель сезонной темы.
 *
 * Четыре сезона — это тема оформления, а не настройка аккаунта: она живёт
 * в localStorage браузера, на сервер не уезжает. Поэтому переключатель
 * стоит в меню шапки рядом с «Выйти», а не в личном кабинете.
 *
 * Раньше сезон менялся только руками через `localStorage.themeOverride`
 * в DevTools — интерфейса не было вообще.
 */
const appStore = useAppStore()
const { setThemeOverride } = useTheme()

function select(season: Season) {
  setThemeOverride(season)
}
</script>

<template>
  <div class="px-4 py-2">
    <div class="mb-1 text-xs text-muted">Сезон оформления</div>

    <div class="flex gap-1">
      <button
        v-for="season in SEASON_ORDER"
        :key="season"
        type="button"
        :title="SEASON_LABELS[season]"
        :aria-label="`Сезон: ${SEASON_LABELS[season]}`"
        :aria-pressed="appStore.currentTheme === season"
        class="flex-1 cursor-pointer rounded-md border px-1 py-1 text-xs transition-colors"
        :class="
          appStore.currentTheme === season
            ? 'border-primary bg-bg font-medium text-primary'
            : 'border-border text-muted hover:border-primary hover:text-text'
        "
        @click="select(season)"
      >
        {{ SEASON_LABELS[season] }}
      </button>
    </div>
  </div>
</template>
