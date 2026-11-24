<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

import NotificationSection from '@/components/notifications/NotificationSection.vue'
import { useNotificationsStore } from '@/stores/notifications'
import {
  PERSONAL_SECTION_TITLE,
  SYSTEM_SECTION_TITLE,
} from '@/utils/notifications'

/**
 * Правая колонка — два списка уведомлений вместо ленты диалогов (24.11.2026).
 *
 * Заказчик пересмотрел назначение панели: «правая панель показывает два
 * списка уведомлений вместо диалогов». Спецификация — §14
 * `topics/messages.md`. Отсюда всё, чего здесь больше нет:
 *
 * - **строк чатов без события.** Карточка появляется только тогда, когда
 *   есть что показать: новое сообщение, перевод, просьба о платеже, новая
 *   редакция альманаха. Пустых «Пока пусто» в списке не остаётся;
 * - **«Скрыть чат» и «Скрытые чаты».** Заглушение — настройка диалога
 *   (`conversation_members.muted_at`), и на панель она больше не влияет:
 *   уведомление либо есть, либо его нет;
 * - **«Открыть чат» отдельной строкой.** Переход живёт на карточке своего
 *   типа: у личного сообщения — «Открыть чат», у альманаха и просьбы
 *   о платеже — «Перейти».
 *
 * **Ширина 352 px** (24.11.2026, было 288): заказчик просил увеличить
 * правую колонку за счёт левого сайдбара. Колонка меню в `App.vue` сузилась
 * на столько же, поэтому контент страницы почти не потерял.
 *
 * **Живёт на сторе, а не на запросе.** Ту же панель показывает мобильная
 * версия (`MobileMessages.vue`), и оба компонента всегда в разметке: прячет
 * их CSS по ширине. Стор держит один запрос, один счётчик и одно соединение
 * на двоих.
 */
const notifications = useNotificationsStore()

/** Раскрытая карточка — одна на обе секции. */
const expandedId = ref<string | null>(null)

/**
 * Свёрнутость секций. Обе развёрнуты по умолчанию: карточек мало, и прятать
 * их за кликом незачем. Состояние живёт в памяти вкладки, а не
 * в `localStorage`: это не настройка, а текущий вид панели.
 */
const systemOpen = ref(true)
const personalOpen = ref(true)

const isEmpty = computed(
  () => notifications.system.length === 0 && notifications.personal.length === 0,
)

/** Счётчик в шапке: активные карточки обеих секций. */
const total = computed(() => notifications.total)

/**
 * Выбор карточки.
 *
 * Повторный клик по раскрытой сворачивает её; выбор другой раскрывает новую
 * и **сворачивает прежнюю без действий** — это требование заказчика, а не
 * побочный эффект: панель 352 px двух раскрытых не выдерживает.
 */
function expand(id: string): void {
  expandedId.value = expandedId.value === id ? null : id
}

/**
 * Живость — у стора: его же держит мобильная панель. `hold()` возвращает
 * отписку; пока жив второй потребитель, панель продолжает обновляться.
 */
const release = notifications.hold()

onUnmounted(() => {
  release()
})
</script>

<template>
  <aside class="hidden xl:block xl:w-88 xl:shrink-0" data-test="right-rail">
    <div
      class="flex max-h-[calc(100vh-7rem)] flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-surface p-3 xl:sticky xl:top-4"
    >
      <div class="flex items-baseline justify-between gap-2">
        <h2 class="text-sm font-medium text-text">Уведомления</h2>
        <span
          v-if="total > 0"
          class="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-white"
          data-test="rail-total"
        >
          {{ total }}
        </span>
      </div>

      <p v-if="notifications.isLoading" class="text-sm text-muted" data-test="rail-loading">
        Загружаем…
      </p>

      <p v-else-if="notifications.error" class="text-sm text-muted" data-test="rail-error">
        {{ notifications.error }}
      </p>

      <p v-else-if="isEmpty" class="text-sm text-muted" data-test="rail-empty">
        Пока тихо.
      </p>

      <template v-else>
        <NotificationSection
          section="system"
          :title="SYSTEM_SECTION_TITLE"
          :items="notifications.system"
          :open="systemOpen"
          :expanded-id="expandedId"
          test-prefix="rail"
          @toggle="systemOpen = !systemOpen"
          @expand="expand"
        />

        <NotificationSection
          section="personal"
          :title="PERSONAL_SECTION_TITLE"
          :items="notifications.personal"
          :open="personalOpen"
          :expanded-id="expandedId"
          test-prefix="rail"
          @toggle="personalOpen = !personalOpen"
          @expand="expand"
        />
      </template>
    </div>
  </aside>
</template>
