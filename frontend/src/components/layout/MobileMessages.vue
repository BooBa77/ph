<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import NotificationSection from '@/components/notifications/NotificationSection.vue'
import SidebarIcon from '@/components/ui/SidebarIcon.vue'
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
 * Мобильная панель уведомлений (24.11.2026; секции по походам — 26.11.2026).
 *
 * **Заказчик:** до `xl` — две иконки в правом нижнем углу со счётчиками
 * (треугольник — походы, конверт — «Сообщения»). Счётчик треугольника —
 * **сумма активных карточек по всем походам**, конверта — личные. Секции
 * без карточек иконки не имеют. Иконка открывает панель; в панели — те же
 * секции по походам с заголовками и сворачиванием, что в колонке.
 *
 * Отсюда правила:
 *
 * 1. **Иконка у раздела своя.** Одна кнопка со счётчиком всего непрочитанного
 *    не отвечала на вопрос «а что там»: человек не знал, деньги это или
 *    личное сообщение.
 * 2. **Пустой раздел иконки не имеет.** Кнопка, у которой всегда ноль, —
 *    мусор в углу экрана.
 * 3. **Панель закрывается сама, когда карточек не осталось** (§1.5):
 *    последнюю закрыли «ОК», закрыли двойной галочкой или подтвердили
 *    перевод — пустая панель на весь экран только мешала бы.
 *
 * **Развёрнутая панель — те же секции и те же карточки**, что в колонке:
 * разметка карточки и секции общая (`components/notifications/`), данные —
 * один стор. Треугольник показывает все секции походов, конверт —
 * «Сообщения»; сворачиваются они независимо, как в колонке.
 *
 * **Чего здесь нет намеренно.** Галочки «Уведомлять» и «Скрыть чат»:
 * первая живёт на экране диалога и под чатом похода, вторая — в колонке,
 * где есть куда вернуть скрытое. Панель на телефоне — только список
 * и переходы по карточке.
 */
const notifications = useNotificationsStore()
const route = useRoute()

/** Что открыто: секции походов, «Сообщения» или ничего (панель закрыта). */
type PanelMode = 'trips' | 'personal'
const panelMode = ref<PanelMode | null>(null)

const isOpen = computed(() => panelMode.value !== null)

/** Раскрытая карточка — одна на всю панель, как в колонке. */
const expandedId = ref<string | null>(null)

/** Панель: нужен фокус после открытия. */
const panel = ref<HTMLElement | null>(null)

/**
 * Экран диалога занимает весь экран, и кнопки в углу перекрывали бы поле
 * ввода. Там они не нужны: панель — это вход в уведомления, а мы уже
 * в переписке.
 */
const onDialogScreen = computed(() => route.name === 'messages')

/** У походов есть что показать. */
const hasTrips = computed(() => notifications.tripCards > 0)

/** У «Сообщений» есть что показать. */
const hasPersonal = computed(() => notifications.personalCount > 0)

/** «99+» вместо четырёхзначного числа, которое на бейдже не читается. */
function labelOf(count: number): string {
  return count > 99 ? '99+' : String(count)
}

const tripsLabel = computed(() => labelOf(notifications.tripCards))
const personalLabel = computed(() => labelOf(notifications.personalCount))

/** Шапка панели: какой раздел открыт. */
const activeTitle = computed(() =>
  panelMode.value === 'personal' ? PERSONAL_SECTION_TITLE : 'Уведомления',
)

/** Счётчик шапки — по открытому разделу. */
const activeCount = computed(() =>
  panelMode.value === 'personal'
    ? notifications.personalCount
    : notifications.tripCards,
)

/** Сколько карточек в открытом разделе: по нему панель закрывается сама. */
const visibleCount = computed(() => {
  if (panelMode.value === 'trips') return notifications.tripCards
  if (panelMode.value === 'personal') return notifications.personalCount

  return 0
})

/**
 * Свёрнутость секций походов — своя у каждой, как в колонке.
 *
 * Ключи те же (`localStorage`), поэтому свернуть секцию на телефоне значит
 * свернуть её же и в колонке: это одна секция, а не две копии состояния.
 */
const openState = reactive<Record<string, boolean>>({})

function isOpenSection(sectionKey: string): boolean {
  if (!(sectionKey in openState)) {
    openState[sectionKey] = readSectionOpen(sectionKey)
  }

  return openState[sectionKey] ?? true
}

function toggleSection(sectionKey: string): void {
  const next = !isOpenSection(sectionKey)
  openState[sectionKey] = next
  writeSectionOpen(sectionKey, next)
}

function readAll(tripId: string): void {
  void notifications.readAll(tripId)
}

function close(): void {
  panelMode.value = null
  expandedId.value = null
}

/** Иконка раздела: панель открывается на нём, карточки свёрнуты. */
function openPanel(mode: PanelMode): void {
  panelMode.value = mode
  expandedId.value = null
}

/** Выбор карточки: раскрывается одна, прежняя сворачивается без действий. */
function expand(id: string): void {
  expandedId.value = expandedId.value === id ? null : id
}

/**
 * Панель закрывается, когда показывать нечего: последнюю карточку закрыли
 * «ОК», сработала двойная галочка или подтвердили перевод.
 */
watch(visibleCount, (value) => {
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
      Две иконки, а не одна: крупный контурный треугольник — уведомления
      походов (счётчик — сумма активных карточек по всем походам),
      конверт — «Сообщения». Раздел без карточек кнопки не имеет вовсе.
      Столбиком (25.11.2026, замечание заказчика): горизонтальная пара
      отнимала ширину у контента и на узком экране наезжала на карточки.
    -->
    <div
      class="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex flex-col items-center gap-2"
    >
      <button
        v-if="hasTrips"
        type="button"
        class="relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full border-2 border-primary bg-surface text-primary shadow-2xl transition-transform active:scale-95"
        aria-label="Уведомления походов"
        data-test="mobile-notifications-system"
        @click="openPanel('trips')"
      >
        <!--
          Крупный контурный треугольник с «!», почти на весь круг
          (44 из 56 px): 25.11.2026 заказчик снял заливку кнопки и попросил
          именно такой знак.
        -->
        <span class="block h-11 w-11"><SidebarIcon name="alert" /></span>

        <span
          class="absolute -top-1 -right-1 min-w-6 rounded-full border border-primary bg-white px-1.5 py-0.5 text-center text-xs font-semibold leading-none text-primary"
          data-test="mobile-notifications-system-badge"
        >
          {{ tripsLabel }}
        </span>
      </button>

      <button
        v-if="hasPersonal"
        type="button"
        class="relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full border-2 border-primary bg-surface text-primary shadow-2xl transition-transform active:scale-95"
        aria-label="Сообщения"
        data-test="mobile-notifications-personal"
        @click="openPanel('personal')"
      >
        <!-- Конверт тоже без заливки. -->
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

            <!-- Счётчик открытого раздела: треугольника — сумма карточек
                 походов, конверта — личные. -->
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
              v-else-if="visibleCount === 0"
              class="p-2 text-sm text-muted"
              data-test="mobile-messages-empty"
            >
              Пока тихо.
            </p>

            <template v-else-if="panelMode === 'trips'">
              <NotificationSection
                v-for="section in notifications.sections"
                :key="section.tripId"
                :section-key="tripSectionKey(section.tripId)"
                :title="tripSectionTitle(section.tripName)"
                :items="section.items"
                :open="isOpenSection(tripSectionKey(section.tripId))"
                :expanded-id="expandedId"
                :can-read-all="canReadAllSection(section.items)"
                test-prefix="mobile-messages"
                @toggle="toggleSection(tripSectionKey(section.tripId))"
                @expand="expand"
                @read-all="readAll(section.tripId)"
              />
            </template>

            <template v-else-if="panelMode === 'personal'">
              <!-- Шапка панели уже говорит «Сообщения»: второй заголовок
                   внутри был бы дублем. -->
              <NotificationSection
                :section-key="PERSONAL_SECTION_KEY"
                :title="PERSONAL_SECTION_TITLE"
                :items="notifications.personal"
                :open="true"
                :expanded-id="expandedId"
                :show-header="false"
                test-prefix="mobile-messages"
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
