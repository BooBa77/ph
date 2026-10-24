<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { ApiError } from '@/api/errors'
import { listDishes } from '@/api/meals'
import {
  addMealDish,
  createMealPackage,
  fetchMealChecks,
  fetchMealPlan,
  removeMealDish,
  removeMealLine,
  removeMealPackage,
  setMealAllocations,
  setMealDishExclusions,
  setMealForm,
  setMealKulek,
  setMealLine,
  setMyStatus,
  updateMealCheck,
  updateMealPackage,
} from '@/api/trips'
import ProductPicker from '@/components/ui/ProductPicker.vue'
import TripChat from '@/views/trips/TripChat.vue'
import { useAuthStore } from '@/stores/auth'
import {
  TRIP_MEAL_CODES,
  TRIP_MEAL_FORMS,
  TRIP_MEAL_FORM_LABELS,
  TRIP_MEAL_KINDS,
  TRIP_MEAL_LABELS,
  type Trip,
  type TripMeal,
  type TripMealCheck,
  type TripMealDish,
  type TripMealForm,
  type TripMealKind,
  type TripMealPackage,
  type TripMealPlan,
  type TripMealProduct,
} from '@/types/trips'
import { formatProductAmount, type Dish, type Product } from '@/types/meals'
import { formatWeight } from '@/utils/gearWeight'

/**
 * Вкладка «Питание»: едоки, раскладка по дням и приёмам, фасовка.
 *
 * Раскладка считается на бэкенде: рецепт × едоков, мясное — без
 * вегетарианцев, ручные строки абсолютные. Здесь только экран и правки.
 *
 * **Дни — из похода.** У решённого похода день имеет дату; у «Планирую»
 * — только номер. Края подрезаются по времени заезда/выезда: приехали
 * в 14:00 — завтрак первого дня уже не нужен (`meals.md` §5.4). Время
 * 00:00 — «не задано», тогда показываем все приёмы.
 */
const props = defineProps<{ trip: Trip; canEdit?: boolean }>()

const auth = useAuthStore()

const plan = ref<TripMealPlan | null>(null)
const dishes = ref<Dish[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)
/** Что сейчас в полёте: ключ действия, чтобы не жать дважды. */
const busy = ref<string | null>(null)

/** Выбранное блюдо в форме добавления: ключ приёма → dishId. */
const dishDrafts = ref<Record<string, string>>({})
/** Черновик ручной строки: ключ приёма → продукт и количество. */
const lineDrafts = ref<Record<string, { product: Product | null; amount: string }>>({})

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

function mealKey(dayIndex: number, kind: TripMealKind): string {
  return `${dayIndex}:${kind}`
}

function mealOf(dayIndex: number, kind: TripMealKind): TripMeal | undefined {
  return plan.value?.meals.find(
    (meal) => meal.dayIndex === dayIndex && meal.kind === kind,
  )
}

function dishDraft(key: string): string {
  return dishDrafts.value[key] ?? ''
}

function lineDraft(key: string): { product: Product | null; amount: string } {
  lineDrafts.value[key] ??= { product: null, amount: '' }

  return lineDrafts.value[key]!
}

/** Кто из смотрящих — едок (для флага «питаюсь отдельно»). */
const me = computed(
  () =>
    plan.value?.eaters.people.find(
      (person) => person.userId === auth.user?.id,
    ) ?? null,
)

const packageNames = computed<Record<string, string>>(() =>
  Object.fromEntries(
    (plan.value?.packages ?? []).map((pack) => [pack.id, pack.name]),
  ),
)

const start = computed(() =>
  props.trip.startsAt ? new Date(props.trip.startsAt) : null,
)
function dateLabel(dayIndex: number): string {
  if (!start.value) return ''

  const date = new Date(start.value)
  date.setDate(date.getDate() + dayIndex - 1)

  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

const days = computed(() => {
  const count = plan.value?.dayCount ?? 0

  return Array.from({ length: count }, (_, index) => {
    const dayIndex = index + 1

    return {
      index: dayIndex,
      date: dateLabel(dayIndex),
      kinds: [...TRIP_MEAL_KINDS],
    }
  })
})

/** Мясное на «едоков минус вегетарианцы»: подпись «на 4 из 6». */
const meatPortion = computed(() => {
  if (!plan.value) return ''

  const eaters = plan.value.eaters.total - plan.value.eaters.vegetarians

  return `на ${eaters} из ${plan.value.eaters.total}`
})

/**
 * Убрать или вернуть ингредиент блюда в этом приёме. Рецепт не меняется:
 * исключение живёт только в строке приёма.
 */
function toggleDishIngredient(
  dayIndex: number,
  kind: TripMealKind,
  dish: TripMealDish,
  productId: number,
): void {
  if (!props.canEdit) return

  const excluded = dish.excludedProductIds.includes(productId)
    ? dish.excludedProductIds.filter((id) => id !== productId)
    : [...dish.excludedProductIds, productId]

  void run(`${dish.dishId}:${productId}:exclude`, () =>
    setMealDishExclusions(
      props.trip.id,
      dayIndex,
      kind,
      dish.dishId,
      excluded,
    ),
  )
}

function productPackages(product: TripMealProduct): string {
  return product.allocations
    .map(
      (share) =>
        `${packageNames.value[share.packageId] ?? 'Пакет'} ${formatProductAmount(share.amount, product.unit)}`,
    )
    .join(', ')
}

async function load() {
  isLoading.value = true
  error.value = null

  try {
    plan.value = await fetchMealPlan(props.trip.id)
  } catch (problem) {
    error.value = messageOf(problem, 'Не удалось загрузить раскладку')
    plan.value = null
  } finally {
    isLoading.value = false
  }
}

async function loadDishes() {
  try {
    dishes.value = await listDishes()
  } catch {
    // Блюда нужны только для добавления: без них раскладка читается.
    dishes.value = []
  }
}

async function run(key: string, action: () => Promise<TripMealPlan>) {
  busy.value = key
  error.value = null

  try {
    plan.value = await action()
  } catch (problem) {
    error.value = messageOf(problem, 'Не удалось сохранить')
  } finally {
    busy.value = null
  }
}

function changeForm(meal: TripMeal, form: TripMealForm) {
  if (!props.canEdit || meal.form === form) return

  void run(`${meal.id}:form`, () =>
    setMealForm(props.trip.id, meal.dayIndex, meal.kind, form),
  )
}

function addDish(dayIndex: number, kind: TripMealKind) {
  const key = mealKey(dayIndex, kind)
  const dishId = dishDraft(key)
  if (!dishId) return

  void run(`${key}:dish`, async () => {
    const next = await addMealDish(props.trip.id, dayIndex, kind, dishId)
    dishDrafts.value[key] = ''

    return next
  })
}

function removeDish(dayIndex: number, kind: TripMealKind, dishId: string) {
  void run(`${mealKey(dayIndex, kind)}:dish:${dishId}`, () =>
    removeMealDish(props.trip.id, dayIndex, kind, dishId),
  )
}

function chooseLineProduct(key: string, product: Product) {
  const draft = lineDraft(key)
  draft.product = product
  draft.amount = ''
}

/** Рецепты, которых ещё нет в этом приёме: выбранные не предлагаем. */
function dishesFor(meal: TripMeal | undefined): Dish[] {
  if (!meal) return []

  return dishes.value.filter(
    (dish) => !meal.dishes.some((row) => row.dishId === String(dish.id)),
  )
}

function lineReady(key: string): boolean {
  const draft = lineDraft(key)
  const amount = Number(String(draft.amount).trim())

  return Boolean(draft.product) && Number.isInteger(amount) && amount > 0
}

function addLine(dayIndex: number, kind: TripMealKind) {
  const key = mealKey(dayIndex, kind)
  const draft = lineDraft(key)

  if (!lineReady(key)) return

  const amount = Number(String(draft.amount).trim())

  void run(`${key}:line`, async () => {
    const next = await setMealLine(
      props.trip.id,
      dayIndex,
      kind,
      draft.product!.id,
      amount,
    )
    lineDrafts.value[key] = { product: null, amount: '' }

    return next
  })
}

function removeLine(
  dayIndex: number,
  kind: TripMealKind,
  productId: number,
) {
  void run(`${mealKey(dayIndex, kind)}:line:${productId}`, () =>
    removeMealLine(props.trip.id, dayIndex, kind, productId),
  )
}

async function toggleSeparate() {
  if (!me.value) return

  await run('separate', async () => {
    await setMyStatus(props.trip.id, 'going', !me.value!.eatsSeparately)

    return fetchMealPlan(props.trip.id)
  })
}

// ─── фасовка: пакеты и доли ───

const confirmingPackageId = ref<string | null>(null)

/** Обычные пакеты: кулёк в списках долей не участвует. */
const normalPackages = computed(() =>
  (plan.value?.packages ?? []).filter((pack) => pack.kind === 'normal'),
)

function kulekOf(meal: TripMeal): TripMealPackage | undefined {
  return plan.value?.packages.find(
    (pack) => pack.kind === 'kulek' && pack.mealId === meal.id,
  )
}

/** Сколько продукта лежит в этом пакете. */
function allocationAmount(product: TripMealProduct, pack: TripMealPackage): number {
  return product.allocations.find((row) => row.packageId === pack.id)?.amount ?? 0
}

function isElasticOf(product: TripMealProduct, pack: TripMealPackage): boolean {
  return product.allocations.some(
    (row) => row.packageId === pack.id && row.isElastic,
  )
}

/** Всего разложено по пакетам. */
function allocatedOf(product: TripMealProduct): number {
  return product.allocations.reduce((sum, row) => sum + row.amount, 0)
}

/** Насколько пакеты превысили рецепт — лишнее можно убрать. */
function overAllocated(product: TripMealProduct): number {
  return Math.max(0, allocatedOf(product) - product.amount)
}

/** Нерасфасованное: продукты, которых пакеты не добрали. */
const unpackedRows = computed(() => {
  const rows: Array<{
    key: string
    meal: string
    name: string
    left: number
    unit: TripMealProduct['unit']
  }> = []

  for (const meal of plan.value?.meals ?? []) {
    for (const product of meal.products) {
      const left = product.amount - allocatedOf(product)
      if (left <= 0) continue

      rows.push({
        key: `${meal.id}:${product.productId}`,
        meal: `${TRIP_MEAL_CODES[meal.kind]} ${TRIP_MEAL_LABELS[meal.kind]}`,
        name: product.name,
        left,
        unit: product.unit,
      })
    }
  }

  return rows
})

function saveShares(
  dayIndex: number,
  kind: TripMealKind,
  product: TripMealProduct,
  rows: Array<{ packageId: string; amount: number; isElastic: boolean }>,
): void {
  void run(`${product.productId}:alloc`, () =>
    setMealAllocations(props.trip.id, dayIndex, kind, product.productId, rows),
  )
}

/** Положили в пакет другое количество, в том числе больше рецепта. */
function updateAllocation(
  dayIndex: number,
  kind: TripMealKind,
  product: TripMealProduct,
  pack: TripMealPackage,
  event: Event,
): void {
  const amount = Number((event.target as HTMLInputElement).value)
  if (!Number.isInteger(amount) || amount < 0) return

  const rows = normalPackages.value.map((row) => {
    const share = product.allocations.find((item) => item.packageId === row.id)

    return {
      packageId: row.id,
      amount: row.id === pack.id ? amount : (share?.amount ?? 0),
      isElastic: share?.isElastic ?? false,
    }
  })

  saveShares(dayIndex, kind, product, rows)
}

/** «Всё» — одна на строку: выбор снимает остальные доли. */
function toggleAllocationElastic(
  dayIndex: number,
  kind: TripMealKind,
  product: TripMealProduct,
  pack: TripMealPackage,
): void {
  const next = !isElasticOf(product, pack)

  const rows = normalPackages.value.map((row) => {
    const share = product.allocations.find((item) => item.packageId === row.id)

    return {
      packageId: row.id,
      amount: row.id === pack.id && next ? 0 : (share?.amount ?? 0),
      isElastic: row.id === pack.id ? next : false,
    }
  })

  saveShares(dayIndex, kind, product, rows)
}

/** Убрать остаток из плана: убавка на «разложено минус рецепт». */
function dropLeftover(
  dayIndex: number,
  kind: TripMealKind,
  product: TripMealProduct,
): void {
  const reduction = allocatedOf(product) - product.recipeAmount

  void run(`${product.productId}:leftover`, () =>
    setMealLine(
      props.trip.id,
      dayIndex,
      kind,
      product.productId,
      reduction,
    ),
  )
}

/** «Убрать лишнее»: доли снимаются, пакеты снова пустые. */
function resetOverAllocations(
  dayIndex: number,
  kind: TripMealKind,
  product: TripMealProduct,
): void {
  saveShares(dayIndex, kind, product, [])
}

function toggleKulek(meal: TripMeal): void {
  const kulek = kulekOf(meal)

  void run(`${meal.id}:kulek`, () =>
    setMealKulek(props.trip.id, meal.dayIndex, meal.kind, !kulek),
  )
}

function addPackage(): void {
  void run('package:add', () => createMealPackage(props.trip.id))
}

function savePackageName(pack: TripMealPackage, event: Event): void {
  const name = (event.target as HTMLInputElement).value.trim()
  if (!name || name === pack.name) return

  void run(`${pack.id}:name`, () =>
    updateMealPackage(props.trip.id, pack.id, { name }),
  )
}

function savePackageWeight(pack: TripMealPackage, event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  const grams = raw === '' ? null : Number(raw)
  if (grams !== null && (!Number.isInteger(grams) || grams <= 0)) return

  void run(`${pack.id}:weight`, () =>
    updateMealPackage(props.trip.id, pack.id, { weightActualGrams: grams }),
  )
}

function removePackage(pack: TripMealPackage): void {
  confirmingPackageId.value = null

  void run(`${pack.id}:delete`, () => removeMealPackage(props.trip.id, pack.id))
}

// ─── чек-лист покупок ───

const checks = ref<TripMealCheck[] | null>(null)
const checksOpen = ref(false)

function toggleChecklist(): void {
  checksOpen.value = !checksOpen.value

  if (checksOpen.value && checks.value === null) {
    void loadChecks()
  }
}

async function loadChecks(): Promise<void> {
  try {
    checks.value = await fetchMealChecks(props.trip.id)
  } catch (problem) {
    error.value = messageOf(problem, 'Не удалось загрузить чек-лист')
  }
}

async function patchCheck(
  check: TripMealCheck,
  patch: { isBought?: boolean; isHome?: boolean; boughtAmount?: number | null },
): Promise<void> {
  try {
    checks.value = await updateMealCheck(props.trip.id, check.productId, patch)
  } catch (problem) {
    error.value = messageOf(problem, 'Не удалось сохранить отметку')
  }
}

function toggleCheck(check: TripMealCheck, field: 'isBought' | 'isHome'): void {
  void patchCheck(check, { [field]: !check[field] })
}

function setCheckAmount(check: TripMealCheck, event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  const amount = raw === '' ? null : Number(raw)
  if (amount !== null && (!Number.isInteger(amount) || amount < 0)) return

  void patchCheck(check, { boughtAmount: amount })
}

onMounted(() => {
  void load()
  void loadDishes()
})
</script>

<template>
  <section class="flex flex-col gap-6" data-test="trip-meals">
    <p v-if="isLoading" class="text-sm text-muted" data-test="meals-loading">Загружаем раскладку…</p>

    <p v-else-if="error" class="text-sm text-red-600" data-test="meals-error">{{ error }}</p>

    <template v-else-if="plan">
      <!-- Едоки -->
      <div class="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4" data-test="eaters">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 class="text-sm text-muted">Едоки</h2>

          <p class="text-sm text-text" data-test="eaters-counts">
          в общей раскладке — {{ plan.eaters.total }}
          (М-{{ plan.eaters.men }}, Ж-{{ plan.eaters.women }}),
          <template v-if="plan.eaters.vegetarians === 0">вегетарианцев нет</template>
          <template v-else>вегетарианцев {{ plan.eaters.vegetarians }}</template>
          </p>
        </div>

        <ul class="flex flex-col gap-1" data-test="eaters-list">
          <li
            v-for="person in plan.eaters.people"
            :key="person.userId"
            class="flex flex-wrap items-baseline gap-2 text-sm text-text"
            data-test="eater"
          >
            <span class="text-xs text-muted">{{ person.gender === 'm' ? 'м' : 'ж' }}</span>
            <span>{{ person.displayName }}</span>
            <span v-if="person.isVegetarian" class="text-xs text-muted">вегетарианец</span>
            <span v-if="person.allergies" class="text-xs text-muted">аллергии: {{ person.allergies }}</span>
            <span v-if="person.eatsSeparately" class="text-xs text-muted">питается отдельно</span>
          </li>
        </ul>

        <div v-if="me" class="mt-2 border-t border-border pt-2" data-test="eats-separately-block">
          <label class="flex cursor-pointer items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              class="h-4 w-4 cursor-pointer accent-[var(--theme-primary)]"
              :checked="me.eatsSeparately"
              :disabled="busy === 'separate'"
              data-test="eats-separately"
              @change="toggleSeparate"
            />
            Я буду питаться отдельно
          </label>
        </div>
      </div>

      <!-- Раскладка по дням -->
      <div class="flex flex-col gap-4">
        <h2 class="text-sm text-muted">Раскладка</h2>

        <section
          v-for="day in days"
          :key="day.index"
          class="flex flex-col gap-2"
          data-test="meal-day"
        >
          <h3 class="text-sm font-medium text-text">
            День {{ day.index }}
            <span v-if="day.date" class="text-muted"> · {{ day.date }}</span>
          </h3>

          <div class="flex flex-col gap-3">
            <article
              v-for="kind in day.kinds"
              :key="kind"
              class="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
              :data-test="`meal-${day.index}-${kind}`"
            >
              <header class="flex flex-col gap-1">
                <span class="text-sm font-medium text-text">
                  {{ day.index }}{{ TRIP_MEAL_CODES[kind] }} · {{ TRIP_MEAL_LABELS[kind] }}
                </span>
                <button
                  v-if="canEdit && mealOf(day.index, kind)"
                  type="button"
                  class="cursor-pointer text-xs transition-colors"
                  :class="
                    kulekOf(mealOf(day.index, kind)!)
                      ? 'font-medium text-primary'
                      : 'text-muted underline hover:text-text'
                  "
                  :data-test="`meal-kulek-${day.index}-${kind}`"
                  @click="toggleKulek(mealOf(day.index, kind)!)"
                >
                  <template v-if="kulekOf(mealOf(day.index, kind)!)">кулёк собран</template>
                  <template v-else>
                    <span class="hidden sm:inline">всё </span>в отдельный кулёк
                  </template>
                </button>
              </header>

              <template v-if="mealOf(day.index, kind)">

                <div v-if="canEdit" class="flex gap-1" data-test="meal-form">
                  <button
                    v-for="form in TRIP_MEAL_FORMS"
                    :key="form"
                    type="button"
                    class="cursor-pointer rounded-lg border px-2 py-1 text-xs transition-colors disabled:opacity-60"
                    :class="
                      mealOf(day.index, kind)!.form === form
                        ? 'border-primary font-medium text-primary'
                        : 'border-border text-muted hover:text-text'
                    "
                    :disabled="busy === `${mealOf(day.index, kind)!.id}:form`"
                    :data-test="`meal-form-${form}`"
                    @click="changeForm(mealOf(day.index, kind)!, form)"
                  >
                    {{ TRIP_MEAL_FORM_LABELS[form] }}
                  </button>
                </div>

                <div class="grid gap-4 md:grid-cols-2">
                  <section class="flex flex-col gap-1">
                    <h4 class="text-xs uppercase tracking-wide text-muted">Блюда</h4>
                    <ul class="flex flex-col gap-1">
                  <li
                    v-for="dish in mealOf(day.index, kind)!.dishes"
                    :key="dish.dishId"
                    class="flex flex-col gap-1 text-sm text-text"
                    data-test="meal-dish"
                  >
                    <span class="flex items-start justify-between gap-2">
                      <span class="font-medium">{{ dish.title }}</span>
                      <button
                        v-if="canEdit"
                        type="button"
                        class="cursor-pointer text-xs text-muted underline transition-colors hover:text-text"
                        :data-test="`meal-dish-remove-${dish.dishId}`"
                        @click="removeDish(day.index, kind, dish.dishId)"
                      >
                        убрать
                      </button>
                    </span>

                    <span class="flex flex-wrap gap-1">
                      <button
                        v-for="ingredient in dish.ingredients"
                        :key="ingredient.productId"
                        type="button"
                        class="rounded-full border px-2 py-0.5 text-xs transition-colors"
                        :class="
                          dish.excludedProductIds.includes(ingredient.productId)
                            ? 'border-dashed border-border text-muted line-through'
                            : 'border-border text-text hover:border-primary'
                        "
                        :disabled="!canEdit"
                        :title="
                          dish.excludedProductIds.includes(ingredient.productId)
                            ? 'Вернуть ингредиент'
                            : 'Убрать из этого приёма'
                        "
                        :data-test="`dish-ing-${dish.dishId}-${ingredient.productId}`"
                        @click="toggleDishIngredient(day.index, kind, dish, ingredient.productId)"
                      >
                        {{ ingredient.name }}
                        {{ formatProductAmount(ingredient.amount, ingredient.unit) }}
                        <span v-if="canEdit">
                          {{ dish.excludedProductIds.includes(ingredient.productId) ? '+' : '×' }}
                        </span>
                      </button>
                    </span>
                  </li>
                    </ul>
                  </section>

                  <section class="flex flex-col gap-1">
                    <h4 class="text-xs uppercase tracking-wide text-muted">Продукты</h4>
                    <ul class="flex flex-col gap-1" data-test="meal-products">
                  <li
                    v-for="product in mealOf(day.index, kind)!.products"
                    :key="product.productId"
                    class="flex flex-wrap items-baseline gap-2 text-sm text-text"
                    data-test="meal-product"
                  >
                    <span>{{ product.name }}</span>
                    <span class="text-xs text-muted">
                      {{ formatProductAmount(product.amount, product.unit) }}
                    </span>
                    <span v-if="product.isMeat" class="text-xs text-muted">
                      мясное · {{ meatPortion }}
                    </span>
                    <span v-if="product.manualAmount > 0" class="text-xs text-muted">ручная</span>
                    <span v-if="product.allocations.length" class="text-xs text-muted">
                      {{ productPackages(product) }}
                    </span>
                    <button
                      v-if="canEdit && product.manualAmount > 0"
                      type="button"
                      class="cursor-pointer text-xs text-muted underline transition-colors hover:text-text"
                      :data-test="`meal-line-remove-${product.productId}`"
                      @click="removeLine(day.index, kind, product.productId)"
                    >
                      убрать ручную
                    </button>

                    <div
                      v-if="canEdit && normalPackages.length > 0"
                      class="mt-1 flex w-full flex-col gap-1 rounded-lg border border-border/60 bg-field/60 p-2"
                      :data-test="`product-packs-${product.productId}`"
                    >
                      <div
                        v-for="pack in normalPackages"
                        :key="pack.id"
                        class="flex items-center gap-2 text-xs"
                      >
                        <span class="w-20 text-muted">{{ pack.name }}</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          :value="allocationAmount(product, pack)"
                          :disabled="isElasticOf(product, pack)"
                          class="w-16 rounded border border-border bg-surface px-1 py-0.5 text-text focus:border-primary focus:outline-none disabled:opacity-50"
                          :data-test="`alloc-amount-${pack.id}`"
                          @change="updateAllocation(day.index, kind, product, pack, $event)"
                        />
                        <label class="flex items-center gap-1 text-muted">
                          <input
                            type="checkbox"
                            :checked="isElasticOf(product, pack)"
                            :data-test="`alloc-elastic-${pack.id}`"
                            @change="toggleAllocationElastic(day.index, kind, product, pack)"
                          />
                          всё
                        </label>
                      </div>

                      <p v-if="overAllocated(product) > 0" class="text-xs text-amber-700">
                        сверх рецепта:
                        {{ formatProductAmount(overAllocated(product), product.unit) }}
                        <button
                          type="button"
                          class="ml-1 cursor-pointer underline"
                          :data-test="`alloc-over-reset-${product.productId}`"
                          @click="resetOverAllocations(day.index, kind, product)"
                        >
                          убрать лишнее
                        </button>
                      </p>

                      <p
                        v-if="allocatedOf(product) > 0 && product.amount > allocatedOf(product)"
                        class="text-xs text-amber-700"
                        data-test="meal-leftover"
                      >
                        остаток:
                        {{ formatProductAmount(product.amount - allocatedOf(product), product.unit) }}
                        <button
                          type="button"
                          class="ml-1 cursor-pointer underline"
                          :data-test="`meal-leftover-drop-${product.productId}`"
                          @click="dropLeftover(day.index, kind, product)"
                        >
                          убрать
                        </button>
                      </p>
                    </div>
                  </li>
                  </ul>
                  </section>
                </div>

                <p class="text-xs text-muted" data-test="meal-weight">
                  {{ formatWeight(mealOf(day.index, kind)!.weightGrams) }}
                </p>
              </template>

              <p v-else class="text-sm text-muted" data-test="meal-empty">Пусто</p>

              <div v-if="canEdit" class="mt-auto flex flex-col gap-2" data-test="meal-add">
                <div class="flex gap-1">
                  <select
                    v-model="dishDrafts[mealKey(day.index, kind)]"
                    class="w-full rounded-lg border border-border bg-field px-2 py-1 text-xs text-text focus:border-primary focus:outline-none"
                    :data-test="`meal-dish-select-${day.index}-${kind}`"
                  >
                    <option value="" disabled hidden>Выберите рецепт блюда</option>
                    <option v-for="dish in dishesFor(mealOf(day.index, kind))" :key="dish.id" :value="dish.id">
                      {{ dish.title }}
                    </option>
                  </select>
                  <button
                    type="button"
                    class="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text transition-colors hover:border-primary disabled:opacity-50"
                    :disabled="!dishDraft(mealKey(day.index, kind)) || busy !== null"
                    :data-test="`meal-dish-add-${day.index}-${kind}`"
                    @click="addDish(day.index, kind)"
                  >
                    +
                  </button>
                </div>

                <div class="flex flex-col">
                  <ProductPicker
                    :product="lineDraft(mealKey(day.index, kind)).product"
                    class="[&_input]:rounded-b-none"
                    @select="chooseLineProduct(mealKey(day.index, kind), $event)"
                  />

                  <div class="flex items-center gap-1">
                    <input
                      v-model="lineDraft(mealKey(day.index, kind)).amount"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="кол-во"
                      class="-mt-px w-20 shrink-0 rounded-t-none rounded-b-lg border border-border bg-field px-2 py-1.5 text-xs text-text focus:border-primary focus:outline-none"
                      :data-test="`meal-line-amount-${day.index}-${kind}`"
                    />

                    <button
                      type="button"
                      class="ml-auto shrink-0 cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                      :disabled="!lineReady(mealKey(day.index, kind)) || busy !== null"
                      :data-test="`meal-line-add-${day.index}-${kind}`"
                      @click="addLine(day.index, kind)"
                    >
                      Добавить
                    </button>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>

      <!-- Фасовка: пакеты -->
      <div class="flex flex-col gap-2" data-test="packages">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm text-muted">Пакеты</h2>
          <button
            v-if="canEdit"
            type="button"
            class="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text transition-colors hover:border-primary"
            data-test="package-add"
            @click="addPackage"
          >
            Добавить пакет
          </button>
        </div>

        <p v-if="plan.packages.length === 0" class="text-sm text-muted" data-test="packages-empty">
          Пакетов пока нет.
        </p>

        <ul v-else class="flex flex-col gap-2">
          <li
            v-for="pack in plan.packages"
            :key="pack.id"
            class="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 text-sm"
            data-test="package"
          >
            <input
              v-if="canEdit && pack.kind !== 'kulek'"
              :value="pack.name"
              type="text"
              maxlength="60"
              class="w-32 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-text transition-colors hover:border-border focus:border-primary focus:bg-field focus:outline-none"
              data-test="package-name"
              @change="savePackageName(pack, $event)"
            />
            <span v-else class="text-text">{{ pack.name }}</span>

            <span v-if="pack.kind === 'kulek'" class="text-xs text-muted">кулёк</span>
            <span class="text-xs text-muted">
              расчёт: {{ formatWeight(pack.weightEstimatedGrams) }}
            </span>

            <label v-if="canEdit" class="flex items-center gap-1 text-xs text-muted">
              факт:
              <input
                type="number"
                min="1"
                step="1"
                :value="pack.weightActualGrams ?? ''"
                placeholder="—"
                class="w-20 rounded-lg border border-border bg-field px-2 py-1 text-xs text-text focus:border-primary focus:outline-none"
                data-test="package-weight"
                @change="savePackageWeight(pack, $event)"
              />
              г
            </label>
            <span v-else-if="pack.weightActualGrams !== null" class="text-xs text-muted">
              факт: {{ formatWeight(pack.weightActualGrams) }}
            </span>

            <span
              v-if="pack.weightActualStale"
              class="text-xs text-amber-700"
              data-test="package-stale"
            >
              перевесить
            </span>

            <span class="text-xs text-muted">{{ pack.items.length }} строк</span>

            <template v-if="canEdit">
              <template v-if="confirmingPackageId === pack.id">
                <span class="text-xs text-muted">Удалить?</span>
                <button
                  type="button"
                  class="cursor-pointer rounded-lg border border-red-600 px-2 py-0.5 text-xs text-red-600 transition-colors hover:bg-red-600 hover:text-white"
                  data-test="package-delete-confirm"
                  @click="removePackage(pack)"
                >
                  Да
                </button>
                <button
                  type="button"
                  class="cursor-pointer rounded-lg border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:text-text"
                  data-test="package-delete-cancel"
                  @click="confirmingPackageId = null"
                >
                  Нет
                </button>
              </template>
              <button
                v-else
                type="button"
                class="cursor-pointer text-xs text-muted underline transition-colors hover:text-text"
                data-test="package-delete"
                @click="confirmingPackageId = pack.id"
              >
                Удалить
              </button>
            </template>
          </li>
        </ul>

        <div v-if="unpackedRows.length" class="flex flex-col gap-1" data-test="unpacked">
          <p class="text-xs text-muted">Не расфасовано:</p>
          <ul class="flex flex-col gap-0.5">
            <li v-for="row in unpackedRows" :key="row.key" class="text-xs text-muted">
              {{ row.meal }} · {{ row.name }} — {{ formatProductAmount(row.left, row.unit) }}
            </li>
          </ul>
        </div>
      </div>

      <!-- Чек-лист покупок: живая проекция раскладки -->
      <div class="flex flex-col gap-2" data-test="checklist">
        <button
          type="button"
          class="w-full cursor-pointer rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text transition-colors hover:border-primary"
          data-test="checklist-toggle"
          @click="toggleChecklist"
        >
          {{ checksOpen ? 'Скрыть чек-лист' : 'Чек-лист покупок' }}
        </button>

        <template v-if="checksOpen">
          <p v-if="checks === null" class="text-sm text-muted" data-test="checklist-loading">
            Загружаем чек-лист…
          </p>

          <p v-else-if="checks.length === 0" class="text-sm text-muted" data-test="checklist-empty">
            В раскладке пока нет продуктов.
          </p>

          <ul v-else class="flex flex-col gap-2">
            <li
              v-for="check in checks"
              :key="check.productId"
              class="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2 text-sm"
              :class="check.isOrphaned ? 'text-muted' : 'text-text'"
              data-test="check-row"
            >
              <span>{{ check.name }}</span>
              <span class="text-xs text-muted">
                надо: {{ formatProductAmount(check.needAmount, check.unit) }}
              </span>
              <span v-if="check.isOrphaned" class="text-xs text-muted">нет в плане</span>

              <label class="flex items-center gap-1 text-xs text-muted">
                <input
                  type="checkbox"
                  :checked="check.isBought"
                  class="h-4 w-4 cursor-pointer accent-[var(--theme-primary)]"
                  data-test="check-bought"
                  @change="toggleCheck(check, 'isBought')"
                />
                куплено
              </label>

              <label class="flex items-center gap-1 text-xs text-muted">
                <input
                  type="checkbox"
                  :checked="check.isHome"
                  class="h-4 w-4 cursor-pointer accent-[var(--theme-primary)]"
                  data-test="check-home"
                  @change="toggleCheck(check, 'isHome')"
                />
                домашнее
              </label>

              <label class="flex items-center gap-1 text-xs text-muted">
                куплено:
                <input
                  type="number"
                  min="0"
                  step="1"
                  :value="check.boughtAmount ?? ''"
                  placeholder="—"
                  class="w-16 rounded-lg border border-border bg-field px-2 py-1 text-xs text-text focus:border-primary focus:outline-none"
                  data-test="check-amount"
                  @change="setCheckAmount(check, $event)"
                />
              </label>

              <span v-if="check.boughtByName" class="text-xs text-muted">
                купил(а): {{ check.boughtByName }}
              </span>
            </li>
          </ul>
        </template>
      </div>

      <!-- Чат питания: обсуждение раскладки и закупки -->
      <TripChat :trip-id="trip.id" kind="trip_meals" />
    </template>
  </section>
</template>
