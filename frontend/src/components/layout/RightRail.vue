<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from 'vue'

import NotificationSection from '@/components/notifications/NotificationSection.vue'
import { useNotificationsStore } from '@/stores/notifications'
import {
  PERSONAL_SECTION_KEY,
  PERSONAL_SECTION_TITLE,
  canReadAllSection,
  readSectionOpen,
  tripSectionKey,
  tripSectionTitle,
  writeSectionOpen,
} from '@/utils/notifications'

/**
 * Правая колонка — самостоятельные секции по походам плюс «Сообщения»
 * последней (26.11.2026, §1.1).
 *
 * Заказчик: не один общий блок с заголовком «Уведомления», а **свой блок
 * у каждого похода** — своё название, свой счётчик, свой chevron и своя
 * свёрнутость. «Сообщения» остаются отдельной секцией и стоят последними.
 * Пустая секция не рисуется; если пусто везде — «Пока тихо».
 *
 * **Порядок секций и карточек задаёт сервер**, клиент его не
 * пересортировывает: идущие и предстоящие по возрастанию даты, прошедшие
 * по убыванию, без дат по имени; внутри — по приоритету. Прежняя
 * клиентская шкала приоритетов удалена вместе с этой правкой.
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

/** Раскрытая карточка — одна на всю панель. */
const expandedId = ref<string | null>(null)

/**
 * Свёрнутость секций — своя у каждой и переживает перезагрузку.
 *
 * Состояние ленивое: секций столько, сколько походов с карточками, и читать
 * все ключи при создании незачем. `localStorage` — источник истины при
 * первом обращении, дальше живёт реактивная запись.
 */
const openState = reactive<Record<string, boolean>>({})

function isOpen(sectionKey: string): boolean {
  if (!(sectionKey in openState)) {
    openState[sectionKey] = readSectionOpen(sectionKey)
  }

  return openState[sectionKey] ?? true
}

function toggleSection(sectionKey: string): void {
  const next = !isOpen(sectionKey)
  openState[sectionKey] = next
  writeSectionOpen(sectionKey, next)
}

/** Двойная галочка: закрыть всё, кроме денег к действию. */
function readAll(tripId: string): void {
  void notifications.readAll(tripId)
}

const isEmpty = computed(
  () => notifications.tripCards === 0 && notifications.personalCount === 0,
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
    <div class="flex max-h-[calc(100vh-7.5rem)] flex-col gap-2 overflow-y-auto">
      <p
        v-if="notifications.isLoading"
        class="rounded-xl border border-border bg-surface p-3 text-sm text-muted"
        data-test="rail-loading"
      >
        Загружаем…
      </p>

      <p
        v-else-if="notifications.error"
        class="rounded-xl border border-border bg-surface p-3 text-sm text-muted"
        data-test="rail-error"
      >
        {{ notifications.error }}
      </p>

      <p
        v-else-if="isEmpty"
        class="rounded-xl border border-border bg-surface p-3 text-sm text-muted"
        data-test="rail-empty"
      >
        Пока тихо.
      </p>

      <template v-else>
        <!--
          Секции походов идут в серверном порядке (§1.1); клиент его
          не пересортировывает. У каждой — свой блок, счётчик и chevron.
        -->
        <NotificationSection
          v-for="section in notifications.sections"
          :key="section.tripId"
          :section-key="tripSectionKey(section.tripId)"
          :title="tripSectionTitle(section.tripName)"
          :items="section.items"
          :open="isOpen(tripSectionKey(section.tripId))"
          :expanded-id="expandedId"
          :can-read-all="canReadAllSection(section.items)"
          test-prefix="rail"
          @toggle="toggleSection(tripSectionKey(section.tripId))"
          @expand="expand"
          @read-all="readAll(section.tripId)"
        />

        <NotificationSection
          v-if="notifications.personalCount > 0"
          :section-key="PERSONAL_SECTION_KEY"
          :title="PERSONAL_SECTION_TITLE"
          :items="notifications.personal"
          :open="isOpen(PERSONAL_SECTION_KEY)"
          :expanded-id="expandedId"
          test-prefix="rail"
          @toggle="toggleSection(PERSONAL_SECTION_KEY)"
          @expand="expand"
        />
      </template>
    </div>
  </aside>
</template>
