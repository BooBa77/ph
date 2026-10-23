<script setup lang="ts">
import { onMounted, ref } from 'vue'

import {
  addIngredient,
  createDish,
  deleteDish,
  deleteIngredient,
  listDishes,
  updateDish,
  updateIngredient,
} from '@/api/meals'
import { ApiError } from '@/api/errors'
import ProductPicker from '@/components/ui/ProductPicker.vue'
import {
  PRODUCT_UNIT_LABELS,
  type Dish,
  type DishIngredient,
  type Product,
} from '@/types/meals'
import { formatWeight } from '@/utils/gearWeight'

/**
 * «Питание» — кулинарная книга: блюда и их состав.
 *
 * Блюдо — это не текст, а **состав из продуктов**: из строк складывается
 * вес блюда и (в Ф7) раскладка по дням и список продуктов для магазина.
 * Поэтому состав собирается выбором из справочника, а не руками: два
 * написания одной гречки дали бы два разных продукта в раскладке.
 *
 * **Продукты общие, блюда личные.** Справочник только читается (пополнение
 * справочника — отдельная задача), а блюда у каждого свои: чужих здесь
 * не видно никому.
 *
 * Вес считает бэкенд и отдаёт `totalGrams`; после правки состава
 * пересчитываем локально по тем же граммам строк — иначе пришлось бы
 * перечитывать весь список на каждое изменение количества.
 */
const dishes = ref<Dish[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)

/** Новое блюдо. */
const newTitle = ref('')
const isCreating = ref(false)

/** Какое блюдо ждёт подтверждения удаления. */
const confirmingDeleteId = ref<string | null>(null)

/** Черновик состава по каждому блюду: продукт, количество и мясной флаг. */
const drafts = ref<
  Record<string, { product: Product | null; amount: string; isMeat: boolean }>
>({})

/** Что сейчас в полёте: id блюда или строки состава. */
const pendingId = ref<string | null>(null)

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

/** Пересчитать вес блюда по строкам — та же формула, что на бэкенде. */
function recalc(dish: Dish) {
  dish.totalGrams = dish.ingredients.reduce((sum, row) => sum + row.grams, 0)
}

/** Черновик состава: заводим на каждое блюдо сразу, чтобы шаблон его видел. */
function draftOf(dish: Dish): {
  product: Product | null
  amount: string
  isMeat: boolean
} {
  drafts.value[dish.id] ??= { product: null, amount: '', isMeat: false }

  return drafts.value[dish.id]!
}

/** Черновики для всех блюд — до рендера, а не во время. */
function ensureDrafts() {
  for (const dish of dishes.value) draftOf(dish)
}

async function load() {
  isLoading.value = true
  error.value = null

  try {
    dishes.value = await listDishes()
    ensureDrafts()
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось загрузить рецепты.')
  } finally {
    isLoading.value = false
  }
}

async function create() {
  const title = newTitle.value.trim()
  if (title.length === 0 || isCreating.value) return

  isCreating.value = true
  error.value = null

  try {
    dishes.value.push(await createDish(title))
    ensureDrafts()
    newTitle.value = ''
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось создать рецепт.')
  } finally {
    isCreating.value = false
  }
}

/** Переименование и заметка сохраняются на месте, по `change`. */
async function saveTitle(dish: Dish, event: Event) {
  const input = event.target as HTMLInputElement
  const title = input.value.trim()

  if (title.length === 0) {
    input.value = dish.title
    return
  }
  if (title === dish.title) return

  pendingId.value = dish.id
  error.value = null

  try {
    Object.assign(dish, await updateDish(dish.id, { title }))
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось переименовать рецепт.')
    await load()
  } finally {
    pendingId.value = null
  }
}

async function saveNote(dish: Dish, event: Event) {
  const input = event.target as HTMLInputElement
  const note = input.value.trim()

  if ((note || null) === dish.note) return

  pendingId.value = dish.id
  error.value = null

  try {
    Object.assign(dish, await updateDish(dish.id, { note: note || null }))
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось сохранить заметку.')
    await load()
  } finally {
    pendingId.value = null
  }
}

async function removeDish(dish: Dish) {
  pendingId.value = dish.id
  error.value = null

  try {
    await deleteDish(dish.id)
    dishes.value = dishes.value.filter((row) => row.id !== dish.id)
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось удалить рецепт.')
  } finally {
    pendingId.value = null
    confirmingDeleteId.value = null
  }
}

/** Выбрали продукт в подсказке: кладём в черновик этого блюда. */
function chooseProduct(dish: Dish, product: Product) {
  const draft = draftOf(dish)
  draft.product = product
  draft.amount = ''
}

async function addRow(dish: Dish) {
  const draft = draftOf(dish)
  const amount = Number(String(draft.amount).trim())

  if (!draft.product || !Number.isFinite(amount) || amount <= 0) {
    error.value = 'Выберите продукт и укажите количество — число больше нуля.'
    return
  }

  pendingId.value = dish.id
  error.value = null

  try {
    const ingredient = await addIngredient(
      dish.id,
      draft.product.id,
      amount,
      draft.isMeat,
    )
    dish.ingredients.push(ingredient)
    recalc(dish)
    drafts.value[dish.id] = { product: null, amount: '', isMeat: false }
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось добавить продукт.')
  } finally {
    pendingId.value = null
  }
}

/** Количество правится на месте: самая частая правка — «взяли больше». */
async function saveAmount(dish: Dish, ingredient: DishIngredient, event: Event) {
  const input = event.target as HTMLInputElement
  const amount = Number(input.value)

  if (!Number.isFinite(amount) || amount <= 0) {
    input.value = String(ingredient.amount)
    error.value = 'Количество — число больше нуля.'
    return
  }
  if (amount === ingredient.amount) return

  pendingId.value = ingredient.id
  error.value = null

  try {
    Object.assign(ingredient, await updateIngredient(ingredient.id, amount))
    recalc(dish)
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось изменить количество.')
    await load()
  } finally {
    pendingId.value = null
  }
}

async function removeRow(dish: Dish, ingredient: DishIngredient) {
  pendingId.value = ingredient.id
  error.value = null

  try {
    await deleteIngredient(ingredient.id)
    dish.ingredients = dish.ingredients.filter((row) => row.id !== ingredient.id)
    recalc(dish)
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось убрать продукт.')
  } finally {
    pendingId.value = null
  }
}

onMounted(load)
</script>

<template>
  <section data-test="meals">
    <h2 class="mb-2 text-xl font-semibold text-text">Питание</h2>

    <p class="mb-4 text-sm text-muted">
      Кулинарная книга: блюда из общего справочника продуктов. Из состава считается вес блюда, а в
      походе из этих блюд собирается раскладка по дням.
    </p>

    <p v-if="error" class="mb-3 text-sm text-red-600" data-test="meals-error">{{ error }}</p>

    <form class="mb-6 flex flex-wrap gap-2" @submit.prevent="create">
      <input
        v-model="newTitle"
        type="text"
        maxlength="120"
        placeholder="Название рецепта: «Каша с тушёнкой»"
        class="min-w-0 flex-1 rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
        data-test="new-dish-title"
      />
      <button
        type="submit"
        :disabled="isCreating || newTitle.trim().length === 0"
        class="cursor-pointer rounded-xl border border-primary bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        data-test="create-dish"
      >
        {{ isCreating ? 'Создаём…' : 'Создать рецепт' }}
      </button>
    </form>

    <p v-if="isLoading" class="text-sm text-muted" data-test="meals-loading">
      Загружаем рецепты…
    </p>

    <p
      v-else-if="dishes.length === 0"
      class="rounded-xl border border-dashed border-border p-4 text-sm text-muted"
      data-test="meals-empty"
    >
      Рецептов пока нет. Заведите первое — и в следующий поход раскладка соберётся из готовых.
    </p>

    <ul v-else class="flex flex-col gap-4">
      <li
        v-for="dish in dishes"
        :key="dish.id"
        class="rounded-xl border border-border bg-surface p-4"
        data-test="dish-card"
      >
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <input
            :value="dish.title"
            type="text"
            maxlength="120"
            :disabled="pendingId === dish.id"
            aria-label="Название рецепта"
            class="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-base font-medium text-text transition-colors hover:border-border focus:border-primary focus:bg-field focus:outline-none disabled:opacity-60"
            data-test="dish-title"
            @change="saveTitle(dish, $event)"
          />

          <span class="text-sm text-muted" data-test="dish-weight">
            {{ formatWeight(dish.totalGrams) }}
          </span>

          <template v-if="confirmingDeleteId === dish.id">
            <span class="text-sm text-muted">Удалить?</span>
            <button
              type="button"
              :disabled="pendingId === dish.id"
              class="cursor-pointer rounded-xl border border-red-600 px-3 py-1 text-sm text-red-600 transition-colors hover:bg-red-600 hover:text-white disabled:opacity-50"
              data-test="dish-delete-confirm"
              @click="removeDish(dish)"
            >
              Да
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border px-3 py-1 text-sm text-muted transition-colors hover:text-text"
              data-test="dish-delete-cancel"
              @click="confirmingDeleteId = null"
            >
              Нет
            </button>
          </template>
          <button
            v-else
            type="button"
            class="cursor-pointer text-sm text-muted underline transition-colors hover:text-text"
            data-test="dish-delete"
            @click="confirmingDeleteId = dish.id"
          >
            Удалить
          </button>
        </div>

        <input
          :value="dish.note ?? ''"
          type="text"
          maxlength="500"
          placeholder="Как готовить: «варить 15 минут, солить в конце»"
          :disabled="pendingId === dish.id"
          aria-label="Заметка к рецепту"
          class="mb-3 w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-xs text-muted transition-colors hover:border-border focus:border-primary focus:bg-field focus:outline-none disabled:opacity-60"
          data-test="dish-note"
          @change="saveNote(dish, $event)"
        />

        <!-- Состав -->
        <ul v-if="dish.ingredients.length > 0" class="mb-3 flex flex-col">
          <li
            v-for="ingredient in dish.ingredients"
            :key="ingredient.id"
            class="grid gap-2 border-t border-border py-1.5 sm:grid-cols-[1fr_5rem_5rem_auto] sm:items-center"
            data-test="ingredient-row"
          >
            <span class="text-sm text-text" data-test="ingredient-name">
              {{ ingredient.product.name }}
              <span
                v-if="ingredient.isMeat"
                class="ml-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted"
                data-test="ingredient-meat"
                title="В походе посчитается на едоков без вегетарианцев"
              >
                мясное
              </span>
            </span>

            <div class="flex items-center gap-1">
              <input
                :value="ingredient.amount"
                type="number"
                min="0.001"
                step="0.001"
                :disabled="pendingId === ingredient.id"
                aria-label="Количество"
                class="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-right text-sm text-text transition-colors hover:border-border focus:border-primary focus:bg-field focus:outline-none disabled:opacity-60"
                data-test="ingredient-amount"
                @change="saveAmount(dish, ingredient, $event)"
              />
              <span class="shrink-0 text-xs text-muted">
                {{ PRODUCT_UNIT_LABELS[ingredient.product.unit] }}
              </span>
            </div>

            <span class="text-xs text-muted" data-test="ingredient-grams">
              {{ formatWeight(ingredient.grams) }}
            </span>

            <button
              type="button"
              :disabled="pendingId === ingredient.id"
              class="cursor-pointer justify-self-start text-xs text-muted underline transition-colors hover:text-text disabled:opacity-50"
              data-test="ingredient-delete"
              @click="removeRow(dish, ingredient)"
            >
              Убрать
            </button>
          </li>
        </ul>

        <p v-else class="mb-3 text-sm text-muted" data-test="ingredients-empty">
          Состав пуст — добавьте продукты.
        </p>

        <!-- Новый продукт в составе -->
        <form class="flex flex-col gap-2 sm:flex-row sm:items-start" @submit.prevent="addRow(dish)">
          <div class="flex-1">
            <ProductPicker @select="chooseProduct(dish, $event)" />

            <p
              v-if="drafts[dish.id]?.product"
              class="mt-1 text-xs text-muted"
              data-test="chosen-product"
            >
              Выбрано: {{ drafts[dish.id]?.product?.name }}
            </p>
          </div>

          <div class="flex items-center gap-2">
            <input
              v-model="drafts[dish.id]!.amount"
              type="number"
              min="0.001"
              step="0.001"
              placeholder="кол-во"
              class="w-24 rounded-xl border border-border bg-field px-2 py-1.5 text-sm text-text focus:border-primary focus:outline-none"
              data-test="ingredient-amount-input"
            />
            <span class="text-xs text-muted">
              {{ drafts[dish.id]?.product ? PRODUCT_UNIT_LABELS[drafts[dish.id]!.product!.unit] : '—' }}
            </span>
            <label class="flex items-center gap-1 text-xs text-muted" title="Мясное: в походе считается без вегетарианцев">
              <input
                v-model="drafts[dish.id]!.isMeat"
                type="checkbox"
                class="h-4 w-4 cursor-pointer accent-[var(--theme-primary)]"
                data-test="ingredient-meat-input"
              />
              мясное
            </label>
            <button
              type="submit"
              :disabled="pendingId === dish.id || !drafts[dish.id]?.product"
              class="cursor-pointer rounded-xl border border-border px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              data-test="add-ingredient"
            >
              Добавить
            </button>
          </div>
        </form>
      </li>
    </ul>
  </section>
</template>
