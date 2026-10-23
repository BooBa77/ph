<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { ApiError } from '@/api/errors'
import { listDishes } from '@/api/meals'
import {
  addMealDish,
  fetchMealPlan,
  removeMealDish,
  removeMealLine,
  setMealForm,
  setMealLine,
  setMyStatus,
} from '@/api/trips'
import ProductPicker from '@/components/ui/ProductPicker.vue'
import { useAuthStore } from '@/stores/auth'
import {
  TRIP_MEAL_CODES,
  TRIP_MEAL_FORMS,
  TRIP_MEAL_FORM_LABELS,
  TRIP_MEAL_KINDS,
  TRIP_MEAL_LABELS,
  TRIP_MEAL_TIMES,
  type Trip,
  type TripMeal,
  type TripMealForm,
  type TripMealKind,
  type TripMealPlan,
  type TripMealProduct,
} from '@/types/trips'
import { PRODUCT_UNIT_LABELS, formatProductAmount, type Dish, type Product } from '@/types/meals'
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

const MEAL_HOURS: Record<TripMealKind, number> = {
  breakfast: 8,
  lunch: 13,
  dinner: 19,
}

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
const end = computed(() =>
  props.trip.endsAt ? new Date(props.trip.endsAt) : null,
)

/** 00:00 — «время не задано»: края дня не подрезаем. */
function isUnknownTime(date: Date | null): boolean {
  return !date || (date.getHours() === 0 && date.getMinutes() === 0)
}

/** Какие приёмы попадают в день с учётом времени заезда и выезда. */
function visibleKinds(dayIndex: number): TripMealKind[] {
  const dayCount = plan.value?.dayCount ?? 0
  const arrival =
    dayIndex === 1 && start.value && !isUnknownTime(start.value)
      ? start.value.getHours() + start.value.getMinutes() / 60
      : null
  const departure =
    dayIndex === dayCount && end.value && !isUnknownTime(end.value)
      ? end.value.getHours() + end.value.getMinutes() / 60
      : null

  return TRIP_MEAL_KINDS.filter(
    (kind) =>
      (arrival === null || MEAL_HOURS[kind] >= arrival) &&
      (departure === null || MEAL_HOURS[kind] <= departure),
  )
}

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
      kinds: visibleKinds(dayIndex),
    }
  })
})

/** Мясное на «едоков минус вегетарианцы»: подпись «на 4 из 6». */
const meatPortion = computed(() => {
  if (!plan.value) return ''

  const eaters = plan.value.eaters.total - plan.value.eaters.vegetarians

  return `на ${eaters} из ${plan.value.eaters.total}`
})

function dishComposition(meal: TripMeal): string {
  return meal.dishes
    .flatMap((dish) => dish.ingredients)
    .map(
      (ingredient) =>
        `${ingredient.name} ${formatProductAmount(ingredient.amount, ingredient.unit)}`,
    )
    .join(', ')
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

function addLine(dayIndex: number, kind: TripMealKind) {
  const key = mealKey(dayIndex, kind)
  const draft = lineDraft(key)
  const amount = Number(String(draft.amount).trim())

  if (!draft.product || !Number.isInteger(amount) || amount <= 0) {
    error.value = 'Выберите продукт и укажите количество — целое число больше нуля.'

    return
  }

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
        <h2 class="text-sm text-muted">Едоки</h2>

        <p class="text-sm text-text" data-test="eaters-counts">
          Всего {{ plan.eaters.total }}: мужчин {{ plan.eaters.men }}, женщин
          {{ plan.eaters.women }}, вегетарианцев {{ plan.eaters.vegetarians }}
        </p>

        <ul class="flex flex-col gap-1" data-test="eaters-list">
          <li
            v-for="person in plan.eaters.people"
            :key="person.userId"
            class="flex flex-wrap items-baseline gap-2 text-sm text-text"
            data-test="eater"
          >
            <span>{{ person.displayName }}</span>
            <span class="text-xs text-muted">{{ person.gender === 'm' ? 'м' : 'ж' }}</span>
            <span v-if="person.isVegetarian" class="text-xs text-muted">вегетарианец</span>
            <span v-if="person.allergies" class="text-xs text-muted">аллергии: {{ person.allergies }}</span>
            <span v-if="person.eatsSeparately" class="text-xs text-muted">питается отдельно</span>
          </li>
        </ul>

        <label v-if="me" class="flex cursor-pointer items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            class="h-4 w-4 cursor-pointer accent-[var(--theme-primary)]"
            :checked="me.eatsSeparately"
            :disabled="busy === 'separate'"
            data-test="eats-separately"
            @change="toggleSeparate"
          />
          Буду питаться отдельно
        </label>
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

          <div class="grid gap-3 md:grid-cols-3">
            <article
              v-for="kind in day.kinds"
              :key="kind"
              class="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
              :data-test="`meal-${day.index}-${kind}`"
            >
              <header class="flex flex-wrap items-baseline justify-between gap-2">
                <span class="text-sm font-medium text-text">
                  {{ day.index }}{{ TRIP_MEAL_CODES[kind] }} · {{ TRIP_MEAL_LABELS[kind] }}
                </span>
                <span class="text-xs text-muted">{{ TRIP_MEAL_TIMES[kind] }}</span>
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

                <ul class="flex flex-col gap-1">
                  <li
                    v-for="dish in mealOf(day.index, kind)!.dishes"
                    :key="dish.dishId"
                    class="flex items-start justify-between gap-2 text-sm text-text"
                    data-test="meal-dish"
                  >
                    <span>
                      {{ dish.title }}
                      <span v-if="dish.ingredients.length" class="text-xs text-muted">
                        ({{ dishComposition(mealOf(day.index, kind)!) }})
                      </span>
                    </span>
                    <button
                      v-if="canEdit"
                      type="button"
                      class="cursor-pointer text-xs text-muted underline transition-colors hover:text-text"
                      :data-test="`meal-dish-remove-${dish.dishId}`"
                      @click="removeDish(day.index, kind, dish.dishId)"
                    >
                      убрать
                    </button>
                  </li>
                </ul>

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
                  </li>
                </ul>

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
                    <option value="">Блюдо из книги…</option>
                    <option v-for="dish in dishes" :key="dish.id" :value="dish.id">
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

                <div class="flex flex-col gap-1">
                  <ProductPicker @select="chooseLineProduct(mealKey(day.index, kind), $event)" />

                  <div class="flex items-center gap-1">
                    <input
                      v-model="lineDraft(mealKey(day.index, kind)).amount"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="кол-во"
                      class="w-20 rounded-lg border border-border bg-field px-2 py-1 text-xs text-text focus:border-primary focus:outline-none"
                      :data-test="`meal-line-amount-${day.index}-${kind}`"
                    />
                    <span class="text-xs text-muted">
                      {{ lineDraft(mealKey(day.index, kind)).product ? PRODUCT_UNIT_LABELS[lineDraft(mealKey(day.index, kind)).product!.unit] : '—' }}
                    </span>
                    <button
                      type="button"
                      class="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text transition-colors hover:border-primary disabled:opacity-50"
                      :disabled="!lineDraft(mealKey(day.index, kind)).product || busy !== null"
                      :data-test="`meal-line-add-${day.index}-${kind}`"
                      @click="addLine(day.index, kind)"
                    >
                      Строка
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
        <h2 class="text-sm text-muted">Пакеты</h2>

        <p v-if="plan.packages.length === 0" class="text-sm text-muted" data-test="packages-empty">
          Пакетов пока нет.
        </p>

        <ul v-else class="flex flex-col gap-2">
          <li
            v-for="pack in plan.packages"
            :key="pack.id"
            class="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-border bg-surface p-3 text-sm"
            data-test="package"
          >
            <span class="text-text">
              {{ pack.name }}
              <span v-if="pack.kind === 'kulek'" class="text-xs text-muted">кулёк</span>
            </span>
            <span class="text-xs text-muted">{{ pack.items.length }} строк</span>
            <span class="text-xs text-muted">{{ formatWeight(pack.weightEstimatedGrams) }}</span>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>
