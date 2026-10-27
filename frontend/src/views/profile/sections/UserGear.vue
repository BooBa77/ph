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
import {
  createVehicle,
  fetchVehicles,
  removeVehicle,
} from '@/api/vehicles'
import {
  VEHICLE_KINDS,
  VEHICLE_KIND_LABELS,
  type Vehicle,
  type VehicleKind,
} from '@/types/trips'
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
onMounted(loadVehicles)

// ───────────────────────────── моя техника ─────────────────────────────

/**
 * «Моя техника» — отдельная секция каталога, а не строки в таблице
 * снаряжения: у техники своя структура (тип, марка, номер, вместимость),
 * и одна таблица с весом рюкзака только запутала бы.
 *
 * На вкладке «Трансфер» эта техника выбирается из списка, поэтому заводится
 * она здесь, рядом с тем, что человек и так ведёт.
 */
const vehicles = ref<Vehicle[]>([])
const vehiclesError = ref<string | null>(null)

const newVehicleKind = ref<VehicleKind>('car')
const newVehicleBrand = ref('')
const newVehiclePlate = ref('')
const newVehicleSeats = ref('')
const isAddingVehicle = ref(false)

async function loadVehicles() {
  try {
    vehicles.value = await fetchVehicles()
  } catch (problem) {
    vehiclesError.value = messageOf(problem, 'Не удалось загрузить технику')
  }
}

async function addVehicle() {
  const brand = newVehicleBrand.value.trim()

  if (!brand) {
    vehiclesError.value = 'Марка нужна — по ней техника выбирается в «Трансфере»'
    return
  }

  const rawSeats = newVehicleSeats.value.trim()
  const seats = rawSeats === '' ? null : Number(rawSeats)

  if (seats !== null && (!Number.isInteger(seats) || seats < 1)) {
    vehiclesError.value = 'Вместимость — целое число, и хотя бы одно место'
    return
  }

  isAddingVehicle.value = true
  vehiclesError.value = null

  try {
    const created = await createVehicle({
      kind: newVehicleKind.value,
      brand,
      plate: newVehiclePlate.value.trim() || null,
      seats,
    })

    vehicles.value = [...vehicles.value, created]
    newVehicleBrand.value = ''
    newVehiclePlate.value = ''
    newVehicleSeats.value = ''
  } catch (problem) {
    vehiclesError.value = messageOf(problem, 'Не удалось сохранить технику')
  } finally {
    isAddingVehicle.value = false
  }
}

async function removeVehicleById(vehicle: Vehicle) {
  vehiclesError.value = null

  try {
    await removeVehicle(vehicle.id)
    vehicles.value = vehicles.value.filter((item) => item.id !== vehicle.id)
  } catch (problem) {
    vehiclesError.value = messageOf(problem, 'Не удалось убрать технику')
  }
}
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

    <!-- Моя техника: своя структура, поэтому отдельной секцией -->
    <section class="mt-8 flex flex-col gap-3" data-test="vehicles">
      <h2 class="text-xl font-semibold text-text">Моя техника</h2>

      <p class="text-sm text-muted">
        Автомобиль, снегоход, квадроцикл, мотоцикл, велосипед или лодка. На вкладке
        «Трансфер» техника выбирается из этого списка — способ доставки и места подставятся
        сами.
      </p>

      <p v-if="vehiclesError" class="text-sm text-red-600" data-test="vehicles-error">
        {{ vehiclesError }}
      </p>

      <div class="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3">
        <label class="flex flex-col gap-1 text-xs text-muted">
          Тип
          <select
            v-model="newVehicleKind"
            class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
            data-test="vehicle-kind"
          >
            <option v-for="kind in VEHICLE_KINDS" :key="kind" :value="kind">
              {{ VEHICLE_KIND_LABELS[kind] }}
            </option>
          </select>
        </label>

        <label class="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted">
          Марка
          <input
            v-model="newVehicleBrand"
            type="text"
            maxlength="100"
            placeholder="«Нива»"
            class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
            data-test="vehicle-brand"
          />
        </label>

        <label class="flex flex-col gap-1 text-xs text-muted">
          Госномер
          <input
            v-model="newVehiclePlate"
            type="text"
            maxlength="20"
            placeholder="А123ВС38"
            class="w-32 rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
            data-test="vehicle-plate"
          />
        </label>

        <label class="flex flex-col gap-1 text-xs text-muted">
          Вместимость
          <input
            v-model="newVehicleSeats"
            type="number"
            min="1"
            max="60"
            placeholder="—"
            class="w-24 rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
            data-test="vehicle-seats"
          />
        </label>

        <button
          type="button"
          :disabled="isAddingVehicle"
          class="cursor-pointer rounded-xl border border-primary bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          data-test="vehicle-add"
          @click="addVehicle"
        >
          Добавить
        </button>
      </div>

      <p v-if="vehicles.length === 0" class="text-sm text-muted" data-test="vehicles-empty">
        Пока ничего не заведено.
      </p>

      <ul v-else class="flex flex-col gap-2" data-test="vehicles-list">
        <li
          v-for="vehicle in vehicles"
          :key="vehicle.id"
          class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3"
          data-test="vehicle-item"
        >
          <span class="text-sm text-text">
            <span class="font-medium" data-test="vehicle-item-brand">{{ vehicle.brand }}</span>
            · {{ VEHICLE_KIND_LABELS[vehicle.kind] }}
            <template v-if="vehicle.plate">
              · <span class="text-muted">{{ vehicle.plate }}</span>
            </template>
            · <span class="text-muted">{{
              vehicle.seats === null ? 'вместимость не указана' : `${vehicle.seats} мест`
            }}</span>
          </span>

          <button
            type="button"
            class="cursor-pointer rounded-xl border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-red-600 hover:text-red-600"
            data-test="vehicle-delete"
            @click="removeVehicleById(vehicle)"
          >
            Убрать
          </button>
        </li>
      </ul>
    </section>
  </section>
</template>
