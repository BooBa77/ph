<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  createAlmanacEntry,
  deleteAlmanacEntry,
  getTripAlmanac,
  updateAlmanacEntry,
} from '@/api/diary'
import { ApiError } from '@/api/errors'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import type {
  AlmanacEntry,
  AlmanacEntryPlace,
  TripAlmanac,
} from '@/types/diary'
import { markdownToHtml, userToken } from '@/utils/markdown'
import { tripDayCount, tripDayDate, tripDayNumber } from '@/utils/tripDay'
import TripAlmanacMemoryModal from '@/views/trips/TripAlmanacMemoryModal.vue'

/**
 * «Альманах» — секция «Гостевой» (22.11.2026).
 *
 * Заказчик: «Всё таки не будем создавать отдельную вкладку Альманах. Сделаем
 * это секцией в Гостевой»; «Чтобы было читабельно, обе секции „гостевой чат“
 * и „Альманах“ сделать сворачиваемыми, как Снаряжение и Питание. Гостевая
 * должна помнить состояние при переходах между закладками»; «Нужна кнопка
 * отображения инструментов редактирования альманаха, чтобы можно было
 * приятно читать без кнопок „удалить“ и „редактировать“».
 *
 * Отсюда устройство экрана:
 *
 * - **Секция, а не вкладка.** Свёрнутость — `<details>`, состояние — в
 *   `localStorage` на поход, как у «Снаряжения» и «Аптечки».
 * - **Читать — без кнопок.** Инструменты («Удалить», выбор места
 *   и «Написать») прячутся кнопкой «⋯» в заголовке.
 * - **Права приходят с сервера.** `canWrite` — участник может писать
 *   воспоминания, `canManage` — организатор может удалять любую строку.
 *   Экран не повторяет правила.
 * - **Место вставки — выбор участника.** «До похода» — после допоходных
 *   записей дневников, «День N» — после дневников этого дня, «В конце» —
 *   итоговое воспоминание. Внутри инструмента-чата дня нет: место выбрано
 *   здесь, кнопкой.
 * - **Одна запись на день.** Если своё воспоминание в слоте уже есть,
 *   кнопка открывает его на дописывание, а не создаёт второе.
 * - **День дневниковой записи считает экран** по часовому поясу смотрящего
 *   (`tripDayNumber`), поэтому у дневниковых строк нет `dayIndex`.
 */
const props = defineProps<{
  trip: {
    id: string
    startsAt: string | null
    endsAt: string | null
    cancelledAt: string | null
  }
}>()

const router = useRouter()

const almanac = ref<TripAlmanac | null>(null)
const isLoading = ref(false)
const error = ref<string | null>(null)
const actionError = ref<string | null>(null)

/** Инструменты скрыты по умолчанию? Нет: сначала их видно, «⋯» убирает. */
const toolsHidden = ref(false)

// ───────────────────────────── свёрнутая секция ─────────────────────────────

const OPEN_STATE_PREFIX = 'ph.tripGuestView.open'

function openStateKey(tripId: string): string {
  return `${OPEN_STATE_PREFIX}.${tripId}`
}

const isOpen = ref(false)

function readOpenState(tripId: string): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(openStateKey(tripId))
    if (raw === null) return {}

    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}

    const result: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') result[key] = value
    }

    return result
  } catch {
    // Мусор в localStorage — свёрнутая секция, а не пустая «Гостевая».
    return {}
  }
}

/**
 * Записать только свой ключ, не затерев соседний.
 *
 * «Гостевой чат» и «Альманах» — две секции одной страницы, и каждая пишет
 * свою свёрнутость. Если писать прочитанное целиком, вторая секция потеряет
 * состояние первой, а требование заказчика — помнить обе.
 */
function writeOpenState(tripId: string, key: string, open: boolean): void {
  try {
    const next = { ...readOpenState(tripId), [key]: open }
    window.localStorage.setItem(openStateKey(tripId), JSON.stringify(next))
  } catch {
    // Хранилище недоступно — память секции до перезагрузки. Секция живёт.
  }
}

function applyOpenState(tripId: string): void {
  isOpen.value = readOpenState(tripId).almanac === true
}

function onToggle(event: Event): void {
  const open = (event.target as HTMLDetailsElement).open
  isOpen.value = open
  writeOpenState(props.trip.id, 'almanac', open)
}

// ───────────────────────────── данные ─────────────────────────────

async function load(): Promise<void> {
  if (isLoading.value) return

  isLoading.value = true
  error.value = null

  try {
    almanac.value = await getTripAlmanac(props.trip.id)
  } catch (problem) {
    error.value =
      problem instanceof ApiError
        ? problem.message
        : 'Не удалось открыть альманах. Попробуй ещё раз.'
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  applyOpenState(props.trip.id)
  void load()
})

const canWrite = computed(() => almanac.value?.canWrite ?? false)
const canManage = computed(() => almanac.value?.canManage ?? false)

/**
 * Есть ли что показывать. Число записей в заголовке не выводим: заказчик
 * попросил убрать счётчик, а пустое состояние проверяется по списку.
 */
const entryCount = computed(() => almanac.value?.entries.length ?? 0)

// ───────────────────────────── дни и группы ─────────────────────────────

const dayCount = computed(() => {
  const stored = tripDayCount(props.trip)
  if (stored !== null) return stored

  // Дат нет (или конец раньше начала) — показываем столько дней, сколько
  // встретилось в записях: прятать уже написанное хуже, чем показать
  // непронумерованный день.
  let max = 0
  for (const entry of almanac.value?.entries ?? []) {
    const day = dayOf(entry)
    if (day !== null && day > max) max = day
  }

  return max
})

/** Номер дня строки: у воспоминания — свой, у дневника — по местному времени. */
function dayOf(entry: AlmanacEntry): number | null {
  if (entry.kind === 'memory') {
    return entry.placement === 'day' ? (entry.dayIndex ?? null) : null
  }

  return tripDayNumber(props.trip, new Date(entry.createdAt))
}

interface AlmanacGroup {
  key: string
  title: string
  entries: AlmanacEntry[]
}

/**
 * Группы альманаха: «До похода», дни похода, «После похода».
 *
 * Порядок внутри группы — как просил заказчик: сначала все дневники
 * на этот день, потом воспоминания. Пустые группы не рисуются: место
 * вставки выбирается кнопкой, а не прокруткой пустых дней.
 */
const groups = computed<AlmanacGroup[]>(() => {
  const before: AlmanacEntry[] = []
  const after: AlmanacEntry[] = []
  const days = new Map<number, AlmanacEntry[]>()

  const last = dayCount.value
  const isKnownDay = (day: number): boolean => day >= 1 && day <= last

  for (const entry of almanac.value?.entries ?? []) {
    if (entry.kind === 'memory') {
      if (entry.placement === 'before') before.push(entry)
      else if (entry.placement === 'after') after.push(entry)
      else {
        const day = entry.dayIndex ?? 1
        days.set(day, [...(days.get(day) ?? []), entry])
      }
      continue
    }

    const day = dayOf(entry)

    if (day === null) before.push(entry)
    else if (!isKnownDay(day)) after.push(entry)
    else days.set(day, [...(days.get(day) ?? []), entry])
  }

  /**
   * Внутри дня — дневники первыми, воспоминания после (решение заказчика:
   * «сообщение вставляется после всех дневников на эту дату и под другими
   * возможными воспоминаниями участников»). В каждой части — по времени
   * создания: хроника читается сверху вниз.
   */
  const ordered = (list: AlmanacEntry[]): AlmanacEntry[] =>
    [...list].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'diary' ? -1 : 1
      return a.createdAt.localeCompare(b.createdAt)
    })

  const result: AlmanacGroup[] = []

  if (before.length > 0) {
    result.push({ key: 'before', title: 'До похода', entries: ordered(before) })
  }

  for (let day = 1; day <= last; day += 1) {
    const entries = days.get(day)
    if (!entries || entries.length === 0) continue

    result.push({
      key: `day-${day}`,
      title: dayTitle(day),
      entries: ordered(entries),
    })
  }

  if (after.length > 0) {
    result.push({ key: 'after', title: 'После похода', entries: ordered(after) })
  }

  return result
})

/** «День 3 · 16 ноября 2026»: без «г.» — в общем тексте это канцелярит. */
function dayTitle(day: number): string {
  const date = tripDayDate(props.trip, day)
  if (date === null) return `День ${day}`

  const dateText = date
    .toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    .replace(/\s*г\.$/, '')

  return `День ${day} · ${dateText}`
}

// ───────────────────────────── упоминания ─────────────────────────────

const mentionNames = computed<Record<string, string>>(() =>
  Object.fromEntries(
    (almanac.value?.entries ?? []).map((entry) => [
      userToken(entry.author.userId),
      entry.author.displayName,
    ]),
  ),
)

const mentionLinks = computed<Record<string, string>>(() =>
  Object.fromEntries(
    (almanac.value?.entries ?? []).map((entry) => [
      userToken(entry.author.userId),
      `/people/${entry.author.userId}`,
    ]),
  ),
)

function bodyHtml(entry: AlmanacEntry): string {
  return markdownToHtml(entry.body, mentionNames.value, mentionLinks.value)
}

/** Ссылка на профиль внутри markdown — через роутер, без перезагрузки. */
function onEntryClick(event: MouseEvent): void {
  const target = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>(
    'a[data-user-id]',
  )
  if (!target) return

  event.preventDefault()
  void router.push({ name: 'person', params: { id: target.dataset.userId } })
}

// ───────────────────────────── выбор места и запись ─────────────────────────────

/** Значение выбора: `before`, `day:N` или `after`. */
const place = ref('before')

const placeOptions = computed(() => {
  const options: Array<{ value: string; label: string }> = [
    { value: 'before', label: 'До похода' },
  ]

  const last = dayCount.value
  for (let day = 1; day <= last; day += 1) {
    const mine = myMemory('day', day)
    options.push({
      value: `day:${day}`,
      label: `${dayTitle(day)}${mine ? ' · уже есть' : ''}`,
    })
  }

  options.push({ value: 'after', label: 'В конце — итоговое' })

  return options
})

/** Моё воспоминание в слоте: на день — одно, «до» и «после» — тоже. */
function myMemory(placement: 'before' | 'day' | 'after', day?: number): AlmanacEntry | null {
  return (
    almanac.value?.entries.find(
      (entry) =>
        entry.kind === 'memory' &&
        entry.canEdit &&
        entry.placement === placement &&
        (placement !== 'day' || entry.dayIndex === day),
    ) ?? null
  )
}

function selectedPlace(): AlmanacEntryPlace {
  if (place.value.startsWith('day:')) {
    return { placement: 'day', dayIndex: Number(place.value.slice(4)) }
  }

  return { placement: place.value as 'before' | 'after' }
}

const selectedMemory = computed<AlmanacEntry | null>(() => {
  const target = selectedPlace()
  return myMemory(target.placement, target.dayIndex)
})

// ───────────────────────────── модалка-чат ─────────────────────────────

const modal = ref<
  | {
      entryId: string | null
      place: AlmanacEntryPlace
      body: string
    }
  | null
>(null)
const isSaving = ref(false)
const modalError = ref<string | null>(null)

function openMemory(): void {
  actionError.value = null
  modalError.value = null

  const existing = selectedMemory.value
  modal.value = existing
    ? { entryId: existing.id, place: selectedPlace(), body: existing.body }
    : { entryId: null, place: selectedPlace(), body: '' }
}

function closeModal(): void {
  if (isSaving.value) return
  modal.value = null
  modalError.value = null
}

async function saveMemory(body: string): Promise<void> {
  const target = modal.value
  if (!target || isSaving.value) return

  isSaving.value = true
  modalError.value = null

  try {
    almanac.value = target.entryId
      ? await updateAlmanacEntry(props.trip.id, target.entryId, body)
      : await createAlmanacEntry(props.trip.id, target.place, body)
    modal.value = null
  } catch (problem) {
    modalError.value =
      problem instanceof ApiError
        ? problem.message
        : 'Не удалось сохранить воспоминание. Попробуй ещё раз.'
  } finally {
    isSaving.value = false
  }
}

// ───────────────────────────── удаление ─────────────────────────────

/** Удаление в два нажатия, как в дневнике: запись исчезает сразу и навсегда. */
const confirmDeleteId = ref<string | null>(null)
const isDeleting = ref(false)

async function removeEntry(entry: AlmanacEntry): Promise<void> {
  if (confirmDeleteId.value !== entry.id) {
    confirmDeleteId.value = entry.id
    return
  }

  confirmDeleteId.value = null
  isDeleting.value = true
  actionError.value = null

  try {
    almanac.value = await deleteAlmanacEntry(props.trip.id, entry.id)
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError
        ? problem.message
        : 'Не удалось удалить запись альманаха'
  } finally {
    isDeleting.value = false
  }
}

/** «14:05» — только у дневниковых строк: у воспоминаний времени нет. */
function entryTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <details
    :open="isOpen"
    class="rounded-2xl border border-border bg-surface"
    data-test="trip-almanac"
    @toggle="onToggle"
  >
    <summary
      class="relative cursor-pointer select-none px-4 py-3 text-sm font-medium text-text"
    >
      <span class="inline-block max-w-full truncate align-bottom">Альманах</span>

      <button
        v-if="almanac && (canWrite || canManage)"
        type="button"
        class="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer rounded-lg border border-border bg-white px-1.5 py-0.5 text-xs text-muted transition-colors hover:border-primary hover:text-text"
        :aria-expanded="!toolsHidden"
        :aria-label="toolsHidden ? 'Показать инструменты' : 'Скрыть инструменты'"
        :title="toolsHidden ? 'Показать инструменты' : 'Скрыть инструменты'"
        data-test="almanac-tools-toggle"
        @click.prevent.stop="toolsHidden = !toolsHidden"
      >
        ⋯
      </button>
    </summary>

    <div class="flex flex-col gap-4 border-t border-border px-4 py-4">
      <p v-if="error" class="text-sm text-muted" data-test="almanac-error">{{ error }}</p>

      <p v-else-if="isLoading" class="text-sm text-muted" data-test="almanac-loading">
        Открываем альманах…
      </p>

      <template v-else-if="almanac">
        <!--
          Инструменты: выбор места и кнопка «Написать». Скрываются «⋯» —
          читать альманах приятнее без кнопок.
        -->
        <div
          v-if="canWrite && !toolsHidden"
          class="flex flex-col gap-2 sm:flex-row sm:items-center"
          data-test="almanac-compose"
        >
          <label class="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
            Место вставки
            <select
              v-model="place"
              class="w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-text transition-colors focus:border-primary focus:outline-none"
              data-test="almanac-place"
            >
              <option v-for="option in placeOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>

          <button
            type="button"
            class="cursor-pointer self-end rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
            :disabled="isSaving"
            data-test="almanac-write"
            @click="openMemory"
          >
            {{ selectedMemory ? 'Дописать' : 'Написать' }}
          </button>
        </div>

        <p v-if="actionError" class="text-sm text-red-600" data-test="almanac-action-error">
          {{ actionError }}
        </p>

        <p
          v-if="entryCount === 0"
          class="py-6 text-center text-sm text-muted"
          data-test="almanac-empty"
        >
          Пока пусто. Сюда попадают записи дневников с пометкой «в альманах»
          и воспоминания участников.
        </p>

        <div
          v-else
          class="flex flex-col gap-6"
          data-test="almanac-days"
          @click="onEntryClick"
        >
          <section
            v-for="group in groups"
            :key="group.key"
            class="flex min-w-0 flex-col gap-3"
          >
            <div class="flex items-center gap-2 text-xs text-muted" data-test="almanac-day">
              <span class="h-px flex-1 bg-border" />
              <span class="shrink-0">{{ group.title }}</span>
              <span class="h-px flex-1 bg-border" />
            </div>

            <article
              v-for="entry in group.entries"
              :key="entry.id"
              class="flex min-w-0 flex-col gap-1"
              data-test="almanac-entry"
            >
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <UserAvatar
                  :src="entry.author.avatarUrl"
                  :alt="entry.author.displayName"
                  :size="24"
                />
                <span class="min-w-0 truncate text-sm font-medium text-text" data-test="almanac-author">
                  {{ entry.author.displayName }}
                </span>
                <!--
                  Время — только у дневниковой строки. Воспоминание — это
                  «как вспомнилось», а не хроника дня; заказчик просил
                  формат «участник, сообщение, без времени».
                -->
                <span
                  v-if="entry.kind === 'diary'"
                  class="text-[11px] text-muted"
                  data-test="almanac-entry-time"
                >
                  {{ entryTime(entry.createdAt) }}
                </span>

                <!--
                  Из ленты ничего не правится: чужую запись админ не
                  редактирует (только удаляет), а своё воспоминание человек
                  дописывает кнопкой «Дописать» в инструментах — там же, где
                  выбирал место. Дневниковая строка правится в дневнике.
                -->
                <span class="ml-auto flex shrink-0 gap-2">
                  <button
                    v-if="entry.canDelete && !toolsHidden"
                    type="button"
                    class="cursor-pointer text-xs text-muted underline transition-colors hover:text-red-600"
                    :disabled="isDeleting"
                    data-test="almanac-delete"
                    @click="removeEntry(entry)"
                  >
                    {{ confirmDeleteId === entry.id ? 'Точно?' : 'Удалить' }}
                  </button>
                </span>
              </div>

              <div
                class="min-w-0 break-words text-sm leading-relaxed text-text"
                data-test="almanac-entry-body"
                v-html="bodyHtml(entry)"
              />
            </article>
          </section>
        </div>
      </template>
    </div>

    <TripAlmanacMemoryModal
      v-if="modal"
      :initial-body="modal.body"
      :busy="isSaving"
      :error="modalError"
      @save="saveMemory"
      @close="closeModal"
    />
  </details>
</template>
