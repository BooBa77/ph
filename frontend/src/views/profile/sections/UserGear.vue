<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createGearItem,
  deleteGearItem,
  listGear,
  updateGearItem,
} from '@/api/gear'
import { ApiError } from '@/api/errors'
import {
  GEAR_KINDS,
  GEAR_KIND_LABELS,
  type GearItem,
  type GearKind,
} from '@/types/gear'
import { formatWeight, formatWeightTotal } from '@/utils/gearWeight'

/**
 * «Снаряжение» — личный каталог предметов с весом.
 *
 * **Зачем каталог, если есть чек-листы.** Чек-лист отвечает «что взять
 * в этот поход», каталог — «что у меня есть и сколько это весит». Второй
 * нужен вкладке «Снаряжение» похода (Ф7): участники предлагают предметы
 * из своих каталогов, а вес рюкзака считается из этих чисел.
 *
 * **Вес правится на месте.** Самая частая правка — «взвесил позже»:
 * поэтому вес в строке — поле ввода, которое сохраняется по `change`
 * (то есть по потере фокуса, если значение изменилось). Отдельного режима
 * правки нет: он нужен ради одной цифры.
 *
 * **Итог считается на клиенте** из уже загруженных предметов. Бэкенд отдаёт
 * те же два числа, но после каждой правки перечитывать список ради суммы
 * значит лишний запрос на каждое взвешивание.
 */
const items = ref<GearItem[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)

/** Форма нового предмета. */
const newKind = ref<GearKind>('tent')
const newTitle = ref('')
const newWeight = ref('')
const newNote = ref('')
const isAdding = ref(false)

/** Что сейчас сохраняется: id предмета, чтобы не дёргать его дважды. */
const savingId = ref<string | null>(null)

/**
 * Итог: сумма известных весов и число невзвешенных.
 *
 * Считаем здесь, а не берём из ответа, — иначе после каждой правки
 * пришлось бы перечитывать список. Формулы ровно те же, что на бэкенде.
 */
const totalWeightGrams = computed(() =>
  items.value.reduce((sum, item) => sum + (item.weightGrams ?? 0), 0),
)
const itemsWithoutWeight = computed(
  () => items.value.filter((item) => item.weightGrams === null).length,
)

/** Предметы по видам, в порядке справочника. Пустые виды не рисуем. */
const groups = computed(() =>
  GEAR_KINDS.map((kind) => ({
    kind,
    label: GEAR_KIND_LABELS[kind],
    items: items.value.filter((item) => item.kind === kind),
  })).filter((group) => group.items.length > 0),
)

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

async function load() {
  isLoading.value = true
  error.value = null

  try {
    items.value = (await listGear()).items
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось загрузить снаряжение.')
  } finally {
    isLoading.value = false
  }
}

/**
 * Вес из поля: пусто — «не указан», мусор — `undefined` (и ошибка).
 *
 * Принимает и строку, и число: `v-model` на `<input type="number">`
 * во Vue 3 отдаёт **число**, а `<input>` через `:value` — строку. Проверка
 * одна, поэтому приводим к строке внутри, а не в двух местах снаружи.
 */
function parseWeight(value: string | number): number | null | undefined {
  const text = String(value).trim()
  if (text === '') return null

  const grams = Number(text)
  if (!Number.isInteger(grams) || grams <= 0) return undefined

  return grams
}

async function add() {
  const title = newTitle.value.trim()
  if (title.length === 0 || isAdding.value) return

  const weightGrams = parseWeight(newWeight.value)
  if (weightGrams === undefined) {
    error.value = 'Вес — целое число граммов, больше нуля. Или оставьте поле пустым.'
    return
  }

  isAdding.value = true
  error.value = null

  try {
    const created = await createGearItem({
      kind: newKind.value,
      title,
      weightGrams,
      note: newNote.value.trim() || null,
    })
    items.value.push(created)
    newTitle.value = ''
    newWeight.value = ''
    newNote.value = ''
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось добавить предмет.')
  } finally {
    isAdding.value = false
  }
}

/**
 * Сохранить поле на месте.
 *
 * `change` срабатывает только при реальном изменении, поэтому проверка
 * «изменилось ли» здесь не нужна — кроме пустого названия: имя стирать
 * нечем, и пустую строку просто возвращаем обратно.
 */
async function saveTitle(item: GearItem, event: Event) {
  const input = event.target as HTMLInputElement
  const title = input.value.trim()

  if (title.length === 0) {
    input.value = item.title
    return
  }
  if (title === item.title) return

  await save(item, { title })
}

async function saveWeight(item: GearItem, event: Event) {
  const input = event.target as HTMLInputElement
  const weightGrams = parseWeight(input.value)

  if (weightGrams === undefined) {
    input.value = item.weightGrams === null ? '' : String(item.weightGrams)
    error.value = 'Вес — целое число граммов, больше нуля. Пустое поле — «не знаю».'
    return
  }
  if (weightGrams === item.weightGrams) return

  await save(item, { weightGrams })
}

async function saveNote(item: GearItem, event: Event) {
  const input = event.target as HTMLInputElement
  const note = input.value.trim()

  if ((note || null) === item.note) return

  await save(item, { note: note || null })
}

async function save(
  item: GearItem,
  patch: { title?: string; weightGrams?: number | null; note?: string | null },
) {
  savingId.value = item.id
  error.value = null

  try {
    const updated = await updateGearItem(item.id, patch)
    Object.assign(item, updated)
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось сохранить предмет.')
    // Значение в поле могло разойтись с базой — перечитываем список.
    await load()
  } finally {
    savingId.value = null
  }
}

async function remove(item: GearItem) {
  savingId.value = item.id
  error.value = null

  try {
    await deleteGearItem(item.id)
    items.value = items.value.filter((row) => row.id !== item.id)
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось удалить предмет.')
  } finally {
    savingId.value = null
  }
}

onMounted(load)
</script>

<template>
  <section data-test="gear">
    <h2 class="mb-2 text-xl font-semibold text-text">Снаряжение</h2>

    <p class="mb-3 text-sm text-muted">
      Свой список предметов и их вес. Из него в походе собирается общественное снаряжение, а вес
      рюкзака считается по этим числам — поэтому взвешенное лучше невзвешенного.
    </p>

    <p v-if="error" class="mb-3 text-sm text-red-600" data-test="gear-error">{{ error }}</p>

    <p class="mb-4 text-sm font-medium text-text" data-test="gear-total">
      {{ formatWeightTotal(totalWeightGrams, itemsWithoutWeight) }}
    </p>

    <!-- Новый предмет -->
    <form
      class="mb-6 grid gap-2 sm:grid-cols-[9rem_1fr_6rem_1fr_auto] sm:items-end"
      @submit.prevent="add"
    >
      <label class="flex flex-col gap-1">
        <span class="text-xs text-muted">Вид</span>
        <select
          v-model="newKind"
          class="w-full cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
          data-test="gear-kind"
        >
          <option v-for="kind in GEAR_KINDS" :key="kind" :value="kind">
            {{ GEAR_KIND_LABELS[kind] }}
          </option>
        </select>
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-xs text-muted">Название</span>
        <input
          v-model="newTitle"
          type="text"
          maxlength="120"
          placeholder="Палатка на четверых"
          class="w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-text transition-colors focus:border-primary focus:outline-none"
          data-test="gear-title"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-xs text-muted">Вес, г</span>
        <input
          v-model="newWeight"
          type="number"
          min="1"
          step="1"
          placeholder="2400"
          class="w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-text transition-colors focus:border-primary focus:outline-none"
          data-test="gear-weight"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-xs text-muted">Заметка</span>
        <input
          v-model="newNote"
          type="text"
          maxlength="500"
          placeholder="проклеена, течёт по шву"
          class="w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-text transition-colors focus:border-primary focus:outline-none"
          data-test="gear-note"
        />
      </label>

      <button
        type="submit"
        :disabled="isAdding || newTitle.trim().length === 0"
        class="cursor-pointer rounded-xl border border-primary bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        data-test="gear-add"
      >
        {{ isAdding ? 'Добавляем…' : 'Добавить' }}
      </button>
    </form>

    <p v-if="isLoading" class="text-sm text-muted" data-test="gear-loading">
      Загружаем снаряжение…
    </p>

    <p
      v-else-if="items.length === 0"
      class="rounded-xl border border-dashed border-border p-4 text-sm text-muted"
      data-test="gear-empty"
    >
      Список пуст. Начните с того, что точно поедет в следующий поход: палатка, спальник, рюкзак.
    </p>

    <div v-else class="flex flex-col gap-5">
      <section v-for="group in groups" :key="group.kind" data-test="gear-group">
        <h3 class="mb-1 text-sm font-medium text-text">{{ group.label }}</h3>

        <ul class="flex flex-col">
          <li
            v-for="item in group.items"
            :key="item.id"
            class="grid gap-2 border-t border-border py-2 sm:grid-cols-[1fr_6rem_1fr_auto] sm:items-center"
            data-test="gear-item"
          >
            <input
              :value="item.title"
              type="text"
              maxlength="120"
              :disabled="savingId === item.id"
              class="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-text transition-colors hover:border-border focus:border-primary focus:bg-field focus:outline-none disabled:opacity-60"
              aria-label="Название предмета"
              data-test="item-title"
              @change="saveTitle(item, $event)"
            />

            <div class="flex items-center gap-1">
              <input
                :value="item.weightGrams ?? ''"
                type="number"
                min="1"
                step="1"
                placeholder="—"
                :disabled="savingId === item.id"
                class="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-right text-sm text-text transition-colors hover:border-border focus:border-primary focus:bg-field focus:outline-none disabled:opacity-60"
                aria-label="Вес в граммах"
                data-test="item-weight"
                @change="saveWeight(item, $event)"
              />
              <span class="shrink-0 text-xs text-muted">{{ formatWeight(item.weightGrams) }}</span>
            </div>

            <input
              :value="item.note ?? ''"
              type="text"
              maxlength="500"
              placeholder="заметка"
              :disabled="savingId === item.id"
              class="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-xs text-muted transition-colors hover:border-border focus:border-primary focus:bg-field focus:outline-none disabled:opacity-60"
              aria-label="Заметка"
              data-test="item-note"
              @change="saveNote(item, $event)"
            />

            <button
              type="button"
              :disabled="savingId === item.id"
              class="cursor-pointer justify-self-start rounded-xl border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-red-600 hover:text-red-600 disabled:opacity-50"
              data-test="item-delete"
              @click="remove(item)"
            >
              Убрать
            </button>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>
