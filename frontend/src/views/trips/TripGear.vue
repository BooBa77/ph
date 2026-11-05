<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  listGear,
  listTripGear,
  proposeTripGear,
  removeTripGear,
  updateTripGear,
} from '@/api/gear'
import { listParticipants } from '@/api/trips'
import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import TripGearExtraPicker from '@/components/gear/TripGearExtraPicker.vue'
import TripGearManualModal from '@/components/gear/TripGearManualModal.vue'
import type { GearItem, TripGearItem, TripGearStatus } from '@/types/gear'
import type { Trip, TripParticipant } from '@/types/trips'
import {
  formatWeightTotal,
  weightInGrams,
} from '@/utils/gearWeight'

/**
 * Вкладка «Снаряжение» похода (код `gear`), первый проход по фронту
 * (05.11.2026).
 *
 * План целиком — `docs/ph/gear-tab.md`. По нему на странице **две большие
 * сворачиваемые секции**: общественное снаряжение (цвет темы, заказчик
 * склоняется к красно-коричневому) и личное (синее, как у «Питания»
 * и «Спальника»). Внутри — вложенные секции, каждая со своим сворачиванием.
 *
 * **«Список» этого шага не рисуем.** План ставит его первым в обеих
 * больших секциях, но логику чек-листов заказчик ещё не описал: «Логику
 * «Списка» заказчик расскажет позже». Придумать её сейчас значило бы
 * сделать экран, который потом переделывать.
 *
 * **Что уже работает на настоящих данных:**
 * - «Берём» — снаряжение похода (`GET /api/trips/:id/gear`). Предложенные
 *   вещи ждут решения, утверждённые стоят сплошными пилюлями, отклонённые
 *   убираются в свёрнутый блок «Не берём» — «эту палатку обсуждали» тоже
 *   ответ. Статус меняет тот, кому роль дала вкладку (`canEdit`), остальные
 *   видят подпись «ждёт решения»: права считает сервер.
 * - «Распределение» — плитки-рюкзаки участников со статусом «Идёт»
 *   (`docs/ph/gear-distribution.md` §5). Вещь перетаскивается мышью или
 *   переносится выпадающим списком (он же путь для телефона: HTML5-drag
 *   на касании не работает). Назначение — отдельное поле `assignedUserId`,
 *   а не смена владельца: вещь остаётся в каталоге владельца, как и решено
 *   в §5.
 * - «Взял» — общественные вещи, назначенные на меня, и «Мой рюкзак» —
 *   то же с итоговым весом. Личные вещи и дополнительные рюкзаки ждут
 *   модели: в `trip_gear` их ещё нет, и придумывать её на экране рано.
 *
 * **Модалка одна на всё приложение.** «Добавить снаряжение» открывает
 * общий `TripGearExtraPicker` (05.11.2026) со своим `storageKey`, «Добавить
 * вручную» — общую `TripGearManualModal`. Копий форм здесь нет: у вкладки
 * свои заголовок, память свёрнутых групп и подпись, а сохранение остаётся
 * этому экрану.
 *
 * **Цвет общественной секции — временный.** Заказчик ещё не выбрал
 * окончательный оттенок; когда выберет, цвет переедет в тему
 * (`themes.css`), а не останется значением в разметке.
 */
const props = withDefaults(
  defineProps<{
    trip: Trip
    /** Правит ли смотрящий снаряжение: статусы и удаление чужих вещей. */
    canEdit?: boolean
  }>(),
  { canEdit: false },
)

const auth = useAuthStore()

const meId = computed(() => auth.user?.id ?? '')

const items = ref<TripGearItem[]>([])
const participants = ref<TripParticipant[]>([])

const isLoading = ref(true)
const error = ref<string | null>(null)
/** Ошибка действия: её показываем рядом, не закрывая уже загруженный список. */
const actionError = ref<string | null>(null)
/** Состав не загрузился — имена в рюкзаках будут неполными, но экран живёт. */
const peopleError = ref<string | null>(null)

/** Вещь, по которой идёт запрос: её поля блокируются до ответа. */
const busyId = ref<string | null>(null)
const removingId = ref<string | null>(null)

// ───────────────────────────── личный каталог и модалки ─────────────────────────────

const isPickerOpen = ref(false)
const isManualOpen = ref(false)
const catalog = ref<GearItem[]>([])
const isCatalogLoading = ref(false)
const isCatalogLoaded = ref(false)
const catalogError = ref<string | null>(null)
const isAdding = ref(false)

// ───────────────────────────── производные списки ─────────────────────────────

const approved = computed(() => items.value.filter((item) => item.status === 'approved'))
const proposed = computed(() => items.value.filter((item) => item.status === 'proposed'))
const declined = computed(() => items.value.filter((item) => item.status === 'declined'))

/** «Берём»: сначала утверждённое, потом ожидающее решения. */
const taking = computed(() => [...approved.value, ...proposed.value])

/** Утверждённое без несущего: его и перетаскивают в рюкзаки. */
const unassigned = computed(() => approved.value.filter((item) => item.assignedUserId === null))

/** Плитки строятся только по «иду»: «пока не решил» ещё не несёт груз. */
const going = computed(() => participants.value.filter((person) => person.status === 'going'))

/** Общественное, которое несу я: это и «Взял», и содержимое «Моего рюкзака». */
const myItems = computed(() =>
  approved.value.filter((item) => item.assignedUserId !== null && item.assignedUserId === meId.value),
)

/**
 * Рюкзаки участников одним проходом: список вещей и итог считаются здесь,
 * а не в разметке по три раза на плитку.
 */
const bags = computed(() =>
  going.value.map((person) => {
    const list = approved.value.filter((item) => item.assignedUserId === person.userId)

    return { person, items: list, weight: weightTotalLabel(list) }
  }),
)

/** Организатору — выбор хозяина для «Добавить вручную», как в «Ночёвках». */
const isOrganizer = computed(() => props.trip.organizerUserId === meId.value)

const manualOwnerOptions = computed(() => {
  if (!isOrganizer.value) return []

  const virtuals = participants.value.filter((person) => person.isVirtual)
  if (virtuals.length === 0) return []

  return [
    { userId: meId.value, displayName: `${auth.user?.displayName ?? 'Я'} (я)` },
    ...virtuals.map((person) => ({
      userId: person.userId,
      displayName: `${person.displayName} (без аккаунта)`,
    })),
  ]
})

/** Название для подписи владельца: состав приходит отдельно от снаряжения. */
function personName(userId: string): string {
  return participants.value.find((person) => person.userId === userId)?.displayName ?? 'Участник'
}

/** Подпись участника в списке «кому»: себя помечаем словом «я». */
function personOptionLabel(person: TripParticipant): string {
  return person.userId === meId.value
    ? `${person.displayName} (я)`
    : person.displayName
}

/**
 * Итог по набору вещей той же строкой, что в каталоге: «Всего: 3,2 кг ·
 * без веса: 1». Неизвестный вес не прячем: иначе итог выглядел бы точным.
 */
function weightTotalLabel(list: TripGearItem[]): string {
  if (list.length === 0) return '—'

  const withWeight = list.filter((item) => item.weightGrams !== null)
  const total = withWeight.reduce((sum, item) => sum + (item.weightGrams ?? 0), 0)

  return formatWeightTotal(total, list.length - withWeight.length)
}

/** Крестик «убрать из похода»: своя вещь — владельцу, чужая — ведущему. */
function canRemove(item: TripGearItem): boolean {
  return props.canEdit || item.ownerUserId === meId.value
}

// ───────────────────────────── загрузка ─────────────────────────────

/**
 * Счётчик запросов: пока ответ едет, поход могли переключить, и поздний
 * ответ прошлого похода не должен перетереть уже показанный новый.
 */
let requestId = 0

async function load(): Promise<void> {
  const current = ++requestId
  isLoading.value = true
  error.value = null
  actionError.value = null
  peopleError.value = null

  try {
    const list = await listTripGear(props.trip.id)
    if (current !== requestId) return

    items.value = list.items

    // Состав нужен только подписям и плиткам рюкзаков: его падение экран
    // не закрывает — снаряжение важнее имён.
    try {
      participants.value = await listParticipants(props.trip.id)
    } catch {
      if (current === requestId) {
        participants.value = []
        peopleError.value = 'Состав похода не загрузился — имена в рюкзаках могут быть неполными'
      }
    }
  } catch (problem) {
    if (current !== requestId) return

    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить снаряжение похода'
  } finally {
    if (current === requestId) isLoading.value = false
  }
}

watch(() => props.trip.id, load, { immediate: true })

// ───────────────────────────── действия ─────────────────────────────

/**
 * Общая правка строки: статус и/или несущий.
 *
 * При ошибке список перерисовывается из прежних данных: `select` уже
 * показал выбранное значение, и без перерисовки экран врал бы, что изменение
 * сохранилось.
 */
async function patchItem(item: TripGearItem, body: { status?: TripGearStatus; assignedUserId?: string | null }): Promise<void> {
  if (busyId.value !== null) return

  busyId.value = item.id
  actionError.value = null

  try {
    const updated = await updateTripGear(props.trip.id, item.id, body)
    items.value = items.value.map((row) => (row.id === updated.id ? updated : row))
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось сохранить изменение'
    items.value = [...items.value]
  } finally {
    busyId.value = null
  }
}

/** Статус выбрали в «Берём»: «Предложено / Берём / Не берём». */
async function onStatusChange(item: TripGearItem, event: Event): Promise<void> {
  const status = (event.target as HTMLSelectElement).value as TripGearStatus
  await patchItem(item, { status })
}

/** Несущего меняли перетаскиванием или списком. */
async function onAssigneeChange(item: TripGearItem, event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value
  await patchItem(item, { assignedUserId: value === '' ? null : value })
}

/**
 * Перетаскивание пилюли между рюкзаками.
 *
 * Мышь тянет пилюлю, плитка принимает её на `drop`; тот же выбор есть
 * в выпадающем списке пилюли, потому что HTML5-drag на телефоне не работает.
 */
const draggingId = ref<string | null>(null)

function startDrag(item: TripGearItem, event: DragEvent): void {
  draggingId.value = item.id

  // Firefox без setData не начинает перетаскивание, даже у draggable-элемента.
  // Данные не читаем: важен сам факт «тащим эту пилюлю».
  event.dataTransfer?.setData('text/plain', item.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

async function dropOn(userId: string | null): Promise<void> {
  const item = items.value.find((row) => row.id === draggingId.value)
  draggingId.value = null

  if (!item || item.assignedUserId === userId) return

  await patchItem(item, { assignedUserId: userId })
}

/** Убрать вещь из похода: строка `trip_gear` уходит, каталог владельца цел. */
async function remove(item: TripGearItem): Promise<void> {
  if (removingId.value !== null) return

  removingId.value = item.id
  actionError.value = null

  try {
    await removeTripGear(props.trip.id, item.id)
    items.value = items.value.filter((row) => row.id !== item.id)
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось убрать вещь из похода'
  } finally {
    removingId.value = null
  }
}

/**
 * «Добавить снаряжение»: открываем общую модалку, каталог грузим один раз.
 *
 * Пустой каталог не мешает: в модалке остаётся «Добавить вручную» — так
 * в поход попадает вещь, которой дома ещё нет.
 */
async function openPicker(): Promise<void> {
  isPickerOpen.value = true
  catalogError.value = null

  if (isCatalogLoaded.value || isCatalogLoading.value) return

  isCatalogLoading.value = true

  try {
    const list = await listGear()
    catalog.value = list.items
    isCatalogLoaded.value = true
  } catch (problem) {
    catalogError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить личное снаряжение'
    // Модалка закрывается: текст ошибки стоит у кнопки, а не под оверлеем,
    // и повторное нажатие «Добавить снаряжение» попробует ещё раз.
    isPickerOpen.value = false
  } finally {
    isCatalogLoading.value = false
  }
}

/** Выбрали вещь каталога: она уходит в поход предложением, как и раньше. */
async function onPick(item: GearItem): Promise<void> {
  if (isAdding.value) return

  isAdding.value = true
  actionError.value = null

  try {
    const created = await proposeTripGear(props.trip.id, item.id)
    items.value = [...items.value, created]
    isPickerOpen.value = false
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось добавить вещь в поход'
  } finally {
    isAdding.value = false
  }
}

/** «Добавить вручную»: форма открывается поверх выбора, как в «Ночёвках». */
function openManual(): void {
  isManualOpen.value = true
}

function onManualCreated(item: TripGearItem): void {
  items.value = [...items.value, item]
  isManualOpen.value = false
  isPickerOpen.value = false
}

/** Каталог, из которого нельзя предложить: то, что уже в походе. */
const excludedIds = computed(() => items.value.map((item) => item.gearItemId))
</script>

<template>
  <section class="flex flex-col gap-3" data-test="trip-gear">
    <p v-if="isLoading" class="text-sm text-muted" data-test="gear-loading">
      Загружаем снаряжение…
    </p>

    <p v-else-if="error" class="text-sm text-muted" data-test="gear-error">{{ error }}</p>

    <template v-else>
      <p v-if="actionError" class="text-sm text-red-600" data-test="gear-action-error">
        {{ actionError }}
      </p>

      <p v-if="peopleError" class="text-xs text-muted" data-test="gear-people-error">
        {{ peopleError }}
      </p>

      <!--
        Общественное снаряжение — цвет темы. Заказчик ещё выбирает
        красно-коричневый оттенок, поэтому пока палитра Tailwind; когда
        выберет, цвет переедет в `themes.css` и сюда станет токеном.
      -->
      <details
        open
        class="flex flex-col gap-3 rounded-2xl border border-orange-900 bg-orange-100 p-3"
        data-test="gear-public-section"
      >
        <summary class="cursor-pointer select-none text-sm font-medium text-orange-900">
          Общественное снаряжение
        </summary>

        <!-- «Берём»: пул вещей похода и решение «берём / не берём» -->
        <details
          open
          class="rounded-xl border border-border bg-white p-3"
          data-test="gear-taking"
        >
          <summary class="cursor-pointer select-none text-sm font-medium text-text">
            Берём<template v-if="taking.length > 0"> · {{ taking.length }}</template>
          </summary>

          <div class="mt-2 flex flex-col gap-2">
            <p
              v-if="taking.length === 0"
              class="text-sm text-muted"
              data-test="gear-taking-empty"
            >
              Пока ничего не собрано. Добавьте снаряжение из личного каталога или вручную —
              вещь появится здесь.
            </p>

            <ul v-else class="flex flex-wrap gap-1.5">
              <li
                v-for="item in taking"
                :key="item.id"
                class="flex flex-wrap items-center gap-1 rounded-xl border px-2 py-1 text-sm"
                :class="
                  item.status === 'approved'
                    ? 'border-orange-300 bg-orange-50 text-text'
                    : 'border-dashed border-border bg-surface text-muted'
                "
                :data-test="`gear-taking-item-${item.id}`"
              >
                <span class="font-medium">{{ item.title }}</span>
                <span v-if="weightInGrams(item.weightGrams)" class="text-xs text-muted">
                  {{ weightInGrams(item.weightGrams) }}
                </span>
                <span class="text-xs text-muted">· {{ personName(item.ownerUserId) }}</span>

                <!--
                  Статус меняет только тот, кому роль дала вкладку. Остальные
                  видят «ждёт решения»: права считает сервер, экран не спорит.
                -->
                <div class="ml-auto flex items-center gap-1">
                  <select
                    v-if="canEdit"
                    :value="item.status"
                    :disabled="busyId === item.id"
                    class="cursor-pointer rounded-lg border border-border bg-field px-2 py-1 text-base text-text focus:border-primary focus:outline-none disabled:opacity-50 md:px-1 md:py-0.5 md:text-xs"
                    aria-label="Статус вещи: предложена, берём или не берём"
                    :data-test="`gear-taking-status-${item.id}`"
                    @change="onStatusChange(item, $event)"
                  >
                    <option value="proposed">Предложено</option>
                    <option value="approved">Берём</option>
                    <option value="declined">Не берём</option>
                  </select>
                  <span
                    v-else-if="item.status === 'proposed'"
                    class="text-xs italic text-muted"
                    :data-test="`gear-taking-pending-${item.id}`"
                  >
                    ждёт решения
                  </span>

                  <button
                    v-if="canRemove(item)"
                    type="button"
                    class="cursor-pointer border-0 bg-transparent px-1 py-1 text-base text-muted transition-colors hover:text-red-600 disabled:opacity-40 md:py-0 md:text-xs"
                    title="Убрать вещь из похода"
                    :disabled="removingId === item.id"
                    :data-test="`gear-taking-remove-${item.id}`"
                    @click="remove(item)"
                  >
                    ✕
                  </button>
                </div>
              </li>
            </ul>

            <p v-if="catalogError" class="text-xs text-red-600" data-test="gear-catalog-error">
              {{ catalogError }}
            </p>

            <button
              type="button"
              class="cursor-pointer self-start rounded-xl border border-orange-900 bg-orange-900 px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90"
              data-test="gear-add"
              @click="openPicker"
            >
              Добавить снаряжение
            </button>

            <!--
              «Не берём» — отдельным свёрнутым блоком: решение принято, но
              вопрос обсуждали, и вещь не должна исчезать бесследно.
            -->
            <details
              v-if="declined.length > 0"
              class="rounded-xl border border-border bg-surface p-2"
              data-test="gear-declined"
            >
              <summary class="cursor-pointer select-none text-xs text-muted">
                Не берём · {{ declined.length }}
              </summary>

              <ul class="mt-2 flex flex-wrap gap-1.5">
                <li
                  v-for="item in declined"
                  :key="item.id"
                  class="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-white px-2 py-1 text-sm text-muted"
                  :data-test="`gear-declined-item-${item.id}`"
                >
                  <span class="line-through">{{ item.title }}</span>
                  <span class="text-xs">· {{ personName(item.ownerUserId) }}</span>

                  <button
                    v-if="canEdit"
                    type="button"
                    class="cursor-pointer rounded-lg border border-border px-1.5 py-0.5 text-xs text-muted transition-colors hover:border-primary hover:text-text disabled:opacity-40"
                    :disabled="busyId === item.id"
                    :data-test="`gear-declined-restore-${item.id}`"
                    @click="patchItem(item, { status: 'proposed' })"
                  >
                    Вернуть
                  </button>
                </li>
              </ul>
            </details>
          </div>
        </details>

        <!--
          «Распределение» — плитки-рюкзаки по «иду». Вещь перетаскивается
          мышью или переносится списком: на телефоне drag&drop не бывает,
          а назначить вещь человек вправе с любого устройства.
        -->
        <details
          open
          class="rounded-xl border border-border bg-white p-3"
          data-test="gear-distribution"
        >
          <summary class="cursor-pointer select-none text-sm font-medium text-text">
            Распределение
          </summary>

          <div class="mt-2 flex flex-col gap-2">
            <p
              v-if="approved.length === 0"
              class="text-sm text-muted"
              data-test="gear-distribution-empty"
            >
              Распределять пока нечего: сначала решите, что берём.
            </p>

            <template v-else>
              <div
                class="rounded-xl border border-dashed p-2 transition-colors"
                :class="draggingId ? 'border-primary bg-primary/5' : 'border-border bg-surface'"
                data-test="gear-unassigned"
                @dragover.prevent
                @drop.prevent="dropOn(null)"
              >
                <p class="text-xs font-medium text-muted">
                  Не распределено · {{ unassigned.length }}
                </p>

                <ul v-if="unassigned.length > 0" class="mt-1 flex flex-wrap gap-1.5">
                  <li
                    v-for="item in unassigned"
                    :key="item.id"
                    class="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-white px-2 py-1 text-sm"
                    draggable="true"
                    :data-test="`gear-unassigned-item-${item.id}`"
                    @dragstart="startDrag(item, $event)"
                  >
                    <span class="font-medium">{{ item.title }}</span>
                    <span v-if="weightInGrams(item.weightGrams)" class="text-xs text-muted">
                      {{ weightInGrams(item.weightGrams) }}
                    </span>
                    <span class="text-xs text-muted">· {{ personName(item.ownerUserId) }}</span>

                    <select
                      :value="item.assignedUserId ?? ''"
                      :disabled="busyId === item.id"
                      class="ml-auto cursor-pointer rounded-lg border border-border bg-field px-2 py-1 text-base text-text focus:border-primary focus:outline-none disabled:opacity-50 md:px-1 md:py-0.5 md:text-xs"
                      aria-label="Кому едет вещь"
                      :data-test="`gear-unassigned-assign-${item.id}`"
                      @change="onAssigneeChange(item, $event)"
                    >
                      <option value="">Не распределено</option>
                      <option v-for="person in going" :key="person.userId" :value="person.userId">
                        {{ personOptionLabel(person) }}
                      </option>
                    </select>
                  </li>
                </ul>

                <p v-else class="mt-1 text-xs text-muted">Всё разобрано по рюкзакам.</p>
              </div>

              <p
                v-if="going.length === 0"
                class="text-sm text-muted"
                data-test="gear-going-empty"
              >
                В походе пока никто не идёт — распределять не между кем.
              </p>

              <div v-else class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <div
                  v-for="bag in bags"
                  :key="bag.person.userId"
                  class="flex flex-col gap-1 rounded-xl border bg-white p-2 transition-colors"
                  :class="bag.person.userId === meId ? 'border-primary' : 'border-border'"
                  :data-test="`gear-bag-${bag.person.userId}`"
                  @dragover.prevent
                  @drop.prevent="dropOn(bag.person.userId)"
                >
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="truncate text-sm font-medium text-text">
                      {{ personOptionLabel(bag.person) }}
                    </span>
                    <span class="shrink-0 text-xs text-muted">{{ bag.weight }}</span>
                  </div>

                  <ul v-if="bag.items.length > 0" class="flex flex-col gap-1">
                    <li
                      v-for="item in bag.items"
                      :key="item.id"
                      class="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-sm"
                      draggable="true"
                      :data-test="`gear-bag-item-${item.id}`"
                      @dragstart="startDrag(item, $event)"
                    >
                      <span class="min-w-0 truncate">{{ item.title }}</span>
                      <span v-if="weightInGrams(item.weightGrams)" class="text-xs text-muted">
                        {{ weightInGrams(item.weightGrams) }}
                      </span>

                      <select
                        :value="item.assignedUserId ?? ''"
                        :disabled="busyId === item.id"
                        class="ml-auto cursor-pointer rounded-lg border border-border bg-field px-2 py-1 text-base text-text focus:border-primary focus:outline-none disabled:opacity-50 md:px-1 md:py-0.5 md:text-xs"
                        aria-label="Кому едет вещь"
                        :data-test="`gear-assign-${item.id}`"
                        @change="onAssigneeChange(item, $event)"
                      >
                        <option value="">Не распределено</option>
                        <option v-for="person in going" :key="person.userId" :value="person.userId">
                          {{ personOptionLabel(person) }}
                        </option>
                      </select>
                    </li>
                  </ul>

                  <p v-else class="text-xs text-muted">Ничего не назначено</p>
                </div>
              </div>
            </template>
          </div>
        </details>
      </details>

      <!-- Личное снаряжение — синее, как «Питание» и «Спальник» -->
      <details
        open
        class="flex flex-col gap-3 rounded-2xl border border-blue-300 bg-blue-100 p-3"
        data-test="gear-personal-section"
      >
        <summary class="cursor-pointer select-none text-sm font-medium text-blue-900">
          Личное снаряжение
        </summary>

        <!-- «Взял»: то, что назначено на меня -->
        <details
          open
          class="rounded-xl border border-border bg-white p-3"
          data-test="gear-taken"
        >
          <summary class="cursor-pointer select-none text-sm font-medium text-text">
            Взял<template v-if="myItems.length > 0"> · {{ myItems.length }}</template>
          </summary>

          <div class="mt-2 flex flex-col gap-2">
            <p v-if="myItems.length === 0" class="text-sm text-muted" data-test="gear-taken-empty">
              Вы пока ничего не несёте: вещи назначаются в «Распределении».
            </p>

            <ul v-else class="flex flex-wrap gap-1.5">
              <li
                v-for="item in myItems"
                :key="item.id"
                class="flex flex-wrap items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2 py-1 text-sm text-blue-900"
                :data-test="`gear-taken-item-${item.id}`"
              >
                <span>{{ item.title }}</span>
                <span v-if="weightInGrams(item.weightGrams)" class="text-xs">
                  · {{ weightInGrams(item.weightGrams) }}
                </span>
                <span class="text-xs text-blue-700">· {{ item.typeName }}</span>
              </li>
            </ul>
          </div>
        </details>

        <!--
          «Мой рюкзак» — то же, что моя плитка в «Распределении», с итогом.
          Личные вещи и дополнительные рюкзаки («сменка на окончание похода»)
          появятся, когда у них будет модель: сейчас их негде хранить.
        -->
        <details
          open
          class="rounded-xl border border-border bg-white p-3"
          data-test="gear-backpack"
        >
          <summary class="cursor-pointer select-none text-sm font-medium text-text">
            Мой рюкзак
          </summary>

          <div class="mt-2 flex flex-col gap-2">
            <p v-if="myItems.length === 0" class="text-sm text-muted" data-test="gear-backpack-empty">
              В рюкзаке пусто.
            </p>

            <template v-else>
              <ul class="flex flex-col gap-1">
                <li
                  v-for="item in myItems"
                  :key="item.id"
                  class="flex items-baseline justify-between gap-2 rounded-lg border border-border bg-surface px-2 py-1 text-sm"
                  :data-test="`gear-backpack-item-${item.id}`"
                >
                  <span class="min-w-0 truncate">{{ item.title }}</span>
                  <span class="shrink-0 text-xs text-muted">
                    {{ weightInGrams(item.weightGrams) ?? 'без веса' }}
                  </span>
                </li>
              </ul>

              <p class="text-sm font-medium text-text" data-test="gear-backpack-total">
                {{ weightTotalLabel(myItems) }}
              </p>
            </template>
          </div>
        </details>
      </details>
    </template>

    <TripGearExtraPicker
      v-if="isPickerOpen"
      :items="catalog"
      :exclude-ids="excludedIds"
      :loading="isCatalogLoading"
      title="Добавить снаряжение"
      storage-key="ph.tripGear.picker"
      @pick="onPick"
      @manual="openManual"
      @close="isPickerOpen = false"
    />

    <TripGearManualModal
      v-if="isManualOpen"
      :trip-id="trip.id"
      :type-codes="[]"
      default-type-code=""
      :owner-options="manualOwnerOptions"
      @created="onManualCreated"
      @close="isManualOpen = false"
    />
  </section>
</template>
