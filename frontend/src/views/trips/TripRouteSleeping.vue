<script setup lang="ts">
import { ref } from 'vue'

import {
  addRouteSleeping,
  removeRouteSleeping,
} from '@/api/trips'
import { createGearItem, listGear } from '@/api/gear'
import { fetchGearTypes } from '@/api/gearTypes'
import { ApiError } from '@/api/errors'
import { GEAR_TYPE_CODES } from '@/types/gear'
import type { GearItem } from '@/types/gear'
import type { Trip, TripRoute, RouteSleeping } from '@/types/trips'
import { parseWeightGrams, weightInGrams } from '@/utils/gearWeight'

/**
 * «Спальник» — личная секция ночёвки (01.11.2026).
 *
 * Слова заказчика: «Добавляем личную секцию „Спальник“, синюю… У каждого
 * участника своё содержимое. Спальники виртуальных участников организаторам
 * не показываем, это личное… В секции две кнопки „добавить спальник“
 * и „добавить коврик“, также меняют цвет на белый при добавлении, можно
 * добавлять сколько угодно спальников и ковриков».
 *
 * **Только своё.** Модель личная: `GET /route` отдаёт строки смотрящему,
 * и компонент рисует ровно их. Чужих вещей здесь нет ни у кого, включая
 * организатора, — поэтому и вопроса «а чей это спальник» не возникает.
 *
 * **Вещь — предмет каталога.** «Выбираем и отображается title… вес в пилюле
 * отображаем»: пилюля подписана названием вещи и весом, а в диалоге
 * предлагаются только свои вещи типов «Спальник» и «Коврик». Новую вещь
 * можно завести прямо отсюда — она попадёт в личный каталог и в поход.
 *
 * **Цвет кнопки — состояние секции**, как у «Кострового» (29.10.2026):
 * пока вещи этого типа нет, кнопка цветная (её и надо нажать); появилась —
 * белая, но нажимать её по-прежнему можно: второй спальник тоже бывает.
 */
const props = defineProps<{
  trip: Trip
  /** Личные вещи смотрящего: только свои, сервер чужих не отдаёт. */
  sleeping: RouteSleeping[]
}>()

const emit = defineEmits<{
  /** Вкладка после добавления или удаления — родитель заменяет состояние. */
  route: [route: TripRoute]
}>()

/**
 * Две кнопки секции. `code` — контракт типа, `label` — заголовок диалога,
 * `button` — подпись кнопки. Цветная кнопка — пока такой вещи нет.
 */
interface SleepingType {
  code: string
  label: string
  button: string
}

const SLEEPING_TYPES: readonly SleepingType[] = [
  {
    code: GEAR_TYPE_CODES.sleeping_bag,
    label: 'Спальник',
    button: 'Добавить спальник',
  },
  {
    code: GEAR_TYPE_CODES.mat,
    label: 'Коврик',
    button: 'Добавить коврик',
  },
]

/**
 * Кнопка одна на два состояния: синяя — такой вещи в секции ещё нет,
 * белая — уже есть. Классы литералами: Tailwind собирает их из исходников.
 */
const COLORED_BUTTON =
  'cursor-pointer rounded-xl border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm text-white transition-colors hover:opacity-90'
const WHITE_BUTTON =
  'cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-blue-600'

function hasType(code: string): boolean {
  return props.sleeping.some((row) => row.typeCode === code)
}

function buttonClass(type: SleepingType): string {
  return hasType(type.code) ? WHITE_BUTTON : COLORED_BUTTON
}

/**
 * Пилюля: «Спальник зимний - 1200 гр.». Веса нет — только название:
 * прочерк читался бы как ошибка, а не как «не взвесили».
 */
function pillText(row: RouteSleeping): string {
  const weight = weightInGrams(row.weightGrams)

  return weight === null ? row.title : `${row.title} - ${weight}`
}

/** Строка в списке выбора: «Спальник зимний - 1200 гр.». */
function gearOptionText(item: GearItem): string {
  const weight = weightInGrams(item.weightGrams)

  return weight === null ? item.title : `${item.title} - ${weight}`
}

// ───────────────────────────── добавление ─────────────────────────────

const isDialogOpen = ref(false)
const activeType = ref<SleepingType | null>(null)

const isLoadingGear = ref(false)
const isAdding = ref(false)
const dialogError = ref<string | null>(null)

/** Мой каталог подходящего типа, которого ещё нет в секции. */
const myGear = ref<GearItem[]>([])
const draftGearItemId = ref('')

/** Тип для заведения новой вещи: id из справочника. */
const typeId = ref<number | null>(null)
const newTitle = ref('')
const newWeight = ref('')

/** Удаление: повторное нажатие крестика не шлёт второй запрос. */
const removingId = ref<string | null>(null)
const removalError = ref<string | null>(null)

async function openDialog(type: SleepingType): Promise<void> {
  activeType.value = type
  isDialogOpen.value = true
  dialogError.value = null
  draftGearItemId.value = ''
  newTitle.value = ''
  newWeight.value = ''
  typeId.value = null
  isLoadingGear.value = true

  try {
    const [list, types] = await Promise.all([listGear(), fetchGearTypes()])

    const inTrip = new Set(props.sleeping.map((row) => row.gearItemId))

    myGear.value = list.items.filter(
      (item) => item.typeCode === type.code && !inTrip.has(item.id),
    )

    typeId.value = types.find((row) => row.code === type.code)?.id ?? null
  } catch (problem) {
    dialogError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить снаряжение'
  } finally {
    isLoadingGear.value = false
  }
}

/** Положить уже существующую вещь в ночёвку. */
async function addExisting(): Promise<void> {
  if (isAdding.value || draftGearItemId.value === '') return

  isAdding.value = true
  dialogError.value = null

  try {
    emit('route', await addRouteSleeping(props.trip.id, draftGearItemId.value))
    isDialogOpen.value = false
  } catch (problem) {
    dialogError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось добавить вещь'
  } finally {
    isAdding.value = false
  }
}

/**
 * Завести новую вещь и сразу положить её в ночёвку.
 *
 * Два запроса, а не один: каталог и ночёвка — разные вещи. Если второй
 * упадёт, вещь останется в каталоге, и это не потеря: её видно в профиле.
 */
async function createAndAdd(): Promise<void> {
  if (isAdding.value || activeType.value === null) return

  if (typeId.value === null) {
    dialogError.value = 'Типа нет в справочнике — обновите страницу или заведите вещь в профиле'
    return
  }

  const title = newTitle.value.trim()

  if (title === '') {
    dialogError.value = 'Название вещи — как вы её узнаете, например «Спальник зимний»'
    return
  }

  const weightGrams = parseWeightGrams(newWeight.value)

  if (weightGrams === undefined) {
    dialogError.value = 'Вес — целое число граммов, больше нуля. Или оставьте поле пустым.'
    return
  }

  isAdding.value = true
  dialogError.value = null

  try {
    const item = await createGearItem({
      typeId: typeId.value,
      title,
      weightGrams,
    })

    emit('route', await addRouteSleeping(props.trip.id, item.id))
    isDialogOpen.value = false
  } catch (problem) {
    dialogError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось завести вещь'
  } finally {
    isAdding.value = false
  }
}

// ───────────────────────────── удаление ─────────────────────────────

async function remove(row: RouteSleeping): Promise<void> {
  if (removingId.value !== null) return

  removingId.value = row.id
  removalError.value = null

  try {
    emit('route', await removeRouteSleeping(props.trip.id, row.id))
  } catch (problem) {
    removalError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось убрать вещь'
  } finally {
    removingId.value = null
  }
}
</script>

<template>
  <section class="flex flex-col gap-3" data-test="route-sleeping">
    <p
      v-if="removalError"
      class="text-sm text-red-600"
      data-test="route-sleeping-remove-error"
    >
      {{ removalError }}
    </p>

    <!--
      Пилюли личных вещей. Крестик убирает настоящим `DELETE`: строка
      `trip_route_sleeping` исчезает, а вещь остаётся в каталоге.
    -->
    <div
      v-if="sleeping.length > 0"
      class="flex flex-wrap items-center gap-2"
      data-test="route-sleeping-items"
    >
      <span
        v-for="row in sleeping"
        :key="row.id"
        class="flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2 py-1 text-sm text-blue-900"
        :title="row.title"
        data-test="route-sleeping-item"
      >
        <span>{{ pillText(row) }}</span>

        <button
          type="button"
          :disabled="removingId !== null"
          class="cursor-pointer border-0 bg-transparent p-0 text-blue-700 transition-colors hover:text-blue-900 disabled:cursor-not-allowed disabled:opacity-40"
          title="Убрать из ночёвки"
          :data-test="`route-sleeping-remove-${row.id}`"
          @click="remove(row)"
        >
          ×
        </button>
      </span>
    </div>

    <p v-else class="text-sm text-muted" data-test="route-sleeping-empty">
      Пока не добавлено ни спальника, ни коврика.
    </p>

    <div class="flex flex-wrap items-center gap-2" data-test="route-sleeping-buttons">
      <button
        v-for="type in SLEEPING_TYPES"
        :key="type.code"
        type="button"
        :class="buttonClass(type)"
        :data-test="`route-sleeping-add-${type.code}`"
        @click="openDialog(type)"
      >
        {{ type.button }}
      </button>
    </div>

    <!--
      Диалог: своя вещь нужного типа из каталога или новая. Ошибка — в самом
      диалоге, а не строкой под затемнением (правило «Трансфера»).
    -->
    <div
      v-if="isDialogOpen"
      class="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
      data-test="route-sleeping-dialog"
    >
      <div
        class="flex w-full max-w-md flex-col gap-3 rounded-xl border border-border bg-surface p-4"
      >
        <h3 class="text-base font-medium text-text">{{ activeType?.label }}</h3>

        <p v-if="isLoadingGear" class="text-sm text-muted" data-test="route-sleeping-loading">
          Загружаем снаряжение…
        </p>

        <template v-else>
          <label class="flex flex-col gap-1 text-sm text-muted">
            Своё снаряжение
            <select
              v-model="draftGearItemId"
              class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none md:text-sm"
              data-test="route-sleeping-gear"
            >
              <option value="">выберите…</option>
              <option v-for="item in myGear" :key="item.id" :value="item.id">
                {{ gearOptionText(item) }}
              </option>
            </select>
          </label>

          <p
            v-if="myGear.length === 0"
            class="text-xs text-muted"
            data-test="route-sleeping-no-gear"
          >
            Подходящей вещи в каталоге нет — заведите новую ниже.
          </p>

          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              :disabled="isAdding || draftGearItemId === ''"
              data-test="route-sleeping-add-existing"
              @click="addExisting"
            >
              {{ isAdding ? 'Добавляем…' : 'Добавить выбранную' }}
            </button>
          </div>

          <hr class="border-border" />

          <!--
            Новая вещь: название и вес. Тип задан кнопкой, из которой открыли
            диалог; вещь попадает в личный каталог и сразу в ночёвку.
          -->
          <p class="text-sm text-muted">Или заведите новую вещь</p>

          <label class="flex flex-col gap-1 text-sm text-muted">
            Название
            <input
              v-model="newTitle"
              type="text"
              maxlength="120"
              class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none md:text-sm"
              placeholder="Например, спальник зимний"
              data-test="route-sleeping-new-title"
            />
          </label>

          <label class="flex flex-col gap-1 text-sm text-muted">
            Вес, г
            <input
              v-model="newWeight"
              type="number"
              min="1"
              step="1"
              class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none md:text-sm"
              placeholder="необязательно"
              data-test="route-sleeping-new-weight"
            />
          </label>

          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              :disabled="isAdding || typeId === null"
              data-test="route-sleeping-create"
              @click="createAndAdd"
            >
              {{ isAdding ? 'Сохраняем…' : 'Создать и добавить' }}
            </button>

            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary"
              :disabled="isAdding"
              data-test="route-sleeping-cancel"
              @click="isDialogOpen = false"
            >
              Отмена
            </button>
          </div>

          <p
            v-if="dialogError"
            class="text-sm text-red-600"
            data-test="route-sleeping-dialog-error"
          >
            {{ dialogError }}
          </p>
        </template>
      </div>
    </div>
  </section>
</template>
