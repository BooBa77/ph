<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

import NotificationSection from '@/components/notifications/NotificationSection.vue'
import { useNotificationsStore } from '@/stores/notifications'
import type { NotificationSection as Section } from '@/types/notifications'
import {
  PERSONAL_SECTION_TITLE,
  SYSTEM_SECTION_TITLE,
  readSectionOpen,
  writeSectionOpen,
} from '@/utils/notifications'

/**
 * Правая колонка — две **независимые** секции уведомлений (25.11.2026).
 *
 * Заказчик после живого теста: общий заголовок «Уведомления» со счётчиком
 * лишний, а секции должны жить сами по себе — «Уведомления» (деньги,
 * альманах, чаты похода) и «Сообщения» (личные диалоги). Каждая со своим
 * заголовком, счётчиком, chevron и **своим состоянием свёрнутости
 * в `localStorage`** (`utils/notifications.ts`). Свернуть «Уведомления»,
 * оставив «Сообщения» открытыми, — нормальный сценарий; прежний один флаг
 * этого не умел.
 *
 * **Пустая секция не рисуется**, а если пусты обе — «Пока тихо». Общего
 * счётчика в шапке больше нет: два счётчика у заголовков давали третий,
 * сводный, ради которого человеку приходилось складывать в уме.
 *
 * **Ширина 352 px** (24.11.2026, было 288): заказчик просил увеличить
 * правую колонку за счёт левого сайдбара. Колонка меню в `App.vue` сузилась
 * на столько же, поэтому контент страницы почти не потерял.
 *
 * **Липкость (25.11.2026).** Панель стоит на месте при прокрутке основной
 * колонки: `sticky` на самой `aside`, а не на внутренней карточке — иначе
 * высота `aside` равнялась бы содержимому и липнуть было бы нечему. Если
 * панель выше окна, внутренний блок получает свой `max-height`
 * и `overflow-y`, чтобы её можно было прокрутить.
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
 * Свёрнутость секций — своя у каждой и переживает перезагрузку.
 *
 * Состояние читается из `localStorage` при создании, а не при монтировании:
 * компонент живёт всё время, пока открыто приложение, и повторное чтение
 * при каждом заходе на страницу только путало бы.
 */
const systemOpen = ref(readSectionOpen('system'))
const personalOpen = ref(readSectionOpen('personal'))

function toggleSection(section: Section): void {
  const target = section === 'system' ? systemOpen : personalOpen
  target.value = !target.value
  writeSectionOpen(section, target.value)
}

const isEmpty = computed(
  () => notifications.system.length === 0 && notifications.personal.length === 0,
)

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
  <!--
    `sticky` — на `aside`: колонка стоит при прокрутке основной части.
    `top` учитывает липкую шапку (68 px) и верхний отступ каркаса (32 px
    на `md`), иначе панель уехала бы под шапку.
  -->
  <aside
    class="hidden xl:sticky xl:top-[100px] xl:block xl:w-88 xl:shrink-0 xl:self-start"
    data-test="right-rail"
  >
    <div
      class="flex max-h-[calc(100vh-7.5rem)] flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-surface p-3"
    >
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
        <!--
          Секции независимы: каждая сама решает, рисоваться ли (пустая —
          нет), и каждая помнит свою свёрнутость.
        -->
        <NotificationSection
          section="system"
          :title="SYSTEM_SECTION_TITLE"
          :items="notifications.system"
          :open="systemOpen"
          :expanded-id="expandedId"
          test-prefix="rail"
          @toggle="toggleSection('system')"
          @expand="expand"
        />

        <NotificationSection
          section="personal"
          :title="PERSONAL_SECTION_TITLE"
          :items="notifications.personal"
          :open="personalOpen"
          :expanded-id="expandedId"
          test-prefix="rail"
          @toggle="toggleSection('personal')"
          @expand="expand"
        />
      </template>
    </div>
  </aside>
</template>
