<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { listGear, listTripGear, proposeTripGear } from '@/api/gear'
import { ApiError } from '@/api/errors'
import { listParticipants } from '@/api/trips'
import { useAuthStore } from '@/stores/auth'
import type { GearItem, GearKind, TripGearItem } from '@/types/gear'
import type { Trip, TripParticipant } from '@/types/trips'
import { weightInGrams } from '@/utils/gearWeight'

/**
 * «Костровое» — снаряжение для готовки (29.10.2026).
 *
 * Заказчик перечислил, что здесь нужно: «кнопки добавления топора, пилы,
 * розжига, тагана, горелок, газовых баллонов. По этим кнопкам участники
 * предлагают своё снаряжение соответствующего типа».
 *
 * Поэтому **кнопка задаёт тип**, а участник выбирает из своего каталога вещь
 * этого типа. Вещь уходит в снаряжение похода (`POST /api/trips/:id/gear` —
 * та же ручка, что «взять палатку в поход») и сразу появляется пилюлей.
 *
 * Разбор заказчика 29.10.2026 (продолжение шага 3) переделал три вещи:
 *
 * 1. **Кнопки видны по плану ночёвок**: топор, пила, розжиг и таган — если
 *    хоть в одной ночи запланирован костёр, горелка и баллон — если горелка.
 *    План приходит пропсами из `TripRouteNights.vue`: своей модели у секции
 *    нет, и второй раз считать ночи здесь значило бы разойтись с плашками.
 * 2. **Цвет кнопки — состояние секции**: пока вещи этого типа в секции нет,
 *    кнопка цветная (её и надо нажать); появилась — белая, но нажимать её
 *    по-прежнему можно, если топоров нужно два.
 * 3. **Пилюля — «{тип} - {вес}гр ({хозяин})»** и крестик: заказчик продиктовал
 *    формат «Горелка - 100гр (Анна)». Название в пилюле — **слово типа**, а не
 *    название вещи из каталога: «Горелка Анны» с подписью «(Анна)» дублировало
 *    бы хозяйку, а тип — это то, по чему здесь договариваются.
 *
 * **Крестик — по правам на вещь** (29.10.2026): у владельца он убирает вещь из
 * секции, у организатора — только **предлагает** убрать: пилюля становится
 * зачёркнутой с пунктирной рамкой, повторное нажатие возвращает. Убирает
 * в памяти компонента: ручки удаления вещи из похода нет, она появится вместе
 * с моделью ночёвок.
 *
 * **Типы пока приблизительные.** Списка типов снаряжения в БД ещё нет:
 * у `gear_items` только вид (`kind`) из восьми значений, и «топор» или
 * «горелка» в него не входят. Пока кнопка смотрит на виды «кухня»
 * и «техника», а вещь, предложенная в прошлых сессиях, узнаётся по словам
 * в названии (`marker`). Когда появится описание снаряжения (основная
 * характеристика и тип), фильтр и узнавание переедут на него (`gear.md` §8).
 */
const props = defineProps<{
  trip: Trip
  /** Запланирован костёр хоть в одной ночи — видны костровые кнопки. */
  fire: boolean
  /** Запланирована горелка хоть в одной ночи — видны газовые кнопки. */
  stove: boolean
}>()

const auth = useAuthStore()

/** План ночёвки, который показывает кнопку: костёр или горелка. */
type CookingPlan = 'fire' | 'stove'

/** Заголовок модалки — «Топор», подпись кнопки — «Добавить топор». */
interface CookingType {
  id: string
  label: string
  button: string
  /**
   * Виды личного снаряжения, из которых берём вещь этого типа. Настоящего
   * типа вещи в модели нет, поэтому «костровое» — это «кухня» и «техника».
   */
  gearKinds: readonly GearKind[]
  /** Какой план ночёвок показывает кнопку. */
  plan: CookingPlan
  /**
   * По каким словам в названии узнаём вещь этого типа. Типа в БД нет, поэтому
   * вещь, предложенную раньше, видно только по названию: «Топор Fiskars X7»,
   * «Горелка Анны», «Баллон газовый 230 г».
   */
  marker: RegExp
}

/**
 * Шесть типов в порядке заказчика: топор, пила, розжиг, таган, горелка,
 * газовый баллон. Порядок — его слова, а не алфавит.
 */
const COOKING_TYPES: readonly CookingType[] = [
  {
    id: 'axe',
    label: 'Топор',
    button: 'Добавить топор',
    gearKinds: ['technical'],
    plan: 'fire',
    marker: /топор|axe/i,
  },
  {
    id: 'saw',
    label: 'Пила',
    button: 'Добавить пилу',
    gearKinds: ['technical'],
    plan: 'fire',
    marker: /пил[аыу]|saw/i,
  },
  {
    id: 'firestarter',
    label: 'Розжиг',
    button: 'Добавить розжиг',
    gearKinds: ['technical', 'kitchen', 'other'],
    plan: 'fire',
    marker: /розжиг|спичк|зажигал/i,
  },
  {
    id: 'tagan',
    label: 'Таган',
    button: 'Добавить таган',
    gearKinds: ['kitchen'],
    plan: 'fire',
    marker: /таган|треног/i,
  },
  {
    id: 'stove',
    label: 'Горелка',
    button: 'Добавить горелку',
    gearKinds: ['kitchen'],
    plan: 'stove',
    marker: /горелк|burner/i,
  },
  {
    id: 'gas',
    label: 'Газовый баллон',
    button: 'Добавить газовый баллон',
    gearKinds: ['kitchen'],
    plan: 'stove',
    marker: /баллон|газов/i,
  },
]

/** Что из снаряжения похода считается костровым: кухня и техника. */
const COOKING_GEAR_KINDS: readonly GearKind[] = ['kitchen', 'technical']

/**
 * Кнопка одна на два состояния: цветная — такой вещи в секции ещё нет,
 * белая — уже есть. Разметку держим литералами: Tailwind собирает классы
 * из исходников, и склейка через переменные его бы обманула.
 */
const COLORED_BUTTON =
  'cursor-pointer rounded-xl border border-red-600 bg-red-600 px-3 py-1.5 text-sm text-white transition-colors hover:opacity-90'
const WHITE_BUTTON =
  'cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-red-600'

/** Вещи похода и состав: имя хозяина берём из состава, как в «Палатках». */
const items = ref<TripGearItem[]>([])
const people = ref<TripParticipant[]>([])

const isLoading = ref(true)
const error = ref<string | null>(null)

const meId = computed(() => auth.user?.id ?? '')

const isOrganizer = computed(
  () => meId.value !== '' && props.trip.organizerUserId === meId.value,
)

/** Типы, чьи вещи уже в секции: помним по вещи, чтобы не гадать по названию. */
const proposedTypeIds = new Map<string, string>()

function typeOfTitle(title: string): CookingType | null {
  return COOKING_TYPES.find((type) => type.marker.test(title)) ?? null
}

/** Тип вещи: свой из этой сессии, иначе — угаданный по названию. */
function typeOf(item: TripGearItem): CookingType | null {
  const known = proposedTypeIds.get(item.id)

  if (known !== undefined) return COOKING_TYPES.find((type) => type.id === known) ?? null

  return typeOfTitle(item.title)
}

interface CookingRow {
  item: TripGearItem
  /** `null` — тип не узнали: пилюля подпишется названием вещи. */
  type: CookingType | null
}

function typeOrder(type: CookingType | null): number {
  return type === null ? COOKING_TYPES.length : COOKING_TYPES.findIndex((row) => row.id === type.id)
}

/**
 * Предложенное костровое, по порядку типов: «Топор - 900 гр. (Сергей)».
 * «Не берём» не показываем — этой вещи в походе нет, и предлагать её снова
 * бессмысленно.
 *
 * Вид «кухня» и «техника» — грубый фильтр, но не единственный: розжиг
 * в демо-данных лежит в «прочем», и по одному виду он бы из секции исчезал.
 * Поэтому вещь показывается ещё и тогда, когда её тип узнан по названию.
 */
const cookingRows = computed<CookingRow[]>(() =>
  items.value
    .filter(
      (item) =>
        item.status !== 'declined' &&
        (COOKING_GEAR_KINDS.includes(item.kind) || typeOf(item) !== null),
    )
    .map((item) => ({ item, type: typeOf(item) }))
    .sort(
      (left, right) =>
        typeOrder(left.type) - typeOrder(right.type) ||
        left.item.title.localeCompare(right.item.title, 'ru'),
    ),
)

/** Кнопки только запланированного плана: костёр или горелка. */
const visibleTypes = computed(() =>
  COOKING_TYPES.filter((type) => (type.plan === 'fire' ? props.fire : props.stove)),
)

function hasType(type: CookingType): boolean {
  return cookingRows.value.some((row) => row.type?.id === type.id)
}

function buttonClass(type: CookingType): string {
  return hasType(type) ? WHITE_BUTTON : COLORED_BUTTON
}

function nameOf(userId: string): string {
  return people.value.find((person) => person.userId === userId)?.displayName ?? 'Участник'
}

/** Строка в списке выбора: «Топор Fiskars X7 · 900 гр.». */
function gearOptionText(item: GearItem): string {
  const weight = weightInGrams(item.weightGrams)

  return weight === null ? item.title : `${item.title} · ${weight}`
}

/**
 * Пилюля предложенной вещи: «Горелка - 130 гр. (Анна)».
 *
 * Вес — из каталога предмета, формат «гр.» общий с заголовком палатки
 * (`weightInGrams`). Веса нет — пилюля без «- 130 гр.»: прочерк читался бы
 * как ошибка, а не как «не взвесили».
 */
function pillText(row: CookingRow): string {
  const weight = weightInGrams(row.item.weightGrams)
  const name = row.type?.label ?? row.item.title
  const head = weight === null ? name : `${name} - ${weight}`

  return `${head} (${nameOf(row.item.ownerUserId)})`
}

// ───────────────────────────── удаление и предложение убрать ─────────────────────────────

/** Вещи, которые организатор предлагает убрать: зачёркнуты, пока не вернут. */
const removalProposed = ref<string[]>([])

function isMine(ownerUserId: string): boolean {
  return meId.value !== '' && ownerUserId === meId.value
}

/** Крестик виден владельцу и организатору — больше никому. */
function canRemove(item: TripGearItem): boolean {
  return isMine(item.ownerUserId) || isOrganizer.value
}

function isRemovalProposed(id: string): boolean {
  return removalProposed.value.includes(id)
}

/**
 * Два разных действия одним крестиком:
 * - владелец убирает свою вещь из секции сразу;
 * - организатор чужую только **предлагает** убрать: зачёркивает, а снимает
 *   вещь владелец. Повторное нажатие организатора отменяет предложение.
 */
function removeItem(row: CookingRow): void {
  if (isMine(row.item.ownerUserId)) {
    items.value = items.value.filter((item) => item.id !== row.item.id)
    removalProposed.value = removalProposed.value.filter((id) => id !== row.item.id)

    return
  }

  removalProposed.value = isRemovalProposed(row.item.id)
    ? removalProposed.value.filter((id) => id !== row.item.id)
    : [...removalProposed.value, row.item.id]
}

function removeHint(row: CookingRow): string {
  if (isMine(row.item.ownerUserId)) return 'Убрать из секции'

  return isRemovalProposed(row.item.id)
    ? 'Вернуть вещь: предложение убрать отменено'
    : 'Предложить убрать: решает владелец'
}

/** Пилюля: обычная — жёлтая, предложенная к удалению — зачёркнутая. */
function pillClass(row: CookingRow): string {
  return isRemovalProposed(row.item.id)
    ? 'border-dashed border-amber-400 bg-transparent text-amber-800'
    : 'border-amber-300 bg-amber-100 text-amber-900'
}

// ───────────────────────────── загрузка ─────────────────────────────

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null

  try {
    const [members, list] = await Promise.all([
      listParticipants(props.trip.id),
      listTripGear(props.trip.id),
    ])

    people.value = members
    items.value = list.items
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить костровое снаряжение'
  } finally {
    isLoading.value = false
  }
}

watch(() => props.trip.id, load, { immediate: true })

// ───────────────────────────── «добавить топор» ─────────────────────────────

const isDialogOpen = ref(false)
const isGearLoading = ref(false)
const isSaving = ref(false)
const dialogError = ref<string | null>(null)

/** Кнопка, которую нажали: её тип и есть тип предложения. */
const activeType = ref<CookingType | null>(null)
const myGear = ref<GearItem[]>([])
const draftGearItemId = ref('')

async function openDialog(type: CookingType): Promise<void> {
  activeType.value = type
  isDialogOpen.value = true
  dialogError.value = null
  draftGearItemId.value = ''
  isGearLoading.value = true

  try {
    const list = await listGear()
    const inTrip = new Set(items.value.map((item) => item.gearItemId))

    myGear.value = list.items.filter(
      (item) => type.gearKinds.includes(item.kind) && !inTrip.has(item.id),
    )
  } catch (problem) {
    dialogError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить снаряжение'
  } finally {
    isGearLoading.value = false
  }
}

async function saveItem(): Promise<void> {
  if (isSaving.value || draftGearItemId.value === '' || activeType.value === null) return

  const type = activeType.value

  isSaving.value = true
  dialogError.value = null

  try {
    const item = await proposeTripGear(props.trip.id, draftGearItemId.value)

    proposedTypeIds.set(item.id, type.id)
    items.value = [...items.value, item]
    isDialogOpen.value = false
  } catch (problem) {
    // Ошибка — в модалке, а не строкой под затемнением (правило «Трансфера»).
    dialogError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось предложить снаряжение'
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <section class="flex flex-col gap-3" data-test="route-cooking">
    <p v-if="isLoading" class="text-sm text-muted" data-test="route-cooking-loading">
      Загружаем снаряжение…
    </p>

    <p v-else-if="error" class="text-sm text-muted" data-test="route-cooking-error">
      {{ error }}
    </p>

    <template v-else>
      <div
        v-if="cookingRows.length > 0"
        class="flex flex-wrap items-center gap-2"
        data-test="route-cooking-items"
      >
        <span
          v-for="row in cookingRows"
          :key="row.item.id"
          class="flex items-center gap-1 rounded-full border px-2 py-1 text-sm"
          :class="pillClass(row)"
          :title="row.item.title"
          data-test="route-cooking-item"
        >
          <span :class="isRemovalProposed(row.item.id) ? 'line-through' : ''">
            {{ pillText(row) }}
          </span>

          <!--
            Крестик: владелец убирает вещь из секции, организатор предлагает
            убрать (пилюля зачёркивается). Чужому участнику крестика нет.
          -->
          <button
            v-if="canRemove(row.item)"
            type="button"
            class="cursor-pointer border-0 bg-transparent p-0 text-amber-700 transition-colors hover:text-amber-900"
            :title="removeHint(row)"
            :data-test="`route-cooking-remove-${row.item.id}`"
            @click="removeItem(row)"
          >
            ×
          </button>
        </span>
      </div>

      <p v-else class="text-sm text-muted" data-test="route-cooking-empty">
        Пока никто не взял костровое снаряжение.
      </p>

      <!--
        Кнопки — только запланированного плана: костёр просит топор, пилу,
        розжиг и таган; горелка — горелку и газовый баллон. Ряд переносится:
        на телефоне это две-три строки, и это нормально.
      -->
      <div class="flex flex-wrap items-center gap-2" data-test="route-cooking-buttons">
        <button
          v-for="type in visibleTypes"
          :key="type.id"
          type="button"
          :class="buttonClass(type)"
          :data-test="`route-cooking-add-${type.id}`"
          @click="openDialog(type)"
        >
          {{ type.button }}
        </button>
      </div>
    </template>

    <!-- Предложение: тип выбран кнопкой, вещь выбирает человек -->
    <div
      v-if="isDialogOpen"
      class="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
      data-test="route-cooking-dialog"
    >
      <div
        class="flex w-full max-w-md flex-col gap-2 rounded-xl border border-border bg-surface p-4"
      >
        <h3 class="text-base font-medium text-text">{{ activeType?.label }}</h3>

        <label class="flex flex-col gap-1 text-sm text-muted">
          Своё снаряжение
          <select
            v-model="draftGearItemId"
            class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none md:text-sm"
            :disabled="isGearLoading"
            data-test="route-cooking-gear"
          >
            <option value="">выберите…</option>
            <option v-for="item in myGear" :key="item.id" :value="item.id">
              {{ gearOptionText(item) }}
            </option>
          </select>
        </label>

        <p
          v-if="!isGearLoading && myGear.length === 0"
          class="text-xs text-muted"
          data-test="route-cooking-no-gear"
        >
          Подходящей вещи в личном снаряжении нет — заведите её в профиле,
          на вкладке «Снаряжение».
        </p>

        <p v-if="dialogError" class="text-sm text-red-600" data-test="route-cooking-error-dialog">
          {{ dialogError }}
        </p>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            :disabled="isSaving || draftGearItemId === ''"
            data-test="route-cooking-save"
            @click="saveItem"
          >
            Предложить
          </button>

          <button
            type="button"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary"
            :disabled="isSaving"
            data-test="route-cooking-cancel"
            @click="isDialogOpen = false"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
