<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { listGear, listTripGear, proposeTripGear } from '@/api/gear'
import { ApiError } from '@/api/errors'
import { listParticipants } from '@/api/trips'
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
 * та же ручка, что «взять палатку в поход») и сразу появляется пилюлей
 * «{хозяин} · {название} · {вес}».
 *
 * **Типы пока приблизительные.** Списка типов снаряжения в БД ещё нет:
 * у `gear_items` только вид (`kind`) из восьми значений, и «топор» или
 * «горелка» в него не входят. Пока кнопка смотрит на виды «кухня»
 * и «техника» — это приближение будущего поля; когда появится описание
 * снаряжения (основная характеристика и тип), фильтр переедет на него
 * (`gear.md` §8).
 *
 * **Чего здесь нет намеренно:** удаления предложенной вещи и счётчиков
 * «сколько топоров уже есть». Заказчик просил кнопки и предложения; остальное
 * — вместе с моделью распределения.
 */
const props = defineProps<{ trip: Trip }>()

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
}

/**
 * Шесть кнопок в порядке заказчика: топор, пила, розжиг, таган, горелка,
 * газовый баллон. Порядок — его слова, а не алфавит.
 */
const COOKING_TYPES: readonly CookingType[] = [
  { id: 'axe', label: 'Топор', button: 'Добавить топор', gearKinds: ['technical'] },
  { id: 'saw', label: 'Пила', button: 'Добавить пилу', gearKinds: ['technical'] },
  {
    id: 'firestarter',
    label: 'Розжиг',
    button: 'Добавить розжиг',
    gearKinds: ['technical', 'kitchen', 'other'],
  },
  { id: 'tagan', label: 'Таган', button: 'Добавить таган', gearKinds: ['kitchen'] },
  { id: 'stove', label: 'Горелка', button: 'Добавить горелку', gearKinds: ['kitchen'] },
  { id: 'gas', label: 'Газовый баллон', button: 'Добавить газовый баллон', gearKinds: ['kitchen'] },
]

/** Что из снаряжения похода считается костровым: кухня и техника. */
const COOKING_GEAR_KINDS: readonly GearKind[] = ['kitchen', 'technical']

/** Вещи похода и состав: имя владельца берём из состава, как в «Палатках». */
const items = ref<TripGearItem[]>([])
const people = ref<TripParticipant[]>([])

const isLoading = ref(true)
const error = ref<string | null>(null)

/**
 * Предложенное костровое: «не берём» не показываем — этой вещи в походе нет,
 * и предлагать её снова бессмысленно.
 */
const cookingItems = computed(() =>
  items.value.filter(
    (item) => COOKING_GEAR_KINDS.includes(item.kind) && item.status !== 'declined',
  ),
)

function nameOf(userId: string): string {
  return people.value.find((person) => person.userId === userId)?.displayName ?? 'Участник'
}

/**
 * Пилюля предложенной вещи: «Трегубов Сергей · Топор Fiskars X7 · 900 гр.».
 *
 * Владелец первый: по нему договариваются, кто везёт. Название — своё из
 * каталога, а не слово кнопки: человек видит, какую именно вещь взяли,
 * и две горелки разных людей не сливаются в одну.
 */
function itemTitle(item: TripGearItem): string {
  const parts = [nameOf(item.ownerUserId), item.title]
  const weight = weightInGrams(item.weightGrams)

  if (weight !== null) parts.push(weight)

  return parts.join(' · ')
}

/** Строка в списке выбора: «Топор Fiskars X7 · 900 гр.». */
function gearOptionText(item: GearItem): string {
  const weight = weightInGrams(item.weightGrams)

  return weight === null ? item.title : `${item.title} · ${weight}`
}

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
  if (isSaving.value || draftGearItemId.value === '') return

  isSaving.value = true
  dialogError.value = null

  try {
    const item = await proposeTripGear(props.trip.id, draftGearItemId.value)

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
        v-if="cookingItems.length > 0"
        class="flex flex-wrap items-center gap-2"
        data-test="route-cooking-items"
      >
        <span
          v-for="item in cookingItems"
          :key="item.id"
          class="rounded-full border border-amber-300 bg-amber-100 px-2 py-1 text-sm text-amber-900"
          data-test="route-cooking-item"
        >
          {{ itemTitle(item) }}
        </span>
      </div>

      <p v-else class="text-sm text-muted" data-test="route-cooking-empty">
        Пока никто не взял костровое снаряжение.
      </p>

      <!--
        Шесть кнопок: каждая предлагает вещь своего типа из личного каталога.
        Ряд переносится — на телефоне это две-три строки, и это нормально:
        кнопки короткие, а прятать их в меню было бы дороже.
      -->
      <div class="flex flex-wrap items-center gap-2" data-test="route-cooking-buttons">
        <button
          v-for="type in COOKING_TYPES"
          :key="type.id"
          type="button"
          class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-amber-600"
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
