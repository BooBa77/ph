<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { ApiError } from '@/api/errors'
import {
  addMyMealDish,
  addMyMealLine,
  createMyMealPackage,
  fetchMyMealPlan,
  removeMyMealDish,
  removeMyMealLine,
  removeMyMealPackage,
  setMyMealAllocations,
  updateMyMealPackage,
} from '@/api/trips'
import ProductPicker from '@/components/ui/ProductPicker.vue'
import TripMealShoppingModal from '@/views/trips/TripMealShoppingModal.vue'
import {
  TRIP_MEAL_CODES,
  TRIP_MEAL_LABELS,
  type TripMeal,
  type TripMealKind,
  type TripMealPackage,
  type TripMealPlan,
  type TripMealProduct,
} from '@/types/trips'
import {
  formatProductAmount,
  type Dish,
  type Product,
} from '@/types/meals'
import { formatWeight } from '@/utils/gearWeight'

/**
 * «Моя еда»: личная раскладка того, кто питается отдельно.
 *
 * Количества считаются на одного человека — тот же бэкенд, что и для
 * общего котла, но с составом из одного едока. Поэтому здесь нет ни
 * мясного «на N из M», ни кулька: личная еда — это свои приёмы, свои
 * продукты и своя тара.
 *
 * **Общие блюда не скрываются.** В списке рецептов — свои блюда из книги
 * и блюда, которые уже стоят в общей раскладке похода: участник берёт
 * рецепт у группы, а не заводит его заново. Чужие блюда вне похода
 * сервер не примет.
 *
 * Компонент грузит план сам: пока флаг «питаюсь отдельно» не поставлен,
 * запроса нет вовсе.
 */
const props = defineProps<{
  tripId: string
  /** Дни похода: те же, что в общей раскладке. */
  days: Array<{ index: number; date: string; kinds: TripMealKind[] }>
  /** Мои блюда из кулинарной книги. */
  dishes: Dish[]
  /** Блюда, которые уже стоят в общей раскладке: их можно взять себе. */
  sharedDishes: Array<{ dishId: string; title: string }>
}>()

const plan = ref<TripMealPlan | null>(null)
const isLoading = ref(true)
const error = ref<string | null>(null)
/** Что сейчас в полёте: ключ действия, чтобы не жать дважды. */
const busy = ref<string | null>(null)
const shoppingOpen = ref(false)

const dishDrafts = ref<Record<string, string>>({})
const lineDrafts = ref<
  Record<string, { product: Product | null; text: string; amount: string }>
>({})

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

function lineDraft(key: string): {
  product: Product | null
  text: string
  amount: string
} {
  lineDrafts.value[key] ??= { product: null, text: '', amount: '' }

  return lineDrafts.value[key]!
}

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null

  try {
    plan.value = await fetchMyMealPlan(props.tripId)
  } catch (problem) {
    error.value = messageOf(problem, 'Не удалось загрузить мою еду')
    plan.value = null
  } finally {
    isLoading.value = false
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

/** Свои пакеты: кулёк личной еды не делаем, он часть общего приёма. */
const normalPackages = computed(() =>
  (plan.value?.packages ?? []).filter((pack) => pack.kind === 'normal'),
)

const totalWeight = computed(() =>
  (plan.value?.meals ?? []).reduce(
    (sum, meal) => sum + meal.weightGrams,
    0,
  ),
)

/**
 * Рецепты для личного приёма: свои плюс общие из раскладки похода.
 *
 * Дубль по id снимается: одно и то же блюдо может быть и своим, и общим —
 * выбирать его дважды незачем.
 */
function dishesFor(meal: TripMeal | undefined): Array<{ id: string; title: string }> {
  const rows = [
    ...props.dishes.map((dish) => ({ id: dish.id, title: dish.title })),
    ...props.sharedDishes.map((dish) => ({
      id: dish.dishId,
      title: dish.title,
    })),
  ]
  const unique = new Map(rows.map((row) => [row.id, row]))
  const taken = new Set(meal?.dishes.map((dish) => dish.dishId) ?? [])

  return [...unique.values()].filter((row) => !taken.has(row.id))
}

function addDish(dayIndex: number, kind: TripMealKind) {
  const key = mealKey(dayIndex, kind)
  const dishId = dishDrafts.value[key]
  if (!dishId) return

  void run(`${key}:dish`, async () => {
    const next = await addMyMealDish(props.tripId, dayIndex, kind, dishId)
    dishDrafts.value[key] = ''

    return next
  })
}

function removeDish(dayIndex: number, kind: TripMealKind, dishId: string) {
  void run(`${mealKey(dayIndex, kind)}:dish:${dishId}`, () =>
    removeMyMealDish(props.tripId, dayIndex, kind, dishId),
  )
}

function onLineQuery(dayIndex: number, kind: TripMealKind, text: string) {
  lineDraft(mealKey(dayIndex, kind)).text = text
}

function chooseLineProduct(key: string, product: Product) {
  const draft = lineDraft(key)
  draft.product = product
  draft.text = product.name
  draft.amount = ''
}

function lineReady(key: string): boolean {
  const draft = lineDraft(key)
  const amount = Number(String(draft.amount).trim())

  return draft.text.trim().length > 0 && Number.isInteger(amount) && amount > 0
}

function addLine(dayIndex: number, kind: TripMealKind) {
  const key = mealKey(dayIndex, kind)
  const draft = lineDraft(key)

  if (!lineReady(key)) return

  const amount = Number(String(draft.amount).trim())
  const name = draft.text.trim()
  // Продукт из справочника копируется в поход; если текст правили руками —
  // это уже свой продукт, и он уедет только в личный слой.
  const catalogProductId =
    draft.product && draft.product.name === name ? draft.product.id : undefined

  void run(`${key}:line`, async () => {
    const next = await addMyMealLine(props.tripId, dayIndex, kind, {
      amount,
      ...(catalogProductId === undefined ? { name } : { catalogProductId }),
    })
    lineDrafts.value[key] = { product: null, text: '', amount: '' }

    return next
  })
}

function removeLine(dayIndex: number, kind: TripMealKind, productId: number) {
  void run(`${mealKey(dayIndex, kind)}:line:${productId}`, () =>
    removeMyMealLine(props.tripId, dayIndex, kind, productId),
  )
}

/** Первая доля строки: в личной еде хватает одного пакета на строку. */
function shareOf(product: TripMealProduct) {
  return product.allocations[0]
}

function packValue(product: TripMealProduct): string {
  return shareOf(product)?.packageId ?? ''
}

function amountValue(product: TripMealProduct): string {
  const share = shareOf(product)
  if (!share) return ''
  if (share.isElastic || share.amount === 0) return 'all'

  return String(share.amount)
}

function amountOptions(product: TripMealProduct): number[] {
  return Array.from(
    { length: Math.max(product.amount, 1) },
    (_, index) => index + 1,
  )
}

function saveShare(
  dayIndex: number,
  kind: TripMealKind,
  product: TripMealProduct,
  packageId: string,
  amount: number,
  isElastic: boolean,
) {
  void run(`${product.productId}:alloc`, () =>
    setMyMealAllocations(props.tripId, dayIndex, kind, product.productId, [
      { packageId, amount, isElastic },
    ]),
  )
}

function setPack(
  dayIndex: number,
  kind: TripMealKind,
  product: TripMealProduct,
  event: Event,
): void {
  const packageId = (event.target as HTMLSelectElement).value
  if (!packageId) return

  const share = shareOf(product)
  saveShare(
    dayIndex,
    kind,
    product,
    packageId,
    share?.amount ?? 0,
    share?.isElastic ?? false,
  )
}

function setAmount(
  dayIndex: number,
  kind: TripMealKind,
  product: TripMealProduct,
  event: Event,
): void {
  const share = shareOf(product)
  if (!share) return

  const value = (event.target as HTMLSelectElement).value
  if (value === 'all') {
    saveShare(dayIndex, kind, product, share.packageId, 0, true)

    return
  }

  const amount = Number(value)
  if (!Number.isInteger(amount) || amount <= 0) return

  saveShare(dayIndex, kind, product, share.packageId, amount, false)
}

/** Всего разложено по пакетам: остаток показываем, как в общей раскладке. */
function allocatedOf(product: TripMealProduct): number {
  return product.allocations.reduce((sum, row) => sum + row.amount, 0)
}

function addPackage(): void {
  void run('package:add', () => createMyMealPackage(props.tripId))
}

function savePackageName(pack: TripMealPackage, event: Event): void {
  const name = (event.target as HTMLInputElement).value.trim()
  if (!name || name === pack.name) return

  void run(`${pack.id}:name`, () =>
    updateMyMealPackage(props.tripId, pack.id, { name }),
  )
}

function savePackageWeight(pack: TripMealPackage, event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  const grams = raw === '' ? null : Number(raw)
  if (grams !== null && (!Number.isInteger(grams) || grams <= 0)) return

  void run(`${pack.id}:weight`, () =>
    updateMyMealPackage(props.tripId, pack.id, { weightActualGrams: grams }),
  )
}

function removePackage(pack: TripMealPackage): void {
  void run(`${pack.id}:delete`, () => removeMyMealPackage(props.tripId, pack.id))
}

onMounted(() => {
  void load()
})
</script>

<template>
  <details open class="flex flex-col gap-3" data-test="my-meals">
    <summary class="cursor-pointer select-none text-sm text-muted">
      Моя еда · отдельное питание
    </summary>

    <p v-if="isLoading" class="text-sm text-muted" data-test="my-meals-loading">
      Загружаем мою еду…
    </p>

    <p v-else-if="error" class="text-sm text-red-600" data-test="my-meals-error">
      {{ error }}
    </p>

    <template v-else-if="plan">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs text-muted" data-test="my-meals-weight">
          на одного · {{ formatWeight(totalWeight) }}
        </span>

        <button
          type="button"
          class="ml-auto cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text transition-colors hover:border-primary"
          data-test="my-meals-shopping"
          @click="shoppingOpen = true"
        >
          Мой список покупок
        </button>
      </div>

      <section
        v-for="day in days"
        :key="day.index"
        class="flex flex-col gap-2"
        data-test="my-meal-day"
      >
        <h3 class="text-sm font-medium text-text">
          День {{ day.index }}
          <span v-if="day.date" class="text-muted"> · {{ day.date }}</span>
        </h3>

        <article
          v-for="kind in day.kinds"
          :key="kind"
          class="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
          :data-test="`my-meal-${day.index}-${kind}`"
        >
          <span class="text-sm font-medium text-text">
            {{ day.index }}{{ TRIP_MEAL_CODES[kind] }} · {{ TRIP_MEAL_LABELS[kind] }}
          </span>

          <template v-if="mealOf(day.index, kind)">
            <div
              v-for="dish in mealOf(day.index, kind)!.dishes"
              :key="dish.dishId"
              class="flex flex-col gap-1"
              data-test="my-meal-dish"
            >
              <div class="flex items-start justify-between gap-2">
                <span class="font-medium text-text">{{ dish.title }}</span>
                <button
                  type="button"
                  class="cursor-pointer text-xs text-muted underline transition-colors hover:text-text"
                  :data-test="`my-meal-dish-remove-${dish.dishId}`"
                  @click="removeDish(day.index, kind, dish.dishId)"
                >
                  убрать
                </button>
              </div>

              <p v-if="dish.ingredients.length" class="text-xs text-muted">
                {{ dish.ingredients
                  .map(
                    (ingredient) =>
                      `${ingredient.name} ${formatProductAmount(ingredient.amount, ingredient.unit)}`,
                  )
                  .join(' · ') }}
              </p>
            </div>

            <ul class="flex flex-col gap-1" data-test="my-meal-products">
              <li
                v-for="product in mealOf(day.index, kind)!.products"
                :key="product.productId"
                class="flex flex-wrap items-center gap-2 text-sm text-text"
                data-test="my-meal-product"
              >
                <span class="font-medium">{{ product.name }}</span>
                <span class="text-xs text-muted">
                  {{ formatProductAmount(product.amount, product.unit) }}
                </span>
                <span
                  v-if="product.amount > allocatedOf(product)"
                  class="text-xs text-amber-700"
                  data-test="my-meal-leftover"
                >
                  не в пакете: {{ formatProductAmount(product.amount - allocatedOf(product), product.unit) }}
                </span>

                <span v-if="normalPackages.length > 0" class="flex gap-1">
                  <select
                    :value="packValue(product)"
                    :data-test="`my-alloc-pack-${product.productId}`"
                    class="min-w-0 rounded border border-border bg-field px-1 py-0.5 text-xs text-text"
                    @change="setPack(day.index, kind, product, $event)"
                  >
                    <option value="" disabled>в пакет</option>
                    <option v-for="pack in normalPackages" :key="pack.id" :value="pack.id">
                      {{ pack.name }}
                    </option>
                  </select>
                  <select
                    :value="amountValue(product)"
                    :disabled="!shareOf(product)"
                    :data-test="`my-alloc-amount-${product.productId}`"
                    class="rounded border border-border bg-field px-1 py-0.5 text-xs text-text disabled:opacity-50"
                    @change="setAmount(day.index, kind, product, $event)"
                  >
                    <option value="" disabled></option>
                    <option value="all">всё</option>
                    <option v-for="n in amountOptions(product)" :key="n" :value="String(n)">
                      {{ n }}
                    </option>
                  </select>
                </span>

                <button
                  v-if="product.manualAmount > 0"
                  type="button"
                  class="ml-auto cursor-pointer text-xs text-muted transition-colors hover:text-text"
                  title="Убрать продукт"
                  :data-test="`my-meal-line-remove-${product.productId}`"
                  @click="removeLine(day.index, kind, product.productId)"
                >
                  ×
                </button>
              </li>
            </ul>
          </template>

          <p v-else class="text-sm text-muted" data-test="my-meal-empty">Пусто</p>

          <div class="flex flex-col gap-1 border-t border-border pt-2">
            <div class="flex gap-1">
              <select
                v-model="dishDrafts[mealKey(day.index, kind)]"
                class="w-full rounded-lg border border-border bg-field px-2 py-1 text-xs text-text focus:border-primary focus:outline-none"
                :data-test="`my-meal-dish-select-${day.index}-${kind}`"
                @change="addDish(day.index, kind)"
              >
                <option value="" disabled hidden>Выберите рецепт блюда</option>
                <option
                  v-for="dish in dishesFor(mealOf(day.index, kind))"
                  :key="dish.id"
                  :value="dish.id"
                >
                  {{ dish.title }}
                </option>
              </select>
            </div>

            <div class="flex flex-col" data-test="my-meal-add">
              <ProductPicker
                :product="lineDraft(mealKey(day.index, kind)).product"
                :query="lineDraft(mealKey(day.index, kind)).text"
                :trip-id="tripId"
                class="[&_input]:rounded-b-none"
                @select="chooseLineProduct(mealKey(day.index, kind), $event)"
                @update:query="onLineQuery(day.index, kind, $event)"
              />
              <div class="flex items-center gap-1">
                <input
                  v-model="lineDraft(mealKey(day.index, kind)).amount"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="кол-во"
                  class="-mt-px w-20 shrink-0 rounded-t-none rounded-b-lg border border-border bg-field px-2 py-1.5 text-xs text-text focus:border-primary focus:outline-none"
                  :data-test="`my-meal-line-amount-${day.index}-${kind}`"
                />
                <button
                  type="button"
                  class="ml-auto shrink-0 cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="!lineReady(mealKey(day.index, kind)) || busy !== null"
                  :data-test="`my-meal-line-add-${day.index}-${kind}`"
                  @click="addLine(day.index, kind)"
                >
                  Добавить
                </button>
              </div>
            </div>
          </div>
        </article>
      </section>

      <div class="flex flex-col gap-2" data-test="my-packages">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm text-muted">Мои пакеты</h3>
          <button
            type="button"
            class="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text transition-colors hover:border-primary"
            data-test="my-package-add"
            @click="addPackage"
          >
            Добавить пакет
          </button>
        </div>

        <p v-if="normalPackages.length === 0" class="text-sm text-muted" data-test="my-packages-empty">
          Пакетов пока нет.
        </p>

        <ul v-else class="flex flex-col gap-2">
          <li
            v-for="pack in normalPackages"
            :key="pack.id"
            class="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 text-sm"
            data-test="my-package"
          >
            <input
              :value="pack.name"
              type="text"
              maxlength="60"
              class="w-32 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-text transition-colors hover:border-border focus:border-primary focus:bg-field focus:outline-none"
              data-test="my-package-name"
              @change="savePackageName(pack, $event)"
            />

            <span class="text-xs text-muted">
              расчётно: {{ formatWeight(pack.weightEstimatedGrams) }}
            </span>

            <label class="flex items-center gap-1 text-xs text-muted">
              факт:
              <input
                type="number"
                min="1"
                step="1"
                :value="pack.weightActualGrams ?? ''"
                placeholder="—"
                class="w-20 rounded-lg border border-border bg-field px-2 py-1 text-xs text-text focus:border-primary focus:outline-none"
                data-test="my-package-weight"
                @change="savePackageWeight(pack, $event)"
              />
              г
            </label>

            <button
              type="button"
              class="ml-auto cursor-pointer text-xs text-muted underline"
              data-test="my-package-delete"
              @click="removePackage(pack)"
            >
              Удалить
            </button>

            <ul v-if="pack.items.length" class="w-full border-t border-border pt-2">
              <li
                v-for="item in pack.items"
                :key="item.mealId + String(item.productId)"
                class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted"
              >
                {{ item.name }} — {{ formatWeight(item.weightGrams) }}
              </li>
            </ul>
            <p v-else class="w-full text-xs text-muted">пустой</p>
          </li>
        </ul>
      </div>
    </template>
  </details>

  <!-- Модалка вне <details>: у свёрнутой секции содержимое скрыто,
       и список покупок вместе с ним пропал бы -->
  <TripMealShoppingModal
    v-if="shoppingOpen"
    :trip-id="tripId"
    personal
    @close="shoppingOpen = false"
  />
</template>
