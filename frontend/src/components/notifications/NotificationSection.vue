<script setup lang="ts">
import NotificationCard from '@/components/notifications/NotificationCard.vue'
import type { AppNotification } from '@/types/notifications'

/**
 * Сворачиваемая секция панели (25.11.2026; секции по походам — 26.11.2026).
 *
 * Один компонент на секцию похода и на «Сообщения»: устройство одинаковое —
 * заголовок, счётчик, сворачивание, список карточек. Общий компонент вместо
 * копий нужен и потому, что колонка и мобильная панель показывают одни и те
 * же секции: правка в одной копии иначе разошлась бы с другой.
 *
 * **Своя свёрнутость у каждой секции.** Ключ хранилища — `sectionKey`:
 * `trip-<id>` или `personal`. Компонент его только рисует и сообщает
 * о клике; читает и пишет родитель (`utils/notifications.ts`), потому что
 * у него же список секций.
 *
 * **Двойная зелёная галочка — только у секции похода** и только когда есть
 * что закрывать (`canReadAll`): в секции из одного перевода нажимать её
 * нечего. Кнопка стоит справа от счётчика, вне кнопки-заголовка, иначе
 * вложенная кнопка ломала бы клик по строке.
 *
 * **Пустая секция не рисуется.** Заказчик: нет карточек — нет и секции;
 * общее «Пока тихо» показывает родитель, когда пусто везде.
 *
 * **Раскрытая карточка одна на всю панель**, поэтому `expandedId` приходит
 * сверху: иначе вторая секция могла бы раскрыть свою, оставив открытой
 * чужую.
 *
 * **`showHeader`.** Мобильная панель в режиме «Сообщения» уже называет
 * секцию в шапке — второй такой же заголовок внутри панели был бы дублем.
 */
withDefaults(
  defineProps<{
    /** Ключ секции: `trip-<id>` или `personal`; он же в `data-test`. */
    sectionKey: string
    title: string
    items: AppNotification[]
    open: boolean
    expandedId: string | null
    testPrefix: string
    /** Есть что закрывать двойной галочкой (только секция похода). */
    canReadAll?: boolean
    showHeader?: boolean
  }>(),
  // `Boolean`-проп без значения Vue приводит к `false`, а заголовок нужен
  // по умолчанию: колонка не передаёт `showHeader` вовсе.
  { canReadAll: false, showHeader: true },
)

const emit = defineEmits<{ toggle: []; expand: [id: string]; readAll: [] }>()
</script>

<template>
  <section
    v-if="items.length > 0"
    class="flex flex-col gap-1 rounded-xl border border-border bg-surface p-2"
    :data-test="`${testPrefix}-section-${sectionKey}`"
  >
    <div v-if="showHeader !== false" class="flex items-center gap-1">
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-bg"
        :aria-expanded="open"
        :data-test="`${testPrefix}-toggle-${sectionKey}`"
        @click="emit('toggle')"
      >
        <span class="shrink-0 text-xs text-muted" aria-hidden="true">
          {{ open ? '▾' : '▸' }}
        </span>

        <span class="min-w-0 truncate text-sm font-medium text-text">{{ title }}</span>

        <span
          class="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-white"
          :data-test="`${testPrefix}-count-${sectionKey}`"
        >
          {{ items.length }}
        </span>
      </button>

      <!--
        Двойная зелёная галочка — «отметить все прочитанными» (§1.3).
        Не рисуется, если закрывать нечего: в секции только перевод или
        запрос платежа сервер их не тронет.
      -->
      <button
        v-if="canReadAll"
        type="button"
        class="shrink-0 cursor-pointer rounded-lg px-1.5 py-1 text-sm font-semibold text-green-600 hover:bg-bg"
        :aria-label="`Прочитать все: ${title}`"
        :title="`Прочитать все: ${title}`"
        :data-test="`${testPrefix}-read-all-${sectionKey}`"
        @click="emit('readAll')"
      >
        ✓✓
      </button>
    </div>

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
