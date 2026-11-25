<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import NotificationSection from '@/components/notifications/NotificationSection.vue'
import SidebarIcon from '@/components/ui/SidebarIcon.vue'
import { useNotificationsStore } from '@/stores/notifications'
import type { NotificationSection as Section } from '@/types/notifications'
import {
  PERSONAL_SECTION_TITLE,
  SYSTEM_SECTION_TITLE,
} from '@/utils/notifications'

/**
 * Мобильная панель уведомлений (24.11.2026; заменила панель диалогов
 * 23.11.2026).
 *
 * **Заказчик:** «Мобила до xl: две иконки в правом нижнем углу со
 * счётчиками (треугольник с „!“ — системные, конверт — личные); нет
 * уведомлений в секции — нет и её иконки. Иконка открывает панель на своей
 * секции» (§14.1).
 *
 * Отсюда два правила, которых не было у прежней кнопки:
 *
 * 1. **Иконка у секции своя.** Одна кнопка со счётчиком всего непрочитанного
 *    не отвечала на вопрос «а что там»: человек не знал, деньги это или
 *    личное сообщение. Треугольник и конверт различают разделы, и счётчик
 *    у каждого свой.
 * 2. **Пустая секция иконки не имеет.** Счётчик 0 не показывается вовсе:
 *    кнопка, у которой всегда ноль, — это мусор в углу экрана.
 *
 * **Развёрнутая панель — те же секции и те же карточки**, что в колонке:
 * разметка карточки и секции общая (`components/notifications/`), данные —
 * один стор. Копии правил нет: иначе «раскрыто одно уведомление» на мобиле
 * пришлось бы помнить отдельно.
 *
 * **Открытая секция одна.** Иконка открывает панель на своей секции; вторую
 * можно раскрыть кликом по её заголовку — тогда первая свернётся. Так же
 * ведёт себя колонка: раскрыто всегда одно уведомление и одна секция не
 * держит открытой вторую.
 *
 * **Чего здесь нет намеренно.** Галочки «Уведомлять» и «Скрыть чат»:
 * первая живёт на экране диалога и под чатом похода, вторая — в колонке,
 * где есть куда вернуть скрытое. Панель на телефоне — только список
 * и переходы по карточке.
 */
const notifications = useNotificationsStore()
const route = useRoute()

/** Панель открыта. */
const isOpen = ref(false)

/** Какая секция раскрыта; `null` — обе свёрнуты. */
const activeSection = ref<Section | null>(null)

/** Раскрытая карточка — одна на обе секции, как в колонке. */
const expandedId = ref<string | null>(null)

/** Панель: нужен фокус после открытия. */
const panel = ref<HTMLElement | null>(null)

/**
 * Экран диалога занимает весь экран, и кнопки в углу перекрывали бы поле
 * ввода. Там они не нужны: панель — это вход в диалог и в уведомления,
 * а мы уже в переписке.
 */
const onDialogScreen = computed(() => route.name === 'messages')

/** У системной секции есть что показать. */
const hasSystem = computed(() => notifications.system.length > 0)

/** У личной секции есть что показать. */
const hasPersonal = computed(() => notifications.personal.length > 0)

/** Всего активных карточек: по нему решается, закрывать ли пустую панель. */
const total = computed(() => notifications.total)

/** Шапка панели: заголовок и счётчик **своей** секции (25.11.2026). */
const activeTitle = computed(() =>
  activeSection.value === 'personal'
    ? PERSONAL_SECTION_TITLE
    : SYSTEM_SECTION_TITLE,
)

const activeCount = computed(() =>
  activeSection.value === 'personal'
    ? notifications.personalCount
    : notifications.systemCount,
)

/** «99+» вместо четырёхзначного числа, которое на бейдже не читается. */
function labelOf(count: number): string {
  return count > 99 ? '99+' : String(count)
}

const systemLabel = computed(() => labelOf(notifications.systemCount))
const personalLabel = computed(() => labelOf(notifications.personalCount))

function close(): void {
  isOpen.value = false
  activeSection.value = null
  expandedId.value = null
}

/** Иконка секции: панель открывается на ней, карточки свёрнуты. */
function openSection(section: Section): void {
  activeSection.value = section
  expandedId.value = null
  isOpen.value = true
}

/** Заголовок секции: раскрыть её, свёрнутую — свернуть. */
function toggleSection(section: Section): void {
  activeSection.value = activeSection.value === section ? null : section
}

/** Выбор карточки: раскрывается одна, прежняя сворачивается без действий. */
function expand(id: string): void {
  expandedId.value = expandedId.value === id ? null : id
}

/**
 * Панель закрывается, когда показывать нечего: последнюю карточку закрыли
 * «ОК» или подтвердили перевод, и пустая панель на весь экран только
 * мешала бы.
 */
watch(total, (value) => {
  if (isOpen.value && value === 0) close()
})

/**
 * Escape и прокрутка — как у прежней панели и мобильного меню: оверлей
 * не должен прокручивать страницу под собой. Фокус кладём на саму панель,
 * чтобы с клавиатуры человек попадал внутрь, а не в начало документа.
 */
let savedOverflow = ''

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  close()
}

watch(isOpen, async (open) => {
  if (typeof document === 'undefined') return

  if (open) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeydown)
    await nextTick()
    panel.value?.focus()
    return
  }

  document.body.style.overflow = savedOverflow
  window.removeEventListener('keydown', onKeydown)
})

// Переход закрывает панель: поверх новой страницы ей не место.
watch(
  () => route.fullPath,
  () => close(),
)

/** Панель обновляется сама, пока она (и колонка) кому-то видны. */
const release = notifications.hold()

onUnmounted(() => {
  release()
  window.removeEventListener('keydown', onKeydown)

  if (typeof document !== 'undefined') document.body.style.overflow = savedOverflow
})
</script>

<template>
  <!--
    `xl:hidden` на обеих частях: от 1280 px уведомления уже стоят колонкой
    справа, и вторая пара кнопок в углу там только мешала бы.
  -->
  <div v-if="!onDialogScreen" class="xl:hidden">
    <!--
      Две иконки, а не одна: «треугольник с !» — системные уведомления,
      конверт — личные. Счётчик у каждой свой; секция без карточек кнопки
      не имеет вовсе.
      25.11.2026, замечание заказчика: иконки стоят **вертикально** — друг
      под другом. Горизонтальная пара отнимала ширину у контента и на узком
      экране наезжала на карточки; столбик растёт вверх от нижнего края.
    -->
    <div
      class="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex flex-col items-center gap-2"
    >
      <button
        v-if="hasSystem"
        type="button"
        class="relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full border-2 border-primary bg-surface text-primary shadow-2xl transition-transform active:scale-95"
        aria-label="Уведомления"
        data-test="mobile-notifications-system"
        @click="openSection('system')"
      >
        <!--
          Крупный контурный треугольник с «!», почти на весь круг
          (44 из 56 px): 25.11.2026 заказчик снял заливку кнопки и попросил
          именно такой знак. Иконка масштабируется целиком — штрих толстеет
          вместе с ней и остаётся читаемым.
        -->
        <span class="block h-11 w-11"><SidebarIcon name="alert" /></span>

        <span
          class="absolute -top-1 -right-1 min-w-6 rounded-full border border-primary bg-white px-1.5 py-0.5 text-center text-xs font-semibold leading-none text-primary"
          data-test="mobile-notifications-system-badge"
        >
          {{ systemLabel }}
        </span>
      </button>

      <button
        v-if="hasPersonal"
        type="button"
        class="relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full border-2 border-primary bg-surface text-primary shadow-2xl transition-transform active:scale-95"
        aria-label="Сообщения"
        data-test="mobile-notifications-personal"
        @click="openSection('personal')"
      >
        <!-- Конверт тоже без заливки; окончательный вид — позже (заказчик). -->
        <span class="block h-6 w-6"><SidebarIcon name="mail" /></span>

        <span
          class="absolute -top-1 -right-1 min-w-6 rounded-full border border-primary bg-white px-1.5 py-0.5 text-center text-xs font-semibold leading-none text-primary"
          data-test="mobile-notifications-personal-badge"
        >
          {{ personalLabel }}
        </span>
      </button>
    </div>

    <Transition name="sheet">
      <div v-if="isOpen" class="fixed inset-0 z-40 xl:hidden" data-test="mobile-messages-panel">
        <div
          class="absolute inset-0 bg-black/40"
          data-test="mobile-messages-backdrop"
          @click="close()"
        />

        <div
          ref="panel"
          class="sheet__panel absolute inset-x-0 bottom-0 flex max-h-[80vh] flex-col rounded-t-2xl border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none"
          role="dialog"
          aria-modal="true"
          aria-label="Уведомления"
          tabindex="-1"
        >
          <div class="flex items-center gap-2 border-b border-border px-4 py-3">
            <span class="text-sm font-medium text-text" data-test="mobile-messages-title">
              {{ activeTitle }}
            </span>

            <!-- Счётчик своей секции, а не сводный: третье число в шапке
                 заставляло складывать в уме и расходилось с иконками. -->
            <span
              v-if="activeCount > 0"
              class="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-white"
              data-test="mobile-messages-count"
            >
              {{ activeCount }}
            </span>

            <button
              type="button"
              class="ml-auto cursor-pointer rounded-full p-2 text-muted transition-colors hover:bg-bg hover:text-text"
              aria-label="Закрыть уведомления"
              data-test="mobile-messages-close"
              @click="close()"
            >
              <span class="block h-5 w-5"><SidebarIcon name="close" /></span>
            </button>
          </div>

          <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
            <p
              v-if="notifications.isLoading"
              class="p-2 text-sm text-muted"
              data-test="mobile-messages-loading"
            >
              Загружаем…
            </p>

            <p
              v-else-if="notifications.error"
              class="p-2 text-sm text-muted"
              data-test="mobile-messages-error"
            >
              {{ notifications.error }}
            </p>

            <p
              v-else-if="total === 0"
              class="p-2 text-sm text-muted"
              data-test="mobile-messages-empty"
            >
              Пока тихо.
            </p>

            <template v-else>
              <NotificationSection
                v-if="hasSystem"
                section="system"
                :title="SYSTEM_SECTION_TITLE"
                :items="notifications.system"
                :open="activeSection === 'system'"
                :expanded-id="expandedId"
                :show-header="activeSection !== 'system'"
                test-prefix="mobile-messages"
                @toggle="toggleSection('system')"
                @expand="expand"
              />

              <NotificationSection
                v-if="hasPersonal"
                section="personal"
                :title="PERSONAL_SECTION_TITLE"
                :items="notifications.personal"
                :open="activeSection === 'personal'"
                :expanded-id="expandedId"
                :show-header="activeSection !== 'personal'"
                test-prefix="mobile-messages"
                @toggle="toggleSection('personal')"
                @expand="expand"
              />
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Панель выезжает снизу, подложка проявляется. Длительности короткие:
   панель — служебная вещь, задерживать человека на анимации незачем. */
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.18s ease;
}

.sheet-enter-active .sheet__panel,
.sheet-leave-active .sheet__panel {
  transition: transform 0.2s ease;
}

.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}

.sheet-enter-from .sheet__panel,
.sheet-leave-to .sheet__panel {
  transform: translateY(100%);
}

@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active,
  .sheet-leave-active,
  .sheet-enter-active .sheet__panel,
  .sheet-leave-active .sheet__panel {
    transition: none;
  }
}
</style>
