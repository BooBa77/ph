<script setup lang="ts">
import NotificationCard from '@/components/notifications/NotificationCard.vue'
import type { AppNotification, NotificationSection } from '@/types/notifications'

/**
 * Сворачиваемая секция панели уведомлений (§14.1; независимые секции —
 * 25.11.2026).
 *
 * Секций ровно две — «Уведомления» и «Сообщения» — и они одинаковы по
 * устройству: заголовок со счётчиком, сворачивание, список карточек. Общий
 * компонент вместо двух копий разметки: колонка и мобильная панель
 * показывают одни и те же секции, и правка в одной копии иначе разошлась бы
 * с другой.
 *
 * **Пустая секция не рисуется.** Заказчик: «нет уведомлений в секции — нет
 * и её иконки» (это про мобилу, но пустая строка с нулём — тот же шум
 * и на десктопе). Общее «Пока тихо» показывает родитель, когда пусто везде.
 *
 * **Раскрытая карточка одна на всю панель**, поэтому `expandedId` приходит
 * сверху и карточка лишь сообщает о клике: иначе вторая секция могла бы
 * раскрыть свою, оставив открытой чужую.
 *
 * **`showHeader` (25.11.2026).** Мобильная панель открывается на своей
 * секции и уже называет её в шапке. Второй такой же заголовок внутри
 * панели — дубль, поэтому активная секция рисует только карточки;
 * у второй заголовок остаётся, и по нему переключаются.
 */
withDefaults(
  defineProps<{
    section: NotificationSection
    title: string
    items: AppNotification[]
    open: boolean
    expandedId: string | null
    testPrefix: string
    showHeader?: boolean
  }>(),
  // `Boolean`-проп без значения Vue приводит к `false`, а заголовок нужен
  // по умолчанию: колонка не передаёт `showHeader` вовсе.
  { showHeader: true },
)

const emit = defineEmits<{ toggle: []; expand: [id: string] }>()
</script>

<template>
  <section
    v-if="items.length > 0"
    class="flex flex-col gap-1"
    :data-test="`${testPrefix}-section-${section}`"
  >
    <button
      v-if="showHeader !== false"
      type="button"
      class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-bg"
      :aria-expanded="open"
      :data-test="`${testPrefix}-toggle-${section}`"
      @click="emit('toggle')"
    >
      <span class="text-sm font-medium text-text">{{ title }}</span>

      <span
        class="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-white"
        :data-test="`${testPrefix}-count-${section}`"
      >
        {{ items.length }}
      </span>

      <span class="ml-auto text-xs text-muted" aria-hidden="true">
        {{ open ? '▾' : '▸' }}
      </span>
    </button>

    <template v-if="open">
      <NotificationCard
        v-for="item in items"
        :key="item.id"
        :notification="item"
        :expanded="expandedId === item.id"
        :test-prefix="testPrefix"
        @toggle="emit('expand', item.id)"
      />
    </template>
  </section>
</template>
