<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { getTripFirstAid, setFirstAidWeight } from '@/api/firstAid'
import { ApiError } from '@/api/errors'
import TripChat from '@/views/trips/TripChat.vue'
import TripGearChecklist from '@/components/gear/TripGearChecklist.vue'
import type { Checklist } from '@/types/checklists'
import type {
  FirstAidSection,
  FirstAidWeightScope,
  TripFirstAid,
} from '@/types/firstAid'
import type { Trip } from '@/types/trips'
import { parseWeightGrams } from '@/utils/gearWeight'

/**
 * Вкладка «Аптечка» похода (09.11.2026).
 *
 * Заказчик: «Открываем закладку Аптечка. Примерно как Снаряжение, две
 * секции — Общественная (если назначен Доктор) и Личная + чат по аптечке.
 * В секциях по одному чек-листу, не нужно вкладывать в ещё одну секцию
 * „Список“, чек-лист прямо в основной секции, элементы управления позициями,
 * импорт из личного чек-листа, скрытие инструментов. Оформление и подписи
 * делай идентично с закладкой Снаряжение. Итогом каждой секции поле для
 * ввода веса получившейся аптечки».
 *
 * Отсюда устройство:
 *
 * - **две большие секции**, как «Общественное» и «Личное» в «Снаряжении»:
 *   та же рамка, тот же цвет, тот же треугольник и «⋯» для инструментов;
 * - **чек-лист лежит прямо в секции**, без вложенного «Списка»: в аптечке
 *   он один, и вторая рамка только отодвигала бы пункты;
 * - **вес — в конце секции**: это итог собранного, а не свойство пункта;
 * - **общественной секции нет, пока нет доктора** — сервер возвращает
 *   `shared: null`, и экран не рисует пустую рамку.
 *
 * Списки правит `TripGearChecklist`: аптечка — та же подсистема чек-листов,
 * просто с областью `first_aid`. Копия компонента разошлась бы с оригиналом
 * в правах и импорте.
 */
const props = defineProps<{ trip: Trip }>()

const state = ref<TripFirstAid | null>(null)
const isLoading = ref(true)
const error = ref<string | null>(null)
const weightError = ref<string | null>(null)
const savingScope = ref<FirstAidWeightScope | null>(null)

/**
 * Черновики веса. Храним строкой, как вводит человек: `parseWeightGrams`
 * различает «пусто» и «мусор», а `v-model.number` потерял бы разницу.
 */
const sharedWeight = ref('')
const personalWeight = ref('')

/** Инструменты секций скрываются кнопкой «⋯» — как в «Снаряжении». */
const sharedToolsHidden = ref(false)
const personalToolsHidden = ref(false)

// ───────────────────────────── свёрнутые секции ─────────────────────────────

/**
 * Развёрнутость секций на поход — тот же приём, что в «Снаряжении»
 * (06.11.2026): первый раз всё свёрнуто, дальше вкладка помнит выбор.
 * Ключ свой, чтобы «Аптечка» не разворачивала секции «Снаряжения».
 */
const OPEN_STATE_PREFIX = 'ph.tripFirstAid.open'

const openState = ref<Record<string, boolean>>({})

function openStateKey(tripId: string): string {
  return `${OPEN_STATE_PREFIX}.${tripId}`
}

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
    // Мусор в localStorage — те же свёрнутые секции, а не пустая вкладка.
    return {}
  }
}

function writeOpenState(tripId: string, next: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(openStateKey(tripId), JSON.stringify(next))
  } catch {
    // Хранилище недоступно — память секций до перезагрузки. Вкладка живёт.
  }
}

watch(
  () => props.trip.id,
  (tripId) => {
    openState.value = readOpenState(tripId)
  },
  { immediate: true },
)

function isSectionOpen(key: string): boolean {
  return openState.value[key] === true
}

function onSectionToggle(key: string, event: Event): void {
  const open = (event.target as HTMLDetailsElement).open
  if (openState.value[key] === open) return

  const next = { ...openState.value, [key]: open }
  openState.value = next
  writeOpenState(props.trip.id, next)
}

// ───────────────────────────── загрузка и вес ─────────────────────────────

function applyState(next: TripFirstAid): void {
  state.value = next
  sharedWeight.value = next.shared?.weightGrams?.toString() ?? ''
  personalWeight.value = next.personal.weightGrams?.toString() ?? ''
}

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null

  try {
    applyState(await getTripFirstAid(props.trip.id))
  } catch (problem) {
    error.value =
      problem instanceof ApiError
        ? problem.message
        : 'Не удалось загрузить аптечку похода'
    state.value = null
  } finally {
    isLoading.value = false
  }
}

watch(() => props.trip.id, load, { immediate: true })

/** Прогресс списка: «1/3» — как у чек-листов «Снаряжения». */
function progress(checklist: Checklist | null): string {
  const items = checklist?.items ?? []
  const done = items.filter((item) => item.isDone).length

  return done > 0 ? `${done}/${items.length}` : ''
}

const sharedProgress = computed(() => progress(state.value?.shared?.checklist ?? null))
const personalProgress = computed(() => progress(state.value?.personal.checklist ?? null))

/** Обновление списка из компонента: вес не трогаем. */
function applySharedChecklist(checklist: Checklist | null): void {
  if (!state.value?.shared) return
  state.value.shared = { ...state.value.shared, checklist }
}

function applyPersonalChecklist(checklist: Checklist | null): void {
  if (!state.value) return
  state.value.personal = { ...state.value.personal, checklist }
}

function sectionWeight(scope: FirstAidWeightScope): number | null {
  if (!state.value) return null
  return scope === 'shared'
    ? (state.value.shared?.weightGrams ?? null)
    : state.value.personal.weightGrams
}

/**
 * Вес сохраняется по уходу из поля, а не по каждой цифре: человек может
 * стереть старый вес и набрать новый, и промежуточное «1» не должно
 * уехать в поход. Ошибка ввода объясняется словами, а не молчанием.
 */
async function saveWeight(scope: FirstAidWeightScope): Promise<void> {
  if (!state.value || savingScope.value !== null) return
  if (scope === 'shared' && !state.value.shared?.canEdit) return

  const raw = scope === 'shared' ? sharedWeight.value : personalWeight.value
  const parsed = parseWeightGrams(raw)

  if (parsed === undefined) {
    weightError.value = 'Вес — целое число граммов, больше нуля. Или оставь поле пустым.'
    return
  }

  // Ничего не изменилось — не шлём запрос на пустом месте.
  if (parsed === sectionWeight(scope)) {
    weightError.value = null
    return
  }

  savingScope.value = scope
  weightError.value = null

  try {
    applyState(await setFirstAidWeight(props.trip.id, scope, parsed))
  } catch (problem) {
    weightError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось сохранить вес аптечки'
  } finally {
    savingScope.value = null
  }
}

/** Подпись у поля: «не взвешена» — это законное состояние, а не ошибка. */
function weightHint(section: FirstAidSection | null): string {
  const weight = section?.weightGrams ?? null

  return weight === null ? 'Пока не взвешена — в раскладке 0 г, вес не показывается.' : ''
}
</script>

<template>
  <section class="flex flex-col gap-3" data-test="trip-first-aid">
    <p v-if="isLoading" class="text-sm text-muted" data-test="first-aid-loading">
      Загружаем аптечку…
    </p>

    <p v-else-if="error" class="text-sm text-muted" data-test="first-aid-error">
      {{ error }}
    </p>

    <template v-else-if="state">
      <p v-if="weightError" class="text-sm text-red-600" data-test="first-aid-weight-error">
        {{ weightError }}
      </p>

      <!--
        Общественная аптечка — цвет темы «Снаряжения»: заказчик просил
        оформление идентичное, а различие секций там задаёт цвет.
        Пока доктора нет, секции нет: список ни за кем не нужен.
      -->
      <details
        v-if="state.shared"
        :open="isSectionOpen('shared')"
        class="flex flex-col gap-3 rounded-2xl border border-orange-900 bg-orange-100 p-3"
        data-test="first-aid-public-section"
        @toggle="onSectionToggle('shared', $event)"
      >
        <summary class="relative cursor-pointer select-none text-sm font-medium text-orange-900">
          <span class="inline-block max-w-full truncate align-bottom">
            Общественная аптечка<span
              v-if="sharedProgress"
              class="ml-1 text-xs font-normal"
              data-test="first-aid-public-progress"
            >{{ sharedProgress }}</span>
          </span>

          <button
            v-if="state.shared.checklist && state.shared.canEdit"
            type="button"
            class="absolute right-0 top-1/2 -translate-y-1/2 cursor-pointer rounded-lg border border-border bg-white px-1.5 py-0.5 text-xs text-muted transition-colors hover:border-primary hover:text-text"
            :aria-expanded="!sharedToolsHidden"
            :aria-label="sharedToolsHidden ? 'Показать инструменты' : 'Скрыть инструменты'"
            :title="sharedToolsHidden ? 'Показать инструменты' : 'Скрыть инструменты'"
            data-test="first-aid-shared-tools-toggle"
            @click.prevent.stop="sharedToolsHidden = !sharedToolsHidden"
          >
            ⋯
          </button>
        </summary>

        <div class="flex flex-col gap-3 rounded-xl border border-border bg-white p-3">
          <p v-if="state.doctorName" class="text-xs text-muted" data-test="first-aid-doctor">
            Доктор: {{ state.doctorName }}
          </p>

          <TripGearChecklist
            :trip-id="trip.id"
            :checklist="state.shared.checklist"
            scope="trip"
            area="first_aid"
            empty-text="Аптечка ещё пуста — добавь первый пункт."
            add-placeholder="Добавить в аптечку"
            import-note="В общую аптечку вещи из шаблона попадут названиями типов."
            :can-manage="state.shared.canEdit"
            :can-mark="state.shared.canEdit"
            :can-import="state.shared.canEdit"
            :tools-hidden="sharedToolsHidden"
            @updated="applySharedChecklist"
          />

          <!--
            Вес — итог секции, поэтому стоит после списка. Пустое поле
            значит «не взвесили»: в раскладке общественная аптечка пойдёт
            доктору нулём, а цифра на экране не появится.
          -->
          <label class="flex flex-col gap-1 text-sm text-muted">
            Вес аптечки, г
            <input
              v-model="sharedWeight"
              type="number"
              min="1"
              step="1"
              inputmode="numeric"
              class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none disabled:opacity-60 md:text-sm"
              :disabled="!state.shared.canEdit || savingScope !== null"
              placeholder="необязательно"
              data-test="first-aid-shared-weight"
              @blur="saveWeight('shared')"
              @keydown.enter.prevent="saveWeight('shared')"
            />
          </label>

          <p class="text-xs text-muted" data-test="first-aid-shared-weight-hint">
            {{ weightHint(state.shared) }}
          </p>
        </div>
      </details>

      <p v-else class="text-sm text-muted" data-test="first-aid-no-doctor">
        Общественная аптечка появится, когда в походе назначат доктора.
      </p>

      <!-- Личная аптечка — синяя, как «Личное снаряжение» и «Спальник». -->
      <details
        :open="isSectionOpen('personal')"
        class="flex flex-col gap-3 rounded-2xl border border-blue-300 bg-blue-100 p-3"
        data-test="first-aid-personal-section"
        @toggle="onSectionToggle('personal', $event)"
      >
        <summary class="relative cursor-pointer select-none text-sm font-medium text-blue-900">
          <span class="inline-block max-w-full truncate align-bottom">
            Личная аптечка<span
              v-if="personalProgress"
              class="ml-1 text-xs font-normal"
              data-test="first-aid-personal-progress"
            >{{ personalProgress }}</span>
          </span>

          <button
            v-if="state.personal.checklist"
            type="button"
            class="absolute right-0 top-1/2 -translate-y-1/2 cursor-pointer rounded-lg border border-border bg-white px-1.5 py-0.5 text-xs text-muted transition-colors hover:border-primary hover:text-text"
            :aria-expanded="!personalToolsHidden"
            :aria-label="personalToolsHidden ? 'Показать инструменты' : 'Скрыть инструменты'"
            :title="personalToolsHidden ? 'Показать инструменты' : 'Скрыть инструменты'"
            data-test="first-aid-personal-tools-toggle"
            @click.prevent.stop="personalToolsHidden = !personalToolsHidden"
          >
            ⋯
          </button>
        </summary>

        <div class="flex flex-col gap-3 rounded-xl border border-border bg-white p-3">
          <TripGearChecklist
            :trip-id="trip.id"
            :checklist="state.personal.checklist"
            scope="personal"
            area="first_aid"
            empty-text="Личная аптечка ещё пуста — добавь первый пункт."
            add-placeholder="Добавить в аптечку"
            import-note="В личную аптечку вещи из шаблона попадут конкретными экземплярами — как в каталоге."
            :can-manage="true"
            :can-mark="true"
            :can-import="true"
            :tools-hidden="personalToolsHidden"
            @updated="applyPersonalChecklist"
          />

          <label class="flex flex-col gap-1 text-sm text-muted">
            Вес аптечки, г
            <input
              v-model="personalWeight"
              type="number"
              min="1"
              step="1"
              inputmode="numeric"
              class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none disabled:opacity-60 md:text-sm"
              :disabled="savingScope !== null"
              placeholder="необязательно"
              data-test="first-aid-personal-weight"
              @blur="saveWeight('personal')"
              @keydown.enter.prevent="saveWeight('personal')"
            />
          </label>

          <p class="text-xs text-muted" data-test="first-aid-personal-weight-hint">
            {{ weightHint(state.personal) }}
          </p>
        </div>
      </details>

      <!-- Чат — тема вкладки, как у «Снаряжения» и остальных. -->
      <TripChat :trip-id="trip.id" kind="trip_first_aid" />
    </template>
  </section>
</template>
